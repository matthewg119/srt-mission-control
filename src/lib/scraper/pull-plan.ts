// "Say how many records you want and the lane works out where." The arithmetic, with no Slack, no
// database and no network in it.
//
// ‼️ PURE, FOR THE SAME REASON maps-command.ts IS. This decides how much money is spent and in which
// cities, so it has to be provable offline by scripts/_probe-pull-plan.ts without spending any. Every
// input arrives as a plain object; nothing in this file reads a table.
//
// ‼️ THE ONE RULE THAT MATTERS: A METRO WITH NO MEASURED CIRCLE MAY NOT BE GIVEN A BUDGET. `remaining`
// is null, not zero, for anything nobody has counted, and 15 of the 16 planned metros were in that
// state on 2026-10-09. Guessing that Houston holds what Dallas holds is how a plan buys 300 records
// in a city that has 40. So an unmeasured metro gets a MEASURE step ($0.0124) and a RESERVATION, and
// the chunks behind it are worked out after the count lands rather than invented now.
//
// ‼️ AND NULL IS NOT ZERO ANYWHERE IN THIS FILE. "Nobody has measured this circle" and "this circle
// is exhausted" are opposite facts, and a `?? 0` would render the first as the second: an untouched
// metro marked finished, skipped by the planner forever, and the vertical declared exhausted with
// fifteen cities never looked at.

import { METROS } from "@/lib/trt";
import type { PlanRow } from "./territory";
import type { VerticalDef } from "./verticals";

/**
 * How many records one chunk buys.
 *
 * ‼️ 300, NOT 3000, AND IT IS THE SAME 300 pullCommands USES. Four chunks finish a Dallas-sized
 * metro, and a chunk that fails costs one chunk rather than the whole pull. `limit 3000` against a
 * metro holding 1,990 is how batch 7a472c40 died.
 */
export const PLAN_CHUNK = 300;

/**
 * The most records one plan may ask for.
 *
 * ‼️ A CAP ON THE ASK, NOT ON THE SPEND, AND THE REASON IS TIME RATHER THAN MONEY. 10,000 records is
 * about $4.10, which is nothing. It is also 34 chunks, and chunks are serialised through
 * `activeMapsPull` at roughly one per cron tick, so it is most of a working day of crawling. A plan
 * longer than that is not a plan, it is a background process nobody is watching.
 *
 * ‼️ AND THE REAL CEILING IS MILLIONVERIFIER, WHICH THIS DOES NOT KNOW ABOUT. 10,000 raw records is
 * roughly 900 to 1,300 shippable addresses at the measured rate, against 10,500 bulk credits. The
 * card says so; this constant only stops a typo buying a hundred thousand.
 */
export const PLAN_MAX_RECORDS = 10_000;

/** $0.37 per 1,000 records. Measured, and the same figure SENDING.dfsPerThousand carries. */
export const PLAN_PER_RECORD = 0.37 / 1000;
/** One task fee per vendor call, and one call per chunk. */
export const PLAN_PER_TASK = 0.012;

/**
 * What it costs to find out how big a circle is: one task fee plus one record.
 *
 * ‼️ limit 1 IS THE WHOLE TRICK, AND IT IS THE ONE releaseCellProbes ALREADY USES. `total_count`
 * comes back on every DataForSEO response, so the vendor will say exactly how many businesses match
 * inside a circle for the price of the cheapest possible query.
 */
export const PLAN_MEASURE_USD = PLAN_PER_TASK + PLAN_PER_RECORD;

/** What a pull of `n` records costs: the records, plus one task fee per chunk. */
export function chunkCostUsd(records: number): number {
  return records * PLAN_PER_RECORD + PLAN_PER_TASK;
}

export type PlanStepKind = "measure" | "pull_budget" | "pull";

