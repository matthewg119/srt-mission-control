// What makes one thing more worth doing today than another.
//
// ‼️ THE SHAPE IS worklist.ts's, AND IT IS COPIED ON PURPOSE. An additive score with a PARALLEL
// array of plain sentences, one pushed beside every term. That file's whole design argument is that
// a number which cannot explain itself is a number nobody trusts, and the reasons are printed
// verbatim on the card rather than summarised.
//
// ‼️ "BIGGEST FIRST" IS ABOUT CONSEQUENCE, NOT DURATION. Nobody sorts a day by how long things take.
// What makes a task big in this business is how much waits on it, and DELIVERY_STEPS[].blockedBy
// already says so. A step eleven later steps are waiting on is genuinely the biggest thing that can
// be done today; a ninety-minute citation cleanup that unblocks nothing is not.
//
// PURE. No database, no clock beyond the `now` handed in, so the same inputs give the same order.

import { DELIVERY_STEPS, type StepKey } from "@/config/delivery-steps";

export interface ScoreResult {
  score: number;
  reasons: string[];
}

/** Capped, so one very central step cannot outrank an errored one on this term alone. */
const UNBLOCK_CAP = 24;
const OVERDUE_CAP = 20;

/**
 * How many steps are transitively waiting on this one.
 *
 * ‼️ FROM CONFIG, NOT FROM THE BOARD. reachableCursor() answers a similar question and WRITES while
 * doing it: it re-seeds missing rows, which is why lead-context.ts refuses to call it. This walks
 * the declared blockedBy graph, costs nothing, and is the same for every client, which is correct:
 * it is a property of the process, not of one board's current state.
 */
export function unblockCount(key: StepKey): number {
  const direct = new Map<string, string[]>();
  for (const step of DELIVERY_STEPS) {
    for (const blocker of step.blockedBy ?? []) {
      const list = direct.get(blocker) ?? [];
      list.push(step.key);
      direct.set(blocker, list);
    }
  }

  const seen = new Set<string>();
  const queue = [...(direct.get(key) ?? [])];
  while (queue.length) {
    const next = queue.shift() as string;
    if (seen.has(next)) continue;
    seen.add(next);
    for (const child of direct.get(next) ?? []) if (!seen.has(child)) queue.push(child);
  }
  return seen.size;
}

function daysSince(iso: string, now: number): number {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((now - t) / 86_400_000));
}

/** A delivery step waiting on a person. */
export function scoreStep(args: {
  status: "awaiting_me" | "error";
  updatedAt: string;
  errorDetail: string | null;
  stepLabel: string;
  stepNumber: number;
  unblocks: number;
  now: number;
}): ScoreResult {
  const reasons: string[] = [];
  let score = 0;

  if (args.status === "error") {
    score += 60;
    reasons.push(
      args.errorDetail
        ? `step ${args.stepNumber} errored: ${args.errorDetail}`
        : `step ${args.stepNumber} errored and has not been retried`
    );
  } else {
    const days = daysSince(args.updatedAt, args.now);
    if (days >= 2) {
      score += 40 + Math.min(days * 5, OVERDUE_CAP);
      reasons.push(`waiting on you for ${days} day${days === 1 ? "" : "s"}`);
    } else {
      score += 20;
      reasons.push(days === 0 ? "posted today, waiting on you" : "posted yesterday, waiting on you");
    }
  }

  if (args.unblocks > 0) {
    score += Math.min(args.unblocks * 4, UNBLOCK_CAP);
    reasons.push(
      args.unblocks === 1
        ? "one later step is waiting on this one"
        : `${args.unblocks} later steps are waiting on this one`
    );
  }

  return { score, reasons };
}

/** An approved plan row nobody has written yet. */
export function scorePage(args: { approvedAt: string | null; claimedAt: string | null; now: number }): ScoreResult {
  const reasons: string[] = [];
  let score = 10;
  reasons.push("approved and still unwritten");

  if (args.claimedAt) {
    const days = daysSince(args.claimedAt, args.now);
    if (days >= 3) {
      score += 20;
      reasons.push(`claimed ${days} days ago and there is still no page`);
    }
    return { score, reasons };
  }

  if (args.approvedAt) {
    const days = daysSince(args.approvedAt, args.now);
    const weeks = Math.floor(days / 7);
    if (weeks >= 1) {
      score += 15 + Math.min(weeks * 5, 15);
      reasons.push(`approved ${weeks} week${weeks === 1 ? "" : "s"} ago`);
    }
  }
  return { score, reasons };
}

/**
 * A follow-up task.
 *
 * ‼️ THE WORDING IS worklist.ts's, not a second vocabulary for the same states. Somebody reading
 * both surfaces should not have to work out whether "overdue" means the same thing in each.
 */
export function scoreFollowup(args: { dueAt: string | null; now: number; priority: string }): ScoreResult {
  const reasons: string[] = [];
  let score = 0;

  if (!args.dueAt) {
    score += 35;
    reasons.push("no follow-up date is set");
  } else {
    const due = new Date(args.dueAt).getTime();
    if (Number.isFinite(due) && due < args.now) {
      const days = daysSince(args.dueAt, args.now);
      score += 40 + Math.min(days * 5, OVERDUE_CAP);
      reasons.push(days === 0 ? "due earlier today" : `overdue by ${days} day${days === 1 ? "" : "s"}`);
    } else {
      score += 25;
      reasons.push("due today");
    }
  }

  if (args.priority === "urgent") {
    score += 15;
    reasons.push("marked urgent");
  } else if (args.priority === "high") {
    score += 8;
    reasons.push("marked high priority");
  }

  return { score, reasons };
}

/** A client inside their first month is worth a nudge up: the work compounds. */
export function newClientBonus(dayZeroAt: string | null, now: number): ScoreResult {
  if (!dayZeroAt) return { score: 0, reasons: [] };
  const days = daysSince(dayZeroAt, now);
  if (days > 30) return { score: 0, reasons: [] };
  return { score: 10, reasons: [`day ${days} of their first month`] };
}
