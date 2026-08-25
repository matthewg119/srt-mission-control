// What the call sheet's question block will actually say, for one real client.
//
//   bunx tsx --env-file=.env.local scripts/_probe-question-set.ts <clientId>
//   bunx tsx --env-file=.env.local scripts/_probe-question-set.ts <clientId> --freeze
//
// ‼️ WITHOUT --freeze IT WRITES NOTHING. universalSetFor() freezes `universal_v1@{vertical}` the
// first time it runs for a vertical, which is correct and idempotent and is exactly what should
// happen on the next real call-sheet run — but a probe should not be the thing that decides when
// a tracked set gets frozen. The default reads the same rows and runs the same materializeSet,
// so what it prints is what the PDF will print.
//
// ‼️ WITHOUT --env-file THIS SILENTLY RETURNS NOTHING. Not an error. Nothing.
//
// The live failure this exists to catch: the call sheet for SRT Agency LLC, an AI-visibility
// MARKETING AGENCY, asked "Who does the best lip filler in Greensboro, NC?" and "What med spa in
// Greensboro, NC specializes in melasma?".

import { supabaseAdmin } from "../src/lib/db";
import {
  UNIVERSAL_V1_MED_SPA,
  composeTrackedSet,
  substitutionsWithProvenance,
  universalSetFor,
  ORIGIN_LABEL,
} from "../src/lib/clients/question-sets";
import { verticalFor } from "../src/lib/clients/harvest";

const clientId = process.argv[2];
const freeze = process.argv.includes("--freeze");

if (!clientId) {
  console.error("Pass a client id. See the header for the env-file flag you also need.");
  process.exit(1);
}

async function main() {
  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("legal_name, dba_name, slug, city, state, vertical_slug, business_type")
    .eq("id", clientId)
    .maybeSingle();

  if (!client) {
    console.error("No such client. If this printed nothing at all, you forgot --env-file.");
    process.exit(1);
  }

  console.log(
    `${(client.dba_name || client.legal_name) as string}  (${client.slug as string})\n` +
      `vertical_slug: ${String(client.vertical_slug)}   business_type: ${String(client.business_type)}\n`
  );

  const subs = await substitutionsWithProvenance(clientId);
  if (!subs) {
    console.error("substitutionsWithProvenance returned null.");
    process.exit(1);
  }

  console.log("SUBSTITUTIONS, and where each one came from:");
  for (const [k, v] of Object.entries(subs.values)) {
    const src = subs.provenance[k as keyof typeof subs.provenance];
    console.log(`  ${k.padEnd(18)} ${src.padEnd(20)} ${v || "(empty)"}`);
  }
  console.log("");

  const resolved = await verticalFor(clientId);
  if (!resolved.ok) {
    console.error(`verticalFor refused: ${resolved.error}`);
    process.exit(1);
  }
  const vertical = resolved.vertical;

  // The source questions: the frozen row, the shipped twenty, or a dry preview of what would be
  // derived. Deliberately duplicated here rather than calling universalSetFor, because the whole
  // point of the default mode is that nothing is written.
  let source: string[];
  let label: string;

  if (freeze) {
    const set = await universalSetFor(clientId);
    if (!set.ok) {
      console.error(`universalSetFor refused: ${set.error}`);
      process.exit(1);
    }
    source = set.questions;
    label = `${set.version} (${set.frozen ? "frozen" : "NOT frozen"})${set.note ? ` - ${set.note}` : ""}`;
  } else if (vertical === "med_spa") {
    source = [...UNIVERSAL_V1_MED_SPA];
    label = "universal_v1@med_spa, the shipped twenty (dry run, nothing written)";
  } else {
    const { data: frozen } = await supabaseAdmin
      .from("question_set_versions")
      .select("questions")
      .eq("version", `universal_v1@${vertical}`)
      .maybeSingle();

    if (frozen?.questions) {
      source = (frozen.questions as unknown[]).map((q) =>
        typeof q === "string" ? q : String((q as Record<string, unknown>).prompt ?? "")
      );
      label = `universal_v1@${vertical}, already frozen`;
    } else {
      const { data: report } = await supabaseAdmin
        .from("audit_reports")
        .select("id, prompts")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const seen = new Set<string>();
      source = [];
      for (const p of ((report?.prompts as unknown[] | null) ?? [])) {
        const t = typeof p === "string" ? p : String((p as Record<string, unknown>)?.prompt ?? (p as Record<string, unknown>)?.text ?? "");
        const trimmed = t.trim();
        if (!trimmed) continue;
        const key = trimmed.toLowerCase().replace(/\s+/g, " ");
        if (seen.has(key)) continue;
        seen.add(key);
        source.push(trimmed);
        if (source.length === 20) break;
      }
      label = `WOULD freeze universal_v1@${vertical} from audit ${String(report?.id ?? "none")} (dry run, nothing written)`;
    }
  }

  console.log(`SOURCE SET: ${label}\n`);

  const set = composeTrackedSet(source, subs.values, subs.provenance, { vertical });

  console.log(`THE ${set.questions.length} AS THEY WILL RUN:`);
  for (const q of set.questions) {
    console.log(`  ${String(q.index).padStart(2)}. [${ORIGIN_LABEL[q.origin]}] ${q.text}`);
  }

  if (set.dropped.length) {
    console.log(`\nDROPPED (${set.dropped.length}), rather than filled with a wrong noun:`);
    for (const d of set.dropped) console.log(`  ${d.index}. "${d.source}"\n      ${d.reason}`);
  }

  if (set.fallbacksUsed.length) {
    console.log(`\nFilled from MATERIALIZATION_FALLBACKS: ${set.fallbacksUsed.join(", ")}`);
  }

  // The two sentences the live call sheet actually printed, and the whole reason for lane 3.
  const rendered = set.questions.map((q) => q.text).join("\n").toLowerCase();
  const smells = ["lip filler", "melasma", "morpheus8", "med spa", "injector"];
  const hits = vertical === "med_spa" ? [] : smells.filter((w) => rendered.includes(w));

  console.log("");
  if (vertical === "med_spa") {
    console.log("Vertical is med_spa, so the med spa vocabulary is correct here.");
  } else if (hits.length) {
    console.log(`FAIL: a non-med-spa client is still being asked about: ${hits.join(", ")}`);
    process.exit(1);
  } else {
    console.log("PASS: no med spa vocabulary survived into a non-med-spa question set.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