export interface PlanStep {
  seq: number;
  kind: PlanStepKind;
  metroKey: string;
  metroLabel: string;
  /** "Houston TX" shaped: what goes in the metro slot of the command. */
  where: string;
  /** Null except on `pull`. */
  limit: number | null;
  /** Null except on `pull`. Where in the vendor's result list this chunk starts. */
  offset: number | null;
  /** Null except on `pull_budget`: records held for this metro until its circle is counted. */
  budget: number | null;
  /** Null except on `pull`. The exact `pull maps ...` text, so the plan and the batch label agree. */
  command: string | null;
  costUsd: number;
}

export interface PlanMetro {
  key: string;
  label: string;
  priority: number;
  pulled: number;
  /** Null when the circle has never been counted. Never coerce to zero. */
  remaining: number | null;
  /** Records this plan will buy here. Concrete chunks only; a reservation is `reserved`. */
  allocated: number;
  /** Records held here pending a measurement in this same plan. */
  reserved: number;
  /** Will this plan measure the circle first. */
  measuring: boolean;
  /**
   * What is left here once the plan has run, or null when that cannot honestly be said.
   *
   * ‼️ NULL FOR A METRO BEING MEASURED, RATHER THAN A SUBTRACTION FROM A GUESS. The card's whole
   * claim is "here is what will be left afterwards", and for a circle nobody has counted the honest
   * answer is that nobody knows yet. Printing `budget - 0` there would be a number with no
   * measurement under it, which is the thing this file exists to prevent.
   */
  leftAfter: number | null;
}

export type PullPlanOutcome =
  /** There is work and the plan says what it is. */
  | { kind: "plan" }
  /** Every planned metro is measured and has nothing left. The cell walk is what remains. */
  | { kind: "metros_exhausted" }
  /** Nothing could be placed, and not because the metros are empty. */
  | { kind: "nothing_to_do"; reason: string };

export interface PullPlan {
  vertical: string;
  requested: number;
  outcome: PullPlanOutcome;
  steps: PlanStep[];
  metros: PlanMetro[];
  /** Records in concrete chunks. What the card can promise. */
  allocated: number;
  /** Records reserved behind a measurement. What the card can only describe. */
  reserved: number;
  /** Records the plan could place nowhere at all. */
  unplaced: number;
  measureCostUsd: number;
  pullCostUsd: number;
  totalCostUsd: number;
  /** How many metros this plan will pay to measure. */
  measuring: number;
  /** Measured metros with nothing left, which the plan skipped. */
  finished: number;
  /** Metros left untouched because the budget ran out before reaching them. */
  untouched: number;
}

export interface PlanInput {
  vertical: string;
  /** How many records the operator asked for. */
  requested: number;
  /** The per-metro picture, from `metroPlan`. Priority order is taken from the rows themselves. */
  rows: readonly PlanRow[];
  /** The vertical's registry entry, for the search string the commands carry. */
  def: VerticalDef | null;
  /**
   * How many circles this PASS may pay to measure.
   *
   * ‼️ ONE, AND THE REASON IS THAT A RESERVATION TAKES THE WHOLE REMAINING BUDGET. An unmeasured
   * metro cannot be given a chunk list, so it is given everything that is left and the real chunks
   * are worked out after the count lands. That consumes the budget, so a second measurement in the
   * same pass would be a measurement with nothing to spend behind it: a purchase for a card.
   *
   * ‼️ THE WALK IS WHAT REACHES THE SECOND METRO, NOT THIS. When the measurement comes back smaller
   * than the reservation (Houston holding 400 against 1,760 reserved), `expandBudget` places what
   * fits and the leftover is re-planned against the metros after it, which measures the next one.
   * That cascade is bounded by PLAN_MEASURE_BUDGET rather than by this.
   */
  maxMeasures?: number;
  chunk?: number;
}

export const PLAN_MAX_MEASURES = 1;

