// Zoho → Supabase. The PULL direction.
//
// zoho-backfill.ts already pushes Supabase contacts INTO Zoho. This file is
// the opposite, and it is what makes Mission Control the CRM of record:
// every Lead, Note, Call, Task and Event comes across into `contacts`,
// `lead_activities` and `lead_tasks`.
//
// Three design decisions worth knowing before editing:
//
// 1. WHOLE-MODULE PULLS, NOT PER-LEAD. Fetching /Leads/{id}/Notes for every
//    lead is O(leads) requests — ~10k API credits and an hour for a 10k-lead
//    org, with no clean resume point. GET /Notes?per_page=200 is a few hundred
//    requests and finishes in a couple of minutes. The tradeoff is that we
//    must resolve each activity's parent ourselves, which is what
//    buildZohoIdIndex() is for.
//
// 2. converted=both ON EVERY LEADS READ. Zoho v5 defaults GET /Leads to
//    converted=false. Without the param a full pull silently drops every
//    lead that ever became a deal — the entire won-business history. This is
//    the single most dangerous line in the file.
//
// 3. IDEMPOTENT BY CONSTRUCTION. Everything upserts on a unique index
//    (contacts.zoho_lead_id, lead_activities(source, external_id),
//    lead_tasks(source, external_id)), so a re-run is a no-op and a crashed
//    run can simply be run again. Re-running the full pull and getting
//    identical counts is the Phase 1 acceptance test.

import { supabaseAdmin } from "./db";
import { listAllRecords, zohoRequest, type ZohoApiRecord } from "./zoho";
import { buildContactFromZohoLead } from "./field-map";
import { parseBusinessDate } from "./business-time";

export type PullEntity =
  | "leads"
  | "notes"
  | "calls"
  | "tasks"
  | "events"
  | "deleted_leads";

export const PULL_ENTITIES: PullEntity[] = [
  "leads",
  "notes",
  "calls",
  "tasks",
  "events",
  "deleted_leads",
];

export interface PullOptions {
  entity: PullEntity | "all";
  dryRun?: boolean;
  /** Start from the checkpointed crm_sync_state.page_token. */
  resume?: boolean;
  /** Page budget for this invocation. The admin route uses ~15 to fit in 60s. */
  maxPages?: number;
  /** ISO timestamp — sets If-Modified-Since for an incremental pass. */
  since?: string;
  onProgress?: (entity: PullEntity, seen: number, written: number) => void;
}

export interface PullResult {
  entity: PullEntity;
  seen: number;
  created: number;
  updated: number;
  skipped: number;
  /** Activities whose Zoho parent matched no contact. Expect a few. */
  unmatched: number;
  errored: number;
  complete: boolean;
  nextPageToken?: string;
  errors: string[];
}

function emptyResult(entity: PullEntity): PullResult {
  return {
    entity,
    seen: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    unmatched: 0,
    errored: 0,
    complete: false,
    errors: [],
  };
}

const BATCH = 500;
const MAX_ERRORS_KEPT = 25;

// ─────────────────────────────────────────────────────────────────────
// Field lists
// ─────────────────────────────────────────────────────────────────────
// Zoho v5 caps the `fields` param around 50 names. Run
// `bun run crm:probe` to confirm the Leads module fits; if it doesn't,
// split LEAD_FIELDS into two passes and merge by id.

// EVERY NAME BELOW WAS VERIFIED AGAINST LIVE RECORDS on 2026-08-16 with
// `bun run crm:probe`. They are not guesses any more, and an unverified name
// added here is worse than useless: Zoho does NOT reject an unknown name in
// `fields`, it silently omits the column, so a typo reads as "that lead had no
// legal name" rather than as an error.
//
// The Leads module has exactly 62 fields on one "Standard" layout, and none of
// the MCA custom fields this list used to ask for (EIN, DBA, SSN, DOB,
// Legal_Name, Credit_Score_Range, Monthly_Deposits, Existing_Loans,
// Ownership_Percentage, Incorporation_Date, Time_in_Business, Signature_Name)
// exist at all. See the header of src/lib/field-map.ts.
const LEAD_FIELDS = [
  "First_Name", "Last_Name", "Company", "Email", "Phone", "Mobile",
  "Lead_Source", "Lead_Status", "Industry", "Street", "City", "State",
  "Zip_Code",
  // The two real financial fields. "Funding_Amount", not
  // "Funding_Amount_Requested"; "Use_of_funds", lower-case f.
  "Funding_Amount", "Monthly_Revenue", "Use_of_funds",
  "Description", "Owner", "Created_Time", "Modified_Time",
  "Last_Activity_Time", "Converted__s", "Converted_Date_Time",
].join(",");

