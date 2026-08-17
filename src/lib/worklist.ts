// "Who do we need to call today?"
//
// One question, asked from three places (the /dashboard/worklist board, the
// Vektor chatbot, and the morning Slack digest), answered from Supabase only.
// hanging-leads.ts used to answer it by scanning Zoho on every run; this reads
// four denormalized columns off `contacts` that the triggers in
// docs/2026-08-17-crm-core.sql keep current.
//
// ── The rule, in the user's words ──────────────────────────────────────
// "Working leads with no follow up date tasks. Always get a follow up date
//  after a call. If I call a lead from the new UI and leave notes I MUST
//  leave a follow up date."
//
// So the primary bucket is UNSCHEDULED: a live lead with zero open rows in
// lead_tasks. That is a lead nobody has committed to a next step on, and it is
// the failure mode a CRM is supposed to prevent. Everything else — overdue
// tasks, tasks due today, inbound replies — is a lead that already has a
// commitment attached, so it ranks by urgency instead.
//
// ── Why a lib function and not a SQL view ─────────────────────────────
// Under 10k contacts the workable set is a few thousand rows behind a partial
// index, so scoring in memory costs nothing. Scoring rules change often, and
// migrations in this repo are hand-pasted into the Supabase console — keeping
// the weights in TypeScript means tuning them is a deploy, not a ceremony.

import { supabaseAdmin } from "./db";
import { isSameBusinessDay } from "./business-time";
import {
  cadenceFor,
  isDeadStage,
  HOT_STAGES,
  STAGE_PIPELINES,
} from "@/config/stage-display";

export type WorklistBucket =
  | "replied"
  | "overdue"
  | "due_today"
  | "unscheduled"
  | "cadence";

export interface WorklistTask {
  id: string;
  title: string;
  dueAt: string | null;
  overdueDays: number | null;
}

export interface WorklistItem {
  contactId: string;
  zohoLeadId: string | null;
  name: string;
  businessName: string | null;
  phone: string | null;
  email: string | null;

  status: string | null;
  workingState: string;
  bucket: WorklistBucket;
  score: number;
  /** Plain sentences, printed verbatim by the chat card and the Slack digest. */
  reasons: string[];

  lastActivityAt: string | null;
  daysSinceActivity: number | null;
  nextActionAt: string | null;
  nextActionReason: string | null;
  openTasks: WorklistTask[];
  lastNote: { title: string | null; body: string | null; occurredAt: string } | null;
  website: string | null;
}

export interface WorklistOptions {
  limit?: number;
  bucket?: WorklistBucket;
  includeSnoozed?: boolean;
  /** Freeze "now" — used by tests and by the digest to be deterministic. */
  asOf?: Date;
}

// Runaway guard, not a filter. The Zoho import puts ~8,300 leads in the
// workable set, so this has to sit ABOVE the real table size or the board
// scores a truncated sample — see the comment in fetchCandidates(). If this
// ever starts firing, the answer is a narrower predicate, not a bigger number.
const CANDIDATE_CAP = 25_000;
const DEFAULT_LIMIT = 25;

const CANDIDATE_COLS = [
  "id",
  "zoho_lead_id",
  "first_name",
  "last_name",
  "business_name",
  "phone",
  "mobile_phone",
  "email",
  "application_stage",
  "working_state",
  "snoozed_until",
  "do_not_contact",
  "last_activity_at",
  "last_inbound_at",
  "last_outbound_at",
  "next_action_at",
  "next_action_reason",
  "open_task_count",
  "website",
  "industry",
  "created_at",
  // NOTE: only columns present in CONTACT_FIELD_MAP (or created by
  // docs/2026-08-17-crm-core.sql) are safe to select here. PostgREST fails the
  // WHOLE query on one unknown column, so an optimistic guess takes the call
  // board down. `application_signed_at` was such a guess and is NOT a real
  // column.
].join(", ");

export interface WorklistCandidateRow {
  id: string;
  zoho_lead_id: string | null;
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
  phone: string | null;
  mobile_phone: string | null;
  email: string | null;
  application_stage: string | null;
  working_state: string | null;
  snoozed_until: string | null;
  do_not_contact: boolean | null;
  last_activity_at: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  next_action_at: string | null;
  next_action_reason: string | null;
  open_task_count: number | null;
  website: string | null;
  industry: string | null;
  created_at: string | null;
}

