// What the thread says, and the two CSVs it says it about.
//
// The message is the Python's stdout, deliberately close to it: input / clean / junk with
// percentages, then the junk breakdown by reason, most common first. Matthew has read that shape a
// lot of times and a Slack lane that reports the same numbers differently is a lane he has to
// re-learn.
//
// Pure. No Slack, no database, no network, so `_probe-scraper.ts` can assert the wording.

import { toCsv } from "./csv";
import type { DedupeMatch, DuplicateRow } from "./dedup";
import { JUNK_REASON_ORDER, type JunkReason } from "./rules";
import type { StoredRow } from "./store";
import type { CutoffPlan, ScoreResult } from "./score";
import {
  OPTIMIZATION_KEY_ORDER,
  OPTIMIZATION_LABEL,
  UNVERIFIABLE,
  type GapCount,
  type OptimizationKey,
} from "./gbp-audit";

/** Plain-English gloss per reason, because "no_mx" means nothing to anyone reading it cold. */
const REASON_LABEL: Record<JunkReason, string> = {
  no_email: "no email on the row",
  duplicate_in_file: "same address twice in this file",
  duplicate_prior_batch: "already seen on an earlier drop",
  already_in_crm: "already in outreach_prospects",
  bad_syntax: "not a valid address",
  role_account: "role account (info@, sales@)",
  disposable_domain: "disposable domain",
  no_mx: "domain accepts no mail",
};

function pct(n: number, total: number): string {
  if (total <= 0) return "0.0%";
  return ((n / total) * 100).toFixed(1) + "%";
}

export interface BreakdownInput {
  fileName: string | null;
  emailColumn: string | null;
  total: number;
  clean: number;
  junk: number;
  breakdown: Map<JunkReason, number>;
}

export function formatBreakdown(input: BreakdownInput): string {
  const { total, clean, junk } = input;
  const lines: string[] = [];

  lines.push("*" + (input.fileName ?? "the file") + "* filtered.");
  lines.push("");
  lines.push("```");
  lines.push("Input:  " + total);
  lines.push("Clean:  " + clean + "  (" + pct(clean, total) + ")");
  lines.push("Junk:   " + junk + "  (" + pct(junk, total) + ")");
  lines.push("```");

  if (junk > 0) {
    lines.push("");
    lines.push("Junk breakdown:");
    // Sorted by count, ties broken by the pipeline's own order, so two runs with the same numbers
    // print the same list rather than whatever the Map happened to iterate.
    const rows = Array.from(input.breakdown.entries()).sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return JUNK_REASON_ORDER.indexOf(a[0]) - JUNK_REASON_ORDER.indexOf(b[0]);
    });
    lines.push("```");
    for (const [reason, count] of rows) {
      lines.push(reason.padEnd(20) + String(count).padStart(6) + "   " + REASON_LABEL[reason]);
    }
    lines.push("```");
  }

  if (input.emailColumn) {
    lines.push("");
    lines.push("_Email column read as `" + input.emailColumn + "`._");
  }

  return lines.join("\n");
}

/**
 * clean.csv: the original columns, original order, survivors only.
 *
 * ‼️ THE HEADERS COME FROM THE FILE, NOT FROM THE ROWS. Rebuilding them by unioning the keys of
 * every row would reorder the columns and silently drop any column that happens to be empty on
 * every surviving row, which turns a re-upload into a different file than the one that was pulled.
 */
export function buildCleanCsv(headers: string[], rows: StoredRow[]): string {
  return toCsv(headers, rows.map((r) => r.raw));
}

/** junk.csv: the same columns plus `reason`, exactly like the Python's. */
export function buildJunkCsv(headers: string[], rows: StoredRow[]): string {
  return toCsv(
    [...headers, "reason"],
    rows.map((r) => ({ ...r.raw, reason: r.reason ?? "" }))
  );
}

// ── the drop's dedupe split ─────────────────────────────────────────────────────────────────────

/** Plain-English gloss per match key, on the card and in the file. */
const MATCH_LABEL: Record<DedupeMatch, string> = {
  in_file: "the same business twice in this file",
  domain: "same website as a business from an earlier drop",
  phone: "same phone as a business from an earlier drop",
  email: "same address as a contact from an earlier drop",
};