const NOTE_FIELDS = [
  "Note_Title", "Note_Content", "Parent_Id", "Created_Time", "Modified_Time",
  "Owner",
].join(",");

// Voice_Recording__s is the call recording URL and is worth keeping — it is the
// one thing in Zoho's call history that cannot be reconstructed from anywhere
// else. Caller_ID / Dialled_Number / Outgoing_Call_Status ride along cheaply.
const CALL_FIELDS = [
  "Subject", "Call_Type", "Call_Start_Time", "Call_Duration",
  "Call_Duration_in_seconds", "Call_Result", "Call_Purpose", "Description",
  "Caller_ID", "Dialled_Number", "Outgoing_Call_Status", "Voice_Recording__s",
  "Who_Id", "What_Id", "Owner", "Created_Time", "Modified_Time",
].join(",");

const TASK_FIELDS = [
  "Subject", "Status", "Priority", "Due_Date", "Closed_Time", "Description",
  "Who_Id", "What_Id", "Owner", "Created_Time", "Modified_Time",
].join(",");

// The Events module is EMPTY (0 records, confirmed via /Events/actions/count),
// so this mapper has never had a real record to run against and the field names
// here remain unverified. Kept so the entity is not a special case, but if
// Events is ever populated, re-probe before trusting the output.
const EVENT_FIELDS = [
  "Event_Title", "Start_DateTime", "End_DateTime", "All_day", "Venue",
  "Description", "Who_Id", "What_Id", "Owner", "Created_Time", "Modified_Time",
].join(",");

// ─────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────

type Rec = Record<string, unknown>;

/**
 * Supplies the zoho-id -> contact-id map, built on first call and reused.
 *
 * A provider rather than the map itself so the scan is skipped entirely when a
 * delta sync has nothing to map. See runIncrementalSync().
 */
type IndexProvider = () => Promise<Map<string, string>>;

/** Zoho lookups come back as { id, name }. Pull the id out safely. */
function lookupId(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === "string") return v || null;
  if (typeof v === "object") {
    const id = (v as Rec).id;
    return typeof id === "string" && id ? id : null;
  }
  return null;
}

