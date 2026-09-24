// Re-score every stored SERP reading from the observations it already carries.
//
//   bun run --env-file=.env.local scripts/_rescore-serp.ts            report only, writes nothing
//   bun run --env-file=.env.local scripts/_rescore-serp.ts --apply    write the new scores
//   bun run --env-file=.env.local scripts/_rescore-serp.ts --client=<uuid>
//
// ‼️ THIS IS WHAT "PURE FUNCTIONS OF THE READ" WAS FOR, AND WITHOUT IT THE CLAIM IS DECORATION. The
// scores are stored rather than recomputed on every card, so a change to clickValueFrom or
// citationValueFrom leaves every existing row carrying the OLD number while new rows carry the new
// one, and the two disagree silently. This is the deliberate backfill that makes a scoring change
// cheap and visible, the same job scripts/_rescore-optimization.ts does for the scraper lane.
//
// ‼️ AND IT IS THE READER FOR EIGHT COLUMNS THAT WOULD OTHERWISE BE WRITE-ONLY. ai_overview_satisfies,
// local_pack, paa_present, ads_above_fold, forum_ranks, result_shape, dominant_intent and
// dominant_page_type are written by recordVerdict and read by nothing else: the card shows the
// SCORES, not the observations behind them. The audit that started this build found eleven columns
// written by one thing and read by another that never saw them, and the data looked correct
// throughout. A column with no reader is a column nobody can prove is right.
//
// ‼️ IT NEVER RE-READS A SCREENSHOT AND NEVER CALLS A MODEL. Nothing here costs money, and the magnet
// judgement is left exactly as it was: that is a judgement with an author recorded in magnet_by, and
// a rescoring pass may not quietly overwrite what a person typed.
//
// ‼️ DRY BY DEFAULT. --apply is the only thing that writes.

import { supabaseAdmin } from "@/lib/db";
import {
  citationValueFrom,
  clickValueFrom,
  intentFrom,
  isVerdict,
  pageTypeFrom,
  routeFrom,
  type SerpRead,
} from "@/lib/clients/keyword-strategy-rules";

const apply = process.argv.includes("--apply");
const clientArg = process.argv.find((a) => a.startsWith("--client="))?.split("=")[1] ?? null;

// One string literal: the Supabase client types the row shape off it and a concatenation types every
// column as an error.
const COLUMNS =
  "id, client_id, phrase, verdict, source, ai_overview, ai_overview_answers, ai_overview_satisfies, result_shape, local_pack, paa_present, ads_above_fold, forum_ranks, top_domains, paa_questions, vocabulary, click_value, citation_value, route, recommended_asset, magnet_space, magnet_idea, magnet_by, dominant_intent, dominant_page_type";

let query = supabaseAdmin.from("keyword_serp_reads").select(COLUMNS).order("created_at", { ascending: false }).range(0, 4999);
if (clientArg) query = query.eq("client_id", clientArg);

const { data, error } = await query;

if (error) {
  console.error(`Could not read keyword_serp_reads: ${error.message}`);
  console.error("If that names a missing table, docs/2026-09-26-keyword-serp.sql has not been run here.");
  process.exit(1);
}

const rows = data ?? [];
console.log(`\n${rows.length} stored reading${rows.length === 1 ? "" : "s"}${clientArg ? ` for ${clientArg}` : ""}.`);
console.log(apply ? "APPLYING the new scores.\n" : "Dry run. Nothing is written. Add --apply to write.\n");

let changed = 0;
let unchanged = 0;
let skipped = 0;
let failed = 0;

for (const r of rows) {
  const verdict = r.verdict as string | null;
  if (!isVerdict(verdict)) {
    skipped += 1;
    continue;
  }

  // ‼️ A TYPED VERDICT HAS NO OBSERVATIONS AND THEREFORE NO SCORES. Scoring one from nothing would
  // put numbers on the card that nobody measured, which is what the null is protecting.
  if (r.source === "typed") {
    skipped += 1;
    continue;
  }

  const read: Pick<
    SerpRead,
    "aiOverview" | "aiOverviewAnswers" | "aiOverviewSatisfies" | "resultShape" | "localPack" | "paaPresent" | "adsAboveFold" | "forumRanks"
  > = {
    aiOverview: tri(r.ai_overview),
    aiOverviewAnswers: tri(r.ai_overview_answers),
    aiOverviewSatisfies: num(r.ai_overview_satisfies),
    resultShape: (r.result_shape as SerpRead["resultShape"]) ?? null,
    localPack: tri(r.local_pack),
    paaPresent: tri(r.paa_present),
    adsAboveFold: num(r.ads_above_fold),
    forumRanks: tri(r.forum_ranks),
  };

  const click = clickValueFrom(read);
  const cite = citationValueFrom(read);
  const routed = routeFrom({
    verdict,
    clickValue: click,
    citationValue: cite,
    // The magnet is left exactly as stored. It is a judgement with an author.
    magnetSpace: num(r.magnet_space),
    magnetIdea: (r.magnet_idea as string | null) ?? null,
    magnetBy: (r.magnet_by as "model" | "person" | null) ?? null,
  });

  const before = `${r.click_value}/${r.citation_value} ${r.route ?? "-"}`;
  const after = `${click}/${cite} ${routed.route}`;

  if (before === after) {
    unchanged += 1;
    continue;
  }

  changed += 1;
  console.log(`  ${before.padEnd(14)} -> ${after.padEnd(14)}  ${String(r.phrase).slice(0, 60)}`);

  if (!apply) continue;

  const up = await supabaseAdmin
    .from("keyword_serp_reads")
    .update({
      click_value: click,
      citation_value: cite,
      route: routed.route,
      recommended_asset: routed.asset,
      dominant_intent: intentFrom(read),
      dominant_page_type: pageTypeFrom(read),
    })
    .eq("id", r.id as string);

  if (up.error) {
    failed += 1;
    console.error(`    FAILED: ${up.error.message}`);
  }
}

console.log(
  `\n${changed} would change, ${unchanged} already current, ${skipped} skipped (typed or unreadable)` +
    (apply ? `, ${failed} failed to write` : "") +
    "."
);
if (!apply && changed) console.log("Re-run with --apply to write them.\n");
process.exit(failed ? 1 : 0);

function tri(v: unknown): boolean | null {
  return v === true || v === false ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