/**
 * How many circles ONE PLAN may pay to measure across its whole walk.
 *
 * ‼️ A BOUND ON THE CASCADE, NOT ON THE COST, AND THE DIFFERENCE MATTERS. Six measurements is
 * $0.074, which is not a budget. What it bounds is a plan that walks the entire metro list
 * measuring as it goes because every city turned out to hold forty businesses: the honest answer
 * there is to stop, report the budget as unspent, and let a person look at a vertical whose metros
 * are all empty, rather than to grind through sixteen cities on one check mark.
 */
export const PLAN_MEASURE_BUDGET = 6;

/**
 * The place string a command names for a metro.
 *
 * ‼️ THE ANCHOR CITY, NOT THE METRO LABEL, AND THE TWO ARE DIFFERENT VOCABULARIES. METROS keys
 * `dfw` with the label "Dallas-Fort Worth" and the anchors Dallas and Fort Worth. `locationNameOf`
 * turns "Dallas TX" into "Dallas,Texas,United States", which DataForSEO takes; it would make
 * "Dallas-Fort Worth,United States" out of the label, which is not a place.
 */
export function whereFor(metroKey: string, fallbackLabel: string): string {
  const anchor = METROS.find((m) => m.key === metroKey)?.anchors[0];
  return anchor ? anchor.city + " " + anchor.state : fallbackLabel;
}

/** The command one chunk runs, in the grammar `parseMapsCommand` already owns. */
export function chunkCommand(args: {
  vertical: string;
  query: string;
  where: string;
  limit: number;
  offset: number;
}): string {
  return (
    "pull maps " + args.vertical + " | " + args.where + " | " + args.query +
    " | limit " + args.limit + " | offset " + args.offset
  );
}

/**
 * Work out where to spend a budget.
 *
 * The order is the only interesting part: fill the metro already in progress before opening a new
 * one, because a half-worked metro is a half-worked market and finishing it is worth more than
 * starting a second. That falls out of taking the rows in priority order, since a worked metro is
 * always higher priority than the unworked one after it.
 */