function lookupName(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === "string") return v || null;
  if (typeof v === "object") {
    const n = (v as Rec).name;
    return typeof n === "string" && n ? n : null;
  }
  return null;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function iso(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function numOrNull(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = str(v);
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Zoho's Call_Duration display string, in seconds.
 *
 * "mm:ss" for short calls and "hh:mm:ss" once a call passes an hour. Reading
 * every value as "mm:ss" turned a 1h23m call into 83 seconds, so the segment
 * count decides rather than being assumed.
 */
function parseClock(s: string | null): number | null {
  if (!s) return null;
  const parts = s.split(":").map((p) => parseInt(p, 10));
  if (parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

function digits10(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const d = s.replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : null;
}

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
    // Logging must never take the import down.
  }
}

// ─────────────────────────────────────────────────────────────────────
// Sync state
// ─────────────────────────────────────────────────────────────────────

interface SyncState {
  entity: string;
  phase: string;
  page_token: string | null;
  watermark: string | null;
  records_seen: number;
  records_written: number;
}

async function readSyncState(entity: PullEntity): Promise<SyncState | null> {
  const { data } = await supabaseAdmin
    .from("crm_sync_state")
    .select("entity, phase, page_token, watermark, records_seen, records_written")
    .eq("entity", entity)
    .maybeSingle();
  return (data as SyncState | null) ?? null;
}

/**
 * A dry run must not touch crm_sync_state, and it used to.
 *
 * Each puller writes state three times: on entry, after every written page, and
 * once at the end. Only the middle one sits behind the dry-run early-return, so
 * `--dry` still overwrote `page_token`, `watermark` and `phase` for that entity
 * — meaning a `--dry` followed by a `--resume` resumed from a checkpoint that a
 * run which wrote nothing had invented.
 *
 * Gating the writer itself rather than its twelve call sites is deliberate: the
 * next puller someone adds cannot reintroduce the bug by forgetting a check.
 */
let syncStateReadOnly = false;

async function writeSyncState(
  entity: PullEntity,
  patch: Partial<SyncState> & { last_error?: string | null }
): Promise<void> {
  if (syncStateReadOnly) return;
  await supabaseAdmin
    .from("crm_sync_state")
    .upsert(
      {
        entity,
        ...patch,
        last_run_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "entity" }
    );
}

// ─────────────────────────────────────────────────────────────────────
// Contact resolution
// ─────────────────────────────────────────────────────────────────────

export type MatchKind = "zoho_id" | "email" | "phone" | "created" | "none";

/**
 * Find (or create) the Supabase contact for a Zoho Lead.
 *
 * Order is deliberate: zoho_lead_id is the only fully safe key, so when we
 * match on email we WRITE THE ID BACK and every future run takes the fast,
 * unambiguous path. Phone is last and refuses to guess — two contacts sharing
 * a number is common enough (spouses, one business line) that a wrong merge
 * would be worse than a duplicate.
 */
export async function resolveContactForZohoLead(
  lead: ZohoApiRecord,
  opts: { createIfMissing: boolean }
): Promise<{ contactId: string | null; matchedBy: MatchKind }> {
  const zohoId = str(lead.id);
  const email = str(lead.Email)?.toLowerCase() ?? null;
  const phone10 = digits10(lead.Phone) ?? digits10(lead.Mobile);

  if (zohoId) {
    const { data } = await supabaseAdmin
      .from("contacts")
      .select("id")
      .eq("zoho_lead_id", zohoId)
      .maybeSingle();
    if (data?.id) return { contactId: data.id as string, matchedBy: "zoho_id" };
  }

  if (email) {
    const { data } = await supabaseAdmin
      .from("contacts")
      .select("id")
      .ilike("email", email)
      .limit(2);
    if (data && data.length === 1) {
      const id = data[0].id as string;
      if (zohoId) {
        await supabaseAdmin
          .from("contacts")
          .update({ zoho_lead_id: zohoId })
          .eq("id", id);
      }
      return { contactId: id, matchedBy: "email" };
    }
  }

  if (phone10) {
    const { data } = await supabaseAdmin
      .from("contacts")
      .select("id")
      .or(`phone_last10.eq.${phone10},mobile_last10.eq.${phone10}`)
      .limit(3);
    if (data && data.length === 1) {
      const id = data[0].id as string;
      if (zohoId) {
        await supabaseAdmin
          .from("contacts")
          .update({ zoho_lead_id: zohoId })
          .eq("id", id);
      }
      return { contactId: id, matchedBy: "phone" };
    }
    if (data && data.length > 1) {
      // Refuse to guess. Fall through to create, and leave a breadcrumb.
      await logSystem(
        "crm_pull_ambiguous_phone",
        `Zoho lead ${zohoId} phone ${phone10} matched ${data.length} contacts — created a new row instead of merging`,
        { zohoLeadId: zohoId, phone10, candidates: data.map((d) => d.id) }
      );
    }
  }

  if (!opts.createIfMissing) return { contactId: null, matchedBy: "none" };

  const insert = {
    ...buildContactFromZohoLead(lead as Rec),
    zoho_lead_id: zohoId,
    source_system: "zoho",
    zoho_modified_time: iso(lead.Modified_Time),
    application_stage_origin: "import",
  };
  const { data, error } = await supabaseAdmin
    .from("contacts")
    .insert(insert)
    .select("id")
    .single();
  if (error || !data) return { contactId: null, matchedBy: "none" };
  return { contactId: data.id as string, matchedBy: "created" };
}

/**
 * zoho_lead_id AND zoho_deal_id → contact_id, loaded once per run.
 *
 * Activities link by Who_Id (a Lead or Contact) or What_Id (a Deal), and
 * doing a round-trip per activity would be tens of thousands of queries.
 * One index, O(1) lookups.
 */
export async function buildZohoIdIndex(): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("contacts")
      .select("id, zoho_lead_id, zoho_deal_id")
      .or("zoho_lead_id.not.is.null,zoho_deal_id.not.is.null")
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    for (const row of data) {
      const r = row as { id: string; zoho_lead_id?: string; zoho_deal_id?: string };
      if (r.zoho_lead_id) index.set(r.zoho_lead_id, r.id);
      // Lead id wins if a row somehow carries both under the same key.
      if (r.zoho_deal_id && !index.has(r.zoho_deal_id)) {
        index.set(r.zoho_deal_id, r.id);
      }
    }
    if (data.length < PAGE) break;
  }
  return index;
}

// ─────────────────────────────────────────────────────────────────────
// Bulk-load trigger control
// ─────────────────────────────────────────────────────────────────────
// lead_activities_touch fires per row. On a bulk import that is one UPDATE
// per activity, which turns minutes into hours. We disable it around the
// activity phases and recompute in three set-based statements after.
// Requires the helper functions from docs/2026-08-17-crm-core.sql.

async function setActivityTrigger(enabled: boolean): Promise<boolean> {
  try {
    const { error } = await supabaseAdmin.rpc("crm_set_activity_trigger", {
      enabled,
    });
    if (error) throw new Error(error.message);
    return true;
  } catch {
    // Helper not installed — the trigger stays on. Correct, just slower.
    return false;
  }
}

async function recomputeDenormalized(): Promise<void> {
  try {
    await supabaseAdmin.rpc("crm_recompute_contact_rollups");
  } catch {
    console.warn(
      "[zoho-pull] crm_recompute_contact_rollups unavailable — run docs/2026-08-17-crm-core-recompute.sql by hand"
    );
  }
}

