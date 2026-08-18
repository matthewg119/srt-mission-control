// The single write-through point for every CRM mutation.
//
// Before this file, ~25 call sites wrote to Zoho directly and Supabase kept a
// partial, lossy copy. That is why status writes were dangerous: a Supabase
// write pushed to Zoho, Zoho webhooked back into /api/webhooks/zoho-lead, and
// the round trip re-fired sequences and Slack cards. The workaround at the
// time was to split contacts.disposition out of application_stage
// (docs/2026-07-27-lead-disposition.sql) and stop writing the status at all.
//
// Zoho is gone and this is the only CRM. Every write still records WHERE it
// came from (lead_status_history.origin), which is what made the round trip
// safe to break and is worth keeping now that there is nothing to echo: it is
// how the worklist tells a human edit from an audit inferring a field.

import { supabaseAdmin } from "./db";
import { invalidateWorklistCache } from "./worklist";

export type CrmOrigin =
  | "mission_control"
  | "zoho"
  | "slack"
  | "ai"
  | "portal"
  | "import"
  | "webhook"
  // An AI visibility audit inferring fields from the live website. Kept distinct from
  // "ai" because updateLeadFields treats it differently: an audit writes field history
  // but does NOT log the summary activity, so a scan cannot reorder the worklist.
  // lead_field_history's check constraint mirrors this union.
  | "audit_engine";

type Rec = Record<string, unknown>;

async function logSystem(
  eventType: string,
  description: string,
  metadata: Rec = {}
): Promise<void> {
  try {
    await supabaseAdmin
      .from("system_logs")
      .insert({ event_type: eventType, description, metadata });
  } catch {
    // Never let telemetry break a write.
  }
}

// ─────────────────────────────────────────────────────────────────────
// Contact resolution
// ─────────────────────────────────────────────────────────────────────
//
// ONE lookup, five keys. Before this, "find the person behind this phone
// number" was written six times across the tree — in api/imessage/inbound,
// api/loopmessage/inbound, api/ext/lead/resolve, api/sms/compose,
// ai-intel/smart-followup and here — each with its own column list, its own
// null handling, and three of them with their own live Zoho fallback. They
// disagreed about what a match even was, so the extension could name a lead the
// inbound webhook had already discarded.
//
// Everything that needs to turn a phone, an email or an id into a person calls
// resolveLead(). It is the seam the Zoho cutover, the email panel, the text
// thread and the dialer all sit on.

/** A person, as the rest of the app should see them. Never a Zoho record. */
export interface LeadRef {
  id: string;
  firstName: string | null;
  lastName: string | null;
  businessName: string | null;
  email: string | null;
  phone: string | null;
  mobilePhone: string | null;
  website: string | null;
  applicationStage: string | null;
  doNotContact: boolean;
  zohoLeadId: string | null;
  workingState: string | null;
  /** Where the lead came from. The successor of Zoho's Lead_Source. */
  source: string | null;
  /** Business name, else person name, else email, else phone. Never empty. */
  displayName: string;
}

/**
 * Verified against the live table with scripts/_probe-contacts-columns.ts.
 *
 * `contacts` was built in the Supabase console and has drifted from the code's
 * assumptions more than once, and PostgREST fails the WHOLE query on a single
 * unknown column — it does not degrade, it 400s the entire lane. So this list
 * is checked, not assumed, and the probe script is how you check it again.
 */
const LEAD_COLS =
  "id, first_name, last_name, business_name, email, phone, mobile_phone, " +
  "website, application_stage, do_not_contact, zoho_lead_id, working_state, source";

/** Zoho handed back "" for unset text, never null, so `a ?? b` never reached b.
 *  Callers were written around that. Normalizing here means they no longer have
 *  to be, and a blank name can never pass a "did we get a name" check again. */
function blank(v: unknown): string | null {
  const t = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
  return t.length > 0 ? t : null;
}

type ContactRow = Record<string, unknown>;

/** Takes `unknown` on purpose. PostgREST types a runtime column-list string as
 *  a union with GenericStringError, so every caller would otherwise need the
 *  same cast. blank() already treats anything non-string as absent, so a
 *  surprise shape degrades to nulls rather than throwing. */
