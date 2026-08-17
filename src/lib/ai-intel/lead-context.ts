import { supabaseAdmin } from "@/lib/db";

// ── LeadContext ──────────────────────────────────────────────────────────
// Everything VeKtor needs in order to draft a personalized email or brief a
// call: the contact row, its CRM timeline, recent marketing history, open
// tasks, and the signals Touch Policy uses to decide whether we should even
// reach out.
//
// This was merchant-context.ts and it read Zoho for the lead's status and
// notes. Both now live in Supabase (contacts.application_stage,
// lead_activities), so this reads one database instead of two, which also
// takes a Zoho caller off the list blocking that subscription's cancellation.
//
// The funding fields are gone with the funding business: amount_needed,
// monthly_revenue, credit_score, use_of_funds and the portal statement flags
// used to be fed straight into the drafting prompts, which is exactly the
// cross-wiring we are removing.

export interface LeadContextInput {
  contactId?: string;
  zohoLeadId?: string;
}

export interface ContactSnapshot {
  id: string;
  email: string | null;
  phone: string | null;
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
  industry: string | null;
  website: string | null;
  biz_city: string | null;
  biz_state: string | null;
  application_stage: string | null;
  source: string | null;
  zoho_lead_id: string | null;
  do_not_contact: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export interface RecentSend {
  campaign_key: string;
  subject: string;
  sent_at: string;
  opened_at: string | null;
  clicked_at: string | null;
  replied_at: string | null;
}

export interface NoteDigest {
  title: string;
  content: string;
  modified_at: string;
}

export interface ActivityDigest {
  activity_type: string;
  direction: string | null;
  subject: string | null;
  body: string | null;
  outcome: string | null;
  occurred_at: string;
}

export interface LeadContext {
  contact: ContactSnapshot;
  /** Status, source and the note history, all from Supabase. */
  crm: {
    lead_status: string | null;
    lead_source: string | null;
    last_activity: string | null;
    notes: NoteDigest[];
  };
  recent_activity: ActivityDigest[];
  recent_sends: RecentSend[];
  open_tasks: Array<{ title: string; assigned_to: string | null; due_at: string | null }>;
  cadence: {
    track: string;
    current_day: number;
    sends_today: number;
    started_at: string;
    last_send_at: string | null;
    paused: boolean;
    paused_reason: string | null;
  } | null;
  days_since_created: number | null;
  days_since_updated: number | null;
}

export async function buildLeadContext(input: LeadContextInput): Promise<LeadContext | null> {
  let contactRow: Record<string, unknown> | null = null;

  if (input.contactId) {
    const { data } = await supabaseAdmin
      .from("contacts")
      .select("*")
      .eq("id", input.contactId)
      .maybeSingle();
    contactRow = data;
  } else if (input.zohoLeadId) {
    const { data } = await supabaseAdmin
      .from("contacts")
      .select("*")
      .eq("zoho_lead_id", input.zohoLeadId)
      .maybeSingle();
    contactRow = data;
  }

  if (!contactRow) return null;

  const c = contactRow;
  const contact: ContactSnapshot = {
    id: c.id as string,
    email: (c.email as string | null) ?? null,
    phone: ((c.phone as string | null) || (c.mobile_phone as string | null)) ?? null,
    first_name: (c.first_name as string | null) ?? null,
    last_name: (c.last_name as string | null) ?? null,
    business_name: (c.business_name as string | null) ?? null,
    industry: (c.industry as string | null) ?? null,
    website: (c.website as string | null) ?? null,
    biz_city: (c.biz_city as string | null) ?? null,
    biz_state: (c.biz_state as string | null) ?? null,
    application_stage: (c.application_stage as string | null) ?? null,
    source: (c.source as string | null) ?? null,
    zoho_lead_id: (c.zoho_lead_id as string | null) ?? null,
    do_not_contact: Boolean(c.do_not_contact),
    created_at: (c.created_at as string | null) ?? null,
    updated_at: (c.updated_at as string | null) ?? null,
  };

  const [activity, recentSends, openTasks, cadenceRow] = await Promise.all([
    fetchRecentActivity(contact.id, 10),
    fetchRecentSends(contact.id, 10),
    fetchOpenTasks(contact.id),
    fetchCadenceState(contact.id),
  ]);

  const now = Date.now();
  const daysSinceCreated = contact.created_at
    ? Math.floor((now - new Date(contact.created_at).getTime()) / 86_400_000)
    : null;
  const daysSinceUpdated = contact.updated_at
    ? Math.floor((now - new Date(contact.updated_at).getTime()) / 86_400_000)
    : null;

  return {
    contact,
    crm: {
      lead_status: contact.application_stage,
      lead_source: contact.source,
      last_activity: activity[0]?.occurred_at ?? null,
      notes: activity
        .filter((a) => a.activity_type === "note" || a.activity_type === "call")
        .map((a) => ({
          title: a.subject ?? "(no title)",
          content: (a.body ?? "").slice(0, 800),
          modified_at: a.occurred_at,
        })),
    },
    recent_activity: activity,
    recent_sends: recentSends,
    open_tasks: openTasks,
    cadence: cadenceRow,
    days_since_created: daysSinceCreated,
    days_since_updated: daysSinceUpdated,
  };
}

async function fetchRecentActivity(contactId: string, limit: number): Promise<ActivityDigest[]> {
  const { data } = await supabaseAdmin
    .from("lead_activities")
    .select("activity_type, direction, subject, body, outcome, occurred_at")
    .eq("contact_id", contactId)
    .order("occurred_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as unknown as ActivityDigest[];
}

async function fetchRecentSends(contactId: string, limit: number): Promise<RecentSend[]> {
  const { data } = await supabaseAdmin
    .from("marketing_sends")
    .select("campaign_key, subject, sent_at, opened_at, clicked_at, replied_at")
    .eq("contact_id", contactId)
    .order("sent_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as unknown as RecentSend[];
}

async function fetchOpenTasks(contactId: string) {
  const { data } = await supabaseAdmin
    .from("lead_tasks")
    .select("title, created_by, due_at")
    .eq("contact_id", contactId)
    .eq("status", "open")
    .order("due_at", { ascending: true });
  return ((data ?? []) as Array<{ title: string; created_by: string | null; due_at: string | null }>)
    .map((t) => ({ title: t.title, assigned_to: t.created_by, due_at: t.due_at }));
}

async function fetchCadenceState(contactId: string): Promise<LeadContext["cadence"]> {
  const { data } = await supabaseAdmin
    .from("cadence_state")
    .select("track, current_day, sends_today, started_at, last_send_at, paused, paused_reason")
    .eq("contact_id", contactId)
    .maybeSingle();
  if (!data) return null;
  return {
    track: data.track as string,
    current_day: Number(data.current_day),
    sends_today: Number(data.sends_today),
    started_at: data.started_at as string,
    last_send_at: (data.last_send_at as string | null) ?? null,
    paused: Boolean(data.paused),
    paused_reason: (data.paused_reason as string | null) ?? null,
  };
}

/** Compact single-line "why this lead" summary for Slack preview cards. */
export function whyThisLead(ctx: LeadContext): string {
  const who =
    ctx.contact.business_name ||
    `${ctx.contact.first_name ?? ""} ${ctx.contact.last_name ?? ""}`.trim() ||
    "unknown lead";
  const bits: string[] = [];
  if (ctx.days_since_created != null) bits.push(`${ctx.days_since_created}d old lead`);
  if (ctx.cadence) bits.push(`${ctx.cadence.track} D${ctx.cadence.current_day}`);
  if (ctx.crm.lead_status) bits.push(ctx.crm.lead_status);
  if (!ctx.contact.website) bits.push("no website on file");
  if (ctx.recent_sends.length) bits.push(`${ctx.recent_sends.length} prior sends`);
  return `${who} · ${bits.join(" · ")}`;
}

// ── Call brief snapshot ──────────────────────────────────────────────────
/**
 * The flat shape the Call Coach brief wants, keyed by whatever id the dialer
 * hands us.
 *
 * This used to read Zoho directly, because a cold Zoho lead had no `contacts`
 * row and those were most of the leads Matthew dials. The Zoho import ended
 * that: every one of them is in `contacts` now, so this resolves by contact id
 * or zoho_lead_id and reads one database.
 *
 * Deliberately narrow. It sits on the critical path of a live dial, so a slow
 * enrichment is a worse answer than a thin one.
 */
export interface LeadSnapshot {
  record_id: string;
  company: string | null;
  person: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  lead_status: string | null;
  lead_source: string | null;
  last_activity: string | null;
  days_since_modified: number | null;
  notes: NoteDigest[];
}

export async function buildLeadSnapshot(recordId: string): Promise<LeadSnapshot | null> {
  // The dialer may hand us either identifier, and a Zoho id is not a uuid, so
  // try the contacts PK first and fall back rather than guessing on shape.
  let ctx = await buildLeadContext({ contactId: recordId }).catch(() => null);
  if (!ctx) ctx = await buildLeadContext({ zohoLeadId: recordId }).catch(() => null);
  if (!ctx) return null;

  const last = ctx.crm.last_activity;
  return {
    record_id: ctx.contact.id,
    company: ctx.contact.business_name,
    person:
      [ctx.contact.first_name, ctx.contact.last_name].filter(Boolean).join(" ").trim() || null,
    email: ctx.contact.email,
    phone: ctx.contact.phone,
    website: ctx.contact.website,
    lead_status: ctx.crm.lead_status,
    lead_source: ctx.crm.lead_source,
    last_activity: last,
    days_since_modified: last
      ? Math.floor((Date.now() - new Date(last).getTime()) / 86_400_000)
      : null,
    notes: ctx.crm.notes.slice(0, 8),
  };
}
