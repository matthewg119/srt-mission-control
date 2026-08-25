/**
 * Probe: the address bar to platform resolver. PURE, no network, no database, no model.
 *
 *   bun scripts/_probe-presence-url.ts
 *
 * ‼️ THE CASE THIS EXISTS FOR IS THE CHAMBER OF COMMERCE ONE, AND IT IS CASE 3.
 *
 * `platform.url` is not a domain map: google's url is google.com/maps and chamber's is
 * google.com/search. A hostname map derived from it would file a chamber-of-commerce screenshot
 * as a Google Business Profile, which is a green tick on a platform nobody looked at. The same
 * shape catches bing.com/maps against a Bing web search.
 *
 * Everything here is a real address bar shape, including the ones Chrome shows with the scheme
 * hidden, because that is what a model transcribing a screenshot hands back.
 */

import { resolvePlatformFromUrl, ALL_PLATFORMS, RECOMMENDED_KEYS, SWEEP_GATE_COUNT, PLATFORM_COUNT } from "../src/config/presence-platforms";

let failures = 0;
let checks = 0;

function eq(name: string, got: string[], want: string[]) {
  checks += 1;
  const a = got.join(",");
  const b = want.join(",");
  if (a === b) {
    console.log(`  ok   ${name}`);
    return;
  }
  failures += 1;
  console.error(`  FAIL ${name}\n       got  [${a}]\n       want [${b}]`);
}

console.log("\nResolving a platform from an address bar\n");

// ── The four Matthew is steered to ──────────────────────────────────────────
eq("google maps place", resolvePlatformFromUrl("https://www.google.com/maps/place/SRT+Agency/@36.07,-79.79,17z"), ["google"]);
eq("google maps search", resolvePlatformFromUrl("google.com/maps/search/SRT+Agency+LLC+Greensboro+NC"), ["google"]);
eq("yelp biz", resolvePlatformFromUrl("https://www.yelp.com/biz/acme-med-spa-greensboro"), ["yelp"]);
eq("trustpilot review", resolvePlatformFromUrl("https://www.trustpilot.com/review/srtagency.com"), ["trustpilot"]);
eq("bbb profile", resolvePlatformFromUrl("https://www.bbb.org/us/nc/greensboro/profile/marketing/acme-0643-123"), ["bbb"]);

// ── The collision the whole design exists for ───────────────────────────────
eq("a google WEB search is not Google Business Profile", resolvePlatformFromUrl("https://www.google.com/search?q=greensboro+chamber+of+commerce"), []);
eq("a bing WEB search is not Bing Places", resolvePlatformFromUrl("https://www.bing.com/search?q=acme+med+spa"), []);
eq("bing maps is Bing Places", resolvePlatformFromUrl("https://www.bing.com/maps?q=acme"), ["bing"]);

// ── Shapes a model really hands back ────────────────────────────────────────
eq("no scheme", resolvePlatformFromUrl("yelp.com/biz/acme"), ["yelp"]);
eq("subdomain", resolvePlatformFromUrl("https://m.facebook.com/AcmeMedSpa/"), ["facebook"]);
eq("maps.apple.com", resolvePlatformFromUrl("https://maps.apple.com/place?auid=123"), ["apple"]);
eq("upper case and padding", resolvePlatformFromUrl("  HTTPS://WWW.YELLOWPAGES.COM/greensboro-nc/mip/acme-123  "), ["yellowpages"]);
eq("a full government host", resolvePlatformFromUrl("https://npiregistry.cms.hhs.gov/provider-view/123"), ["npi"]);

// ── Nothing, said as nothing ────────────────────────────────────────────────
eq("empty", resolvePlatformFromUrl(""), []);
eq("a chrome page", resolvePlatformFromUrl("chrome://newtab"), []);
eq("a bare word", resolvePlatformFromUrl("greensboro"), []);
eq("localhost is not a business listing", resolvePlatformFromUrl("localhost:3000/maps"), []);
// A suffix match must not be a substring match. notyelp.com is somebody else entirely.
eq("suffix not substring", resolvePlatformFromUrl("https://notyelp.com/biz/acme"), []);
// A path prefix has to end on a boundary, or /maps matches /mapsomething.
eq("path boundary", resolvePlatformFromUrl("https://www.google.com/mapsomething/x"), []);

console.log("\nThe list itself\n");

checks += 1;
if (PLATFORM_COUNT !== ALL_PLATFORMS.length) {
  failures += 1;
  console.error("  FAIL PLATFORM_COUNT does not match the list");
} else console.log(`  ok   PLATFORM_COUNT is ${PLATFORM_COUNT}`);

// ‼️ chamber MUST NOT ACQUIRE A domains ENTRY. Its surface is a Google search page, so its
// address bar is indistinguishable from any other Google search. Unmappable is the honest answer.
checks += 1;
const chamber = ALL_PLATFORMS.find((p) => p.key === "chamber");
if (chamber?.domains) {
  failures += 1;
  console.error("  FAIL chamber has a domains entry. Its surface is a Google search page: a domain map for it would file every Google search as a chamber of commerce.");
} else console.log("  ok   chamber is deliberately unmappable from a screenshot");

// Every recommended key has to be a real platform, or the sweep card prints three lines.
checks += 1;
const missing = RECOMMENDED_KEYS.filter((k) => !ALL_PLATFORMS.some((p) => p.key === k));
if (missing.length) {
  failures += 1;
  console.error(`  FAIL RECOMMENDED_KEYS names platforms that do not exist: ${missing.join(", ")}`);
} else console.log(`  ok   the recommended ${RECOMMENDED_KEYS.length} all exist`);

// The gate has to be reachable. Four of nineteen is, six of four would not be.
checks += 1;
if (SWEEP_GATE_COUNT > ALL_PLATFORMS.length) {
  failures += 1;
  console.error("  FAIL SWEEP_GATE_COUNT is larger than the number of platforms");
} else console.log(`  ok   the gate is ${SWEEP_GATE_COUNT} of ${PLATFORM_COUNT}`);

// Two platforms sharing a host without a pathPrefix between them would be permanently ambiguous.
checks += 1;
const byHost = new Map<string, string[]>();
for (const p of ALL_PLATFORMS) {
  for (const d of p.domains ?? []) {
    const at = byHost.get(d.host) ?? [];
    at.push(`${p.key}${d.pathPrefix ?? ""}`);
    byHost.set(d.host, at);
  }
}
const unresolvable = [...byHost.entries()].filter(
  ([, owners]) => owners.length > 1 && owners.some((o) => !/\//.test(o))
);
if (unresolvable.length) {
  failures += 1;
  console.error(`  FAIL a host is claimed by two platforms and one of them has no path: ${unresolvable.map(([h]) => h).join(", ")}`);
} else console.log("  ok   no host is claimed twice without a path to separate them");

if (failures > 0) {
  console.error(`\n${failures} of ${checks} checks failed.`);
  process.exit(1);
}
console.log(`\nAll ${checks} checks passed.`);