function toLeadRef(raw: unknown): LeadRef {
  const row = raw as ContactRow;
  const firstName = blank(row.first_name);
  const lastName = blank(row.last_name);
  const businessName = blank(row.business_name);
  const email = blank(row.email);
  const phone = blank(row.phone);
  const mobilePhone = blank(row.mobile_phone);
  const personName = [firstName, lastName].filter(Boolean).join(" ") || null;

  return {
    id: String(row.id),
    firstName,
    lastName,
    businessName,
    email,
    phone,
    mobilePhone,
    website: blank(row.website),
    applicationStage: blank(row.application_stage),
    doNotContact: row.do_not_contact === true,
    zohoLeadId: blank(row.zoho_lead_id),
    workingState: blank(row.working_state),
    source: blank(row.source),
    displayName:
      businessName ?? personName ?? email ?? phone ?? mobilePhone ?? "Unknown lead",
  };
}

export interface ResolveLeadInput {
  contactId?: string | null;
  zohoLeadId?: string | null;
  phone?: string | null;
  email?: string | null;
  businessName?: string | null;
}

/**
 * Find a person in `contacts`, cheapest and most certain first.
 *
 * The ladder is ordered by how a step can be WRONG, not by convenience:
 *   id            cannot be wrong.
 *   zoho_lead_id  unique index; cannot be wrong while the column survives.
 *   phone         a shared front-desk line legitimately matches two businesses,
 *                 so this takes the first hit and does not pretend to be sure.
 *   email         near-certain for one hit.
 *   businessName  weakest. Only accepted when EXACTLY one row comes back.
 *
 * Returns null when nothing matches. A null is not permission to discard the
 * work: inbound messaging keeps the thread under the bare phone number, because
 * dropping a real reply from an unrecognized number is worse than an unnamed one.
 */
export async function resolveLead(a: ResolveLeadInput): Promise<LeadRef | null> {
  const { matches, rung } = await resolveLeadCandidates(a);
  if (!matches.length) return null;
  // businessName is the one rung that refuses an ambiguous answer outright.
  if (rung === "businessName" && matches.length !== 1) return null;
  return matches[0];
}

/** Which lookup key produced the match. Callers turn this into a confidence. */
export type ResolveRung = "contactId" | "zohoLeadId" | "phone" | "email" | "businessName";

export interface ResolveCandidates {
  /** Everyone the first matching rung returned. Empty when nothing matched. */
  matches: LeadRef[];
  /** The rung that produced `matches`. Null when nothing matched. */
  rung: ResolveRung | null;
}

/** How many rows an ambiguous rung reports. Enough for a 1/2/3 confirm strip. */
const CANDIDATE_LIMIT = 3;

/**
 * The same ladder as resolveLead(), but it says WHICH rung answered and hands
 * back every row that rung found instead of silently taking the first.
 *
 * Call Coach needs both: a phone that matches two businesses must not
 * auto-commit, and "one hit on a unique business name" is a far weaker claim
 * than "this is the contact id". resolveLead() is a thin wrapper over this so
 * there is still exactly one ladder to keep correct.
 */
