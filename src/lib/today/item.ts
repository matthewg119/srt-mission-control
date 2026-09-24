// One thing the owner could do today, from any of four places.
//
// ‼️ A SIBLING OF FeedTask, NOT AN EXTENSION OF IT, and there are three reasons.
//
//  1. FeedTask.id is a table primary key. A delivery step's uuid is NOT stable: reachableCursor and
//     loadRows re-seed missing client_delivery_steps rows, so a pin keyed on that id would be lost
//     the first time a board topped itself up, and the owner would watch his own drag undo itself.
//     A day item needs a composite key, and FeedTask cannot carry one without lying about `id`.
//  2. FeedTask's header declares a merge of exactly TWO named tables with lead_tasks as the source
//     of truth. Adding delivery steps and plan rows makes that header false, and headers here are
//     load-bearing.
//  3. Every field added as required breaks fromOpsTask, fromLeadTask and their four consumers.
//     Added as optional, two thirds of rows carry `undefined` and every reader null-checks forever.
//
// It REUSES everything it honestly can: FeedPriority, FeedStatus, BucketKey, bucketFor,
// formatDueDate and overdueDays from task-feed.ts; businessDayKey from business-time.ts; ActionVerb
// and STEP_ACTIONS from do-this-now.ts; DELIVERY_STEPS and stepNumber from config/delivery-steps.ts.
//
// ‼️ IT IS A READING, NOT A RECORD. Nothing here is stored except the pin. The step board, the page
// plan and lead_tasks stay the only writers of state, and every row links back to the Slack card
// that owns it. ops-index.ts's rule applies verbatim: "IT IS NOT A SECOND BOARD, and that is the
// line it must not cross."
//
// PURE. No database, no model, no network.

import type { BucketKey, FeedPriority, FeedStatus } from "@/lib/task-feed";
import type { DayRole } from "@/config/roles";

/**
 * ‼️ A CLOSED UNION, AND loadDayItems SWITCHES OVER IT WITH NO DEFAULT ARM. A fifth source does not
 * compile until somebody writes a case, and writing that case is a reviewed diff. That is the
 * compile-time half of "everything that is not AEO and the AI Referral Engine is noise": the day
 * cannot quietly grow a source the way a denylist of tables would let it.
 */
export type DaySource = "delivery_step" | "page_write" | "followup" | "ops_task";

export interface DayItem {
  /**
   * `${source}:${scope}:${local}`. The ordering key.
   *
   * ‼️ NOT A uuid, AND NOT A FOREIGN KEY. It addresses one of four tables and Postgres has no
   * polymorphic foreign key; and the one id you would reach for, client_delivery_steps.id, is
   * re-seeded underneath a pin. Parsed in exactly one place, itemKeyScope() below.
   */
  key: string;
  source: DaySource;
  role: DayRole;

  title: string;
  /** One line under the title. A plain sentence, never a status word on its own. */
  detail: string | null;

  /** Where the work is actually done. A Slack permalink for a step, an app route otherwise. */
  href: string | null;
  /** Present when a Slack card already owns this item. Today links to it; it never replaces it. */
  slackPermalink: string | null;

  clientId: string | null;
  clientName: string | null;

  priority: FeedPriority;
  status: FeedStatus;
  dueAt: string | null;
  createdAt: string;
  bucket: BucketKey;

  /** ‼️ STATED, NOT MEASURED. Rendered with "est." and never without it. See config/roles.ts. */
  effortMinutes: number;

  /**
   * How many later delivery steps declare they are waiting on this one.
   *
   * ‼️ THIS IS WHAT "BIGGEST TASKS FIRST" ACTUALLY MEANS. Zero for every non-step source. Computed
   * from DELIVERY_STEPS[].blockedBy, which is pure config: no database read, and no call to
   * reachableCursor(), which WRITES.
   */
  unblocks: number;

  score: number;
  /** Plain sentences, printed verbatim. worklist.ts's contract: a number that explains itself. */
  reasons: string[];

  /** Where the owner dragged it. Null means "wherever the score puts it". */
  pinnedRank: number | null;
  deferredUntil: string | null;

  /** The chip: "step 12", "page", "follow-up". */
  typeLabel: string;
}

