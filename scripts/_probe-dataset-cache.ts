// Proves the claims getOrFetch and the spend ledger are not allowed to be wrong about.
//
// Run: bunx tsx --env-file=.env.local scripts/_probe-dataset-cache.ts [--live]
//
// ‼️ NO MODEL CALL, EVER, AT ANY FLAG. Nothing here spends a cent: the pure half is arithmetic on
// strings, and the --live half exercises getOrFetch with a fetch() that returns a literal. That is
// the whole point of a cache probe, which would otherwise have to buy the thing it is testing.
//
// By default only the pure checks run, so this is safe against production at any moment.
// `--live` adds a round trip against client_datasets under a probe-owned `kind` that nothing else
// reads, and deletes its rows afterwards in a finally.
//
// WHAT IT PROVES
//   1. ONE QUESTION IS ONE KEY. cacheKeyOf sorts object keys, so {a,b} and {b,a} are one paid
//      question rather than two. A key that depended on property order would silently double every
//      cost in the ledger and never hit.
//   2. A BAD ANSWER IS NEVER KEPT. unusableReason is the single definition of "usable" that both
//      the cache and researchViaClaudeDetailed read. If they ever disagreed, an answer the caller
//      rejects would be stored and then served back for free on every audit of that business until
//      the TTL ran out. `no_sources` is the one that matters most: found=true with no sources is a
//      confident hallucination, and caching it would make one bad minute permanent.
//   3. THE LEDGER RECORDS DOLLARS. Every model in ClaudeModel has a published rate, so no call
//      silently records $0. A zero in a spend ledger reads as a measurement, which is worse than
//      recording nothing, and that is exactly what every row held before model-costs.ts existed.
//   4. (--live) A THROWN fetch() WRITES NOTHING, which is the mechanism claim 2 rests on, and a
//      second call for the same key does not call fetch at all.

import { cacheKeyOf, getOrFetch } from "@/lib/data/dataset-cache";
import { isPriced, pricedModels, tokensOnly, RATES_READ_ON } from "@/lib/data/model-costs";
import { unusableReason } from "@/lib/audit-engine/claude-research";
import type { BusinessIdentity } from "@/lib/audit-engine/claude-research";
import { supabaseAdmin } from "@/lib/db";

const LIVE = process.argv.includes("--live");
const PROBE_KIND = "probe.dataset_cache";

let failures = 0;