export function planPull(input: PlanInput): PullPlan {
  const chunk = input.chunk ?? PLAN_CHUNK;
  const maxMeasures = input.maxMeasures ?? PLAN_MAX_MEASURES;
  const query = input.def?.searchQueries[0] ?? input.vertical;

  const rows = [...input.rows].sort((a, b) => a.priority - b.priority);

  const steps: PlanStep[] = [];
  const metros: PlanMetro[] = [];
  let budgetLeft = Math.max(0, input.requested);
  let measures = 0;
  let seq = 0;

  for (const row of rows) {
    const where = whereFor(row.key, row.label);
    const metro: PlanMetro = {
      key: row.key,
      label: row.label,
      priority: row.priority,
      pulled: row.pulled,
      remaining: row.remaining,
      allocated: 0,
      reserved: 0,
      measuring: false,
      leftAfter: row.remaining,
    };

    if (budgetLeft <= 0) {
      metros.push(metro);
      continue;
    }

    // ‼️ A MEASURED EMPTY METRO IS SKIPPED, AND THAT IS THE ONLY CASE WHERE ZERO MEANS FINISHED.
    // `remaining === 0` is a statement with a measurement behind it. `remaining === null` is the
    // absence of one, and the branch below is what tells them apart.
    if (row.remaining === 0) {
      metros.push(metro);
      continue;
    }

    if (row.remaining === null) {
      // Never counted. Buy the count, reserve the records, and let the walker do the arithmetic
      // once it has a real number. The card says exactly this rather than quoting chunks.
      if (measures >= maxMeasures) {
        metros.push(metro);
        continue;
      }
      measures += 1;
      metro.measuring = true;
      metro.leftAfter = null;

      steps.push({
        seq: (seq += 1),
        kind: "measure",
        metroKey: row.key,
        metroLabel: row.label,
        where,
        limit: null,
        offset: null,
        budget: null,
        command: null,
        costUsd: PLAN_MEASURE_USD,
      });

      const reserve = budgetLeft;
      metro.reserved = reserve;
      budgetLeft -= reserve;
      steps.push({
        seq: (seq += 1),
        kind: "pull_budget",
        metroKey: row.key,
        metroLabel: row.label,
        where,
        limit: null,
        offset: null,
        budget: reserve,
        command: null,
        // Free. The chunks it expands into carry the cost, and the card prices the reservation
        // separately as "up to" rather than folding a guess into one total.
        costUsd: 0,
      });
      metros.push(metro);
      continue;
    }

    // Measured and not empty: concrete chunks, offsets walking from what is already pulled.
    let placed = 0;
    let offset = row.pulled;
    while (placed < row.remaining && budgetLeft > 0) {
      const limit = Math.min(chunk, row.remaining - placed, budgetLeft);
      const command = chunkCommand({ vertical: input.vertical, query, where, limit, offset });
      steps.push({
        seq: (seq += 1),
        kind: "pull",
        metroKey: row.key,
        metroLabel: row.label,
        where,
        limit,
        offset,
        budget: null,
        command,
        costUsd: chunkCostUsd(limit),
      });
      placed += limit;
      offset += limit;
      budgetLeft -= limit;
    }

    metro.allocated = placed;
    metro.leftAfter = row.remaining - placed;
    metros.push(metro);
  }

  const allocated = metros.reduce((a, m) => a + m.allocated, 0);
  const reserved = metros.reduce((a, m) => a + m.reserved, 0);
  const measureCostUsd = steps.filter((s) => s.kind === "measure").reduce((a, s) => a + s.costUsd, 0);
  const pullCostUsd = steps.filter((s) => s.kind === "pull").reduce((a, s) => a + s.costUsd, 0);

  const measured = rows.filter((r) => r.remaining !== null);
  const unmeasured = rows.filter((r) => r.remaining === null);
  const finished = measured.filter((r) => r.remaining === 0).length;

  // ‼️ EXHAUSTION NEEDS EVERY METRO MEASURED, NOT MERELY EVERY METRO EMPTY-LOOKING. Declaring a
  // vertical finished while fifteen circles have never been counted is the single most expensive
  // wrong answer this file could give: it would stop the lane buying leads that are there.
  const metrosExhausted = rows.length > 0 && unmeasured.length === 0 && finished === rows.length;

  let outcome: PullPlanOutcome;
  if (steps.length > 0) {
    outcome = { kind: "plan" };
  } else if (metrosExhausted) {
    outcome = { kind: "metros_exhausted" };
  } else if (rows.length === 0) {
    outcome = { kind: "nothing_to_do", reason: "there are no metros in the plan for this vertical" };
  } else if (unmeasured.length > 0 && maxMeasures <= 0) {
    outcome = {
      kind: "nothing_to_do",
      reason:
        unmeasured.length + " metros have never had their circle measured and measuring is switched " +
        "off, so there is nowhere a budget could honestly be spent",
    };
  } else {
    outcome = { kind: "nothing_to_do", reason: "the budget was zero" };
  }

  return {
    vertical: input.vertical,
    requested: input.requested,
    outcome,
    steps,
    metros,
    allocated,
    reserved,
    unplaced: Math.max(0, input.requested - allocated - reserved),
    measureCostUsd,
    pullCostUsd,
    totalCostUsd: measureCostUsd + pullCostUsd,
    measuring: measures,
    finished,
    untouched: metros.filter((m) => m.allocated === 0 && m.reserved === 0 && m.remaining !== 0).length,
  };
}

/**
 * Expand a reservation into real chunks, once its circle has been counted.
 *
 * ‼️ THIS IS THE HALF THAT COULD NOT BE DONE AT PLAN TIME, and keeping it as its own function is
 * what makes that provable: the inputs are the measurement and the reservation, so a probe can
 * assert that a metro measured at 40 gets one chunk of 40 and not one of 300.
 */
