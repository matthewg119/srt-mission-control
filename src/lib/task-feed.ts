/**
 * One task list out of two tables.
 *
 * WHY THIS EXISTS
 * Follow-ups scheduled by logging a call live in `lead_tasks` (contact-linked,
 * trigger-backed, the thing the call board is built on). BrainHeart's ops tasks
 * live in `tasks` (free-text, no lead linkage). They were never merged, so a
 * follow-up set on a lead could not appear under Tasks — which is the one place
 * the operator looks to find out what to do next.
 *
 * The merge is READ-SIDE ONLY. `lead_tasks` stays the single source of truth for
 * follow-ups: completing one has to run through `completeTask()` so the activity
 * echo and the `contacts.open_task_count` trigger stay correct, and Take Off List
 * bulk-cancels straight out of that table. A mirrored copy in `tasks` would drift
 * from the call board within a day.
 *
 * The two tables disagree on every vocabulary they share, so the mapping lives
 * here and nowhere else.
 */

import { businessDayKey, isSameBusinessDay } from "./business-time";

export type TaskOrigin = "ops" | "followup";
export type FeedPriority = "urgent" | "high" | "medium" | "low";
export type FeedStatus = "open" | "in_progress" | "completed" | "cancelled";

export interface FeedTask {
  id: string;
  origin: TaskOrigin;
  title: string;
  description: string | null;
  priority: FeedPriority;
  status: FeedStatus;
  /** ISO instant, or null when nothing is scheduled. */
  dueAt: string | null;
  createdAt: string;
  /** `tasks.type` or `lead_tasks.task_type`, for the row's chip. */
  typeLabel: string;
  /** Present only on follow-ups. */
  lead: { id: string; name: string } | null;
}

/* ── row shapes, as the two tables actually return them ──────────────────── */

export interface OpsTaskRow {
  id: string;
  type: string | null;
  title: string;
  description: string | null;
  priority: string | null;
  status: string | null;
  due_date: string | null;
  created_at: string | null;
}

export interface LeadTaskRow {
  id: string;
  contact_id: string;
  title: string;
  description: string | null;
  task_type: string | null;
  priority: string | null;
  status: string | null;
  due_at: string | null;
  created_at: string | null;
  lead_name?: string | null;
}

/* ── vocabulary ─────────────────────────────────────────────────────────── */

// `tasks.status` is CHECKed to open|in_progress|completed|cancelled. The board
// used to ask for "pending", which that CHECK can never match, so the page was
// blank no matter what was in the table. "pending"/"dismissed" are accepted as
// read-aliases so an old bookmarked URL still resolves to something real.
const OPS_STATUS_ALIAS: Record<string, FeedStatus> = {
  pending: "open",
  dismissed: "cancelled",
};

export function normalizeOpsStatus(raw: string | null | undefined): FeedStatus {
  const s = (raw ?? "open").toLowerCase();
  if (OPS_STATUS_ALIAS[s]) return OPS_STATUS_ALIAS[s];
  if (s === "open" || s === "in_progress" || s === "completed" || s === "cancelled") return s;
  return "open";
}

// `lead_tasks.status` is open|done|cancelled. There is no in_progress: a
// follow-up is scheduled or it is finished.
export function normalizeLeadStatus(raw: string | null | undefined): FeedStatus {
  const s = (raw ?? "open").toLowerCase();
  if (s === "done") return "completed";
  if (s === "cancelled") return "cancelled";
  return "open";
}

/** Feed status → the value to write back to `lead_tasks`. */
export function toLeadStatus(s: FeedStatus): "open" | "done" | "cancelled" {
  if (s === "completed") return "done";
  if (s === "cancelled") return "cancelled";
  return "open";
}

// `lead_tasks.priority` is low|normal|high; `tasks.priority` is low|medium|high|urgent.
// "normal" and "medium" are the same idea under two names.
export function normalizePriority(raw: string | null | undefined): FeedPriority {
  const p = (raw ?? "").toLowerCase();
  if (p === "urgent" || p === "high" || p === "low") return p;
  return "medium"; // covers "normal", "medium", and anything unrecognised
}

/* ── row → FeedTask ──────────────────────────────────────────────────────── */

export function fromOpsTask(r: OpsTaskRow): FeedTask {
  return {
    id: r.id,
    origin: "ops",
    title: r.title,
    description: r.description,
    priority: normalizePriority(r.priority),
    status: normalizeOpsStatus(r.status),
    dueAt: r.due_date,
    createdAt: r.created_at ?? new Date().toISOString(),
    typeLabel: (r.type ?? "task").replace(/_/g, " "),
    lead: null,
  };
}

