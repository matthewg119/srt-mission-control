// Regenerates src/data/disposable-domains.ts from the upstream blocklist.
//
//   bun run scraper:disposable
//
// The list is CHECKED IN rather than fetched at runtime, and that is a deliberate trade. A runtime
// fetch means the cold-list filter's verdict depends on GitHub being reachable from a lambda at
// that moment, and the failure mode is silent: an unreachable list makes every disposable address
// pass as clean, on the one step whose whole job is to reject them. Checked in, the list can only
// go STALE, which is visible (git log) and fixed by running this.
//
// Run it monthly. The original Python note said the same thing about its curl step.

import { writeFileSync } from "fs";
import { resolve } from "path";

const SOURCE =
  "https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/master/disposable_email_blocklist.conf";

const OUT = resolve(import.meta.dirname ?? __dirname, "../src/data/disposable-domains.ts");

async function main(): Promise<void> {
  const res = await fetch(SOURCE);
  if (!res.ok) throw new Error(`blocklist fetch failed: ${res.status} ${res.statusText}`);
  const text = await res.text();

  // Same parse as the Python: strip blanks and comments, lowercase. Sorted and deduped here so the
  // generated file diffs cleanly when upstream only reorders.
  const domains = Array.from(
    new Set(
      text
        .split(/\r?\n/)
        .map((l) => l.trim().toLowerCase())
        .filter((l) => l.length > 0 && !l.startsWith("#"))
    )
  ).sort();

  if (domains.length < 1000) {
    // A truncated response is worse than a stale file: it would quietly shrink the blocklist.
    throw new Error(`refusing to write ${domains.length} domains, the list is far too short`);
  }

  const body = [
    "// GENERATED FILE. Do not edit by hand.",
    "//",
    "// Source: disposable-email-domains/disposable_email_blocklist.conf",
    "// Regenerate: bun run scraper:disposable",
    `// Domains: ${domains.length}`,
    "",
    "export const DISPOSABLE_DOMAINS: ReadonlySet<string> = new Set([",
    ...domains.map((d) => `  ${JSON.stringify(d)},`),
    "]);",
    "",
  ].join("\n");

  writeFileSync(OUT, body, "utf8");
  console.log(`Wrote ${domains.length} domains to ${OUT}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