export function expandBudget(args: {
  vertical: string;
  query: string;
  where: string;
  metroKey: string;
  metroLabel: string;
  /** What the circle holds, as just measured. */
  totalCount: number;
  /** What has already been pulled from this metro. The offset walks from here. */
  alreadyPulled: number;
  /** Records reserved for this metro. */
  budget: number;
  startSeq: number;
  chunk?: number;
}): PlanStep[] {
  const chunk = args.chunk ?? PLAN_CHUNK;
  const remaining = Math.max(0, args.totalCount - args.alreadyPulled);
  const steps: PlanStep[] = [];

  let placed = 0;
  let offset = args.alreadyPulled;
  let seq = args.startSeq;
  while (placed < remaining && placed < args.budget) {
    const limit = Math.min(chunk, remaining - placed, args.budget - placed);
    // ‼️ A ZERO LIMIT WOULD SPIN FOREVER, so it ends the loop rather than being emitted. It cannot
    // happen with the guards above, which is exactly why it is worth refusing: a loop that depends
    // on arithmetic staying positive should say so.
    if (limit <= 0) break;
    steps.push({
      // Fractional, so expanded chunks sort between this reservation and whatever follows it
      // without renumbering a plan that is already being walked.
      seq: seq + (steps.length + 1) / 1000,
      kind: "pull",
      metroKey: args.metroKey,
      metroLabel: args.metroLabel,
      where: args.where,
      limit,
      offset,
      budget: null,
      command: chunkCommand({ vertical: args.vertical, query: args.query, where: args.where, limit, offset }),
      costUsd: chunkCostUsd(limit),
    });
    placed += limit;
    offset += limit;
  }

  return steps;
}

// ── the command ──────────────────────────────────────────────────────────────────────────────────

export interface PullBudgetCommand {
  count: number;
  vertical: string;
}

export type PullBudgetParse =
  | { ok: true; command: PullBudgetCommand }
  | { ok: false; reason: string };

/** Printed on every refusal, so the shape never has to be guessed. */
export const PULL_BUDGET_GRAMMAR = [
  "`pull <how many> <vertical>`",
  "",
  "For example:",
  "  `pull 2000 medspa`   _works out which metros, splits it into chunks, and asks before buying_",
  "  `pull 300 dentist`",
  "",
  "It reads the territory plan, skips metros that are finished, measures the next one if nobody has",
  "counted it yet, and posts ONE card with the cost. Nothing is bought until you react.",
].join("\n");

/**
 * `pull 2000 medspa`, or null when the text is not that shape at all.
 *
 * ‼️ IT RETURNS null RATHER THAN A REFUSAL FOR ANYTHING STARTING `pull maps`, so the two grammars
 * cannot both claim a message. `parseMapsCommand` owns everything after "pull maps" and this owns
 * "pull" followed by a number. A message that is neither falls through to the assistant, which is
 * the behaviour #srt-scraper already has.
 *
 * ‼️ AND THE COUNT IS REQUIRED, NOT DEFAULTED. "pull medspa" with no number is the queue form that
 * `parseNextMetroCommand` already owns, and inventing a budget for it would turn a command that
 * takes the next cell into one that buys an arbitrary number of records.
 */
