/**
 * Probe: the foundation listings registry and board. READ ONLY, and most of it needs no database.
 *
 *   bun run scripts/_probe-foundation-listings.ts
 *
 * ‼️ `bun run`, NOT `bunx tsx`. The documented invocation for scripts in this repo is
 * `bunx tsx --env-file=.env.local`, and it fails on top-level await with "Top-level await is
 * currently not supported with the cjs output format". `bun run` handles it, resolves the `@/`
 * aliases and loads .env.local by itself.
 *
 * Sections 1 to 5 are PURE and always run: they are the checks that would have caught a med spa on
 * an AI tool directory, a key colliding with presence-platforms, and a description assembled out of
 * an offer nobody locked. Section 6 reads the database and says so rather than silently passing when
 * there is no env.
 *
 * ‼️ IT WRITES NOTHING. Not a seed, not a status, not a verify. runFoundationListingVerify is
 * deliberately NOT called even in dry mode: it would make up to 60 outbound HTTP requests to other
 * people's websites, which is not a thing a probe should do casually.
 *
 * Exit code 1 on any failed assertion, so this is usable from CI.
 */

import {
  FOUNDATION_PLATFORMS,
  FOUNDATION_PLATFORM_COUNT,
  FOUNDATION_TYPES,
  SRT_TYPES,
  TYPE_LABELS,
  foundationPlatformByKey,
  foundationPlatformsFor,
  nextBatch,
  totalMinutes,
  type FoundationType,
} from "../src/config/foundation-platforms";
import { ALL_PLATFORMS, PLATFORM_COUNT, SWEEP_GATE_COUNT } from "../src/config/presence-platforms";
import {
  assembleDescription,
  countListings,
  offerProse,
  type ListingRow,
} from "../src/lib/clients/foundation-listings";

let failures = 0;

function ok(label: string, detail = ""): void {
  console.log(`  PASS  ${label}${detail ? `  ${detail}` : ""}`);
}

function bad(label: string, detail: string): void {
  failures += 1;
  console.log(`  FAIL  ${label}  ${detail}`);
}

function assert(condition: boolean, label: string, detail: string): void {
  if (condition) ok(label);
  else bad(label, detail);
}