export interface DayGroup {
  role: DayRole;
  label: string;
  items: DayItem[];
  estMinutes: number;
}

export interface DayPlan {
  /** businessDayKey(now). NEVER toISOString().slice(0,10): Vercel runs UTC. */
  planDay: string;
  groups: DayGroup[];
  /** Deferred items, so nothing is silently dropped. */
  later: DayItem[];
  estMinutes: number;
  /** Set when day_plan_order is missing. The page renders read only. */
  orderingUnavailable?: boolean;
  /** Named when a source could not be read, so an empty day is never mistaken for a clear one. */
  unreadable: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// The key
// ─────────────────────────────────────────────────────────────────────────────

export function stepKeyFor(clientId: string, stepKey: string): string {
  return `delivery_step:${clientId}:${stepKey}`;
}
export function pageKeyFor(planRowId: string): string {
  return `page_write:${planRowId}`;
}
export function followupKeyFor(taskId: string): string {
  return `followup:${taskId}`;
}

/** The only parser of the key grammar. */
export function itemKeyScope(key: string): { source: DaySource | null; parts: string[] } {
  const [head, ...rest] = key.split(":");
  const source =
    head === "delivery_step" || head === "page_write" || head === "followup" || head === "ops_task"
      ? (head as DaySource)
      : null;
  return { source, parts: rest };
}

// ─────────────────────────────────────────────────────────────────────────────
// Ordering
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Within a role group: a pin first, then the score, then the title.
 *
 * ‼️ compareTasks IS NOT USED AS THE PRIMARY SORT, deliberately. It orders by due date, and a
 * delivery step has no due date at all: every step would tie and fall through to alphabetical. It is
 * imported by the caller only as a last-resort tiebreaker on rows that are otherwise identical.
 */
export function compareDayItems(a: DayItem, b: DayItem): number {
  const ap = a.pinnedRank;
  const bp = b.pinnedRank;
  if (ap !== null && bp !== null) return ap - bp;
  if (ap !== null) return -1;
  if (bp !== null) return 1;
  if (b.score !== a.score) return b.score - a.score;
  return a.title.localeCompare(b.title);
}

/**
 * Group into lanes, in reading order, dropping deferred items into `later`.
 *
 * ‼️ A LANE WITH NOTHING IN IT IS NOT RENDERED. An empty "Outreach" heading every morning teaches
 * somebody to skim past the headings, and then a real one is missed.
 */
export function groupByRole(items: readonly DayItem[], roleOrder: readonly DayRole[], labels: Record<DayRole, string>): {
  groups: DayGroup[];
  later: DayItem[];
} {
  const now = Date.now();
  const later: DayItem[] = [];
  const live: DayItem[] = [];

  for (const item of items) {
    const deferred = item.deferredUntil ? new Date(item.deferredUntil).getTime() > now : false;
    (deferred ? later : live).push(item);
  }

  const groups: DayGroup[] = [];
  for (const role of roleOrder) {
    const inRole = live.filter((i) => i.role === role).sort(compareDayItems);
    if (!inRole.length) continue;
    groups.push({
      role,
      label: labels[role],
      items: inRole,
      estMinutes: inRole.reduce((n, i) => n + i.effortMinutes, 0),
    });
  }

  return { groups, later: later.sort(compareDayItems) };
}

// ─────────────────────────────────────────────────────────────────────────────
// The noise filter, asserted rather than assumed
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Words that mean a row came from a business this company no longer runs.
 *
 * ‼️ A BACKSTOP, NOT THE FILTER. The filter is the four adapters and the closed union above: nothing
 * reaches a DayItem unless an adapter put it there. This exists so that the day noise DOES creep
 * back, a probe fails loudly rather than the page quietly showing it. Matthew, 2026-09-23:
 * "everything that is not related to AI Engine Optimization and our AI Referral Engine is noise."
 */
export const DECOMMISSIONED =
  /\b(MCA|merchant cash|lender|lenders|funder|funders|bank statement|underwriting|IBKR|strike price|coaching studio|sms simulator)\b/i;

export function looksDecommissioned(item: Pick<DayItem, "title" | "detail">): boolean {
  return DECOMMISSIONED.test(item.title) || DECOMMISSIONED.test(item.detail ?? "");
}