// ─────────────────────────────────────────────────────────────────────
// Activity mapping
// ─────────────────────────────────────────────────────────────────────

interface ActivityRow {
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
  external_id: string;
  external_module: string;
  metadata: Rec;
}

/** Who_Id (person) first, then What_Id (deal). Returns null if neither hits. */
function resolveActivityContact(
  rec: Rec,
  index: Map<string, string>
): string | null {
  const who = lookupId(rec.Who_Id);
  if (who && index.has(who)) return index.get(who)!;
  const what = lookupId(rec.What_Id);
  if (what && index.has(what)) return index.get(what)!;
  return null;
}

function mapNote(rec: Rec, index: Map<string, string>): ActivityRow | null {
  // Parent_Id is an OBJECT in v5, not a string — a mapper that treats it as
  // a string silently matches nothing.
  const parentId = lookupId(rec.Parent_Id);
  if (!parentId) return null;
  const contactId = index.get(parentId);
  if (!contactId) return null;

  const id = str(rec.id);
  if (!id) return null;

  return {
    contact_id: contactId,
    activity_type: "note",
    direction: "internal",
    channel: "zoho",
    subject: str(rec.Note_Title),
    body: str(rec.Note_Content),
    outcome: null,
    duration_secs: null,
    occurred_at: iso(rec.Created_Time) ?? new Date().toISOString(),
    actor: lookupName(rec.Owner),
    source: "zoho",
    external_id: id,
    external_module: "Notes",
    metadata: { zoho_parent_id: parentId, se_module: rec.$se_module ?? null },
  };
}

function mapCall(rec: Rec, index: Map<string, string>): ActivityRow | null {
  const contactId = resolveActivityContact(rec, index);
  if (!contactId) return null;
  const id = str(rec.id);
  if (!id) return null;

  // Call_Duration_in_seconds comes back as a real JSON number (verified: 1 for
  // a "00:01" call). Coerce anyway — it is the reliable source and a string
  // "125" from some other Zoho edition should still be used in preference to
  // re-parsing the display string.
  const durationSecs =
    numOrNull(rec.Call_Duration_in_seconds) ?? parseClock(str(rec.Call_Duration));

  const callType = str(rec.Call_Type)?.toLowerCase();

  // Zoho's own call outcome vocabulary, kept verbatim. It is a different set
  // from the one crm.logCall() writes (connected / voicemail / no_answer /
  // bad_number), so metadata records which vocabulary this row speaks rather
  // than pretending the two are one enum.
  const result = str(rec.Call_Result);
  const outcome = result && result !== "-None-" ? result : null;

  return {
    contact_id: contactId,
    activity_type: "call",
    direction:
      // "Missed" is the third picklist value. It is an inbound call nobody
      // answered, not a call with no direction.
      callType === "inbound" || callType === "missed"
        ? "inbound"
        : callType === "outbound"
          ? "outbound"
          : null,
    channel: "phone",
    subject: str(rec.Subject),
    body: str(rec.Description),
    outcome,
    duration_secs: durationSecs,
    occurred_at:
      iso(rec.Call_Start_Time) ?? iso(rec.Created_Time) ?? new Date().toISOString(),
    actor: lookupName(rec.Owner),
    source: "zoho",
    external_id: id,
    external_module: "Calls",
    metadata: {
      call_purpose: str(rec.Call_Purpose),
      call_type: str(rec.Call_Type),
      outcome_vocabulary: outcome ? "zoho" : null,
      // The recording URL is the one part of Zoho's call history that exists
      // nowhere else in our stack. Losing it would be irreversible.
      recording_url: str(rec.Voice_Recording__s),
      caller_id: str(rec.Caller_ID),
      dialled_number: str(rec.Dialled_Number),
      call_status: str(rec.Outgoing_Call_Status),
    },
  };
}

function mapEvent(rec: Rec, index: Map<string, string>): ActivityRow | null {
  const contactId = resolveActivityContact(rec, index);
  if (!contactId) return null;
  const id = str(rec.id);
  if (!id) return null;

  return {
    contact_id: contactId,
    activity_type: "meeting",
    direction: "internal",
    channel: "zoho",
    subject: str(rec.Event_Title),
    body: str(rec.Description),
    outcome: null,
    duration_secs: null,
    occurred_at:
      iso(rec.Start_DateTime) ?? iso(rec.Created_Time) ?? new Date().toISOString(),
    actor: lookupName(rec.Owner),
    source: "zoho",
    external_id: id,
    external_module: "Events",
    metadata: {
      end: iso(rec.End_DateTime),
      venue: str(rec.Venue),
      all_day: rec.All_day ?? null,
    },
  };
}

