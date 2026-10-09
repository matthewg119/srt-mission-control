// How a client is doing, in one word and one reason, computed from facts and nothing else.
//
// ‼️ PURE ON PURPOSE. No supabase, no Date.now(), no network. Ages arrive pre-computed, so the same
// facts always give the same answer and this file can be reasoned about without a database. The
// clients page, a Slack digest and the chat agent must never disagree about whether a client is at
// risk, and the only way to guarantee that is one function all three call.
//
// ‼️ IT LIVES APART FROM clients-overview.ts BECAUSE THAT FILE IMPORTS @/lib/db. The reason is the
// one config/delivery-steps.ts was moved to config/ for: a "use client" card importing the health
// rule would otherwise drag the server client, and everything it reaches, into the browser bundle.
//
// ── WHAT THE PILL MEANS, AND WHY EACH RUNG IS WHERE IT IS ───────────────────────────────────────
//
// ‼️ A RED PILL NOBODY CAN EXPLAIN IS A PILL PEOPLE LEARN TO IGNORE. So the level and the reason
// come out of the SAME branch rather than out of two lookups, and the card prints both. There is no
// state in which a client is Watch for a reason the card cannot name.
//
// The ladder, first match wins:
//
//    1  churned                      Closed    nothing about a gone client is work
//    2  waitlist                     Parked    parked on purpose, so nothing can be late
//    3  onboarding_status complete   Closed    finished, not failing
//    4  a step in error              At risk   broken now, however long it has been broken
//    5  14+ days quiet               At risk   two missed weeks is a pattern
//    6  market_conflict              Watch     a decision somebody owes
//    7  7+ days quiet                Watch     one missed week is a question
//    8  2+ days sitting on me        Watch     stalled on our side, not theirs
//    9  active with no board         Watch     a seeding failure, not a quiet week
//   10  board present, all settled   On track
//   11  otherwise                    On track
//
// ‼️ RUNGS 1 TO 3 ARE src/lib/today/plan.ts:48 RENDERED, NOT A NEW OPINION. That file already draws
// this line: LIVE_BILLING = ["pilot", "active"], "`churned` and `waitlist` are not today's work". A
// churned client is not AT RISK, it is gone, and scoring it red every day is exactly how a red pill
// becomes wallpaper. The quiet and step tests are skipped for all three, because nothing is owed to
// a client nobody is delivering for.
//
// ‼️ AN ERROR IS AT RISK IMMEDIATELY, WITH NO TIME THRESHOLD. Taken verbatim from the rule
// step-engine.ts already states for the Slack digest: "AN ERRORED STEP IS NEVER STALE: it is broken
// now, however long it has been broken, and hiding a fresh error for two days is the opposite of
// what a digest is for."
//
// ‼️ THERE IS NO `blocked` RUNG, DELIBERATELY. `blocked` is advisory (DeliveryStep.blockedBy says so
// twice) and a freshly seeded board is mostly blocked by construction, so a rung on it would put
// nearly every healthy client on Watch inside a week. isOwnerWork()'s own docstring settles it in
// one line: "`pending` and `blocked` are the future."
//
// ‼️ THE THREE NUMBERS ARE BORROWED, NOT INVENTED, because a threshold somebody made up is the part
// of a rule that gets argued with instead of acted on:
//   2 days   stepDigest()'s own `staleHours: 48`, so the 09:00 Slack digest and this page cannot
//            disagree about what counts as stalled. Same argument isOwnerWork() makes about Today.
//   7 days   the slowest `repeatDays` this repo has ever set for anything: STAGE_CADENCE's entry
//            for a lead nobody has looked at, in src/config/stage-display.ts.
//   14 days  two of those. One missed week is a question, two is a pattern.

import { isOwnerWork } from "@/config/roles";

export type HealthLevel = "risk" | "watch" | "good" | "closed";

export interface ClientHealth {
  level: HealthLevel;
  /** The pill. */
  label: string;
  /** Why, in a few words, printed beside the pill. ‼️ NEVER EMPTY. */
  reason: string;
}

/** The first unsettled step, or the errored one, as facts rather than as a database row. */
export interface OpenStepFacts {
  /** From stepNumber(). ‼️ NOTHING IN THIS FILE KNOWS A STEP NUMBER OR A BOARD LENGTH. */
  number: number;
  key: string;
  label: string;
  status: string;
  errorDetail: string | null;
  /** Days since this step row last moved. Null when the row carries no timestamp. */
  ageDays: number | null;
}