export function fromLeadTask(r: LeadTaskRow): FeedTask {
  return {
    id: r.id,
    origin: "followup",
    title: r.title,
    description: r.description,
    priority: normalizePriority(r.priority),
    status: normalizeLeadStatus(r.status),
    dueAt: r.due_at,
    createdAt: r.created_at ?? new Date().toISOString(),
    typeLabel: "follow-up",
    lead: { id: r.contact_id, name: (r.lead_name ?? "").trim() || "Unnamed lead" },
  };
}

/**
 * The lead label, matching the rule the lead page itself uses
 * (`dashboard/leads/[id]/page.tsx`): person first, business as the fallback.
 */
export function leadDisplayName(c: {
  first_name?: string | null;
  last_name?: string | null;
  business_name?: string | null;
}): string {
  const person = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
  return person || (c.business_name ?? "").trim() || "Unnamed lead";
}

/* ── bucketing ──────────────────────────────────────────────────────────── */

export type BucketKey = "overdue" | "today" | "this_week" | "later" | "no_date";

export const BUCKET_ORDER: BucketKey[] = ["overdue", "today", "this_week", "later", "no_date"];

export const BUCKET_LABELS: Record<BucketKey, string> = {
  overdue: "Overdue",
  today: "Today",
  this_week: "This week",
  later: "Later",
  no_date: "No date",
};

/**
 * Which bucket a task falls in, judged in BUSINESS_TZ.
 *
 * Never compare these dates with raw getDate()/slice(0,10): Vercel runs UTC, so
 * a follow-up due at 9am ET is stored 13:00Z and a naive comparison drifts by a
 * whole day either side of midnight. That is the exact bug business-time.ts was
 * written to kill — see its header.
 */
export function bucketFor(dueAt: string | null, now: Date = new Date()): BucketKey {
  if (!dueAt) return "no_date";
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return "no_date";

  if (isSameBusinessDay(due, now)) return "today";
  if (due.getTime() < now.getTime()) return "overdue";

  // "This week" is the next 7 calendar days, not an ISO week: what matters is
  // how soon it lands, not which side of Sunday it falls on.
  const weekOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  return due.getTime() <= weekOut.getTime() ? "this_week" : "later";
}

const PRIORITY_RANK: Record<FeedPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/** Soonest first within a bucket, priority breaking ties. */
export function compareTasks(a: FeedTask, b: FeedTask): number {
  if (a.dueAt && b.dueAt) {
    const d = new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
    if (d !== 0) return d;
  } else if (a.dueAt !== b.dueAt) {
    return a.dueAt ? -1 : 1;
  }
  const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (p !== 0) return p;
  return a.title.localeCompare(b.title);
}

export interface TaskBucket {
  key: BucketKey;
  label: string;
  tasks: FeedTask[];
}

/** Merge both feeds into due-date buckets, in display order, empties dropped. */
export function bucketTasks(tasks: FeedTask[], now: Date = new Date()): TaskBucket[] {
  const groups = new Map<BucketKey, FeedTask[]>();
  for (const t of tasks) {
    const key = bucketFor(t.dueAt, now);
    const list = groups.get(key);
    if (list) list.push(t);
    else groups.set(key, [t]);
  }
  return BUCKET_ORDER.filter((k) => (groups.get(k)?.length ?? 0) > 0).map((key) => ({
    key,
    label: BUCKET_LABELS[key],
    tasks: (groups.get(key) ?? []).sort(compareTasks),
  }));
}

/* ── display ────────────────────────────────────────────────────────────── */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Aug 24" / "Aug 24, 2027", in BUSINESS_TZ. */
export function formatDueDate(dueAt: string | null, now: Date = new Date()): string {
  if (!dueAt) return "no date";
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return "no date";
  const [y, m, d] = businessDayKey(due).split("-").map(Number);
  const thisYear = Number(businessDayKey(now).slice(0, 4));
  const stem = `${MONTHS[m - 1]} ${d}`;
  return y === thisYear ? stem : `${stem}, ${y}`;
}

/** How late a task is, in whole business days. 0 when not overdue. */
export function overdueDays(dueAt: string | null, now: Date = new Date()): number {
  if (!dueAt) return 0;
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime()) || due.getTime() >= now.getTime()) return 0;
  if (isSameBusinessDay(due, now)) return 0;
  return Math.max(1, Math.floor((now.getTime() - due.getTime()) / (24 * 60 * 60 * 1000)));
}