/**
 * duplicates.csv: the original columns plus WHAT matched and WHICH value did it.
 *
 * ‼️ THE VALUE, NOT JUST THE KEY NAME. These rows are removed from the run before anything is
 * filtered, scored or bought, so this file is the only place they are ever seen again. The one way
 * the dedupe can be wrong is a shared front-desk phone or a platform host slipping past
 * NON_IDENTIFYING_HOSTS, and `matched_value` is what makes that visible in one glance rather than
 * requiring somebody to reconstruct the key by hand.
 */
export function buildDuplicatesCsv(headers: string[], rows: DuplicateRow[]): string {
  return toCsv(
    [...headers, "duplicate_reason", "matched_value"],
    rows.map((r) => ({ ...r.raw, duplicate_reason: r.matchedOn, matched_value: r.matchedValue }))
  );
}

/** new.csv: the original columns, original order, the rows nobody had seen. */
export function buildNewCsv(headers: string[], rows: Array<{ raw: Record<string, string> }>): string {
  return toCsv(headers, rows.map((r) => r.raw));
}

export function formatDedupeSplit(input: {
  fileName: string | null;
  total: number;
  dupes: DuplicateRow[];
  newCount: number;
  /** Which columns the keys were read from, so the numbers can be argued with. */
  keyColumns: { website: string | null; phone: string | null; email: string | null };
}): string {
  const { total, dupes, newCount } = input;
  const lines: string[] = [];

  lines.push("*" + (input.fileName ?? "the file") + "* checked against every earlier drop.");
  lines.push("");
  lines.push("```");
  lines.push("rows        " + total);
  lines.push("already in  " + dupes.length + "  (" + pct(dupes.length, total) + ")");
  lines.push("new         " + newCount + "  (" + pct(newCount, total) + ")");
  lines.push("```");

  if (dupes.length > 0) {
    const counts = new Map<DedupeMatch, number>();
    for (const d of dupes) counts.set(d.matchedOn, (counts.get(d.matchedOn) ?? 0) + 1);
    const order: DedupeMatch[] = ["in_file", "domain", "phone", "email"];
    lines.push("");
    lines.push("Matched on:");
    lines.push("```");
    for (const key of order) {
      const n = counts.get(key);
      if (n) lines.push(key.padEnd(10) + String(n).padStart(6) + "   " + MATCH_LABEL[key]);
    }
    lines.push("```");
  }

  // Which columns were read, stated rather than assumed. A file whose phone lives under a header
  // this lane does not know reports fewer duplicates than it has, and this line is the only place
  // that would ever be visible.
  const read: string[] = [];
  if (input.keyColumns.website) read.push("website `" + input.keyColumns.website + "`");
  if (input.keyColumns.phone) read.push("phone `" + input.keyColumns.phone + "`");
  if (input.keyColumns.email) read.push("email `" + input.keyColumns.email + "`");
  lines.push("");
  lines.push(
    read.length > 0
      ? "_Keys read from " + read.join(", ") + "._"
      : "_No website, phone or email column in this file, so nothing could be matched. Every row is new._"
  );

  return lines.join("\n");
}

/** verified-ok.csv: the clean rows MillionVerifier came back OK on, original columns. */
export function buildVerifiedCsv(headers: string[], rows: StoredRow[]): string {
  return toCsv(
    [...headers, "mv_result"],
    rows.map((r) => ({ ...r.raw, mv_result: r.mv_result ?? "" }))
  );
}

export interface MvCounts {
  ok?: number;
  catch_all?: number;
  invalid?: number;
  unknown?: number;
  disposable?: number;
  total?: number;
}

export function formatMvSummary(fileName: string | null, counts: MvCounts): string {
  const lines: string[] = [];
  lines.push("*MillionVerifier finished* on " + (fileName ?? "the file") + ".");
  lines.push("```");
  for (const key of ["ok", "catch_all", "unknown", "invalid", "disposable"] as const) {
    const v = counts[key];
    if (typeof v === "number") lines.push(key.padEnd(14) + String(v).padStart(6));
  }
  lines.push("```");
  lines.push("`verified-ok.csv` is the send list.");
  return lines.join("\n");
}

