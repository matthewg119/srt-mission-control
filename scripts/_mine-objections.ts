// Mine real sales objections from AEO-era prospect messages into question_bank.
//
//   bunx tsx --env-file=.env.local scripts/_mine-objections.ts [--vertical=aeo-agency-med-spa] [--since=2026-08-18] [--write]
//
// Dry by default: prints what was read per source and the objections found, and writes nothing.
// --write stores them (docs/2026-09-16-board-fixes.sql section B first). See objection-mining.ts.

import { extractObjections, mergeMined, readSalesMessages, storeSalesObjections, AEO_PIVOT } from "../src/lib/clients/objection-mining";

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"] as const;
  })
);

async function main(): Promise<void> {
  const vertical = args.get("vertical") ?? "aeo-agency-med-spa";
  const since = args.get("since") ?? AEO_PIVOT;
  const { messages, counts } = await readSalesMessages(since);
  console.log(`Read since ${since}:`, counts, `(${messages.length} messages)`);
  if (messages.length === 0) {
    console.log("Nothing to mine. No prospect conversations are recorded since the pivot.");
    return;
  }

  const found = [];
  for (let i = 0; i < messages.length; i += 40) {
    found.push(...(await extractObjections(messages.slice(i, i + 40))));
  }
  const merged = mergeMined(found);
  console.log(`\n${merged.length} distinct objections:`);
  for (const o of merged.slice(0, 40)) console.log(`  x${o.refs.length}  "${o.phrase}"  (${o.belief ?? "no belief"})`);

  if (args.get("write") !== "true") {
    console.log("\nDry run. Nothing written. --write stores them.");
    return;
  }
  const res = await storeSalesObjections({ vertical, objections: merged });
  console.log(res.error ? `Stored ${res.stored}, then failed: ${res.error}` : `Stored ${res.stored}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
