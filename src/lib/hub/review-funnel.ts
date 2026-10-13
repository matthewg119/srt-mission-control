// Conversion per step of the walk, and per state of the referral.
//
//   SQL aggregates, this folds. docs/2026-10-13-review-funnel.sql explains why that split is not
//   a style preference: PostgREST applies a server-side row ceiling, so a raw select would
//   quietly return the newest N rows and draw a plausible, wrong chart. An undercount that looks
//   right is worse than an error.
//
// ‼️ THE STEP ORDER IS DECLARED IN REVIEW_SCRIPT AND NOWHERE ELSE, WHICH IS WHY THE FOLD IS HERE
// AND NOT IN THE DATABASE. A SQL function cannot know that q_walkout comes after q_motivation
// without a second copy of the walk living in a migration, and the day those two disagree the
// chart is wrong in a way nobody can see. Reordering the walk moves these numbers automatically.
//
// ‼️ WHAT THIS CANNOT MEASURE, STATED HERE SO NOBODY READS MORE INTO THE NUMBERS THAN IS THERE:
//
//   - It cannot follow one person. review_tool_submissions carries no session id and must never
//     carry one (docs/2026-08-18-client-hub.sql: "THE ABSENCE OF THE COLUMN IS THE ENFORCEMENT").
//     Every figure here is per ROW, which is per walk that produced at least one answer.
//   - It cannot see somebody who opened the page and typed nothing. That person is in hub_hits
//     and not here, which is exactly why the exposure count comes from there.
//   - It cannot tell whether a review was ever posted. No code path can observe a review
//     appearing on Google; posted_destination is self-reported and says so in its own comment.
//   - It is blind to the two yes/no gates as steps of their own. Recording them would mean
//     calling store() inside answerGate() or answerRefer(), and _probe-review-gating.ts fails the
//     build if it appears there, because those two handlers are the FTC rail on this surface and
//     have to stay small enough to read in one go. The invite's own drop-off is measured properly
//     by referralFunnel below, from its own table.
//
// Pure. No imports from the database, no network, no React.

import { REVIEW_SCRIPT } from "@/lib/hub/review-script";

/** One row of review_walk_funnel(), as PostgREST returns it. */
export interface WalkFunnelRow {
  last_step: string | null;
  n: number;
  completed: number;
  edited: number;
  regenerated: number;
}

/** One row of referral_funnel(). */
export interface ReferralFunnelRow {
  channel: string | null;
  invites: number;
  sent: number;
  claimed: number;
}

export interface WalkStep {
  id: string;
  /** What she was asked, trimmed to something that fits a table cell. */
  label: string;
  /** Walks whose furthest point was at or after this step. */
  reached: number;
  /** Of the walks that got here, the share of everyone who started. */
  rate: string;
}

export interface WalkFunnel {
  steps: WalkStep[];
  /** Walks that produced at least one answer. The denominator for `rate`. */
  started: number;
  /** Walks that reached a finished review. */
  completed: number;
  /** Of the completed ones, how many she edited before copying. */
  edited: number;
  /** Of the completed ones, how many tried another wording. */
  regenerated: number;
  /** Steps named in the data that are not in REVIEW_SCRIPT any more. */
  unknown: number;
}

/**
 * ‼️ BELOW THIS, COUNTS ONLY AND NO PERCENTAGES. Borrowed from
 * src/lib/experiments/funnel-report.ts, which pins the same floor and keeps the caveat in the
 * same string as the numbers so a later tidy-up cannot separate them.
 *
 * The number is lower here than that file's 100 because the populations are different: that one
 * measures ad traffic, this one measures patients at a single clinic's counter, where thirty walks
 * is a busy month rather than a slow afternoon. It is still high enough that "2 of 3 = 67%" never
 * reaches a client call, which is the whole job.
 */
export const MIN_WALKS_FOR_RATE = 30;

/** The house percent formatter. Same shape as funnel-report.ts's, including the dash for zero. */
export function pct(n: number, d: number): string {
  if (!d) return "-";
  return `${(Math.round((n / d) * 1000) / 10).toFixed(1)}%`;
}

/**
 * The steps she can actually be stopped at.
 *
 * ‼️ DERIVED, NOT TYPED. `say` and `ack` steps play on their own and she is never waiting at one,
 * so a funnel row for "greeting" would be a row that is always 100% and tells nobody anything.
 * What is left is the things she answers, in the order REVIEW_SCRIPT declares them.
 */
const ANSWERABLE = REVIEW_SCRIPT.filter(
  (step) => step.kind === "ask" || step.kind === "stars" || step.kind === "gate" || step.kind === "refer" || step.kind === "invite"
);

/**
 * Where every step sits in the walk, answerable or not.
 *
 * ‼️ EVERY SCRIPT STEP, NOT JUST THE ANSWERABLE ONES, AND GETTING THIS WRONG MADE THE FIRST
 * VERSION OF THIS FILE REPORT ZERO COMPLETIONS. Section 8 of scripts/_probe-review-v7.ts caught
 * it. The walk's last step is `closing`, which is a `say` and therefore not answerable, so a
 * finished walk stamps `last_step = "closing"` and an order built only from ANSWERABLE did not
 * recognise it: every completed walk fell into `unknown`, the funnel read 0% at the first row, and
 * all of it looked plausible.
 *
 * So positions come from the whole script, and the question each funnel row asks is "did she get
 * to a step at or after this one", which `closing` and every `ack_*` answer correctly.
 */