// ── workflow B: the picker, the scores, the cutoff ──────────────────────────────────────────────

/**
 * The card a top-level drop posts, before anything has been decided.
 *
 * ‼️ IT READS THE HEADERS AND SAYS WHAT IT SEES. IT DOES NOT ACT ON THEM. Naming which columns are
 * present is genuinely useful and costs nothing; letting that decide would make the picker fire
 * only on the ambiguous case, which is a tripwire rather than a review step. Same reasoning that
 * took the size threshold off the MillionVerifier gate.
 */
export function formatWorkflowPicker(input: {
  fileName: string | null;
  totalRows: number;
  emailColumn: string | null;
  companyColumn: string | null;
  cityColumn: string | null;
  websiteColumn: string | null;
  /** From the drop's dedupe. Both workflows run on the new rows only. */
  duplicateCount: number;
  newCount: number;
}): string {
  const lines: string[] = [];
  lines.push(
    "*" + (input.fileName ?? "the file") + "*, " + input.totalRows + " rows" +
      (input.duplicateCount > 0
        ? ", " + input.duplicateCount + " already seen, *" + input.newCount + " new*"
        : ", all new") +
      ". Which workflow?"
  );
  lines.push("");
  lines.push(
    ":one:  *Filter and verify.* The seven checks, then `clean.csv` and `junk.csv`, then " +
      "MillionVerifier behind a :white_check_mark:."
  );
  lines.push(
    ":two:  *Score first.* Rank every business on how visible it already is, so the dominant ones " +
      "can be dropped before anybody pays to reveal contacts."
  );
  lines.push("");
  lines.push("Columns I can see:");
  lines.push("```");
  lines.push("email     " + (input.emailColumn ?? "not found"));
  lines.push("company   " + (input.companyColumn ?? "not found"));
  lines.push("city      " + (input.cityColumn ?? "not found") + "   optional, absent means not measured");
  lines.push("website   " + (input.websiteColumn ?? "not found") + "   optional, absent means not measured");
  lines.push("```");

  // A read, never a decision. The wording says so out loud so nobody later mistakes it for one.
  if (!input.emailColumn && input.companyColumn) {
    lines.push("");
    lines.push(
      "_No email column in this file, so :two: is probably it. Your call either way, nothing " +
        "starts until you react._"
    );
  } else if (input.emailColumn && !input.companyColumn) {
    lines.push("");
    lines.push(
      "_There is an email column and no company column, so :one: is probably it. Your call either " +
        "way, nothing starts until you react._"
    );
  }

  if (input.duplicateCount > 0) {
    lines.push("");
    lines.push(
      input.newCount === 0
        ? "_Every row in that file has been through here before, so whichever you pick has nothing " +
          "to work on. `duplicates.csv` above is the whole file._"
        : "_Either workflow runs on the " + input.newCount + " new rows only. The " +
          input.duplicateCount + " in `duplicates.csv` are not filtered, not scored and not paid for._"
    );
  }

  lines.push("");
  lines.push("React :one: or :two: on THIS message.");
  return lines.join("\n");
}

/** How many names the drop card prints in full before it starts counting instead. */
const GEO_NAMES_SHOWN = 60;

/**
 * What the United States filter removed, by name.
 *
 * ‼️ THE NAMES, NOT JUST THE COUNT, and this is the same rule `junk.csv` follows by carrying a
 * `reason` column. These rows are DELETED from the run rather than sorted to the bottom, so the
 * thread is the only place they are ever seen again. The one way the filter can be wrong is a
 * genuinely American business whose export left the state cell blank and wrote a bare city, and a
 * bare number would hide exactly that behind a plausible-looking total.
 *
 * ‼️ `unlocated` ARE KEPT AND ARE SAID OUT LOUD ANYWAY. A row with no city and no state was not
 * judged to be foreign, it could not be judged at all, which is a fact about the export rather than
 * about the business. Same tri-state as `MxVerdict` and every "not measured" note in this lane:
 * "could not look" and "nothing is there" are different answers and the safe direction is to keep.
 */
