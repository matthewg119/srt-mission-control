// Does the write-side filter keep what a keyword block is made of, and refuse what debris is?
//
// ‼️ THE FAILURE THIS EXISTS TO CATCH IS OVER-FILTERING, NOT UNDER-FILTERING.
// research-intake.ts now refuses debris at the door. The full rule set drops anything under
// three words, and section 9 of the research brief asks for search phrases: "botox cost" is two
// words and is exactly what it asked for. Applying the wrong rule set to the KEYWORDS block
// would silently delete the most commercial third of every paste, and nothing would say so.
//
//   bunx tsx --env-file=.env.local scripts/_probe-phrase-write-filter.ts
//
// Also reports the live corpus split, which is the number the whole change is justified by.
import { supabaseAdmin } from "@/lib/db";
import { filterPhrases, isUsablePhrase, DEBRIS_FAULTS, phraseFaults } from "@/lib/clients/phrase-quality";

let failures = 0;
function check(pass: boolean, label: string, detail?: string) {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}`);
  if (!pass) {
    failures += 1;
    if (detail) console.log(`      ${detail}`);
  }
}

async function main() {
  // ── 1. Keyword shapes survive DEBRIS_FAULTS ───────────────────────────────
  //
  // Every one of these is a real answer to "the search phrases this buyer types", and every one
  // of them fails the full rule set on length or shape alone.
  const keywordShapes = [
    "botox cost",
    "lip filler near me",
    "is it worth it",
    "morpheus8 vs microneedling",
    "how much does coolsculpting cost",
    "best med spa greensboro nc",
  ];
  for (const k of keywordShapes) {
    const kept = filterPhrases([k], (s) => s, DEBRIS_FAULTS).kept.length === 1;
    check(kept, `a keyword survives the write filter: ${JSON.stringify(k)}`, phraseFaults(k).join(", "));
  }

  // ‼️ AND THE POINT OF THE SPLIT: at least one of them must FAIL the full set, or the two rule
  // sets are the same thing and this whole distinction is decoration.
  check(
    keywordShapes.some((k) => !isUsablePhrase(k)),
    "at least one real keyword would be lost to the full rule set",
    "if this fails, DEBRIS_FAULTS is doing nothing and can be deleted"
  );

  // ── 2. Real debris is refused by the narrow set too ───────────────────────
  //
  // These are the shapes measured in SRT's corpus. All six mean the extraction broke, whatever
  // shape the text is, so they must be caught even by the narrow rule set.
  const debris: Array<[string, string]> = [
    ["botox cost https://www.realself.com/botox", "url"],
    ["how long does filler last 【41†L65-L69】", "citation_marker"],
    ["does it hurt -> reddit.com/r/30plusskincare", "arrow"],
    ['"I was terrified of looking overdone, honestly."', "quoted"],
    ["what is the downtime <strong>really</strong>", "markup"],
    ["Out of scope of $900:", "dangling"],
  ];
  for (const [text, why] of debris) {
    const gone = filterPhrases([text], (s) => s, DEBRIS_FAULTS).kept.length === 0;
    check(gone, `the write filter refuses ${why}`, `kept: ${JSON.stringify(text)}`);
  }

  // ── 3. The live corpus, which is the number this change is justified by ───
  const { data, error } = await supabaseAdmin
    .from("question_bank")
    .select("phrase, source")
    .eq("vertical", "aeo-agency-med-spa");

  if (error) {
    console.log(`\n(could not read question_bank: ${error.message})`);
  } else {
    const rows = data ?? [];
    const bySource = new Map<string, { total: number; kept: number }>();
    for (const r of rows) {
      const src = (r.source as string) ?? "unknown";
      const cur = bySource.get(src) ?? { total: 0, kept: 0 };
      cur.total += 1;
      if (isUsablePhrase(r.phrase as string)) cur.kept += 1;
      bySource.set(src, cur);
    }
    console.log("\nLive corpus, vertical aeo-agency-med-spa:");
    let total = 0;
    let kept = 0;
    for (const [src, c] of [...bySource].sort((a, b) => b[1].total - a[1].total)) {
      const pct = c.total ? Math.round((c.kept / c.total) * 100) : 0;
      console.log(`  ${src.padEnd(15)} ${String(c.kept).padStart(4)} of ${String(c.total).padStart(4)} usable  (${pct}%)`);
      total += c.total;
      kept += c.kept;
    }
    console.log(`  ${"TOTAL".padEnd(15)} ${String(kept).padStart(4)} of ${String(total).padStart(4)} usable  (${total ? Math.round((kept / total) * 100) : 0}%)`);
    console.log("\nThese rows stay. The read filter is what fixes them; the write filter is what");
    console.log("stops the pile growing.");
  }

  if (failures) {
    console.log(`\n${failures} failing.`);
    process.exit(1);
  }
  console.log("\nAll checks passed.");
}

main();

export {};