export async function resolveLeadCandidates(a: ResolveLeadInput): Promise<ResolveCandidates> {
  const none: ResolveCandidates = { matches: [], rung: null };

  if (a.contactId) {
    const { data } = await supabaseAdmin
      .from("contacts")
      .select(LEAD_COLS)
      .eq("id", a.contactId)
      .maybeSingle();
    if (data) return { matches: [toLeadRef(data)], rung: "contactId" };
  }

  if (a.zohoLeadId) {
    const { data } = await supabaseAdmin
      .from("contacts")
      .select(LEAD_COLS)
      .eq("zoho_lead_id", a.zohoLeadId)
      .maybeSingle();
    if (data) return { matches: [toLeadRef(data)], rung: "zohoLeadId" };
  }

  if (a.phone) {
    // phone_last10 and mobile_last10 are STORED generated columns
    // (docs/2026-06-04-contacts-phone-last10.sql). They are phone-only and
    // mobile-only respectively and are NOT coalesced, so both must be checked
    // or 10% of the book silently stops matching. Contacts store phones in
    // mixed formats with none in E.164, which is why exact matching on `phone`
    // found nobody and every inbound iMessage used to be discarded.
    const last10 = a.phone.replace(/\D/g, "").slice(-10);
    if (last10.length === 10) {
      const { data } = await supabaseAdmin
        .from("contacts")
        .select(LEAD_COLS)
        .or(`phone_last10.eq.${last10},mobile_last10.eq.${last10}`)
        .limit(CANDIDATE_LIMIT);
      if (data?.length) return { matches: data.map(toLeadRef), rung: "phone" };
    }
  }

  if (a.email) {
    const email = a.email.trim();
    // ilike, not eq: the index is on lower(email) (contacts_email_lower_idx),
    // and an eq would neither use it nor match a differently-cased address.
    if (email) {
      const { data } = await supabaseAdmin
        .from("contacts")
        .select(LEAD_COLS)
        .ilike("email", email)
        .limit(CANDIDATE_LIMIT);
      if (data?.length) return { matches: data.map(toLeadRef), rung: "email" };
    }
  }

  if (a.businessName) {
    const { data } = await supabaseAdmin
      .from("contacts")
      .select(LEAD_COLS)
      .ilike("business_name", a.businessName)
      .limit(CANDIDATE_LIMIT);
    // More than one hit means we do not know which, and guessing writes a call
    // note onto the wrong company's record, where it stays. resolveLead()
    // refuses outright; a caller with a confirm strip can offer the choice.
    if (data?.length) return { matches: data.map(toLeadRef), rung: "businessName" };
  }

  return none;
}

// ─────────────────────────────────────────────────────────────────────
// Activity log
// ─────────────────────────────────────────────────────────────────────

export interface LogActivityInput {
  contactId: string;
  dealId?: string | null;
  /**
   * note | call | email | sms | meeting | task_created | task_completed
   * | status_change | portal | submission | snooze | system
   */
  activityType: string;
  direction?: "inbound" | "outbound" | "internal";
  channel?: string;
  subject?: string;
  body?: string;
  outcome?: string;
  durationSecs?: number;
  occurredAt?: string | Date;
  actor?: string;
  actorEmail?: string;
  source: string;
  externalId?: string;
  externalModule?: string;
  metadata?: Rec;
}

/**
 * Append to the timeline. Idempotent on (source, external_id) when an
 * externalId is supplied, so replaying a webhook or re-running an import
 * cannot double-log.
 *
 * Returns the activity id, or null if the write failed — callers should treat
 * a failed log as non-fatal, since losing a timeline row is better than
 * failing the user's actual action.
 */