export function formatGeoDrop(
  dropped: Array<{ company: string; where: string }>,
  unlocated: number,
  kept: number
): string {
  const lines: string[] = [];

  if (dropped.length > 0) {
    lines.push(
      "*" + dropped.length + " row" + (dropped.length === 1 ? "" : "s") + " removed: not in the " +
        "United States.* " + kept + " left to score."
    );
    lines.push(
      "_Read off the `state` and `city` cells of your file, never off the search. Deleted before " +
        "anything was queued, so none of them cost a lookup._"
    );
    lines.push("```");
    const width = Math.max(...dropped.slice(0, GEO_NAMES_SHOWN).map((d) => d.company.length));
    for (const d of dropped.slice(0, GEO_NAMES_SHOWN)) {
      lines.push(d.company.padEnd(Math.min(width, 44)) + "  " + d.where);
    }
    if (dropped.length > GEO_NAMES_SHOWN) {
      lines.push("... and " + (dropped.length - GEO_NAMES_SHOWN) + " more");
    }
    lines.push("```");
  }

  if (unlocated > 0) {
    if (dropped.length > 0) lines.push("");
    lines.push(
      "_" + unlocated + " row" + (unlocated === 1 ? "" : "s") + " carried no city and no state at " +
        "all, so nothing could say where they are. Those were KEPT: an empty cell is a fact about " +
        "the export, not about the business._"
    );
  }

  return lines.join("\n");
}

export interface ScoreSummaryInput {
  fileName: string | null;
  queryTemplate: string;
  scored: number;
  unmeasured: number;
  /** Presence, the one number the file is sorted and ranked by. */
  presenceScored: number;
  presenceUnmeasured: number;
  presenceHigh: number | null;
  presenceLow: number | null;
  costUsd: number;
  high: number | null;
  low: number | null;
  /** The GBP optimization audit, on the same rows in the same pass. */
  optimized: number;
  optimizationUnmeasured: number;
  optimizationHigh: number | null;
  optimizationLow: number | null;
  /** Most common gap first. `countGaps` already sorted and tie-broke it. */
  gaps: GapCount[];
}

export function formatScoreSummary(input: ScoreSummaryInput): string {
  const lines: string[] = [];
  lines.push("*" + (input.fileName ?? "the file") + "* scored.");
  lines.push("");
  lines.push("*Presence*, the one number. The file is sorted and ranked by it, highest first.");
  lines.push("```");
  lines.push("scored        " + input.presenceScored);
  if (input.presenceUnmeasured > 0) lines.push("not measured  " + input.presenceUnmeasured);
  if (input.presenceHigh !== null) {
    lines.push("range         " + input.presenceLow + " to " + input.presenceHigh);
  }
  lines.push("spent         $" + input.costUsd.toFixed(4));
  lines.push("```");
  lines.push(
    "_Everything of the twelve components that could be measured, dominance and GBP optimization " +
      "in one denominator. A row measured on six is scored out of six, so nothing is invented for " +
      "the half that could not be looked at._"
  );

  if (input.presenceUnmeasured > 0) {
    // Said out loud rather than left to be noticed, because these rows are about to be swept into
    // whichever pile the cutoff leaves them in.
    lines.push(
      "_" + input.presenceUnmeasured + " could not be measured on a single component. They sit at " +
        "the bottom of the file with no rank, they are left out of any percentage, and they stay " +
        "in the keep pile._"
    );
  }

  lines.push("");
  lines.push("*Dominance*, the first of the two halves. A column now, not the sort key.");
  lines.push("```");
  lines.push("scored        " + input.scored);
  if (input.unmeasured > 0) lines.push("not measured  " + input.unmeasured);
  if (input.high !== null) lines.push("range         " + input.low + " to " + input.high);
  lines.push("```");
  lines.push("");
  lines.push("_Query: `" + input.queryTemplate + "`_");

  lines.push("");
  lines.push(formatOptimizationBlock(input));

  return lines.join("\n");
}