export function parsePullBudgetCommand(
  text: string,
  knownVerticals: readonly string[]
): PullBudgetParse | null {
  const t = unwrap(text).trim();
  if (!t) return null;
  // "pull maps ..." belongs to the other parser, whatever follows it.
  if (/^pull\s+maps\b/i.test(t)) return null;

  // `pull 2000 medspa`, `pull 2000 medspa leads`, `pull medspa 2000`. A count and a vertical, in
  // either order, with an optional noun on the end that is ignored.
  const m =
    /^pull\s+(\d[\d,]*)\s+([a-z][a-z\s]*?)(?:\s+(?:leads|records|rows|businesses))?$/i.exec(t) ??
    /^pull\s+([a-z][a-z\s]*?)\s+(\d[\d,]*)(?:\s+(?:leads|records|rows|businesses))?$/i.exec(t);
  if (!m) return null;

  const digits = /^\d/.test(m[1]) ? m[1] : m[2];
  const word = (/^\d/.test(m[1]) ? m[2] : m[1]).trim();

  // ‼️ THE VERTICAL IS CHECKED BEFORE THE COUNT, AND A MULTI-WORD ONE FALLS THROUGH RATHER THAN
  // BEING REFUSED. This channel is a CHAT surface as well as a command surface, and returning a
  // refusal is as much a claim on the message as returning a command: both stop it reaching the
  // assistant. "pull 20 of those into a list" is conversation and must reach the model, which now
  // has a plan_pull tool and can answer it properly. "pull 2000 plumber" is unambiguously this
  // command typed with an unknown vertical, and gets the list of known ones.
  //
  // The discriminator is whitespace: one bare word after the number is a vertical somebody meant,
  // several words are a sentence. Same instinct as `isOptionToken`, which separates two command
  // forms that have the same number of parts.
  if (/\s/.test(word)) return null;

  const vertical = word.toLowerCase();
  if (!knownVerticals.includes(vertical)) {
    return {
      ok: false,
      reason:
        "`" + word + "` is not a vertical I have a buyer profile for. Known: " +
        knownVerticals.map((v) => "`" + v + "`").join(", ") +
        ". Add one in `src/lib/scraper/verticals.ts` first, because a pull that cannot be judged is " +
        "money spent for nothing.",
    };
  }

  const count = Number(digits.replace(/,/g, ""));
  if (!Number.isFinite(count) || count < 1) {
    return { ok: false, reason: "`" + digits + "` is not a number of records I can plan for." };
  }
  if (count > PLAN_MAX_RECORDS) {
    return {
      ok: false,
      reason:
        count.toLocaleString() + " is above the plan cap of " + PLAN_MAX_RECORDS.toLocaleString() +
        ". The cap is about TIME rather than money: chunks are serialised one per cron tick on " +
        "purpose, so " + Math.ceil(count / PLAN_CHUNK) + " chunks is most of a day of crawling. Ask " +
        "for " + PLAN_MAX_RECORDS.toLocaleString() + " or fewer and run it again when it lands.",
    };
  }

  return { ok: true, command: { count, vertical } };
}

/**
 * Slack code formatting off a command.
 *
 * ‼️ THE SAME GENEROSITY unwrapCodeText HAS, AND FOR THE SAME MEASURED REASON. An operator typing a
 * command into Slack formats it as code, so `event.text` arrives wrapped in backticks. When that
 * stopped `pull maps` matching, the message fell through to the general assistant, which answered it
 * plausibly from the existing database and looked exactly like a pull that had run. Nothing had run.
 */
