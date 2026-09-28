// Probe: the two vendor behaviours the national crawl rests on, against the live account.
//
//   bun run scripts/_probe-cells-live.ts           refuses, and prints what it would spend
//   bun run scripts/_probe-cells-live.ts --yes      SPENDS about $0.06
//
// ‼️ IT SPENDS MONEY, SO IT IS OPT-IN AND IT IS NEVER IN CI. Same convention as _probe-gbp-live.ts and
// _probe-attribution-live.ts. The offline suite (_probe-cells.ts) proves the geometry and the walk with
// no key at all; this file exists for the two things no amount of pure code can establish, because they
// are facts about somebody else's API:
//
//   1. `total_count` is returned for a `limit 1` query, is radius-aware, and is monotonic in radius.
//      The entire design is "ask how many are there before buying any", and it is worth nothing if the
//      number is not what it was measured to be on 2026-09-28.
//   2. A cell key is accepted VERBATIM as `location_coordinate`. cells.ts claims byte-identity with
//      that parameter, and that claim is what lets one string be the identity, the label, the filter
//      and the row's source_metro. If the vendor ever stops accepting the shape, everything still
//      typechecks and every pull quietly answers the wrong question, which is exactly the failure the
//      location_name trap already taught this lane once.
//
// ‼️ A FAILED TASK IS NOT BILLED. Measured 2026-09-28: five HTTP 500s from deep offsets cost $0.0000.
// So the worst case here is the cost below, not a surprise.
//
// ‼️ bun run, NOT bunx tsx. Bun auto-loads .env.local; Node does not, and the DataForSEO calls then
// fail with a bare "not configured" that says nothing about the missing credentials.

import { isConfigured, searchListings } from "../src/lib/dataforseo-places";
import { DFS_CATEGORIES } from "../src/lib/scraper/maps-command";
import { categoriesKey, cellKey, childrenOf, seedGrid } from "../src/lib/scraper/cells";
import { reverseGeocode } from "../src/lib/geocode";
import { canonicalStateName } from "../src/lib/scraper/geo";

let passed = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, detail?: string): void {
  if (cond) passed++;
  else failures.push(label + (detail ? "  (" + detail + ")" : ""));
}

const PROBE_USD = 0.0124;
const CALLS = 5;

async function main(): Promise<void> {
  const go = process.argv.includes("--yes");
  if (!go) {
    console.log(
      "This probe SPENDS. " + CALLS + " count probes at $" + PROBE_USD.toFixed(4) +
      " = about $" + (CALLS * PROBE_USD).toFixed(2) + ", plus two free Nominatim lookups.\n" +
      "Re-run with --yes to actually spend it."
    );
    process.exit(0);
  }
  if (!isConfigured()) {
    console.log(
      "DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD are not set in this environment, so nothing was spent.\n" +
      "They live in Vercel; a sensitive env var reads back empty through the CLI, so pull them by hand."
    );
    process.exit(1);
  }

  const categories = DFS_CATEGORIES.medspa;
  console.log("categories: " + categories.join(", ") + "  -> key " + categoriesKey(categories));

  let spent = 0;
  const countAt = async (coord: string): Promise<number | null> => {
    const r = await searchListings({ categories, locationCoordinate: coord, limit: 1 });
    spent += r.costUsd;
    console.log(
      "  " + coord.padEnd(28) + (r.ok ? "total_count=" + r.totalCount : "REFUSED: " + r.error) +
      "   cost $" + r.costUsd.toFixed(4)
    );
    return r.ok ? r.totalCount : null;
  };

  // 1. total_count is radius-aware and monotonic. The readings are the ones the design was built on.
  console.log("\nDallas, three radii (measured 2026-09-28: 416 / 1,766 / 4,439):");
  const d10 = await countAt("32.7767,-96.7970,10");
  const d30 = await countAt("32.7767,-96.7970,30");
  const d100 = await countAt("32.7767,-96.7970,100");

  check("a limit 1 query returns a count at 10km", d10 !== null);
  check("and at 30km", d30 !== null);
  check("and at 100km", d100 !== null);
  if (d10 !== null && d30 !== null && d100 !== null) {
    check("the count is monotonic in radius", d10 <= d30 && d30 <= d100, `${d10} / ${d30} / ${d100}`);
    check("a wider circle really does hold more, so the filter is doing something", d100 > d10, `${d10} -> ${d100}`);
    // Not asserted as equality: the index is live and drifts. A wild divergence is worth a human look.
    const drift = Math.abs(d30 - 1766) / 1766;
    check("the 30km reading is within 25% of the 2026-09-28 measurement", drift < 0.25, `${d30} vs 1766`);
  }
  check("a count probe costs about $0.0124", Math.abs(spent / 3 - PROBE_USD) < 0.005, "averaged $" + (spent / 3).toFixed(4));

  // 2. A cell key is accepted verbatim, at two levels of the tree.
  const seed = seedGrid()[Math.floor(seedGrid().length / 2)];
  const kid = childrenOf(seed)[0];
  console.log("\na real seed cell and one of its children, keys sent verbatim:");
  const seedCount = await countAt(cellKey(seed));
  const kidCount = await countAt(cellKey(kid));
  check("a seed cell key is accepted as a coordinate", seedCount !== null, cellKey(seed));
  check("and so is a child's", kidCount !== null, cellKey(kid));
  if (seedCount !== null && kidCount !== null) {
    // A child is inside its parent's circle, so it cannot hold more. This is the invariant the whole
    // split relies on, and it is the cheapest possible end-to-end check that the geometry is real.
    check("a child never holds more than its parent", kidCount <= seedCount, `${kidCount} <= ${seedCount}`);
  }

  // 3. The reverse geocoder, which is free, and the validator that stops foreign provinces.
  console.log("\nreverse geocoding (free, cached a year):");
  const dallas = await reverseGeocode(32.7767, -96.797);
  console.log("  Dallas centre      -> " + JSON.stringify(dallas));
  check("Dallas resolves to a US country code", dallas?.countryCode === "us", String(dallas?.countryCode));
  check("and canonicalises to Texas", canonicalStateName(dallas?.stateName ?? null) === "Texas", String(dallas?.stateName));

  const atlantic = await reverseGeocode(30.0, -45.0);
  console.log("  mid-Atlantic       -> " + JSON.stringify(atlantic));
  check(
    "an ocean point yields no US state, so it buckets as offshore rather than retrying forever",
    atlantic === null || atlantic.countryCode !== "us" || canonicalStateName(atlantic.stateName) === null
  );

  console.log("\ntotal spent: $" + spent.toFixed(4));
  console.log(passed + " passed, " + failures.length + " failed");
  if (failures.length) for (const f of failures) console.log("  FAIL " + f);
  process.exit(failures.length ? 1 : 0);
}

// Wrapped rather than top-level await, the same reason every other probe here is.
main();