/**
 * The second score, printed under the first and never merged with it.
 *
 * ‼️ TWO NUMBERS, ONE RUN, AND THEY ANSWER DIFFERENT QUESTIONS. Dominance is "are they already
 * winning", which is what the file is sorted and cut by. Optimization is "did anybody fill the
 * profile in", which is what the call is about. A business can be high on one and low on the other
 * in either direction, so anything that averaged them would answer neither question.
 */
function formatOptimizationBlock(input: ScoreSummaryInput): string {
  const lines: string[] = [];
  lines.push("*GBP optimization*, the other half. A column too.");
  lines.push("");
  lines.push("```");
  lines.push("audited       " + input.optimized);
  if (input.optimizationUnmeasured > 0) {
    lines.push("not measured  " + input.optimizationUnmeasured);
  }
  if (input.optimizationHigh !== null) {
    lines.push("range         " + input.optimizationLow + " to " + input.optimizationHigh);
  }
  lines.push("```");

  // The most common gap is the line that writes the campaign, so it is said in words before the
  // table rather than left to be spotted in it.
  const measuredGaps = input.gaps.filter((g) => g.measured > 0 && g.missing > 0);
  if (measuredGaps.length > 0) {
    const top = measuredGaps[0];
    lines.push("");
    lines.push(
      "*The most common gap: " + OPTIMIZATION_LABEL[top.key] + "*, on " + top.missing +
        " of " + top.measured + " profiles that could be checked."
    );
    lines.push("```");
    for (const gap of measuredGaps) {
      lines.push(
        (gap.missing + " of " + gap.measured).padEnd(12) + OPTIMIZATION_LABEL[gap.key]
      );
    }
    lines.push("```");
  }

  // ‼️ PRINTED SO THEIR ABSENCE IS NEVER MISTAKEN FOR A LOW SCORE. These three cannot be observed
  // from outside at all, they carry no weight and no denominator, and they are not components. They
  // are work SRT does for the client, so they belong on the delivery checklist and on the call.
  lines.push("");
  lines.push("_Cannot be measured from outside. Verify on the call:_");
  for (const item of UNVERIFIABLE) lines.push("_  - " + item + "_");
  lines.push(
    "_These three carry no weight, so a 100 means the six things a lookup CAN see are in order, " +
      "not that the profile is finished._"
  );

  return lines.join("\n");
}

/**
 * The cutoff gate card. Posted UNDER `scored.csv`, never above it.
 *
 * Separate from the summary because the summary is a report and this is a gate: it carries the ts
 * that `handleScraperReaction` resolves, and "react on THIS message" has to sit below the file it
 * is asking you to read first. Same order the MillionVerifier card is posted in.
 */
export function formatCutoffCard(): string {
  return [
    "`scored.csv` is sorted by *presence, most FIRST*, so row 1 is the business that is already " +
      "most visible and the bottom is the ones nobody can find.",
    "",
    "`presence_score` is one number over both audits: everything that could be measured of the " +
      "twelve, dominance and GBP optimization together. Both still have their own column.",
    "",
    "How much comes off the top?",
    "",
    "React :one: keep the bottom 30%  ·  :two: bottom 50%  ·  :three: bottom 70%",
    "Or say it in the thread: `drop the first 10`, `top 20%`, `presence > 70`, `keep 120`.",
    "",
    "Nothing is deleted on this message. Whatever you pick gets echoed back for one more " +
      ":white_check_mark: first.",
  ].join("\n");
}

/**
 * The echo, before anything is deleted.
 *
 * The descending sort already means "the first 10" and the rows he is reading are the same thing,
 * so this is a review step rather than a disambiguation one. It still states the count, the
 * direction, the score range and what survives, because the one number nobody can recover after the
 * fact is how many leads were thrown away.
 */