interface TaskRow {
  contact_id: string;
  title: string;
  description: string | null;
  task_type: string;
  priority: string;
  status: string;
  due_at: string | null;
  completed_at: string | null;
  created_by: string | null;
  source: string;
  external_id: string;
  zoho_task_id: string;
  metadata: Rec;
  created_at: string;
}

/**
 * An open Zoho task older than this is treated as abandoned, not as a live
 * follow-up. Override with --stale-task-days=N (0 disables).
 */
export let STALE_TASK_DAYS = 60;

export function setStaleTaskDays(days: number): void {
  STALE_TASK_DAYS = Number.isFinite(days) && days >= 0 ? days : 60;
}

/**
 * Zoho Tasks.Status -> lead_tasks.status.
 *
 * The real picklist, read off the module on 2026-08-16:
 *   Not Started | Deferred | In Progress | Completed | Waiting on someone else
 *
 * Explicit rather than substring-matched. Substring matching happened to give
 * the right answer for all five of these, which is exactly what makes it
 * dangerous — the first status someone adds in Zoho ("Cancelled by client",
 * "Closed - won") lands wherever the keyword list happens to send it, silently.
 * An unrecognised status defaults to `open`, because a task we cannot classify
 * is a task somebody should look at.
 */
function mapTaskStatus(raw: string | null): string {
  switch ((raw ?? "").trim().toLowerCase()) {
    case "completed":
      return "done";
    case "deferred":
      // Deliberately shelved. Not a commitment for today, and leaving it open
      // would keep the lead out of the unscheduled bucket it belongs in.
      return "cancelled";
    case "not started":
    case "in progress":
    case "waiting on someone else":
      return "open";
    default:
      return "open";
  }
}