const SCRIPT_ORDER = new Map(REVIEW_SCRIPT.map((step, at) => [step.id, at]));

/**
 * ‼️ step.prompt WITH NO FALLBACK, AND THE TYPE CHECKER IS WHAT GUARANTEES THAT IS SAFE. The
 * filter above narrows ScriptStep to the four kinds she can be waiting at, and every one of them
 * declares `prompt`; only `say` does not, and `say` is excluded. An `"prompt" in step` guard here
 * resolved its else branch to `never`, which is tsc saying the fallback was unreachable.
 *
 * So if a future step kind arrives without a prompt, this line fails to compile rather than
 * silently labelling a funnel row with an internal id.
 */
function labelFor(step: (typeof ANSWERABLE)[number]): string {
  const prompt = step.prompt;
  return prompt.length > 60 ? `${prompt.slice(0, 57)}...` : prompt;
}

/**
 * Fold the per-last_step counts into a running funnel.
 *
 * "Reached step S" is every walk whose furthest step was S or later, which is what makes this
 * read as a funnel rather than as a histogram of where people stopped. Both are in the data; the
 * funnel is the one that answers the question.
 */
export function walkFunnel(rows: readonly WalkFunnelRow[]): WalkFunnel {
  /** Walks whose furthest point was at this position in the script. */
  const stoppedAt = new Map<number, number>();
  let started = 0;
  let completed = 0;
  let edited = 0;
  let regenerated = 0;
  let unknown = 0;

  for (const row of rows) {
    const n = Number(row.n ?? 0);
    started += n;
    completed += Number(row.completed ?? 0);
    edited += Number(row.edited ?? 0);
    regenerated += Number(row.regenerated ?? 0);

    const id = (row.last_step ?? "").trim();
    const at = SCRIPT_ORDER.get(id);
    // ‼️ AN UNRECOGNISED STEP IS COUNTED AND NAMED, NEVER DROPPED. A row stamped with a step that
    // has since been renamed or removed is still a real walk by a real patient, and silently
    // discarding it would shrink the denominator and inflate every rate above it, which is the
    // direction that flatters us.
    if (at === undefined) {
      unknown += n;
      continue;
    }
    stoppedAt.set(at, (stoppedAt.get(at) ?? 0) + n);
  }

  // Walk backwards so each step carries everybody who got to it or past it.
  //
  // ‼️ THE DIRECTION IS THE WHOLE ARITHMETIC. Summing forwards instead produces a rising series,
  // which draws a funnel upside down and reads as the walk GAINING people as it goes. Section 8
  // of the probe asserts the series is monotonically non-increasing for exactly that reason.
  const steps: WalkStep[] = [];
  let carried = 0;
  let scanned = REVIEW_SCRIPT.length - 1;

  for (let at = ANSWERABLE.length - 1; at >= 0; at -= 1) {
    const step = ANSWERABLE[at];
    const position = SCRIPT_ORDER.get(step.id) ?? 0;
    // Everything that stopped at or after this step, including the `say` and `ack` steps between
    // this answerable one and the next.
    while (scanned >= position) {
      carried += stoppedAt.get(scanned) ?? 0;
      scanned -= 1;
    }
    steps.unshift({
      id: step.id,
      label: labelFor(step),
      reached: carried,
      rate: started >= MIN_WALKS_FOR_RATE ? pct(carried, started) : "-",
    });
  }

  return { steps, started, completed, edited, regenerated, unknown };
}

export interface ReferralFunnel {
  channels: Array<{ channel: string; invites: number; sent: number; claimed: number; claimRate: string }>;
  invites: number;
  sent: number;
  claimed: number;
}

/**
 * Invites minted, got as far as her keyboard, and claimed by the friend.
 *
 * ‼️ `sent` IS NOT A DELIVERY CONFIRMATION AND NO LABEL BUILT FROM IT MAY SAY IT IS. We are not
 * the sender: composeInvite returns an href and opens her own messaging app. What sent_at means is
 * what its column comment says, "she got as far as her own keyboard".
 */
export function referralFunnel(rows: readonly ReferralFunnelRow[]): ReferralFunnel {
  let invites = 0;
  let sent = 0;
  let claimed = 0;

  const channels = rows
    .map((row) => {
      const i = Number(row.invites ?? 0);
      const s = Number(row.sent ?? 0);
      const c = Number(row.claimed ?? 0);
      invites += i;
      sent += s;
      claimed += c;
      return {
        channel: (row.channel ?? "").trim() || "unknown",
        invites: i,
        sent: s,
        claimed: c,
        // ‼️ AGAINST SENT AND NOT AGAINST INVITES. An invite she never sent cannot be claimed, so
        // dividing by the minted count would blame the friend for a message that never left the
        // counter. The two denominators answer different questions and this is the one about the
        // friend.
        claimRate: s >= MIN_WALKS_FOR_RATE ? pct(c, s) : "-",
      };
    })
    .sort((a, b) => b.invites - a.invites);

  return { channels, invites, sent, claimed };
}