export function formatCutoffEcho(plan: CutoffPlan, spoken: string): string {
  const lines: string[] = [];

  if (plan.dropped.length === 0) {
    lines.push("*That drops nothing.* All " + plan.kept.length + " rows would survive.");
    lines.push("React :white_check_mark: to take the whole list, or say a different cut.");
    return lines.join("\n");
  }

  // The range NAMES ITS AXIS too. "scores 94 down to 71" is the one phrase on this card that reads
  // as a fact about a column without ever saying which column it came from.
  const range =
    plan.droppedHigh !== null && plan.droppedLow !== null
      ? ", " + plan.axis + " " + plan.droppedHigh + " down to " + plan.droppedLow
      : "";

  // ‼️ THE AXIS IS NAMED ON EVERY FORM, THE PREFIX ONES INCLUDED, AND THAT IS NOT OPTIONAL. THREE
  // numbers live in one file now, "dropping 34 rows" is the same sentence for all three, and they
  // mean three different things. The sort key has already moved once: a card that names the axis
  // only when it is not the default reads correctly right up until the default moves again, and
  // then it reads confidently and wrongly. `plan.axis` and `plan.shape` are carried for this line.
  const axis = plan.axis.toUpperCase();

  if (plan.shape === "prefix") {
    lines.push(
      "*Dropping rows 1 to " + plan.dropped.length + ", on " + axis + ":* the " +
        plan.dropped.length + " with the most presence" + range + "."
    );
  } else {
    lines.push(
      "*Dropping " + plan.dropped.length + " rows on " + axis + range + ".* " +
        "They are scattered through the file, not the top of it."
    );
    if (plan.axis !== "presence") {
      lines.push("_The file is still sorted by presence, and presence is untouched._");
    }
  }
  lines.push(
    plan.kept.length + " remain" +
      (plan.keptUnmeasured > 0
        ? ", " + plan.keptUnmeasured + " of them with no " + plan.axis + " score"
        : "") + "."
  );
  lines.push("");
  lines.push("_Read as: " + spoken + "_");
  lines.push("");
  lines.push("React :white_check_mark: on THIS message to confirm.");
  return lines.join("\n");
}

export function formatCutoffRefusal(text: string, grammar: string): string {
  return (
    ":question: I could not read `" + text.slice(0, 120) + "` as a cutoff, so nothing was dropped." +
    "\n\n```\n" + grammar + "\n```\n" +
    "Or react :one: / :two: / :three: on the card above."
  );
}

/** One row as scored.csv and dominant.csv see it. */
export interface ScoredCsvRow {
  raw: Record<string, string>;
  score: number | null;
  measured: string;
  /** The second score. Null is "not measured", the same as on dominance. */
  optimization?: number | null;
  optimizationMeasured?: string;
  /**
   * The presence score, and in `"both"` mode THE COLUMN THE RANK COUNTS.
   *
   * ‼️ ONLY READ IN `"both"` MODE. In the `"dominance"` default it is ignored entirely and the
   * rank counts `score`, which is what keeps `_probe-score.ts` pinning the original narrow shape
   * without being edited. Two rank rules in one function is not ideal; one rank rule that silently
   * changed which column it counted, under a probe that could not see the difference, would be
   * worse.
   */
  presence?: number | null;
  presenceMeasured?: string;
  /** Per component, the short verdict that also lives in `optimization_components[key].note`. */
  optNotes?: Partial<Record<OptimizationKey, string>>;
}

/**
 * The optimization columns, prefixed.
 *
 * ‼️ THE `opt_` PREFIX IS NOT DECORATION. `toCsv` is header-keyed and `buildScoredCsv` spreads
 * `...r.raw` FIRST, so a source file carrying a column literally named `services` or `photos` would
 * have its own value silently overwritten by ours, and the round trip would lose the client's data
 * with nothing saying so. Apollo and Outscraper exports really do carry columns with those names.
 */
export const OPTIMIZATION_CSV_COLUMNS = OPTIMIZATION_KEY_ORDER.map((k) => "opt_" + k);