export async function logActivity(input: LogActivityInput): Promise<string | null> {
  // Every mutating path in this module funnels through here (calls, notes,
  // status changes, task created/completed), and all of them can change
  // whether a lead belongs on the call board. Dropping the memoised candidate
  // set here means one invalidation point instead of eight.
  invalidateWorklistCache();

  const occurredAt =
    input.occurredAt instanceof Date
      ? input.occurredAt.toISOString()
      : (input.occurredAt ?? new Date().toISOString());

  const row = {
    contact_id: input.contactId,
    deal_id: input.dealId ?? null,
    activity_type: input.activityType,
    direction: input.direction ?? null,
    channel: input.channel ?? null,
    subject: input.subject ?? null,
    body: input.body ?? null,
    outcome: input.outcome ?? null,
    duration_secs: input.durationSecs ?? null,
    occurred_at: occurredAt,
    actor: input.actor ?? null,
    actor_email: input.actorEmail ?? null,
    source: input.source,
    external_id: input.externalId ?? null,
    external_module: input.externalModule ?? null,
    metadata: input.metadata ?? {},
  };

  try {
    if (input.externalId) {
      const { data, error } = await supabaseAdmin
        .from("lead_activities")
        .upsert(row, { onConflict: "source,external_id", ignoreDuplicates: true })
        .select("id")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (data?.id) return data.id as string;
      // ignoreDuplicates returns nothing when the row already existed.
      const { data: existing } = await supabaseAdmin
        .from("lead_activities")
        .select("id")
        .eq("source", input.source)
        .eq("external_id", input.externalId)
        .maybeSingle();
      return (existing?.id as string) ?? null;
    }

    const { data, error } = await supabaseAdmin
      .from("lead_activities")
      .insert(row)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data.id as string;
  } catch (e) {
    console.error("[crm.logActivity] failed:", (e as Error).message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Activity log — reads
// ─────────────────────────────────────────────────────────────────────

/**
 * Every column anything in the app reads off `lead_activities`, verified against
 * the table definition in docs/2026-08-17-crm-core.sql.
 *
 * Deliberately not select("*"): `metadata` is a jsonb bag no reader uses, and
 * most callers JSON.stringify these rows straight into an LLM prompt, where it
 * would be paid for by the token.
 */
const ACTIVITY_COLS =
  "id, contact_id, activity_type, direction, channel, subject, body, " +
  "outcome, duration_secs, occurred_at, actor, source";

const ACTIVITY_LIMIT_DEFAULT = 50;
const ACTIVITY_LIMIT_MAX = 500;

/**
 * A timeline row, raw.
 *
 * snake_case on purpose. `LeadRef` is camelCase because `contacts` is a drifted
 * 169-column table that needs a translation layer; `lead_activities` was defined
 * once and every existing reader in the app already consumes the raw column
 * names. Renaming them here would mean no existing caller could adopt this
 * without a rewrite, which is the opposite of the point.
 */
export interface LeadActivityRow {
  id: string;
  contact_id: string;
  activity_type: string;
  direction: string | null;
  channel: string | null;
  subject: string | null;
  body: string | null;
  outcome: string | null;
  duration_secs: number | null;
  occurred_at: string;
  actor: string | null;
  source: string;
}

export interface GetLeadActivitiesInput {
  /** One contact, or many. Many is how a board scan reads N contacts in one
   *  round trip instead of N round trips. */
  contactId: string | string[];
  /** Restrict to these `activity_type` values. Omit for the whole timeline. */
  types?: string[];
  /** Clamped to 1..500. Defaults to 50. */
  limit?: number;
}

/**
 * The lead timeline. One reader, so the column list and the ordering are decided
 * in one place rather than in each of the seven near-identical copies that grew
 * across the app.
 */
export async function getLeadActivities(
  a: GetLeadActivitiesInput
): Promise<LeadActivityRow[]> {
  const ids = (Array.isArray(a.contactId) ? a.contactId : [a.contactId]).filter(Boolean);
  // .in("contact_id", []) goes on the wire as `in.()` and 400s the query. An
  // empty caller list is a no-op, not an error, so it never reaches PostgREST.
  if (ids.length === 0) return [];

  const raw = Number(a.limit);
  const limit = Number.isFinite(raw)
    ? Math.min(Math.max(Math.trunc(raw), 1), ACTIVITY_LIMIT_MAX)
    : ACTIVITY_LIMIT_DEFAULT;

  try {
    let q = supabaseAdmin.from("lead_activities").select(ACTIVITY_COLS);
    q = ids.length === 1 ? q.eq("contact_id", ids[0]) : q.in("contact_id", ids);
    if (a.types?.length) q = q.in("activity_type", a.types);

    // Newest first, always, and not an option. Both composite indexes are
    // occurred_at DESC, so it is the only ordering that is free. created_at
    // breaks the tie, because setLeadStatus writes a status_change and logCall
    // writes a call in the same millisecond, and "whichever row came back" is
    // not an ordering.
    const { data, error } = await q
      .order("occurred_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw new Error(error.message);
    // Same cast as toLeadRef: PostgREST types a runtime column-list string as a
    // union with GenericStringError.
    return (data ?? []) as unknown as LeadActivityRow[];
  } catch (e) {
    // Same posture as logActivity. A timeline read is context, never the point
    // of the request, so losing it beats failing the caller's actual job.
    console.error("[crm.getLeadActivities] failed:", (e as Error).message);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────
// Status
// ─────────────────────────────────────────────────────────────────────

export interface SetLeadStatusInput {
  contactId?: string;
  zohoLeadId?: string;
  status: string;
  reason?: string;
  origin: CrmOrigin;
  actor?: string;
}

export interface SetLeadStatusResult {
  ok: boolean;
  contactId: string | null;
  landedStatus: string | null;
  error?: string;
}

export async function setLeadStatus(
  input: SetLeadStatusInput
): Promise<SetLeadStatusResult> {
  const contact = await resolveLead({
    contactId: input.contactId,
    zohoLeadId: input.zohoLeadId,
  });

  const landedStatus = input.status;

  // ── Supabase ───────────────────────────────────────────────────────
  if (!contact) {
    return {
      ok: false,
      contactId: null,
      landedStatus,
      error: "no matching contact in Supabase",
    };
  }

  const oldStatus = contact.applicationStage;
  const now = new Date().toISOString();

  if (oldStatus !== landedStatus) {
    const { error } = await supabaseAdmin
      .from("contacts")
      .update({
        application_stage: landedStatus,
        application_stage_updated_at: now,
        application_stage_origin: input.origin,
      })
      .eq("id", contact.id);

    if (error) {
      return {
        ok: false,
        contactId: contact.id,
        landedStatus,
        error: error.message,
      };
    }

    await supabaseAdmin.from("lead_status_history").insert({
      contact_id: contact.id,
      old_status: oldStatus,
      new_status: landedStatus,
      reason: input.reason ?? null,
      origin: input.origin,
      actor: input.actor ?? null,
      occurred_at: now,
    });

    await logActivity({
      contactId: contact.id,
      activityType: "status_change",
      direction: "internal",
      channel: input.origin === "zoho" ? "zoho" : "web",
      subject: `${oldStatus ?? "—"} → ${landedStatus}`,
      body: input.reason,
      actor: input.actor,
      source: input.origin === "zoho" ? "zoho" : "mission_control",
      metadata: { oldStatus, newStatus: landedStatus, origin: input.origin },
    });
  }

  return { ok: true, contactId: contact.id, landedStatus };
}

// ─────────────────────────────────────────────────────────────────────
// Notes
// ─────────────────────────────────────────────────────────────────────

export interface AddNoteInput {
  contactId?: string;
  zohoLeadId?: string;
  businessName?: string;
  title: string;
  content: string;
  origin: CrmOrigin;
  actor?: string;
  /** Set when replaying an already-recorded note, for idempotency. */
  externalId?: string;
  dealId?: string | null;
}

export async function addNote(input: AddNoteInput): Promise<{
  ok: boolean;
  activityId: string | null;
  contactId: string | null;
}> {
  const contact = await resolveLead({
    contactId: input.contactId,
    zohoLeadId: input.zohoLeadId,
    businessName: input.businessName,
  });

  if (!contact) {
    return { ok: false, activityId: null, contactId: null };
  }

  const activityId = await logActivity({
    contactId: contact.id,
    dealId: input.dealId ?? null,
    activityType: "note",
    direction: "internal",
    channel: input.origin === "zoho" ? "zoho" : "web",
    subject: input.title,
    body: input.content,
    actor: input.actor,
    source: input.origin === "zoho" ? "zoho" : "mission_control",
    externalId: input.externalId,
    externalModule: input.externalId ? "Notes" : undefined,
    metadata: { origin: input.origin },
  });

  return { ok: !!activityId, activityId, contactId: contact.id };
}

// ─────────────────────────────────────────────────────────────────────
// Tasks — the follow-up dates the whole worklist runs on
// ─────────────────────────────────────────────────────────────────────

export interface CreateTaskInput {
  contactId: string;
  title: string;
  dueAt: string | Date;
  description?: string;
  taskType?: string;
  priority?: "low" | "normal" | "high";
  origin: CrmOrigin;
  actor?: string;
  dealId?: string | null;
}

export async function createTask(input: CreateTaskInput): Promise<{
  ok: boolean;
  taskId: string | null;
  error?: string;
}> {
  const dueAt =
    input.dueAt instanceof Date ? input.dueAt.toISOString() : new Date(input.dueAt).toISOString();

  if (Number.isNaN(new Date(dueAt).getTime())) {
    return { ok: false, taskId: null, error: "invalid dueAt" };
  }

  const { data, error } = await supabaseAdmin
    .from("lead_tasks")
    .insert({
      contact_id: input.contactId,
      deal_id: input.dealId ?? null,
      title: input.title,
      description: input.description ?? null,
      task_type: input.taskType ?? "followup",
      priority: input.priority ?? "normal",
      status: "open",
      due_at: dueAt,
      created_by: input.actor ?? input.origin,
      source: "mission_control",
    })
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, taskId: null, error: error?.message };
  }

  await logActivity({
    contactId: input.contactId,
    dealId: input.dealId ?? null,
    activityType: "task_created",
    direction: "internal",
    subject: input.title,
    body: `Follow-up set for ${dueAt.slice(0, 10)}`,
    actor: input.actor,
    source: "mission_control",
    metadata: { taskId: data.id, dueAt, origin: input.origin },
  });

  return { ok: true, taskId: data.id as string };
}

export async function completeTask(
  taskId: string,
  a: { actor: string; outcome?: string }
): Promise<{ ok: boolean; contactId: string | null; error?: string }> {
  const { data: task } = await supabaseAdmin
    .from("lead_tasks")
    .select("id, contact_id, title, zoho_task_id, status")
    .eq("id", taskId)
    .maybeSingle();

  if (!task) return { ok: false, contactId: null, error: "task not found" };
  if (task.status !== "open") {
    return { ok: true, contactId: task.contact_id as string };
  }

  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("lead_tasks")
    .update({
      status: "done",
      completed_at: now,
      completed_by: a.actor,
      outcome: a.outcome ?? null,
      updated_at: now,
    })
    .eq("id", taskId);

  if (error) return { ok: false, contactId: task.contact_id as string, error: error.message };

  await logActivity({
    contactId: task.contact_id as string,
    activityType: "task_completed",
    direction: "internal",
    subject: task.title as string,
    body: a.outcome,
    actor: a.actor,
    source: "mission_control",
    metadata: { taskId },
  });

  return { ok: true, contactId: task.contact_id as string };
}

// ─────────────────────────────────────────────────────────────────────
// Snooze + field edits
// ─────────────────────────────────────────────────────────────────────

export async function snoozeLead(a: {
  contactId: string;
  until: string | Date;
  reason: string;
  actor: string;
}): Promise<{ ok: boolean; error?: string }> {
  const until = a.until instanceof Date ? a.until.toISOString() : new Date(a.until).toISOString();
  if (Number.isNaN(new Date(until).getTime())) {
    return { ok: false, error: "invalid until date" };
  }
  // Snoozing removes a lead from the board without writing an activity, so it
  // needs its own invalidation.
  invalidateWorklistCache();

  const { error } = await supabaseAdmin
    .from("contacts")
    .update({
      snoozed_until: until,
      snooze_reason: a.reason,
      working_state: "snoozed",
    })
    .eq("id", a.contactId);

  if (error) return { ok: false, error: error.message };

  await logActivity({
    contactId: a.contactId,
    activityType: "snooze",
    direction: "internal",
    subject: `Snoozed until ${until.slice(0, 10)}`,
    body: a.reason,
    actor: a.actor,
    source: "mission_control",
    metadata: { until },
  });

  return { ok: true };
}

/**
 * Field edits from the lead detail form.
 *
 * Deliberately does NOT accept application_stage — status has its own path
 * with history and echo handling, and letting a generic PATCH set it would
 * reopen exactly the hole this module exists to close.
 */
export async function updateLeadFields(a: {
  contactId: string;
  patch: Rec;
  origin: CrmOrigin;
  actor?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const patch = { ...a.patch };
  delete patch.application_stage;
  delete patch.id;
  delete patch.zoho_lead_id;

  if (Object.keys(patch).length === 0) return { ok: true };

  // Read BEFORE the write. This is the only moment the old values still exist, and
  // "the audit overwrote something I typed" is unrecoverable without them.
  const fields = Object.keys(patch);
  const { data: before } = await supabaseAdmin
    .from("contacts")
    .select(fields.join(", "))
    .eq("id", a.contactId)
    .maybeSingle();

  const { error } = await supabaseAdmin
    .from("contacts")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", a.contactId);

  if (error) return { ok: false, error: error.message };

  await recordFieldHistory({
    contactId: a.contactId,
    before: (before ?? {}) as Rec,
    patch,
    origin: a.origin,
    actor: a.actor,
  });

  // The per-field rows above are the record. This summary activity exists only because
  // it TOUCHES the lead: inserting into lead_activities fires the trigger that bumps
  // contacts.last_activity_at and reorders the worklist. A human editing a lead is a
  // touch and should move it. An audit inferring six fields is not, and letting a scan
  // shove the call list around every time it ran was the reason field history got its
  // own table in the first place.
  if (a.origin !== "audit_engine") {
    await logActivity({
      contactId: a.contactId,
      activityType: "system",
      direction: "internal",
      subject: "Fields updated",
      body: Object.keys(patch).join(", "),
      actor: a.actor,
      source: "mission_control",
      metadata: { fields: Object.keys(patch), origin: a.origin },
    });
  }

  return { ok: true };
}

/** Display text for a stored value. Null and empty both read as "empty" upstream. */
function historyValue(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (Array.isArray(v)) return v.map((x) => String(x)).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/**
 * One row per field that actually changed.
 *
 * Best effort by design, like logActivity: a bookkeeping insert must never be the
 * reason a field edit or a finished audit reports failure. Unchanged fields are
 * skipped, so a patch that rewrites the same value produces no history noise.
 */
async function recordFieldHistory(a: {
  contactId: string;
  before: Rec;
  patch: Rec;
  origin: CrmOrigin;
  actor?: string;
}): Promise<void> {
  const rows = Object.entries(a.patch)
    .map(([field, next]) => ({
      contact_id: a.contactId,
      field,
      old_value: historyValue(a.before?.[field]),
      new_value: historyValue(next),
      origin: a.origin,
      actor: a.actor ?? null,
    }))
    .filter((r) => r.old_value !== r.new_value);

  if (rows.length === 0) return;

  const { error } = await supabaseAdmin.from("lead_field_history").insert(rows);
  if (error) console.error("[crm] field history insert failed:", error.message);
}

/**
 * Log a call. THE core interaction of the new CRM.
 *
 * A follow-up date is mandatory by design, not by oversight: the worklist's
 * primary bucket is "working lead with no open follow-up", so a call that
 * leaves no next date silently drops the lead into that bucket forever. Making
 * it required at the only place calls are recorded is what keeps the board
 * honest. The API route and the chat tool both enforce the same rule.
 */
export async function logCall(a: {
  contactId: string;
  outcome: string;
  nextFollowUpAt: string | Date;
  notes?: string;
  durationSecs?: number;
  nextStep?: string;
  actor: string;
  origin: CrmOrigin;
}): Promise<{
  ok: boolean;
  activityId: string | null;
  taskId: string | null;
  error?: string;
}> {
  const followUp =
    a.nextFollowUpAt instanceof Date
      ? a.nextFollowUpAt
      : new Date(a.nextFollowUpAt);

  if (Number.isNaN(followUp.getTime())) {
    return {
      ok: false,
      activityId: null,
      taskId: null,
      error: "A follow-up date is required on every logged call.",
    };
  }

  const activityId = await logActivity({
    contactId: a.contactId,
    activityType: "call",
    direction: "outbound",
    channel: "phone",
    subject: `Call — ${a.outcome}`,
    body: a.notes,
    outcome: a.outcome,
    durationSecs: a.durationSecs,
    actor: a.actor,
    source: "mission_control",
    metadata: { nextStep: a.nextStep ?? null, origin: a.origin },
  });

  const task = await createTask({
    contactId: a.contactId,
    title: a.nextStep || `Follow up after ${a.outcome} call`,
    dueAt: followUp,
    taskType: "call",
    origin: a.origin,
    actor: a.actor,
  });

  // A call always makes a lead "working" — it is no longer untouched, and it
  // is no longer snoozed.
  await supabaseAdmin
    .from("contacts")
    .update({ working_state: "working", snoozed_until: null, snooze_reason: null })
    .eq("id", a.contactId)
    .neq("working_state", "closed");

  return { ok: true, activityId, taskId: task.taskId };
}