function heading(text: string): void {
  console.log(`\n${text}`);
  console.log("-".repeat(text.length));
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
heading("1. The registry is 138 rows and its keys are unique");
// ─────────────────────────────────────────────────────────────────────────────────────────────

console.log(`  ${FOUNDATION_PLATFORM_COUNT} platforms in FOUNDATION_PLATFORMS.`);

assert(
  FOUNDATION_PLATFORM_COUNT === 138,
  "the registry holds 138 platforms",
  `it holds ${FOUNDATION_PLATFORM_COUNT}. The build asked for 138. If a dead directory was dropped ` +
    `deliberately, change this number and say why in the same commit; do not pad the list to satisfy a probe.`
);

const keys = FOUNDATION_PLATFORMS.map((p) => p.key);
const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
assert(
  dupes.length === 0,
  "no duplicate keys",
  `duplicated: ${[...new Set(dupes)].join(", ")}. platform_key is a unique index column, so a duplicate here is a row that can never be seeded.`
);

const badKey = FOUNDATION_PLATFORMS.filter((p) => !/^[a-z][a-z0-9]*$/.test(p.key));
assert(
  badKey.length === 0,
  "every key is lowercase alphanumeric",
  `these are not: ${badKey.map((p) => p.key).join(", ")}`
);

const badUrl = FOUNDATION_PLATFORMS.filter((p) => !/^https:\/\/[^\s]+\.[^\s]+/.test(p.submitUrl));
assert(
  badUrl.length === 0,
  "every submitUrl is an https address",
  `these are not: ${badUrl.map((p) => p.key).join(", ")}`
);

const badNumbers = FOUNDATION_PLATFORMS.filter(
  (p) => p.dr < 0 || p.dr > 100 || p.dr % 5 !== 0 || p.minutes <= 0 || p.costCents < 0
);
assert(
  badNumbers.length === 0,
  "dr is a 0 to 100 multiple of five, minutes is positive, cost is not negative",
  `these are not: ${badNumbers.map((p) => `${p.key} (dr ${p.dr}, ${p.minutes}m, ${p.costCents}c)`).join(", ")}`
);

const badType = FOUNDATION_PLATFORMS.filter((p) => !FOUNDATION_TYPES.includes(p.type));
assert(
  badType.length === 0,
  "every row carries one of the seven types",
  `these do not: ${badType.map((p) => p.key).join(", ")}`
);

assert(
  FOUNDATION_TYPES.every((t) => typeof TYPE_LABELS[t] === "string" && TYPE_LABELS[t].length > 0),
  "every type has a label for a card",
  `missing: ${FOUNDATION_TYPES.filter((t) => !TYPE_LABELS[t]).join(", ")}`
);

for (const type of FOUNDATION_TYPES) {
  const group = FOUNDATION_PLATFORMS.filter((p) => p.type === type);
  console.log(`  ${String(group.length).padStart(3)}  ${type}`);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
heading("2. The two registries do not overlap, and presence-platforms is untouched");
// ─────────────────────────────────────────────────────────────────────────────────────────────

// ‼️ THE CHECK THIS FILE EXISTS FOR. The whole argument of the second registry is that a clinic's
// nineteen swept platforms and the 138 we submit to are different lists of different things. One key
// in both would be one platform with two boards, two statuses and no way to say which is true.
const presenceKeys = new Set(ALL_PLATFORMS.map((p) => p.key));
const collisions = keys.filter((k) => presenceKeys.has(k));
assert(
  collisions.length === 0,
  "no key appears in both registries",
  `in both: ${collisions.join(", ")}. presence-platforms SWEEPS a platform and files a screenshot; this file SUBMITS to one and records a live URL. A key in both means one platform with two answers.`
);

// The near-miss the registry warns about, asserted rather than trusted.
assert(
  presenceKeys.has("chamber") && foundationPlatformByKey("chamberofcommerce") !== undefined,
  "`chamber` and `chamberofcommerce` are two platforms in two registries",
  "one of the pair has moved, which is how a national directory gets filed as the local chamber."
);

assert(
  PLATFORM_COUNT === 19,
  "presence-platforms still holds 19 platforms",
  `it holds ${PLATFORM_COUNT}. Rows were added to it, which is the thing the second registry exists to avoid.`
);
assert(
  SWEEP_GATE_COUNT === 4,
  "SWEEP_GATE_COUNT is still 4",
  `it is ${SWEEP_GATE_COUNT}. Nothing in this lane may move the presence sweep's gate.`
);

// ─────────────────────────────────────────────────────────────────────────────────────────────
heading("3. Selecting platforms is a fact about the owner, never a default");
// ─────────────────────────────────────────────────────────────────────────────────────────────

// ‼️ THE MED SPA CHECK. An empty list must give an empty list, because the moment "no types named"
// reads as "all of them", a clinic's board has twenty-three AI tool directories on it.
const none = foundationPlatformsFor([]);
assert(
  none.platforms.length === 0 && none.unknown.length === 0,
  "no types named gives no platforms",
  `it gave ${none.platforms.length}. Naming none must never read as naming all.`
);

const clinic = foundationPlatformsFor(["business_directory", "review_platform"]);
const clinicHasAi = clinic.platforms.some((p) => p.type === "ai_directory");
assert(
  !clinicHasAi && clinic.platforms.length > 0,
  "a clinic's two types bring back no AI tool directory",
  clinicHasAi ? "an ai_directory row came back for a clinic, which is the exact card this build refuses" : "nothing came back at all"
);
console.log(
  `  a clinic on business_directory + review_platform gets ${clinic.platforms.length} platforms, ` +
    `about ${totalMinutes(clinic.platforms)} minutes of work.`
);

const typo = foundationPlatformsFor(["business_directory", "ai_directories"]);
assert(
  typo.unknown.length === 1 && typo.unknown[0] === "ai_directories",
  "an unrecognised type is returned by name, not dropped",
  `unknown was ${JSON.stringify(typo.unknown)}. A silently dropped type is one group of work nobody notices is missing.`
);

const srt = foundationPlatformsFor(SRT_TYPES);
assert(
  !srt.platforms.some((p) => p.type === "launch"),
  "SRT's own types exclude `launch`",
  "a launch row came back for SRT, and firing twenty-two dated launches at an agency home page spends a Product Hunt slot on nothing."
);
console.log(
  `  SRT's six types give ${srt.platforms.length} platforms of ${FOUNDATION_PLATFORM_COUNT}, ` +
    `about ${Math.round(totalMinutes(srt.platforms) / 60)} hours of submissions.`
);

const batch = nextBatch(srt.platforms, new Set(["googlepartners", "metapartners"]), 5);
assert(
  batch.length === 5 && !batch.some((p) => p.key === "googlepartners" || p.key === "metapartners"),
  "the next batch skips rows already started and comes back strongest first",
  `got ${batch.map((p) => `${p.key}:${p.dr}`).join(", ")}`
);
const descending = batch.every((p, i) => i === 0 || batch[i - 1].dr >= p.dr);
assert(descending, "the batch is in descending DR order", `got ${batch.map((p) => p.dr).join(", ")}`);

// ─────────────────────────────────────────────────────────────────────────────────────────────
heading("4. The description comes from the offer and the short offer, or it refuses");
// ─────────────────────────────────────────────────────────────────────────────────────────────

const SHORT_OFFER = `# Short offer

Product:
A done-for-you AEO build that gets a clinic named when somebody asks ChatGPT for the best med spa in their city.

Price:
$499 a month after the first five AI inquiries land.

The discovery story:
Matthew watched an engine recommend a competitor four times in a row and went looking for why.
`;

const LOCKED = {
  treatment: "AEO for med spas",
  outcomePromise: "more booked consults",
  price: "$499 per month",
  guarantee: "free until five AI inquiries land",
  positioning: null,
};

const full = assembleDescription({
  name: "SRT Agency",
  offer: LOCKED,
  prose: offerProse(SHORT_OFFER),
  docStatus: "approved",
});

console.log(`  tagline (${full.tagline.length}):  ${full.tagline}`);
console.log(`  short   (${full.short.length}):  ${full.short}`);
console.log(`  sources: ${full.sources.join(" | ")}`);
if (full.faults.length) for (const f of full.faults) console.log(`  fault:   ${f}`);

assert(full.tagline.length <= 80, "the tagline fits an 80 character field", `it is ${full.tagline.length}`);
assert(full.short.length <= 300, "the short description fits 300 characters", `it is ${full.short.length}`);
assert(full.long.length <= 1000, "the long description fits 1000 characters", `it is ${full.long.length}`);
assert(
  full.short.includes("$499"),
  "the price from offer_locked reaches the description",
  "the price is missing, so 138 directories would each be free to state a different one"
);
assert(
  !/^#|\bProduct:\s*$/m.test(full.short),
  "the short offer's template headings are not pasted into a directory field",
  `the text still carries a heading: ${full.short.slice(0, 120)}`
);
assert(
  full.faults.length === 0,
  "a locked offer plus an approved short offer produces no faults",
  `faults: ${full.faults.join(" / ")}`
);

// ‼️ THE FOUR SHAPES MEASURED OFF srt-agency-llc's REAL SHORT OFFER ON 2026-09-29. Every one of them
// reached the description before offerProse() was rewritten, and the `---` did double damage: it
// landed mid sentence AND raised a dash fault about punctuation that was never prose.
const MESSY = [
  "# Short offer",
  "> Built directly from the verified avatar sheet.",
  "---",
  "**Shipped name (in use):** AI Referral Engine",
  "Price:",
  "1. $499 a month after the first five AI inquiries land.",
].join("\n");

const cleaned = offerProse(MESSY);
console.log(`  messy document cleans to: ${cleaned}`);

assert(!cleaned.includes(">"), "a blockquote marker never reaches a directory field", `got: ${cleaned}`);
assert(
  !cleaned.includes("--"),
  "a markdown horizontal rule is dropped as structure, not carried in as a double hyphen",
  `got: ${cleaned}. It would also raise a dash fault about punctuation that was never prose.`
);
assert(!cleaned.includes("::"), "a colon inside emphasis markers does not become a double colon", `got: ${cleaned}`);
assert(!cleaned.includes("**"), "emphasis markers are stripped", `got: ${cleaned}`);
assert(!/(^|\s)1\.\s/.test(cleaned), "list numbering is dropped", `got: ${cleaned}`);
assert(
  cleaned.includes("AI Referral Engine") && cleaned.includes("$499"),
  "the actual sentences survive the cleaning",
  `got: ${cleaned}`
);
assert(
  !/^Price:?$/m.test(cleaned) && !cleaned.includes(" Price: $499"),
  "a bare template label with nothing after it is dropped",
  `got: ${cleaned}`
);

// The same assembly with the offer's optional halves missing. It must still produce text AND must
// name what is absent, rather than quietly shipping a thinner message to 138 domains.
const thin = assembleDescription({
  name: "SRT Agency",
  offer: { treatment: "AEO for med spas", outcomePromise: null, price: null, guarantee: null, positioning: null },
  prose: "A done-for-you AEO build.",
  docStatus: "draft",
});
assert(thin.short.length > 0, "a thin offer still produces text", "it produced nothing");
assert(
  thin.faults.some((f) => f.includes("no price")) &&
    thin.faults.some((f) => f.includes("no outcome")) &&
    thin.faults.some((f) => f.includes("draft")) &&
    thin.faults.some((f) => f.includes("thin")),
  "a thin offer names every gap: outcome, price, draft status, thin prose",
  `faults were: ${thin.faults.join(" / ")}`
);

// ‼️ THE DASH IS NAMED, NOT REPAIRED. A silent strip would leave the short offer document wrong and
// every future paste wrong with it, which is the whole lesson of a stored fault being a frozen verdict.
const dashed = assembleDescription({
  name: "SRT Agency",
  offer: LOCKED,
  prose: "A done-for-you AEO build, the kind that gets a clinic named by an engine, and it works because engines read structure rather than slogans.".replace(
    ", the kind",
    " — the kind"
  ),
  docStatus: "approved",
});
assert(
  dashed.faults.some((f) => f.includes("em dash")),
  "an em dash in the source document is reported as a fault",
  `faults were: ${dashed.faults.join(" / ")}`
);
assert(
  dashed.long.includes("—"),
  "the em dash is left in the text rather than silently stripped",
  "the dash was repaired here, which fixes one paste and leaves the document wrong forever"
);

// ─────────────────────────────────────────────────────────────────────────────────────────────
heading("5. Counting a board keeps asserted and observed apart");
// ─────────────────────────────────────────────────────────────────────────────────────────────

const fake: ListingRow[] = [
  row("clutch", "live", { costCents: 0, liveUrl: "https://clutch.co/profile/x", verifiedAt: "2026-09-20T00:00:00Z" }),
  row("goodfirms", "submitted", { costCents: 500 }),
  row("designrush", "queued", { costCents: 0 }),
  row("upcity", "missing", { costCents: 900 }),
  row("sortlist", "rejected", { costCents: 0 }),
  row("a-directory-that-left-the-registry", "live", { costCents: 0, liveUrl: "https://example.com/x" }),
];

const counts = countListings(fake);
console.log(`  ${JSON.stringify(counts)}`);

assert(counts.total === 6, "every row is counted", `total was ${counts.total}`);
assert(
  counts.live === 2 && counts.submitted === 1 && counts.queued === 1 && counts.missing === 1 && counts.rejected === 1,
  "each status is counted separately",
  JSON.stringify(counts)
);
assert(
  counts.orphaned === 1,
  "a platform_key that has left the registry is named rather than hidden",
  `orphaned was ${counts.orphaned}`
);
// ‼️ A `missing` ROW'S SEEDED COST HAS NOT BEEN SPENT. Counting it would report money nobody paid.
assert(
  counts.spentCents === 500,
  "only submitted and live rows count toward money spent",
  `spentCents was ${counts.spentCents}, and upcity's seeded 900 is a row nobody has worked yet`
);

// ─────────────────────────────────────────────────────────────────────────────────────────────
heading("6. The table, and SRT's own row");
// ─────────────────────────────────────────────────────────────────────────────────────────────

await liveChecks();

// ─────────────────────────────────────────────────────────────────────────────────────────────

console.log("");
if (failures > 0) {
  console.log(`${failures} assertion${failures === 1 ? "" : "s"} failed.`);
  process.exit(1);
}
console.log("Everything checked passed.");

// ─── helpers ────────────────────────────────────────────────────────────────────────────────

function row(
  platformKey: string,
  status: ListingRow["status"],
  extra: { costCents: number; liveUrl?: string; verifiedAt?: string }
): ListingRow {
  return {
    id: `fake-${platformKey}`,
    ownerKind: "srt",
    ownerId: null,
    platformKey,
    status,
    submittedAt: status === "submitted" || status === "live" ? "2026-09-01T00:00:00Z" : null,
    liveUrl: extra.liveUrl ?? null,
    verifiedAt: extra.verifiedAt ?? null,
    costCents: extra.costCents,
    notes: null,
    platform: foundationPlatformByKey(platformKey) ?? null,
  };
}

/**
 * The database half. Says what it could not reach rather than passing quietly.
 *
 * ‼️ A PROBE RUN WITHOUT ENV RETURNS NOTHING, NOT AN ERROR, which is the sibling trap to the
 * `bunx tsx` one at the top of this file. So the absence of a URL is reported as a skip with the
 * reason, and never as a pass.
 */
async function liveChecks(): Promise<void> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL && !process.env.SUPABASE_URL) {
    console.log("  SKIP  no Supabase URL in the environment, so nothing below was checked.");
    console.log("        Run it as: bun run scripts/_probe-foundation-listings.ts");
    return;
  }

  const { supabaseAdmin } = await import("../src/lib/db");

  const probe = await supabaseAdmin
    .from("listing_submissions")
    .select("id, owner_kind, owner_id, platform_key, status, cost_cents, live_url, verified_at, submitted_at, notes")
    .limit(200);

  if (probe.error) {
    bad(
      "listing_submissions is readable",
      `${probe.error.message}. If this says the relation does not exist, run docs/2026-09-29-offsite.sql.`
    );
    return;
  }
  ok("listing_submissions is readable", `${probe.data?.length ?? 0} rows visible`);

  const rows = probe.data ?? [];
  const srtRows = rows.filter((r) => r.owner_kind === "srt");
  const clientRows = rows.filter((r) => r.owner_kind === "client");
  console.log(`  ${srtRows.length} SRT rows, ${clientRows.length} client rows.`);

  // The CHECK constraint's rule, verified against what is actually stored rather than trusted.
  const badPairs = rows.filter(
    (r) => (r.owner_kind === "srt" && r.owner_id !== null) || (r.owner_kind === "client" && r.owner_id === null)
  );
  assert(
    badPairs.length === 0,
    "every row's owner_kind and owner_id agree",
    `${badPairs.length} rows do not, which the table's CHECK should have refused`
  );

  const unknownPlatforms = [...new Set(rows.map((r) => String(r.platform_key)))].filter(
    (k) => !foundationPlatformByKey(k)
  );
  assert(
    unknownPlatforms.length === 0,
    "every stored platform_key is still in the registry",
    `these are not: ${unknownPlatforms.join(", ")}. A key was renamed in code without a migration.`
  );

  // ‼️ THE INVARIANT THAT MATTERS MOST AT REST: a `live` row with no URL is a green tick over
  // nothing, and it is exactly what a board that collapsed "I did it" into "it is there" would leave.
  const liveWithoutUrl = rows.filter((r) => r.status === "live" && !r.live_url);
  assert(
    liveWithoutUrl.length === 0,
    "no row is live without a URL",
    `${liveWithoutUrl.length} are: ${liveWithoutUrl.map((r) => r.platform_key).join(", ")}`
  );

  const liveWithoutVerify = rows.filter((r) => r.status === "live" && !r.verified_at);
  assert(
    liveWithoutVerify.length === 0,
    "no row is live without a verified_at",
    `${liveWithoutVerify.length} are: ${liveWithoutVerify.map((r) => r.platform_key).join(", ")}. The URL and the date it answered travel together.`
  );

  // SRT's own client row, by slug, because every id written down for it in this repo is dead.
  const { resolveClient } = await import("../src/lib/clients/client-reads");
  const { SRT_SLUG } = await import("../src/lib/clients/foundation-listings");
  const found = await resolveClient(SRT_SLUG);
  if (!found.ok) {
    bad(`SRT resolves by slug "${SRT_SLUG}"`, found.error);
    return;
  }
  ok(`SRT resolves by slug "${SRT_SLUG}"`, found.client.id);

  const { describeListing } = await import("../src/lib/clients/foundation-listings");
  const described = await describeListing(found.client.id);
  if (!described.ok) {
    // NOT a failure. A refusal on an unlocked offer or a missing short offer is the designed
    // behaviour, and printing the sentence is the useful output.
    console.log(`  NOTE  no description yet, and it says why: ${described.error}`);
    return;
  }

  ok("a description can be built for SRT");
  console.log(`  tagline: ${described.description.tagline}`);
  console.log(`  short:   ${described.description.short}`);
  for (const f of described.description.faults) console.log(`  fault:   ${f}`);

  const typed: FoundationType[] = [...SRT_TYPES];
  console.log(`  SRT's groups: ${typed.map((t) => TYPE_LABELS[t]).join(", ")}`);
}