function unwrap(text: string): string {
  let t = text.trim();
  const fenced = /^```(?:[a-z]+\r?\n|\r?\n)?([\s\S]*?)```$/i.exec(t);
  if (fenced) t = fenced[1].trim();
  const inline = /^`{1,2}([^`][\s\S]*?)`{1,2}$/.exec(t);
  if (inline) t = inline[1].trim();
  return t;
}

/** Is this message the plan command at all. Cheap, for the dispatcher. */
export function looksLikePullBudget(text: string): boolean {
  const t = unwrap(text);
  if (/^pull\s+maps\b/i.test(t)) return false;
  return /^pull\s+(\d|[a-z])/i.test(t);
}

// ── the card ─────────────────────────────────────────────────────────────────────────────────────

/**
 * The one card, which is the whole point of Phase B.
 *
 * ‼️ IT NAMES THE METROS, THE CHUNKS, THE RECORDS, THE COST AND WHAT IS LEFT AFTERWARDS, and it says
 * out loud when one of those cannot be known yet. A card that quoted "240 left in Houston" off an
 * unmeasured circle would be the planner guessing with a straight face, which is worse than the
 * manual arithmetic it replaces, because nobody checks a number a machine printed.
 */
export function planCardLines(plan: PullPlan, args: {
  verticalLabel: string;
  /** Rendered after the cost, so the person ticking sees the real constraint. */
  verifierCreditsLeft: number;
}): string[] {
  const pulls = plan.steps.filter((s) => s.kind === "pull");
  const lines: string[] = [];

  lines.push(
    ":round_pushpin: *Pull " + plan.requested.toLocaleString() + " " + args.verticalLabel + " records*"
  );

  if (plan.measuring > 0) {
    lines.push(
      "  " + plan.measuring + " of these metros has never had its circle counted, so the plan " +
        "MEASURES first and works out the chunks from the real number."
    );
  }

  lines.push("");
  lines.push("```");
  for (const m of plan.metros) {
    if (m.allocated === 0 && m.reserved === 0) continue;
    const chunks = pulls.filter((s) => s.metroKey === m.key).length;
    if (m.measuring) {
      lines.push(
        pad(m.label, 20) + "measure the circle first, then up to " +
          m.reserved.toLocaleString() + " records"
      );
    } else {
      lines.push(
        pad(m.label, 20) + pad(m.allocated.toLocaleString() + " records", 16) +
          pad(chunks + (chunks === 1 ? " chunk" : " chunks"), 10) +
          (m.leftAfter === null ? "left after: unknown" : "left after: " + m.leftAfter.toLocaleString())
      );
    }
  }
  lines.push("```");

  const costParts: string[] = [];
  if (plan.pullCostUsd > 0) costParts.push("$" + plan.pullCostUsd.toFixed(2) + " of records");
  if (plan.measureCostUsd > 0) {
    costParts.push(
      "$" + plan.measureCostUsd.toFixed(4) + " to measure " + plan.measuring +
        (plan.measuring === 1 ? " circle" : " circles")
    );
  }
  lines.push(
    "  *Cost:* about $" + plan.totalCostUsd.toFixed(2) +
      (costParts.length ? "  (" + costParts.join(", ") + ")" : "")
  );
  if (plan.reserved > 0) {
    lines.push(
      "  Plus whatever the reserved " + plan.reserved.toLocaleString() + " records cost once the " +
        "measurement says how many are actually there, at about $" +
        chunkCostUsd(PLAN_CHUNK).toFixed(2) + " per " + PLAN_CHUNK + "."
    );
  }

  lines.push(
    "  *Chunks:* " + pulls.length + " now" + (plan.reserved > 0 ? ", more after the measurement" : "") +
      ", run ONE AT A TIME by the cron. Two pulls in flight means two crawls fighting for one tick."
  );

  if (plan.unplaced > 0) {
    lines.push(
      "  :warning: " + plan.unplaced.toLocaleString() + " of the " + plan.requested.toLocaleString() +
        " could not be placed anywhere measured. " +
        (plan.finished > 0 ? plan.finished + " metros are finished. " : "") +
        "Run this again once these land and it will measure and work the next ones."
    );
  }

  lines.push("");
  lines.push(
    "_MillionVerifier is the budget, not DataForSEO: " + args.verifierCreditsLeft.toLocaleString() +
      " credits left. The records here are about " +
      Math.round((plan.allocated + plan.reserved) * 0.09) + " to " +
      Math.round((plan.allocated + plan.reserved) * 0.13) + " shippable addresses at the measured rate._"
  );
  lines.push("");
  lines.push(
    ":white_check_mark: to queue it. *Nothing is bought until you react*, and the cron then walks " +
      "the chunks one at a time. `stop plan " + plan.vertical + "` cancels whatever has not run."
  );

  return lines;
}

function pad(text: string, width: number): string {
  return text.length >= width ? text + "  " : text + " ".repeat(width - text.length);
}