/**
 * scored.csv and dominant.csv: the original columns plus the ones this lane added.
 *
 * `columns: "both"` appends the GBP optimization audit as well, which is what the LANE always
 * passes. The `"dominance"` default is not a live option and no caller in `src/` selects it: it
 * exists so `_probe-score.ts` keeps pinning the narrow three-column shape without being edited,
 * which is what proves this change was additive rather than a rewrite of the file everybody reads.
 *
 * ‼️ THE HEADERS COME FROM THE FILE, exactly as buildCleanCsv's note says, and it matters twice as
 * much here. `dominant.csv` is the INPUT to a separate cold-email project that qualifies on first
 * name, verified email, website, city and state, and which of those the dropped file happens to
 * carry is unknowable from inside this lane. Narrowing the columns would look like a lead problem
 * downstream rather than the plumbing problem it would actually be.
 *
 * ‼️ `rows` MUST ARRIVE ALREADY SORTED (`sortForCutoff`). The rank printed here is the position in
 * the array, so a re-sort inside this function would number a different file than the one the
 * cutoff then cuts.
 */
export function buildScoredCsv(
  headers: string[],
  rows: ScoredCsvRow[],
  columns: "dominance" | "both" = "dominance"
): string {
  const both = columns === "both";
  // Presence sits directly after the rank, because it is what the rank counts. The two axes that
  // are now columns rather than the sort key follow it, each still carrying its own `measured`.
  const lead = both ? ["presence_score", "presence_measured"] : [];
  const extra = both
    ? ["optimization_score", "optimization_measured", ...OPTIMIZATION_CSV_COLUMNS]
    : [];

  let rank = 0;
  return toCsv(
    [...headers, "rank", ...lead, "dominance_score", "score_measured", ...extra],
    rows.map((r) => {
      // ‼️ THE RANK COUNTS THE COLUMN THE FILE IS SORTED BY, WHICH IS PRESENCE IN `"both"` MODE.
      // A rank counted on one column while the rows were ordered by another would number the file
      // out of sequence, and a reader would take the ordering on trust: it is the one error on this
      // sheet that looks like data rather than like a bug.
      // The same undefined-is-not-null rule `valueOn` draws in score.ts, and for the same reason: a
      // caller that hands over no presence at all is one written before the axis existed, and
      // blanking every rank on it would be a silently empty column rather than an error.
      const ranked = both ? (r.presence === undefined ? r.score : r.presence) : r.score;
      const cells: Record<string, string> = {
        ...r.raw,
        // An unmeasured row gets a BLANK rank, never the next number. A rank is a claim about where
        // a business sits against the others, and there is nothing here to compare it on.
        rank: ranked === null ? "" : String(++rank),
        dominance_score: r.score === null ? "not measured" : String(r.score),
        score_measured: r.measured,
      };
      if (!both) return cells;

      cells.presence_score =
        r.presence === null || r.presence === undefined ? "not measured" : String(r.presence);
      cells.presence_measured = r.presenceMeasured ?? "";
      cells.optimization_score =
        r.optimization === null || r.optimization === undefined
          ? "not measured"
          : String(r.optimization);
      cells.optimization_measured = r.optimizationMeasured ?? "";
      for (const key of OPTIMIZATION_KEY_ORDER) {
        cells["opt_" + key] = r.optNotes?.[key] ?? "";
      }
      return cells;
    })
  );
}

/**
 * apollo_targets.csv: two columns and no more.
 *
 * It is a SEARCH INPUT, not a lead list, which is the whole reason it does not share a shape with
 * dominant.csv. A row with no company is dropped rather than exported blank, because a blank line
 * in an Apollo search is a wasted row somebody has to notice and delete by hand.
 */
export function buildApolloTargetsCsv(
  rows: Array<{ company: string | null; website: string | null }>
): string {
  return toCsv(
    ["company", "website"],
    rows
      .filter((r) => (r.company ?? "").trim().length > 0)
      .map((r) => ({ company: r.company ?? "", website: r.website ?? "" }))
  );
}

/** The component breakdown for ONE row, for a spot check in the thread. Never for a whole file. */
export function formatScoreComponents(company: string, result: ScoreResult): string {
  const lines = [
    "*" + company + "* scored " + (result.score ?? "not measured") + " (" + result.measured + ")",
    "```",
  ];
  for (const [key, c] of Object.entries(result.components)) {
    const verdict = c.attempted ? c.earned + "/" + c.weight : "-";
    lines.push(key.padEnd(16) + verdict.padStart(7) + "   " + c.note);
  }
  lines.push("```");
  return lines.join("\n");
}