const MS_HOUR = 3_600_000;
const MS_DAY = 86_400_000;

function hoursSince(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  return (now.getTime() - new Date(iso).getTime()) / MS_HOUR;
}

function daysSince(iso: string | null, now: Date): number | null {
  const h = hoursSince(iso, now);
  return h === null ? null : h / 24;
}

// "Today" is a day of selling, not a UTC day. On Vercel the server clock is UTC,
// so the old getFullYear/getMonth/getDate comparison dropped a task out of the
// due_today bucket at 8pm ET. See src/lib/business-time.ts.
const isSameDay = isSameBusinessDay;

function displayName(r: WorklistCandidateRow): string {
  const n = [r.first_name, r.last_name].filter(Boolean).join(" ").trim();
  return n || r.business_name || r.email || "Unknown lead";
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Speed to lead. A business rule, not a per-stage cadence. */
const SPEED_TO_LEAD_HOURS = 0.25;

function describeHours(h: number): string {
  if (h < 1) return plural(Math.max(1, Math.round(h * 60)), "minute");
  if (h < 48) return plural(Math.round(h), "hour");
  return plural(Math.floor(h / 24), "day");
}

// ─────────────────────────────────────────────────────────────────────
// Scoring
// ─────────────────────────────────────────────────────────────────────

export interface ScoreResult {
  score: number;
  reasons: string[];
  bucket: WorklistBucket;
  /** False means drop it entirely — dead, snoozed, or do-not-contact. */
  eligible: boolean;
}

/**
 * Rank one lead. Additive, and every point that moves the number also pushes
 * a sentence onto `reasons` — the board and the chatbot show those verbatim,
 * so a lead can always explain why it is on today's list.
 */
export function scoreLead(
  r: WorklistCandidateRow,
  now: Date,
  opts: { includeSnoozed?: boolean } = {}
): ScoreResult {
  const reasons: string[] = [];
  let score = 0;

  if (r.do_not_contact) {
    return { score: -1000, reasons: ["do not contact"], bucket: "unscheduled", eligible: false };
  }
  if (r.working_state === "closed" || isDeadStage(r.application_stage)) {
    return { score: -1000, reasons: ["closed"], bucket: "unscheduled", eligible: false };
  }
  if (r.snoozed_until && new Date(r.snoozed_until) > now && !opts.includeSnoozed) {
    return {
      score: -50,
      reasons: [`snoozed until ${r.snoozed_until.slice(0, 10)}`],
      bucket: "unscheduled",
      eligible: false,
    };
  }

  const openTasks = r.open_task_count ?? 0;
  const nextAction = r.next_action_at ? new Date(r.next_action_at) : null;
  const cadence = cadenceFor(r.application_stage);

  // ── Bucket ──────────────────────────────────────────────────────────
  let bucket: WorklistBucket;

  const repliedAndIgnored =
    !!r.last_inbound_at &&
    (!r.last_outbound_at || new Date(r.last_inbound_at) > new Date(r.last_outbound_at));

  if (repliedAndIgnored) {
    bucket = "replied";
    score += 30;
    const d = daysSince(r.last_inbound_at, now);
    reasons.push(
      d !== null && d >= 1
        ? `they replied ${plural(Math.floor(d), "day")} ago and we haven't answered`
        : "they replied and we haven't answered"
    );
  } else if (nextAction && nextAction < now) {
    bucket = "overdue";
    const overdueDays = Math.floor((now.getTime() - nextAction.getTime()) / MS_DAY);
    score += 40 + Math.min(overdueDays * 5, 20);
    reasons.push(
      overdueDays >= 1
        ? `follow-up "${r.next_action_reason ?? "task"}" overdue ${plural(overdueDays, "day")}`
        : `follow-up "${r.next_action_reason ?? "task"}" due earlier today`
    );
  } else if (nextAction && isSameDay(nextAction, now)) {
    bucket = "due_today";
    score += 25;
    reasons.push(`follow-up "${r.next_action_reason ?? "task"}" due today`);
  } else if (openTasks === 0) {
    // THE core rule.
    bucket = "unscheduled";
    score += 35;
    reasons.push("working lead with no follow-up scheduled");
  } else {
    // Has a task, scheduled in the future. Only surfaces if cadence says the
    // gap is too long anyway.
    bucket = "cadence";
  }

  // ── Cadence ─────────────────────────────────────────────────────────
  const hoursIdle = hoursSince(r.last_activity_at, now);
  if (hoursIdle === null) {
    // Never touched at all. This is the only branch where firstTouchHours can
    // apply — it is measured from creation, and a lead with no activity is
    // exactly a lead whose first touch has not happened. (It used to be read
    // in the `else` below, where `last_activity_at` is non-null by definition,
    // so the whole STAGE_CADENCE.firstTouchHours column was dead config.)
    const ageHours = hoursSince(r.created_at, now) ?? 0;
    if (ageHours <= SPEED_TO_LEAD_HOURS) {
      score += 35;
      reasons.push("brand new — call within 15 minutes");
    } else if (ageHours > cadence.firstTouchHours) {
      score += 25;
      reasons.push(
        `never contacted — first touch was due ${describeHours(ageHours - cadence.firstTouchHours)} ago`
      );
    } else {
      score += 20;
      reasons.push("never contacted");
    }
  } else {
    // last_activity_at is non-null here, so the repeat cadence is the only one
    // that can apply.
    const limitHours = cadence.repeatDays * 24;
    if (hoursIdle > limitHours) {
      score += 15;
      const d = Math.floor(hoursIdle / 24);
      reasons.push(
        `${r.application_stage ?? "no stage"} — ${d >= 1 ? plural(d, "day") : "hours"} since last touch (cadence ${cadence.repeatDays}d)`
      );
    } else if (bucket === "cadence") {
      // Nothing due, nothing stale, task already scheduled. Not today's problem.
      return { score: 0, reasons: [], bucket, eligible: false };
    }
  }

  // ── Modifiers ───────────────────────────────────────────────────────
  // The funding-era modifiers are gone with the funding business: a $100k+
  // `amount_needed` and "signed the app but sent no statements" both described
  // an MCA deal, not an AEO prospect, and both would have quietly kept ranking
  // the call board by how much money someone once asked us for.
  if (r.application_stage && HOT_STAGES.includes(r.application_stage)) {
    score += 25;
    reasons.push(`${r.application_stage} — live conversation`);
  }
  if (!r.website) {
    score += 6;
    reasons.push("no website on file — worth asking what they have");
  }

  // ── Tie-breakers ────────────────────────────────────────────────────
  // WHY THESE EXIST: ~7,400 of the 8,307 imported Zoho leads sit at
  // "Not Contacted" with no activity and no task. Every one of them scores
  // identically on the rules above (unscheduled + never contacted), so the
  // board's top 25 was decided by whatever `last_activity_at asc nulls first`
  // happened to return — i.e. arbitrary. These are deliberately small: they
  // break ties inside a bucket, they never promote a cold lead over a live one.
  score += tieBreakers(r, reasons);

  return { score, reasons, bucket, eligible: score > 0 };
}

/**
 * Small, additive signals that order otherwise-identical leads.
 *
 * Capped well below the bucket weights on purpose. The most a lead can gain
 * here is 12, against 25-40 for a real bucket, so a stale lead with a phone
 * number and a big ask still never outranks someone who replied this morning.
 */
function tieBreakers(r: WorklistCandidateRow, reasons: string[]): number {
  let bonus = 0;

  // Unreachable is unreachable. A lead with no phone cannot be called today,
  // whatever else is true about it, so it sinks below every callable lead.
  const callable = !!(r.phone || r.mobile_phone);
  if (!callable) {
    bonus -= 8;
    reasons.push("no phone on file");
  }

  // Freshness. A lead that came in this week is worth more than one that has
  // been sitting since last year, and among 7,400 untouched leads that is the
  // single most useful ordering signal available.
  const ageDays = daysSince(r.created_at, new Date()) ?? 9999;
  if (ageDays <= 7) bonus += 6;
  else if (ageDays <= 30) bonus += 4;
  else if (ageDays <= 90) bonus += 2;
  else if (ageDays > 365) bonus -= 4;

  // A known industry means we can say something specific about how their
  // customers search, which is the whole pitch.
  if (r.industry) bonus += 2;

  // An email gives a second channel when the call goes to voicemail.
  if (r.email) bonus += 1;

  return bonus;
}

// ─────────────────────────────────────────────────────────────────────
// Query
// ─────────────────────────────────────────────────────────────────────

// The candidate set is now ~8,300 rows fetched in 9 pages, and the worklist
// page asks for it twice (the board, then the bucket counts in the header).
// A few seconds of memoisation turns 18 round trips into 9 without making the
// board meaningfully staler than the request that rendered it.
const CANDIDATE_TTL_MS = 10_000;
let candidateCache: {
  key: string;
  at: number;
  rows: WorklistCandidateRow[];
} | null = null;

/**
 * Drop the memoised candidate set.
 *
 * MUST be called after any write that changes whether a lead belongs on the
 * board. Without it, logging a call and refreshing showed the lead still
 * sitting there for up to CANDIDATE_TTL_MS — which reads as "the follow-up
 * didn't save", i.e. exactly the doubt the mandatory-follow-up rule exists to
 * remove. src/lib/crm.ts calls this from every mutating path.
 */
export function invalidateWorklistCache(): void {
  candidateCache = null;
}

async function fetchCandidates(
  now: Date,
  includeSnoozed: boolean
): Promise<WorklistCandidateRow[]> {
  const key = String(includeSnoozed);
  if (
    candidateCache &&
    candidateCache.key === key &&
    Date.now() - candidateCache.at < CANDIDATE_TTL_MS
  ) {
    return candidateCache.rows;
  }
  const fresh = await fetchCandidatesUncached(now, includeSnoozed);
  candidateCache = { key, at: Date.now(), rows: fresh };
  return fresh;
}

async function fetchCandidatesUncached(
  now: Date,
  includeSnoozed: boolean
): Promise<WorklistCandidateRow[]> {
  // THE CAP USED TO SILENTLY DROP EVERY LEAD WE HAD ACTUALLY WORKED.
  //
  // This was one capped query ordered by `last_activity_at asc nulls first`, on
  // the reasoning that the longest-ignored lead is the most urgent, so a cap
  // would truncate the least urgent end. That held at 234 contacts. After the
  // Zoho import there are ~8,300, and ~7,400 of them have never been touched —
  // so `nulls first` fills the entire cap with untouched leads and every lead
  // with a reply, an overdue task or a hot stage sorts AFTER them and falls off
  // the end. The board would have shown 25 cold leads and hidden the live deals.
  //
  // At this size the honest fix is to stop capping into a sort at all: page
  // through the whole workable set and score it. 8k rows of 21 columns is a few
  // MB and one index scan. CANDIDATE_CAP is now a runaway guard, not a filter.
  const rows: WorklistCandidateRow[] = [];
  const PAGE = 1000;

  for (let from = 0; from < CANDIDATE_CAP; from += PAGE) {
    let q = supabaseAdmin
      .from("contacts")
      .select(CANDIDATE_COLS)
      .neq("working_state", "closed")
      .or("do_not_contact.is.null,do_not_contact.eq.false");

    if (!includeSnoozed) {
      q = q.or(`snoozed_until.is.null,snoozed_until.lt.${now.toISOString()}`);
    }

    // A stable, indexed ordering — this is pagination, not prioritisation.
    // Ranking happens in scoreLead() over the complete set.
    const { data, error } = await q
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);

    if (error) {
      console.error("[worklist] candidate query failed:", error.message);
      break;
    }

    const batch = (data ?? []) as unknown as WorklistCandidateRow[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }

  if (rows.length >= CANDIDATE_CAP) {
    console.warn(
      `[worklist] hit CANDIDATE_CAP (${CANDIDATE_CAP}) — the board is scoring a truncated set. Raise the cap or start filtering.`
    );
  }
  return rows;
}

/** Open tasks + newest note for the leads that actually made the cut. */
async function hydrate(
  contactIds: string[]
): Promise<{
  tasks: Map<string, WorklistTask[]>;
  notes: Map<string, { title: string | null; body: string | null; occurredAt: string }>;
}> {
  const tasks = new Map<string, WorklistTask[]>();
  const notes = new Map<string, { title: string | null; body: string | null; occurredAt: string }>();
  if (contactIds.length === 0) return { tasks, notes };

  const now = Date.now();

  const [taskRes, noteRes] = await Promise.all([
    supabaseAdmin
      .from("lead_tasks")
      .select("id, contact_id, title, due_at")
      .in("contact_id", contactIds)
      .eq("status", "open")
      .order("due_at", { ascending: true, nullsFirst: false }),
    supabaseAdmin
      .from("lead_activities")
      .select("contact_id, subject, body, occurred_at")
      .in("contact_id", contactIds)
      .eq("activity_type", "note")
      .order("occurred_at", { ascending: false }),
  ]);

  for (const row of taskRes.data ?? []) {
    const r = row as { id: string; contact_id: string; title: string; due_at: string | null };
    const list = tasks.get(r.contact_id) ?? [];
    list.push({
      id: r.id,
      title: r.title,
      dueAt: r.due_at,
      overdueDays: r.due_at
        ? Math.max(0, Math.floor((now - new Date(r.due_at).getTime()) / MS_DAY))
        : null,
    });
    tasks.set(r.contact_id, list);
  }

  // Ordered newest-first, so the first row per contact wins.
  for (const row of noteRes.data ?? []) {
    const r = row as {
      contact_id: string;
      subject: string | null;
      body: string | null;
      occurred_at: string;
    };
    if (!notes.has(r.contact_id)) {
      notes.set(r.contact_id, {
        title: r.subject,
        body: r.body ? r.body.slice(0, 400) : null,
        occurredAt: r.occurred_at,
      });
    }
  }

  return { tasks, notes };
}

/**
 * The call list, ranked.
 *
 * Hydration (open tasks, last note) happens only for the leads that survive
 * scoring, so the expensive joins run over ~25 rows instead of ~2000.
 */
export async function buildWorklist(
  opts: WorklistOptions = {}
): Promise<WorklistItem[]> {
  const now = opts.asOf ?? new Date();
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const includeSnoozed = opts.includeSnoozed ?? false;

  const candidates = await fetchCandidates(now, includeSnoozed);

  const scored = candidates
    .map((r) => ({ row: r, ...scoreLead(r, now, { includeSnoozed }) }))
    .filter((s) => s.eligible)
    .filter((s) => (opts.bucket ? s.bucket === opts.bucket : true))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const { tasks, notes } = await hydrate(scored.map((s) => s.row.id));

  return scored.map(({ row, score, reasons, bucket }) => ({
    contactId: row.id,
    zohoLeadId: row.zoho_lead_id,
    name: displayName(row),
    businessName: row.business_name,
    phone: row.phone || row.mobile_phone,
    email: row.email,
    status: row.application_stage,
    workingState: row.working_state ?? "new",
    bucket,
    score,
    reasons,
    lastActivityAt: row.last_activity_at,
    daysSinceActivity: (() => {
      const d = daysSince(row.last_activity_at, now);
      return d === null ? null : Math.floor(d);
    })(),
    nextActionAt: row.next_action_at,
    nextActionReason: row.next_action_reason,
    openTasks: tasks.get(row.id) ?? [],
    lastNote: notes.get(row.id) ?? null,
    website: row.website,
  }));
}

/** Bucket counts across the whole workable set, for the board's header. */
export async function worklistSummary(
  opts: { asOf?: Date } = {}
): Promise<{ total: number; byBucket: Record<WorklistBucket, number> }> {
  const now = opts.asOf ?? new Date();
  const candidates = await fetchCandidates(now, false);

  const byBucket: Record<WorklistBucket, number> = {
    replied: 0,
    overdue: 0,
    due_today: 0,
    unscheduled: 0,
    cadence: 0,
  };
  let total = 0;

  for (const r of candidates) {
    const s = scoreLead(r, now);
    if (!s.eligible) continue;
    byBucket[s.bucket]++;
    total++;
  }

  return { total, byBucket };
}

/** Stage → count, for "what does my pipeline look like" questions. */
export async function statusCounts(): Promise<Array<{ status: string; count: number }>> {
  const { data } = await supabaseAdmin
    .from("contacts")
    .select("application_stage")
    .neq("working_state", "closed")
    .limit(10_000);

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const s = ((row as { application_stage: string | null }).application_stage) ?? "(no stage)";
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }

  // Pipeline order first, then anything unrecognised.
  const order = STAGE_PIPELINES.flatMap((p) => p.stages.map((s) => s.name));
  return [...counts.entries()]
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => {
      const ia = order.indexOf(a.status);
      const ib = order.indexOf(b.status);
      if (ia === -1 && ib === -1) return b.count - a.count;
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
}
