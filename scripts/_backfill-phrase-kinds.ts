// Label every question_bank row with what it is (phrase-kind.ts) and who said it.
//
//   bunx tsx --env-file=.env.local scripts/_backfill-phrase-kinds.ts [--vertical=aeo-agency-med-spa] [--write] [--samples=8]
//
// Dry by default: prints the count per kind and a sample of each, and writes nothing. --write needs
// docs/2026-09-16-board-fixes.sql section B (the kind, speaker and excluded_* columns).
//
// ‼️ NOTHING IS DELETED. question_bank is shared by every client in a vertical and is training data. A
// heading, a vendor's slogan and a report's prose are LABELLED and stop counting as objections; the row
// stays. `excluded_at` is set only on headings, which are not something anybody said or typed.

import { supabaseAdmin } from "../src/lib/db";
import { classifyPhrase, type PhraseKind } from "../src/lib/clients/phrase-kind";

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"] as const;
  })
);
const write = args.get("write") === "true";
const vertical = args.get("vertical") ?? null;
const samples = Number(args.get("samples") ?? 8);

async function main(): Promise<void> {
  const rows: Array<Record<string, unknown>> = [];
  for (let from = 0; ; from += 1000) {
    let q = supabaseAdmin.from("question_bank").select("id, vertical, phrase, source, objection_phrase").range(from, from + 999);
    if (vertical) q = q.eq("vertical", vertical);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  const byKind = new Map<PhraseKind, Array<{ id: string; phrase: string; source: string; reason: string; speaker: string }>>();
  let flippedOff = 0;
  let flippedOn = 0;
  for (const r of rows) {
    const phrase = String(r.phrase ?? "");
    const source = String(r.source ?? "");
    const read = classifyPhrase(phrase, source);
    const list = byKind.get(read.kind) ?? [];
    list.push({ id: String(r.id), phrase, source, reason: read.reason, speaker: read.speaker });
    byKind.set(read.kind, list);
    if (r.objection_phrase === true && read.kind !== "objection") flippedOff += 1;
    if (r.objection_phrase !== true && read.kind === "objection") flippedOn += 1;
  }

  console.log(`${rows.length} rows${vertical ? ` in ${vertical}` : ""}`);
  console.log(`objection_phrase true -> not an objection: ${flippedOff}; false -> objection: ${flippedOn}\n`);
  for (const [kind, list] of [...byKind.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`== ${kind}: ${list.length}`);
    for (const s of list.slice(0, samples)) console.log(`   [${s.source}/${s.speaker}] ${s.phrase.slice(0, 110)}  (${s.reason})`);
  }

  if (!write) {
    console.log("\nDry run. Nothing written. --write labels every row.");
    return;
  }

  const now = new Date().toISOString();
  let done = 0;
  for (const [kind, list] of byKind.entries()) {
    const bySpeaker = new Map<string, string[]>();
    for (const s of list) bySpeaker.set(s.speaker, [...(bySpeaker.get(s.speaker) ?? []), s.id]);
    for (const [speaker, ids] of bySpeaker.entries()) {
      for (let i = 0; i < ids.length; i += 200) {
        const patch: Record<string, unknown> = { kind, speaker, objection_phrase: kind === "objection" };
        if (kind === "heading") {
          patch.excluded_at = now;
          patch.excluded_reason = "heading, not something anybody said";
        }
        const { error } = await supabaseAdmin.from("question_bank").update(patch).in("id", ids.slice(i, i + 200));
        if (error) throw new Error(`${kind}/${speaker}: ${error.message}`);
        done += Math.min(200, ids.length - i);
      }
    }
  }
  console.log(`\nLabelled ${done} rows.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
