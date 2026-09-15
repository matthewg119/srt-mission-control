// Put the seed objections (src/config/objections) into question_bank as source 'seed'.
//
//   bunx tsx --env-file=.env.local scripts/_seed-objections.ts [--write]
//
// Vertical-wide rows (avatar null). Idempotent: a seed already stored is left alone, and a phrase already
// in the bank from another source is not overwritten. Needs docs/2026-09-16-board-fixes.sql section B.

import { supabaseAdmin } from "../src/lib/db";
import { SEED_OBJECTIONS } from "../src/config/objections/aeo-agency-owner";
import { normalizePhrase } from "../src/lib/clients/phrase-quality";

async function main(): Promise<void> {
  const write = process.argv.includes("--write");
  for (const [vertical, seeds] of Object.entries(SEED_OBJECTIONS)) {
    const rows = seeds.map((s) => ({
      vertical,
      phrase: s.text,
      normalized: normalizePhrase(s.text),
      source: "seed",
      frequency_score: 1,
      commercial_intent_score: s.stage <= 2 ? 3 : 2,
      objection_phrase: true,
      kind: "objection",
      speaker: "buyer",
      belief_key: s.belief,
      avatar: null,
    }));
    console.log(`${vertical}: ${rows.length} seeds`);
    if (!write) continue;
    const { error } = await supabaseAdmin
      .from("question_bank")
      .upsert(rows, { onConflict: "vertical,avatar,normalized", ignoreDuplicates: true });
    console.log(error ? `  failed: ${error.message}` : "  stored (existing phrases left alone)");
  }
  if (!write) console.log("Dry run. --write stores them.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