export interface ClientFacts {
  billingStatus: string | null;
  onboardingStatus: string | null;
  marketConflict: boolean;
  /** Days since the last client_events row, or since the client was opened when there are none. */
  quietDays: number;
  /** Which clock quietDays was read off, so the copy can say so rather than overselling it. */
  quietFrom: "event" | "opened";
  /** False when this client holds no step rows at all, which is normal for a brand new client. */
  boardPresent: boolean;
  settled: number;
  /**
   * ‼️ THIS CLIENT'S OWN BOARD LENGTH, NOT THE CONFIG'S. How many rows it holds that the config
   * still lists, so a client seeded before a step was retired reads lower. lane-summary.ts says the
   * same thing in the same words, and it is the honest figure to divide a progress bar by.
   */
  total: number;
  openStep: OpenStepFacts | null;
  /** The first step in error. May sit AFTER openStep, which is why it is carried separately. */
  erroredStep: OpenStepFacts | null;
  /** isOwnerWork() rows: awaiting_me or error. The canonical "waiting on a person" count. */
  ownerWorkCount: number;
}

/** Two missed weeks. */
export const QUIET_RISK_DAYS = 14;
/** One missed week. */
export const QUIET_WATCH_DAYS = 7;
/** stepDigest()'s 48 hours, in the unit this file counts in. */
export const OWNER_HOLD_WATCH_DAYS = 2;

const DAY_MS = 86_400_000;

/** Days elapsed, floored, so something that happened this morning is 0 days ago. */
export function daysSince(iso: string, now: number): number {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 0;
  return Math.max(0, Math.floor((now - then) / DAY_MS));
}

/**
 * Days remaining, CEILED, which is the opposite rounding from daysSince and deliberately so: with
 * eleven hours left on a pilot, "0 days left" is a lie and "1 day left" is the truth somebody acts
 * on. Lifted off the clients list page it replaces, unchanged in behaviour.
 */
export function daysLeft(endsAt: string | null, now: number): string | null {
  if (!endsAt) return null;
  const end = new Date(endsAt).getTime();
  if (!Number.isFinite(end)) return null;
  const days = Math.ceil((end - now) / DAY_MS);
  if (days < 0) return "pilot ended";
  if (days === 0) return "last day";
  return `${days} days left`;
}

/**
 * The six values of clients.onboarding_status, in words.
 *
 * Lifted out of the page so a second surface cannot word the same column differently. The CHECK is
 * invited | intake_started | intake_complete | call_booked | active | complete.
 */
export const STAGE_LABEL: Record<string, string> = {
  invited: "Invited",
  intake_started: "Filling out intake",
  intake_complete: "Intake done",
  call_booked: "Call booked",
  active: "Active",
  complete: "Closed out",
};

export function stageLabel(status: string | null): string {
  if (!status) return "No stage";
  return STAGE_LABEL[status] ?? status;
}

/** See the ladder at the top of this file. The reason is the name of the rung that fired. */
export function clientHealth(f: ClientFacts): ClientHealth {
  if (f.billingStatus === "churned") {
    return { level: "closed", label: "Churned", reason: "churned" };
  }
  if (f.billingStatus === "waitlist") {
    return { level: "closed", label: "Parked", reason: "on the waitlist" };
  }
  if (f.onboardingStatus === "complete") {
    return { level: "closed", label: "Closed", reason: "closed out" };
  }

  if (f.erroredStep) {
    return { level: "risk", label: "At risk", reason: `step ${f.erroredStep.number} stopped` };
  }
  if (f.quietDays >= QUIET_RISK_DAYS) {
    return { level: "risk", label: "At risk", reason: quietReason(f) };
  }

  if (f.marketConflict) {
    // Carried over from the list page this replaces, where it was the one amber string on screen.
    // A signal that disappears during a layout change is a signal nobody decided to drop.
    return { level: "watch", label: "Watch", reason: "market overlap, undecided" };
  }
  if (f.quietDays >= QUIET_WATCH_DAYS) {
    return { level: "watch", label: "Watch", reason: quietReason(f) };
  }
  if (
    f.openStep &&
    isOwnerWork(f.openStep.status) &&
    (f.openStep.ageDays ?? 0) >= OWNER_HOLD_WATCH_DAYS
  ) {
    return { level: "watch", label: "Watch", reason: `on me for ${f.openStep.ageDays} days` };
  }
  if (!f.boardPresent && f.onboardingStatus === "active") {
    // Active with nothing to work is a seeding failure, not a quiet week, and it is invisible
    // everywhere else: the board page renders an empty list and says nothing is wrong.
    return { level: "watch", label: "Watch", reason: "active, no board seeded" };
  }

  if (f.boardPresent && !f.openStep) {
    return { level: "good", label: "On track", reason: "board settled" };
  }
  return { level: "good", label: "On track", reason: "nothing overdue" };
}

