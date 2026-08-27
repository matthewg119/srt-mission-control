// What the thread says, and the two CSVs it says it about.
//
// The message is the Python's stdout, deliberately close to it: input / clean / junk with
// percentages, then the junk breakdown by reason, most common first. Matthew has read that shape a
// lot of times and a Slack lane that reports the same numbers differently is a lane he has to
// re-learn.
//
// Pure. No Slack, no database, no network, so `_probe-scraper.ts` can assert the wording.

import { toCsv } from "./csv";
import { JUNK_REASON_ORDER, type JunkReason } from "./rules";
import type { StoredRow } from "./store";

/** Plain-English gloss per reason, because "no_mx" means nothing to anyone reading it cold. */
const REASON_LABEL: Record<JunkReason, string> = {
  no_email: "no email on the row",
  duplicate_in_file: "same address twice in this file",
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