function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}${ok || !detail ? "" : `\n          ${detail}`}`);
  if (!ok) failures++;
}

// ── 1. One question is one key ───────────────────────────────────────────────────────────────

function keyIdentity(): void {
  console.log("\n1. cacheKeyOf: the same question is the same key");

  check(
    "property order does not change the key",
    cacheKeyOf({ a: 1, b: 2 }) === cacheKeyOf({ b: 2, a: 1 })
  );
  check(
    "nested property order does not change it either",
    cacheKeyOf({ t: { x: 1, y: 2 }, m: "s" }) === cacheKeyOf({ m: "s", t: { y: 2, x: 1 } })
  );
  check(
    "an undefined value is not a different question from an absent one",
    cacheKeyOf({ a: 1, b: undefined }) === cacheKeyOf({ a: 1 })
  );
  check(
    "a different value IS a different question",
    cacheKeyOf({ a: 1 }) !== cacheKeyOf({ a: 2 })
  );
  check(
    "array order is preserved, because [1,2] is not [2,1]",
    cacheKeyOf([1, 2]) !== cacheKeyOf([2, 1])
  );
  check(
    "a different model is a different answer to the same question",
    cacheKeyOf({ target: "x", model: "claude-sonnet-4-6" }) !==
      cacheKeyOf({ target: "x", model: "claude-haiku-4-5-20251001" })
  );

  const k = cacheKeyOf({ anything: true });
  check(`the key is 40 hex chars (${k.length})`, /^[0-9a-f]{40}$/.test(k), k);
}

// ── 2. A bad answer is never kept ────────────────────────────────────────────────────────────

function identity(over: Partial<BusinessIdentity> = {}): BusinessIdentity {
  return {
    found: true,
    tradingName: "Elm Street Aesthetics",
    whatTheyDo:
      "A med spa offering injectables, laser hair removal and skin resurfacing to patients " +
      "across the Greensboro metro, open six days a week with two injectors on staff and a " +
      "treatment menu that runs from consultations through to multi session packages.",
    services: ["botox", "lip filler", "laser hair removal"],
    city: "Greensboro",
    state: "NC",
    cityConfidence: "high",
    alternates: [],
    websites: ["https://elmstreetaesthetics.com"],
    reviewsSummary: "Rated well for the injector, less so for the front desk.",
    competitors: ["Oak Avenue Med Spa"],
    sources: ["https://elmstreetaesthetics.com", "https://maps.google.com/?cid=1"],
    ...over,
  };
}

function usability(): void {
  console.log("\n2. unusableReason: the cache and the caller agree on what is usable");

  check("a complete identity is usable", unusableReason(identity()) === null);

  check(
    "found=false is unidentified, and is never cached",
    unusableReason(identity({ found: false })) === "unidentified"
  );
  check(
    "an empty sources array is no_sources, never a usable answer",
    unusableReason(identity({ sources: [] })) === "no_sources"
  );
  check(
    "a profile under MIN_PROFILE_CHARS is thin_profile",
    unusableReason(
      identity({ whatTheyDo: "A spa.", services: [], reviewsSummary: null, competitors: [] })
    ) === "thin_profile"
  );

  // Order is load-bearing: these used to be three inline checks that returned in this sequence,
  // and a caller that reported thin_profile where it used to report unidentified would be a
  // silent change to what the no-website pitch tells a prospect.
  check(
    "found=false outranks every other fault",
    unusableReason(identity({ found: false, sources: [], whatTheyDo: "x" })) === "unidentified"
  );
  check(
    "a thin profile outranks missing sources",
    unusableReason(
      identity({ whatTheyDo: "x", services: [], reviewsSummary: null, competitors: [], sources: [] })
    ) === "thin_profile"
  );
}

// ── 3. The mechanism: a thrown fetch writes nothing ──────────────────────────────────────────

class Decline extends Error {}

async function roundTrip(): Promise<void> {
  console.log("\n5. getOrFetch against client_datasets (--live)");

  const key = cacheKeyOf({ probe: "round-trip", at: Date.now() });
  const declinedKey = cacheKeyOf({ probe: "declined", at: Date.now() });

  try {
    let calls = 0;
    const first = await getOrFetch<{ v: number }>({
      clientId: null,
      kind: PROBE_KIND,
      cacheKey: key,
      ttlDays: 1,
      provider: "probe",
      fetch: async () => {
        calls++;
        return { payload: { v: 42 }, costUsd: 0.25 };
      },
    });
    check("a miss calls fetch and returns its payload", first.payload.v === 42 && calls === 1);
    check("a miss reports cached=false and the cost", !first.cached && first.costUsd === 0.25);

    const second = await getOrFetch<{ v: number }>({
      clientId: null,
      kind: PROBE_KIND,
      cacheKey: key,
      ttlDays: 1,
      provider: "probe",
      fetch: async () => {
        calls++;
        return { payload: { v: 999 }, costUsd: 0.25 };
      },
    });
    check("a hit does NOT call fetch a second time", calls === 1, `fetch ran ${calls} times`);
    check("a hit returns the stored payload, not the new one", second.payload.v === 42);
    check("a hit costs nothing", second.cached && second.costUsd === 0);

    // The claim the identity cache rests on.
    let threw = false;
    try {
      await getOrFetch<{ v: number }>({
        clientId: null,
        kind: PROBE_KIND,
        cacheKey: declinedKey,
        ttlDays: 1,
        provider: "probe",
        fetch: async () => {
          throw new Decline("not worth keeping");
        },
      });
    } catch (e) {
      threw = e instanceof Decline;
    }
    check("a thrown fetch propagates to the caller", threw);

    const { data: leaked } = await supabaseAdmin
      .from("client_datasets")
      .select("id")
      .eq("kind", PROBE_KIND)
      .eq("cache_key", declinedKey);
    check(
      "and it wrote NOTHING, which is how a bad answer is bought and not kept",
      (leaked ?? []).length === 0,
      `${(leaked ?? []).length} row(s) leaked`
    );

    // An expired row is a miss, not a hit.
    const expiredKey = cacheKeyOf({ probe: "expired", at: Date.now() });
    await supabaseAdmin.from("client_datasets").insert({
      client_id: null,
      kind: PROBE_KIND,
      cache_key: expiredKey,
      payload: { v: 1 },
      provider: "probe",
      cost_usd: 0,
      expires_at: new Date(Date.now() - 86_400_000).toISOString(),
    });
    let refetched = false;
    const third = await getOrFetch<{ v: number }>({
      clientId: null,
      kind: PROBE_KIND,
      cacheKey: expiredKey,
      ttlDays: 1,
      provider: "probe",
      fetch: async () => {
        refetched = true;
        return { payload: { v: 2 }, costUsd: 0 };
      },
    });
    check("an expired row is a miss and is re-fetched", refetched && third.payload.v === 2);
  } finally {
    const { error } = await supabaseAdmin.from("client_datasets").delete().eq("kind", PROBE_KIND);
    console.log(
      error ? `\n  cleanup FAILED: ${error.message}` : "\n  cleanup: probe rows removed"
    );
  }
}


// ── 4. The ledger records dollars, not zeroes ────────────────────────────────────────────────

function costs(): void {
  console.log(`\n4. model-costs: cost_usd is a real number (rates read ${RATES_READ_ON})`);

  // ‼️ EXHAUSTIVE OVER ClaudeModel. If somebody adds a model to the union and not to the rate
  // table, every call on it silently records $0 and the ledger quietly understates. TypeScript
  // catches that at the Record type; this catches it if the Record is ever loosened.
  const union = ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"];
  for (const m of union) check(`${m} has a published rate`, isPriced(m));
  check(
    `the table prices exactly the ${union.length} models in ClaudeModel`,
    pricedModels().length === union.length,
    `table has ${pricedModels().length}: ${pricedModels().join(", ")}`
  );

  // Sonnet 4.6 is $3/MTok in, $15/MTok out. 1M in + 1M out = $18.
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  check(
    "1M in + 1M out on sonnet-4-6 is $18",
    round(tokensOnly("claude-sonnet-4-6", { input_tokens: 1_000_000, output_tokens: 1_000_000 })) === 18,
    String(tokensOnly("claude-sonnet-4-6", { input_tokens: 1_000_000, output_tokens: 1_000_000 }))
  );
  check(
    "a realistic identity call (12k in, 1.5k out) is about 5.9 cents",
    round(tokensOnly("claude-sonnet-4-6", { input_tokens: 12_000, output_tokens: 1_500 })) === 0.0585,
    String(tokensOnly("claude-sonnet-4-6", { input_tokens: 12_000, output_tokens: 1_500 }))
  );
  check(
    "output is priced higher than input, so the two are not transposed",
    tokensOnly("claude-sonnet-4-6", { input_tokens: 0, output_tokens: 1000 }) >
      tokensOnly("claude-sonnet-4-6", { input_tokens: 1000, output_tokens: 0 })
  );
  check(
    "opus costs more than haiku for identical usage",
    tokensOnly("claude-opus-4-7", { input_tokens: 1000, output_tokens: 1000 }) >
      tokensOnly("claude-haiku-4-5-20251001", { input_tokens: 1000, output_tokens: 1000 })
  );

  // Bookkeeping must never fail a call whose money is already spent.
  check(
    "an unpriced model returns 0 rather than throwing",
    tokensOnly("claude-something-unreleased" as never, { input_tokens: 10, output_tokens: 10 }) === 0
  );
  check(
    "missing usage returns 0 rather than throwing",
    tokensOnly("claude-sonnet-4-6", undefined) === 0
  );
}

async function main(): Promise<void> {
  keyIdentity();
  usability();
  costs();
  if (LIVE) await roundTrip();
  else console.log("\n5. skipped. Pass --live to exercise client_datasets (still no paid call).");

  console.log(failures === 0 ? "\nall checks passed\n" : `\n${failures} CHECK(S) FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\nprobe crashed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