function quietReason(f: ClientFacts): string {
  return f.quietFrom === "opened"
    ? `${f.quietDays} days, nothing logged`
    : `${f.quietDays} days quiet`;
}

/**
 * What is owed next, in the words somebody would say out loud.
 *
 * ‼️ THE ERRORED STEP WINS OVER THE FIRST UNSETTLED ONE, the same choice clientHealth() makes and
 * for the same reason. An error can sit behind a pending step, and a card whose pill says
 * "step 22 stopped" while its sentence talks about step 9 is two answers to one question.
 *
 * ‼️ THE STEP LABEL GOES IN WHOLE. They are already sentences ("DNS: three records added by the
 * client"), and shortening one at the colon turns the ask into a heading.
 */
export function owedNext(f: ClientFacts): string {
  if (f.billingStatus === "churned") return "Churned. Nothing is owed.";
  if (f.billingStatus === "waitlist") return "On the waitlist. Nothing is owed yet.";

  if (!f.boardPresent) {
    switch (f.onboardingStatus) {
      case "invited":
        return "Invited. Waiting on them to start the intake.";
      case "intake_started":
        return "Intake is in progress. Nothing to work until it is in.";
      case "intake_complete":
        return "Intake is in. The delivery board has not been seeded yet.";
      case "call_booked":
        return "Call booked. The delivery board has not been seeded yet.";
      case "complete":
        return "Closed out.";
      default:
        return "No delivery board yet.";
    }
  }

  const s = f.erroredStep ?? f.openStep;
  if (!s) return `All ${f.total} steps on the board are settled.`;

  switch (s.status) {
    case "error":
      return s.errorDetail
        ? `Step ${s.number} failed: ${clip(s.errorDetail, 140)}`
        : `Step ${s.number} failed: ${s.label}.`;
    case "awaiting_me":
      return `Waiting on me at step ${s.number}: ${s.label}.`;
    case "blocked":
      return `Step ${s.number} is blocked: ${s.label}.`;
    case "running":
      return `Step ${s.number} is running now: ${s.label}.`;
    case "ready":
      return `Step ${s.number} is ready to run: ${s.label}.`;
    default:
      return `Next is step ${s.number}: ${s.label}.`;
  }
}

/** error_detail can be a stack or a JSON blob. One line, clipped, the shape lane-summary uses. */
function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}...`;
}

/**
 * The relationship, said as a person would say it rather than as a number.
 *
 * ‼️ "opened" IS A DIFFERENT SENTENCE FROM "event", because it is a different measurement. A client
 * with no client_events rows has not been quiet since the beginning of time; it has been open for N
 * days with nothing logged, and saying "spoke today" about a client nobody has spoken to would be
 * the one lie this card cannot afford.
 */
export function quietLine(days: number, from: "event" | "opened"): string {
  if (from === "opened") return days <= 1 ? "just opened" : `${days} days, nothing logged`;
  if (days === 0) return "spoke today";
  if (days === 1) return "spoke yesterday";
  return `${days} days quiet`;
}

/**
 * The money line.
 *
 * ‼️ NO DOLLAR FIGURE, AND THAT IS THE HONEST ANSWER RATHER THAN A MISSING FEATURE. There is no mrr
 * column on clients, or anywhere else; the only $499 in this repo is prose in a knowledge seed. A
 * card rendering "$499/mo" per client would be a price written down in a place no column backs,
 * which is the same failure as a hardcoded step count with an invoice attached. billing_status is
 * what the database actually knows, so that is what the card says.
 *
 * The CHECK is pilot | active | churned | waitlist.
 */
export function moneyLine(
  billingStatus: string | null,
  pilotEndsAt: string | null,
  now: number
): string {
  switch (billingStatus) {
    case "active":
      return "paying";
    case "pilot": {
      const left = daysLeft(pilotEndsAt, now);
      return left ? `free pilot, ${left}` : "free pilot";
    }
    case "churned":
      return "churned";
    case "waitlist":
      return "waitlist";
    default:
      return billingStatus ?? "no billing status";
  }
}