function mapTask(rec: Rec, index: Map<string, string>): TaskRow | null {
  const contactId = resolveActivityContact(rec, index);
  if (!contactId) return null;
  const id = str(rec.id);
  if (!id) return null;

  const zohoStatus = str(rec.Status);
  let status = mapTaskStatus(zohoStatus);

  const priorityRaw = str(rec.Priority)?.toLowerCase() ?? "";
  // Zoho's picklist is High | Highest | Low | Lowest | Normal. "Highest"
  // contains "high" and "Lowest" contains "low", so substring order is safe.
  const priority = priorityRaw.includes("high")
    ? "high"
    : priorityRaw.includes("low")
      ? "low"
      : "normal";

  // Due_Date is a DATE ("2026-08-06"), not an instant. Reading it with
  // new Date() puts it at UTC midnight, which is 8pm the previous evening in
  // ET — so every imported task arrived already overdue. Resolve it against the
  // business day instead.
  const dueAt = rec.Due_Date ? parseBusinessDate(str(rec.Due_Date)) : null;

  // A task left open in Zoho years ago is not a follow-up commitment, it is
  // abandoned. Importing it as `open` puts the lead in the overdue bucket
  // forever and, worse, hides it from the "no follow-up scheduled" bucket that
  // is the whole point of the board. Retire those instead of deleting them, so
  // the history survives and the lead surfaces as genuinely unscheduled.
  let staleImport = false;
  if (status === "open" && dueAt) {
    const daysOverdue = (Date.now() - dueAt.getTime()) / 86_400_000;
    if (daysOverdue > STALE_TASK_DAYS) {
      status = "cancelled";
      staleImport = true;
    }
  }

  return {
    contact_id: contactId,
    title: str(rec.Subject) ?? "Follow up",
    description: str(rec.Description),
    task_type: "followup",
    priority,
    status,
    due_at: dueAt ? dueAt.toISOString() : null,
    completed_at: status === "done" ? iso(rec.Closed_Time) ?? iso(rec.Modified_Time) : null,
    created_by: lookupName(rec.Owner),
    source: "zoho",
    external_id: id,
    zoho_task_id: id,
    metadata: {
      zoho_status: zohoStatus,
      ...(staleImport
        ? { outcome: "stale_import", stale_after_days: STALE_TASK_DAYS }
        : {}),
    },
    created_at: iso(rec.Created_Time) ?? new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Entity pulls
// ─────────────────────────────────────────────────────────────────────

async function pullLeads(opts: PullOptions): Promise<PullResult> {
  const res = emptyResult("leads");
  const state = opts.resume ? await readSyncState("leads") : null;

  await writeSyncState("leads", { phase: "running", last_error: null });

  let watermark: string | null = state?.watermark ?? null;

  const { nextPageToken } = await listAllRecords("Leads", LEAD_FIELDS, {
    maxPages: opts.maxPages,
    startPageToken: state?.page_token ?? undefined,
    // THE line. Without it every converted lead is invisible.
    extraParams: { converted: "both" },
    headers: opts.since ? { "If-Modified-Since": new Date(opts.since).toUTCString() } : undefined,
    onPage: async (batch, nextToken) => {
      res.seen += batch.length;

      const rows = batch
        .map((lead) => {
          const zohoId = str(lead.id);
          if (!zohoId) return null;
          const modified = iso(lead.Modified_Time);
          if (modified && (!watermark || modified > watermark)) watermark = modified;
          const stage = str(lead.Lead_Status);
          return {
            ...buildContactFromZohoLead(lead as Rec),
            zoho_lead_id: zohoId,
            source_system: "zoho",
            zoho_modified_time: modified,
            // CARRY THE ZOHO CREATION DATE. Without this every imported lead
            // takes the row's own insert time, so 8,000 leads spanning years
            // all read as created today — and the worklist, whose whole job is
            // to rank by how long something has been waiting, told us that a
            // two-year-old lead was "brand new, call within 15 minutes".
            // CONTACT_FIELD_MAP does not carry created_at (it is not a Zoho
            // field we sync), so it has to be set explicitly here.
            ...(iso(lead.Created_Time) ? { created_at: iso(lead.Created_Time) } : {}),
            ...(stage
              ? {
                  application_stage: stage,
                  application_stage_updated_at: modified,
                  application_stage_origin: "import",
                }
              : {}),
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      res.skipped += batch.length - rows.length;
      if (opts.dryRun || rows.length === 0) {
        opts.onProgress?.("leads", res.seen, res.created + res.updated);
        return;
      }

      // onConflict zoho_lead_id makes this an update for known leads and an
      // insert for new ones, which is exactly the semantics we want and is
      // why the unique index in the migration is not optional.
      const { error, count } = await supabaseAdmin
        .from("contacts")
        .upsert(rows, { onConflict: "zoho_lead_id", count: "exact" });

      if (error) {
        res.errored += rows.length;
        if (res.errors.length < MAX_ERRORS_KEPT) res.errors.push(error.message);
      } else {
        res.updated += count ?? rows.length;
      }

      await writeSyncState("leads", {
        page_token: nextToken ?? null,
        records_seen: res.seen,
        records_written: res.updated,
      });
      opts.onProgress?.("leads", res.seen, res.updated);
    },
  });

  res.nextPageToken = nextPageToken;
  res.complete = !nextPageToken;
  await writeSyncState("leads", {
    phase: res.complete ? "done" : "running",
    page_token: nextPageToken ?? null,
    watermark,
    records_seen: res.seen,
    records_written: res.updated,
    last_error: res.errors[0] ?? null,
  });
  return res;
}

type ActivityEntity = Extract<PullEntity, "notes" | "calls" | "events">;

const ACTIVITY_CONFIG: Record<
  ActivityEntity,
  { module: string; fields: string; map: (r: Rec, i: Map<string, string>) => ActivityRow | null }
> = {
  notes: { module: "Notes", fields: NOTE_FIELDS, map: mapNote },
  calls: { module: "Calls", fields: CALL_FIELDS, map: mapCall },
  events: { module: "Events", fields: EVENT_FIELDS, map: mapEvent },
};

async function pullActivities(
  entity: ActivityEntity,
  getIndex: IndexProvider,
  opts: PullOptions
): Promise<PullResult> {
  const res = emptyResult(entity);
  const cfg = ACTIVITY_CONFIG[entity];
  const state = opts.resume ? await readSyncState(entity) : null;

  await writeSyncState(entity, { phase: "running", last_error: null });
  let watermark: string | null = state?.watermark ?? null;

  const { nextPageToken } = await listAllRecords(cfg.module, cfg.fields, {
    maxPages: opts.maxPages,
    startPageToken: state?.page_token ?? undefined,
    headers: opts.since ? { "If-Modified-Since": new Date(opts.since).toUTCString() } : undefined,
    onPage: async (batch, nextToken) => {
      res.seen += batch.length;

      // Resolved here, not before the loop: on a delta sync that returns
      // nothing there is no reason to scan every contact.
      const index = await getIndex();

      const rows: ActivityRow[] = [];
      for (const rec of batch as unknown as Rec[]) {
        const modified = iso(rec.Modified_Time);
        if (modified && (!watermark || modified > watermark)) watermark = modified;
        const mapped = cfg.map(rec, index);
        if (mapped) rows.push(mapped);
        else res.unmatched++;
      }

      if (opts.dryRun || rows.length === 0) {
        opts.onProgress?.(entity, res.seen, res.created);
        return;
      }

      for (let i = 0; i < rows.length; i += BATCH) {
        const chunk = rows.slice(i, i + BATCH);
        const { error, count } = await supabaseAdmin
          .from("lead_activities")
          .upsert(chunk, {
            onConflict: "source,external_id",
            ignoreDuplicates: true,
            count: "exact",
          });
        if (error) {
          res.errored += chunk.length;
          if (res.errors.length < MAX_ERRORS_KEPT) res.errors.push(error.message);
        } else {
          res.created += count ?? chunk.length;
        }
      }

      await writeSyncState(entity, {
        page_token: nextToken ?? null,
        records_seen: res.seen,
        records_written: res.created,
      });
      opts.onProgress?.(entity, res.seen, res.created);
    },
  });

  res.nextPageToken = nextPageToken;
  res.complete = !nextPageToken;
  await writeSyncState(entity, {
    phase: res.complete ? "done" : "running",
    page_token: nextPageToken ?? null,
    watermark,
    records_seen: res.seen,
    records_written: res.created,
    last_error: res.errors[0] ?? null,
  });
  return res;
}

async function pullTasks(
  getIndex: IndexProvider,
  opts: PullOptions
): Promise<PullResult> {
  const res = emptyResult("tasks");
  const state = opts.resume ? await readSyncState("tasks") : null;

  await writeSyncState("tasks", { phase: "running", last_error: null });
  let watermark: string | null = state?.watermark ?? null;

  const { nextPageToken } = await listAllRecords("Tasks", TASK_FIELDS, {
    maxPages: opts.maxPages,
    startPageToken: state?.page_token ?? undefined,
    headers: opts.since ? { "If-Modified-Since": new Date(opts.since).toUTCString() } : undefined,
    onPage: async (batch, nextToken) => {
      res.seen += batch.length;

      const index = await getIndex();

      const rows: TaskRow[] = [];
      for (const rec of batch as unknown as Rec[]) {
        const modified = iso(rec.Modified_Time);
        if (modified && (!watermark || modified > watermark)) watermark = modified;
        const mapped = mapTask(rec, index);
        if (mapped) rows.push(mapped);
        else res.unmatched++;
      }

      if (opts.dryRun || rows.length === 0) {
        opts.onProgress?.("tasks", res.seen, res.created);
        return;
      }

      for (let i = 0; i < rows.length; i += BATCH) {
        const chunk = rows.slice(i, i + BATCH);
        const { error, count } = await supabaseAdmin
          .from("lead_tasks")
          .upsert(chunk, {
            onConflict: "source,external_id",
            ignoreDuplicates: true,
            count: "exact",
          });
        if (error) {
          res.errored += chunk.length;
          if (res.errors.length < MAX_ERRORS_KEPT) res.errors.push(error.message);
        } else {
          res.created += count ?? chunk.length;
        }
      }

      await writeSyncState("tasks", {
        page_token: nextToken ?? null,
        records_seen: res.seen,
        records_written: res.created,
      });
      opts.onProgress?.("tasks", res.seen, res.created);
    },
  });

  res.nextPageToken = nextPageToken;
  res.complete = !nextPageToken;
  await writeSyncState("tasks", {
    phase: res.complete ? "done" : "running",
    page_token: nextPageToken ?? null,
    watermark,
    records_seen: res.seen,
    records_written: res.created,
    last_error: res.errors[0] ?? null,
  });
  return res;
}

/**
 * Leads deleted in Zoho. Tombstoned rather than deleted here — a lead we
 * already worked has history worth keeping, and this is the CRM of record now.
 */
async function pullDeletedLeads(opts: PullOptions): Promise<PullResult> {
  const res = emptyResult("deleted_leads");
  await writeSyncState("deleted_leads", { phase: "running", last_error: null });

  // NOT listAllRecords(). Two reasons, both confirmed against the live API:
  //   1. /Leads/deleted takes no `fields` param, and listAllRecords always
  //      sends one — `fields=` empty is a 400 on every other endpoint and is
  //      meaningless here.
  //   2. It paginates with `page`, not `page_token`. listAllRecords is
  //      cursor-only, so it would have stopped after the first page and
  //      reported the entity complete.
  // The whole set is 24 records today, but the loop is honest about growth.
  const records: Rec[] = [];
  const maxPages = opts.maxPages ?? 25;
  for (let page = 1; page <= maxPages; page++) {
    const r = (await zohoRequest(
      "GET",
      `/Leads/deleted?type=all&per_page=200&page=${page}`
    )) as { data?: Rec[]; info?: { more_records?: boolean } };
    const batch = r.data ?? [];
    records.push(...batch);
    if (batch.length === 0 || !r.info?.more_records) break;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  res.seen = records.length;
  const ids = records.map((r) => str(r.id)).filter((s): s is string => !!s);

  if (!opts.dryRun && ids.length > 0) {
    for (let i = 0; i < ids.length; i += BATCH) {
      const chunk = ids.slice(i, i + BATCH);
      const { error, data } = await supabaseAdmin
        .from("contacts")
        .update({ zoho_deleted_at: new Date().toISOString() })
        .in("zoho_lead_id", chunk)
        .is("zoho_deleted_at", null)
        .select("id");
      const count = data?.length ?? 0;
      if (error) {
        res.errored += chunk.length;
        if (res.errors.length < MAX_ERRORS_KEPT) res.errors.push(error.message);
      } else {
        res.updated += count ?? 0;
      }
    }
  }

  res.complete = true;
  await writeSyncState("deleted_leads", {
    phase: "done",
    records_seen: res.seen,
    records_written: res.updated,
    last_error: res.errors[0] ?? null,
  });
  return res;
}

// ─────────────────────────────────────────────────────────────────────
// Orchestration
// ─────────────────────────────────────────────────────────────────────

/**
 * Run one or more entity pulls.
 *
 * Order matters: leads MUST land before activities, because the activity
 * mappers resolve their parent through an index built from contacts. Running
 * "all" handles that for you; running --entity=notes on a cold database will
 * just report everything as unmatched.
 */
export async function runPull(opts: PullOptions): Promise<PullResult[]> {
  syncStateReadOnly = !!opts.dryRun;
  try {
    return await runPullInner(opts);
  } finally {
    syncStateReadOnly = false;
  }
}

async function runPullInner(opts: PullOptions): Promise<PullResult[]> {
  const entities: PullEntity[] =
    opts.entity === "all" ? [...PULL_ENTITIES] : [opts.entity];

  const results: PullResult[] = [];
  const needsIndex = entities.some((e) =>
    ["notes", "calls", "tasks", "events"].includes(e)
  );

  // Leads first, always.
  if (entities.includes("leads")) {
    results.push(await pullLeads(opts));
  }

  if (!needsIndex) {
    if (entities.includes("deleted_leads")) {
      results.push(await pullDeletedLeads(opts));
    }
    return results;
  }

  let indexPromise: Promise<Map<string, string>> | null = null;
  const getIndex: IndexProvider = () =>
    (indexPromise ??= buildZohoIdIndex().then((idx) => {
      console.log(`[zoho-pull] resolved ${idx.size} Zoho ids → contacts`);
      return idx;
    }));

  // The trigger is per-row; on a bulk activity load that is the difference
  // between minutes and hours.
  const triggerDisabled = !opts.dryRun && (await setActivityTrigger(false));

  try {
    for (const entity of entities) {
      if (entity === "leads" || entity === "deleted_leads") continue;
      if (entity === "tasks") results.push(await pullTasks(getIndex, opts));
      else results.push(await pullActivities(entity as ActivityEntity, getIndex, opts));
    }
  } finally {
    if (triggerDisabled) await setActivityTrigger(true);
  }

  if (!opts.dryRun) await recomputeDenormalized();

  if (entities.includes("deleted_leads")) {
    results.push(await pullDeletedLeads(opts));
  }

  return results;
}

/**
 * The every-15-minutes delta. Uses each entity's own watermark, rewound five
 * minutes — the overlap costs nothing because every write is idempotent, and
 * it covers records whose Modified_Time lands either side of a page boundary.
 */
export async function runIncrementalSync(): Promise<PullResult[]> {
  const OVERLAP_MS = 5 * 60 * 1000;
  const results: PullResult[] = [];

  const leadState = await readSyncState("leads");
  const leadSince = leadState?.watermark
    ? new Date(new Date(leadState.watermark).getTime() - OVERLAP_MS).toISOString()
    : undefined;

  results.push(
    await pullLeads({ entity: "leads", since: leadSince, resume: false, maxPages: 20 })
  );

  // BUILD THE INDEX LAZILY. This runs every 15 minutes — 96 times a day — and
  // buildZohoIdIndex() is a paged scan of every contact carrying a Zoho id
  // (~8,300 rows, 9 round trips). The overwhelmingly common outcome of a delta
  // sync is that nothing changed, so paying for that scan up front meant ~860
  // full-table scans a day to map zero records. Now it is built on first use
  // and only when a module actually returns something to map.
  let indexPromise: Promise<Map<string, string>> | null = null;
  const getIndex = () => (indexPromise ??= buildZohoIdIndex());

  for (const entity of ["notes", "calls", "tasks", "events"] as const) {
    const state = await readSyncState(entity);
    const since = state?.watermark
      ? new Date(new Date(state.watermark).getTime() - OVERLAP_MS).toISOString()
      : undefined;
    const opts: PullOptions = { entity, since, resume: false, maxPages: 10 };
    results.push(
      entity === "tasks"
        ? await pullTasks(getIndex, opts)
        : await pullActivities(entity, getIndex, opts)
    );
  }

  results.push(await pullDeletedLeads({ entity: "deleted_leads", maxPages: 10 }));

  return results;
}
