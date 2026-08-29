// Probe: the GBP optimization score, offline.
//
//   bunx tsx scripts/_probe-gbp-audit.ts
//
// No API key, no network, no DB, no Slack. This score goes on a card somebody reads down the phone
// and it sits in the same file as the number that decides who gets deleted, so the weights and the
// denominator rule have to be provable without spending anything.
//
// ‼️ THE SUMMARY AND THE process.exit MUST STAY THE LAST TWO STATEMENTS IN THIS FILE. The DM probe
// records what happens otherwise: five checks once sat below them and never ran.

import {
  buildProfileKeyword,
  categoryTokens,
  cityTokens,
  containsCategory,
  containsCity,
  countGaps,
  extractFirstH1,
  extractGbpSerpFacts,
  extractTitle,
  shareANameToken,
  OPTIMIZATION_COMPONENT_COUNT,
  OPTIMIZATION_KEY_ORDER,
  OPTIMIZATION_WEIGHTS,
  readAdditionalCategories,
  readDescription,
  readPrimaryCategory,
  readServices,
  readTotalPhotos,
  scoreOptimization,
  splitSubtitle,
  stripDescriptionPrefix,
  tokenize,
  UNVERIFIABLE,
  type GbpProfile,
  type GbpSerpFacts,
  type OptimizationInput,
  type OptimizationResult,
} from "../src/lib/scraper/gbp-audit";
import { buildScoredCsv, OPTIMIZATION_CSV_COLUMNS } from "../src/lib/scraper/report";
import { parseCsv } from "../src/lib/scraper/csv";
import { applyCutoff, parseCutoff, sortForCutoff, type ScoredRow } from "../src/lib/scraper/score";
import type { SerpPayload } from "../src/lib/scraper/score";

let passed = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, detail?: string): void {
  if (cond) passed++;
  else failures.push(label + (detail ? "  (" + detail + ")" : ""));
}

function eq(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(label, a === e, "got " + a + ", wanted " + e);
}

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────
//
// One business, fully optimized, and then one field bent at a time. Everything is hand-written so
// the arithmetic below can be checked without running anything.

const SERP: GbpSerpFacts = {
  cid: "2735628611391785789",
  placeId: "ChIJsZmXrzglVIgRPQtnY7rn9iU",
  category: "Medical Spa",
  city: "Charlotte",
  description: "Charlotte's premier medical spa, offering injectables and skin care",
  url: "http://www.theskinbarqc.com/",
  cidSource: "knowledge_graph",
};

function profile(over: Partial<GbpProfile> = {}): GbpProfile {
  return {
    category: "Medical Spa",
    additional_categories: ["Skin care clinic", "Facial spa", "Laser hair removal service", "Day spa"],
    description: "Charlotte's premier medical spa, offering injectables and skin care",
    total_photos: 12,
    services: [
      { title: "Botox", description: "Wrinkle relaxing injections" },
      { title: "Filler", description: "Volume restoration" },
      { title: "Microneedling", description: "Collagen induction therapy" },
    ],
    url: "http://www.theskinbarqc.com/",
    address_info: { city: "Charlotte" },
    ...over,
  };
}

const PAGE_OK = {
  crawled: true,
  title: "Medical Spa in Charlotte, NC | The Skin Bar",
  h1: "Charlotte Medical Spa",
};

function score(over: Partial<OptimizationInput> = {}): OptimizationResult {
  return scoreOptimization({ serp: SERP, profile: profile(), page: PAGE_OK, ...over });
}

// ── 1. the weights ──────────────────────────────────────────────────────────────────────────────

eq("there are six components", OPTIMIZATION_COMPONENT_COUNT, 6);
eq(
  "the weights sum to exactly 100",
  Object.values(OPTIMIZATION_WEIGHTS).reduce((a, b) => a + b, 0),
  100
);
for (const key of OPTIMIZATION_KEY_ORDER) {
  check("every key in the order has a weight: " + key, typeof OPTIMIZATION_WEIGHTS[key] === "number");
}
eq(
  "the order lists every weighted key exactly once",
  [...OPTIMIZATION_KEY_ORDER].sort(),
  Object.keys(OPTIMIZATION_WEIGHTS).sort()
);

//   primary category set             15 / 15
//   4 additional categories          20 / 20
//   description names both           15 / 15
//   12 photos                        15 / 15
//   3 of 3 services described        15 / 15
//   title and h1 name both           20 / 20
//                                   100 / 100  ->  100
const full = score();
eq("a fully optimized profile scores 100", full.score, 100);
eq("and says all six were measured", full.measured, "6 of 6");
for (const key of OPTIMIZATION_KEY_ORDER) {
  eq("component earns its full weight: " + key, full.components[key].earned, OPTIMIZATION_WEIGHTS[key]);
  check("component is attempted: " + key, full.components[key].attempted);
}

// ── 2. ‼️ THE DENOMINATOR RULE, BOTH DIRECTIONS ─────────────────────────────────────────────────
//
// This is the point of the file. A component that could not be MEASURED leaves the denominator; a
// component that was measured and found wanting stays in it and earns zero. Collapsing either
// direction into the other is the bug, and the live proof it matters is already in CLAUDE.md: a
// national chain scored 23/100 because measured zeros were recorded for numbers nobody had read.

// Direction A: unmeasured LEAVES the denominator.
//
//   primary category (off the SERP)  15 / 15
//   description names both           15 / 15
//   title and h1 name both           20 / 20
//   additional / photos / services   unmeasured, no profile came back
//                                    50 / 50   ->  100
const noProfile = score({ profile: null });
eq("with no profile, three components are measured", noProfile.measured, "3 of 6");
eq("and it scores off the 50 points that could be looked at", noProfile.score, 100);
check("additional_categories left the denominator", !noProfile.components.additional_categories.attempted);
check("photos left the denominator", !noProfile.components.photos.attempted);
check("services left the denominator", !noProfile.components.services.attempted);

const ifUnmeasuredCountedZero = Math.round((50 / 100) * 100);
eq("counting the three unmeasured as earned zeros would give 50", ifUnmeasuredCountedZero, 50);
check(
  "leaving the denominator scores HIGHER than counting unmeasured as a zero",
  (noProfile.score as number) > ifUnmeasuredCountedZero,
  noProfile.score + " vs " + ifUnmeasuredCountedZero
);

// Direction B: a measured zero STAYS in the denominator.
//
//   two photos is a real answer about a real profile, so it is attempted and earns nothing:
//                                    85 / 100  ->  85
const twoPhotos = score({ profile: profile({ total_photos: 2 }) });
check("two photos is ATTEMPTED", twoPhotos.components.photos.attempted);
eq("and earns nothing", twoPhotos.components.photos.earned, 0);
eq("so the row scores 85", twoPhotos.score, 85);
eq("and still reports six measured", twoPhotos.measured, "6 of 6");

//   the same profile with the photo count MISSING leaves 15 points out entirely:
//                                    85 / 85   ->  100
const noPhotoCount = score({ profile: profile({ total_photos: undefined }) });
check("an absent photo count is UNMEASURED", !noPhotoCount.components.photos.attempted);
eq("so the row scores 100 off a smaller denominator", noPhotoCount.score, 100);
eq("and says so", noPhotoCount.measured, "5 of 6");
check(
  "a measured zero scores strictly LOWER than the same component being unmeasured",
  (twoPhotos.score as number) < (noPhotoCount.score as number),
  twoPhotos.score + " vs " + noPhotoCount.score
);

// ‼️ AN EMPTY SERVICES ARRAY IS A MEASURED ZERO; AN ABSENT ONE IS NOT. The profile came back and
// listed no services, which is a real finding. An absent key might be a field name we guessed wrong.
const emptyServices = score({ profile: profile({ services: [] }) });
check("an empty services array is ATTEMPTED", emptyServices.components.services.attempted);
eq("and its note says so plainly", emptyServices.components.services.note, "no services listed");
const noServicesKey = score({ profile: profile({ services: undefined }) });
check("an absent services key is UNMEASURED", !noServicesKey.components.services.attempted);
check(
  "the two produce different scores off the same profile",
  emptyServices.score !== noServicesKey.score,
  emptyServices.score + " vs " + noServicesKey.score
);

// ── 3. nothing measurable at all ────────────────────────────────────────────────────────────────
//
// Null, never 0. Zero is the WORST optimization score, which on a pitch list is the most interesting
// business there is, so writing it for a business nobody could look at is the same class of mistake
// as writing mx_ok = false for a domain no resolver answered.

const nothing = scoreOptimization({ serp: null, profile: null, page: null });
eq("nothing measurable scores null, not zero", nothing.score, null);
eq("and it says zero of six", nothing.measured, "0 of 6");
for (const key of OPTIMIZATION_KEY_ORDER) {
  check("no component claims to have been attempted: " + key, !nothing.components[key].attempted);
}

// ── 4. reading the SERP we already paid for ─────────────────────────────────────────────────────
//
// Measured against the live response for "Skin Bar MedSpa Charlotte" on 2026-08-28.

const LIVE_SERP: SerpPayload = {
  items: [
    {
      type: "knowledge_graph",
      title: "The Skin Bar QC",
      subtitle: "Medical spa in Matthews, North Carolina",
      description:
        "From The Skin Bar QC: We are a premier medical spa in Matthews, NC, offering personalized skin care and injectables.",
      url: "http://www.theskinbarqc.com/",
      cid: "2735628611391785789",
    },
    { type: "google_reviews", place_id: "ChIJsZmXrzglVIgRPQtnY7rn9iU", reviews_count: 214 },
    { type: "organic", rank_group: 1, url: "http://www.theskinbarqc.com/" },
  ],
};

const facts = extractGbpSerpFacts(LIVE_SERP);
eq("the cid comes off the knowledge graph", facts.cid, "2735628611391785789");
eq("the place_id comes off the google_reviews block", facts.placeId, "ChIJsZmXrzglVIgRPQtnY7rn9iU");
eq("the category is the half of the subtitle before ' in '", facts.category, "Medical spa");
eq("the city is the first comma-delimited part after it", facts.city, "Matthews");
eq("the landing page comes off the knowledge graph", facts.url, "http://www.theskinbarqc.com/");

// ‼️ THE "From {name}: " PREFIX IS STRIPPED. A business called "Charlotte Med Spa" would otherwise
// satisfy both halves of the keyword check out of a prefix GOOGLE wrote, and score a false 15 on a
// component about whether the OWNER wrote a keyword-bearing description.
check(
  "the From-name prefix is stripped off the description",
  (facts.description ?? "").startsWith("We are a premier medical spa"),
  String(facts.description)
);
eq(
  "a business whose NAME carries the category and city cannot pass on the prefix alone",
  stripDescriptionPrefix("From Charlotte Med Spa: we do great work"),
  "we do great work"
);
eq("a description with no prefix is untouched", stripDescriptionPrefix("Plain text"), "Plain text");

// ‼️ THE SUBTITLE SPLITS ON THE LAST " in ", NOT THE FIRST. Google files real businesses under
// categories containing the word.
eq("a category containing 'in' still parses", splitSubtitle("Walk in clinic in Charlotte, NC"), {
  category: "Walk in clinic",
  city: "Charlotte",
});
eq("a subtitle with no ' in ' yields a category and no city", splitSubtitle("Medical spa"), {
  category: "Medical spa",
  city: null,
});

// ── 4b. ‼️ THE local_pack FALLBACK, AND THE WESTMINSTER TRAP ────────────────────────────────────
//
// Measured on the first live call, and both halves of this came out of ONE response for
// "Skin Bar MedSpa Charlotte, NC":
//
//   1. There was NO knowledge_graph at all. Three `local_pack` items, and the cid was sitting on
//      the first of them. Reading only the knowledge_graph left the whole optimization audit
//      unmeasured for a business whose key was right there. Same failure as `google_reviews` in
//      score.ts, one block type over.
//
//   2. local_pack rank 1 was "The Skin Bar QC" in Matthews NC, the right business. Rank 2 was
//      "Skin Bar MedSpa" in Westminster COLORADO, a different company whose title is a BETTER
//      string match for the name queried. So "pick the local pack whose title looks most like the
//      company" picks the wrong state on the exact query that motivated this feature.
//
// The rule is Google's own rank 1, never the best title match.

const LIVE_LOCAL_PACK: SerpPayload = {
  items: [
    {
      type: "local_pack",
      rank_group: 1,
      title: "The Skin Bar QC",
      description: "5+ years in business, Matthews, NC \nClosed, Opens 9 AM Tue \n",
      domain: "www.theskinbarqc.com",
      url: "http://www.theskinbarqc.com/",
      cid: "2735628611391785789",
    },
    {
      type: "local_pack",
      rank_group: 2,
      title: "Skin Bar MedSpa",
      description: "15+ years in business, Westminster, CO \n",
      domain: "www.vagaro.com",
      url: "https://www.vagaro.com/googlemap/xxx/services",
      cid: "17398952216603090646",
    },
    { type: "local_pack", rank_group: 3, title: "Skin Lab", url: "https://skinlb.com/", cid: "16770619048561987176" },
    { type: "organic", rank_group: 1, url: "http://www.theskinbarqc.com/" },
  ],
};

const packFacts = extractGbpSerpFacts(LIVE_LOCAL_PACK, {
  company: "Skin Bar MedSpa",
  city: "Charlotte, NC",
});
eq("a cid is found even with no knowledge_graph", packFacts.cid, "2735628611391785789");
eq("and the source is recorded as the weaker one", packFacts.cidSource, "local_pack");
check(
  "‼️ it takes Google's RANK 1, not the Colorado business whose name matches better",
  packFacts.cid !== "17398952216603090646",
  "picked " + packFacts.cid
);
eq("the landing page comes off that same entry", packFacts.url, "http://www.theskinbarqc.com/");

// ‼️ A local_pack CARRIES NO CATEGORY AND ITS `description` IS NOT A GBP DESCRIPTION. The live value
// was "5+ years in business, Matthews, NC / Closed, Opens 9 AM Tue", which is Google's operational
// blurb. Reading it as the owner's description would invent a finding about copy nobody wrote: it
// never contains a category, so every business found this way would report the same gap.
eq("no category is claimed from a local pack", packFacts.category, null);
eq("and no description is claimed either", packFacts.description, null);

// So the category component is UNMEASURED, not a measured zero, when only a local pack answered.
const packOnly = scoreOptimization({ serp: packFacts, profile: null, page: null });
check(
  "with only a local_pack cid, the category is unmeasured rather than scored zero",
  !packOnly.components.primary_category.attempted
);
eq("and nothing at all could be measured", packOnly.score, null);

// The knowledge_graph path still wins when one is present.
eq("a knowledge_graph is preferred and recorded as such", facts.cidSource, "knowledge_graph");

// The guard rejects a local pack that has nothing to do with the business asked for.
check("a shared real word passes", shareANameToken("Skin Bar MedSpa", "The Skin Bar QC", "Charlotte"));
check("an unrelated title is rejected", !shareANameToken("Skin Bar MedSpa", "Joe's Garage", "Charlotte"));
check(
  "‼️ the CITY alone is never a shared word: a business named after its city must not match every other one",
  !shareANameToken("Charlotte Med Spa", "Charlotte Dermatology", "Charlotte, NC")
);
const unrelated = extractGbpSerpFacts(LIVE_LOCAL_PACK, { company: "Joe's Garage", city: "Charlotte" });
eq("and a rejected local pack yields no cid at all", unrelated.cid, null);
eq("with no source recorded", unrelated.cidSource, null);

// ── 5. ‼️ BY cid, NEVER BY NAME ─────────────────────────────────────────────────────────────────
//
// A name search silently returns a different business with a similar name in a nearby city and then
// scores somebody else's profile against this lead. Nothing errors and every column fills in, which
// is what makes it the one failure here that is invisible and wrong at the same time.

eq("a cid is preferred", buildProfileKeyword(facts), "cid:2735628611391785789");
eq(
  "a place_id is the fallback",
  buildProfileKeyword({ ...facts, cid: null }),
  "place_id:ChIJsZmXrzglVIgRPQtnY7rn9iU"
);
eq(
  "with NEITHER key it refuses rather than falling back to a name",
  buildProfileKeyword({ ...facts, cid: null, placeId: null }),
  null
);
eq("and null facts refuse too", buildProfileKeyword(null), null);

// ── 6. the mechanical keyword rule ──────────────────────────────────────────────────────────────
//
// No model call anywhere. A prose guard is not a guard.

eq("tokenize drops stopwords and short words", tokenize("The best MED spa for you"), ["med", "spa"]);
eq("hyphens and ampersands split", tokenize("Skin & Laser Med-Spa"), ["skin", "laser", "med", "spa"]);
eq("accents fold", tokenize("Cafes"), tokenize("Cafés"));
eq("a trailing s is stripped symmetrically", tokenize("spas"), ["spa"]);
eq("but a double s is left alone", tokenize("wellness"), ["wellness"]);

const CAT = categoryTokens("Medical Spa");
const CITY = cityTokens("Charlotte, NC");
eq("the state abbreviation is trimmed off the city", CITY, ["charlotte"]);

check("one category token is enough", containsCategory("we run a med spa", CAT));
check("a description naming neither fails", !containsCategory("welcome to our clinic", CAT));
check("the city has to be present", containsCity("serving Charlotte since 2011", CITY));
check("a different city fails", !containsCity("serving Raleigh since 2011", CITY));

// EVERY city token, unlike the category, or a page about Salem in Oregon passes for one in NC.
const WS = cityTokens("Winston Salem");
check("a two-word city needs both halves", containsCity("winston salem med spa", WS));
check("half of a two-word city is not enough", !containsCity("salem med spa", WS));

// A wholly generic category still has to be matchable on something, or its component would be
// permanently unmeasurable for every business Google files under it.
check(
  "an all-generic category matches on its own generic words",
  containsCategory("our service center is open", categoryTokens("Service Center"))
);

// ── 7. the description component, and its three distinct unmeasured notes ───────────────────────

const halfDescription = score({
  profile: profile({ description: "We offer injectables and medical spa treatments" }),
  serp: { ...SERP, description: null },
});
check("a description naming only the category is ATTEMPTED", halfDescription.components.description_keywords.attempted);
eq("and earns nothing", halfDescription.components.description_keywords.earned, 0);
eq(
  "and the note names WHICH half missed",
  halfDescription.components.description_keywords.note,
  "description names the category, not the city"
);
eq("so the row scores 85", halfDescription.score, 85);

// ‼️ THE CATEGORY AND THE CITY ARE PART OF `attempted`, NOT PART OF THE TEST. With nothing to look
// for, the check cannot be RUN, and scoring it zero would record "they wrote a bad description"
// when what actually happened is that we could not read their category.
const noCategory = score({
  profile: profile({ category: undefined, categories: undefined, additional_categories: [] }),
  serp: { ...SERP, category: null },
});
check(
  "with no category, the description check is UNMEASURED not failed",
  !noCategory.components.description_keywords.attempted
);
eq(
  "and it says what was missing",
  noCategory.components.description_keywords.note,
  "not measured: no category to look for"
);
check(
  "the landing page check is unmeasured for the same reason",
  !noCategory.components.landing_page.attempted
);

const noCity = score({
  profile: profile({ address_info: undefined }),
  serp: { ...SERP, city: null },
});
eq(
  "no city is its own distinct note",
  noCity.components.description_keywords.note,
  "not measured: no city to look for"
);

const noDescription = score({
  profile: profile({ description: undefined }),
  serp: { ...SERP, description: null },
});
eq(
  "an absent description is unmeasured and says where it looked",
  noDescription.components.description_keywords.note,
  "not measured: no description on the profile"
);

// ── 8. the landing page ─────────────────────────────────────────────────────────────────────────

eq(
  "the title is read out of raw HTML",
  extractTitle("<head><title>Medical Spa in Charlotte</title></head>"),
  "Medical Spa in Charlotte"
);
eq(
  "the FIRST h1 is read, tags stripped",
  extractFirstH1("<h1 class='x'>Charlotte <span>Medical Spa</span></h1><h1>Second</h1>"),
  "Charlotte Medical Spa"
);
eq("a page with no h1 reads null", extractFirstH1("<h2>Nope</h2>"), null);

check("title and h1 both naming both earns the full 20", full.components.landing_page.earned === 20);

const titleOnly = score({ page: { crawled: true, title: PAGE_OK.title, h1: "Welcome" } });
check("a right title and a wrong h1 is a MEASURED zero", titleOnly.components.landing_page.attempted);
eq("and earns nothing", titleOnly.components.landing_page.earned, 0);
eq("and the note names which half", titleOnly.components.landing_page.note, "title is right, h1 is not");

// ‼️ TWO DIFFERENT UNMEASURED ANSWERS THAT MUST NOT COLLAPSE. "we never looked" and "we looked and
// the site refused" are different facts, and the CSV has to say which.
const neverLooked = score({ page: null });
const refused = score({ page: { crawled: false, title: null, h1: null } });
check("no landing page at all is unmeasured", !neverLooked.components.landing_page.attempted);
check("a refused crawl is unmeasured too, never failed", !refused.components.landing_page.attempted);
check(
  "and the two print DIFFERENT notes",
  neverLooked.components.landing_page.note !== refused.components.landing_page.note,
  neverLooked.components.landing_page.note + " vs " + refused.components.landing_page.note
);
eq(
  "a refused crawl says the site would not load",
  refused.components.landing_page.note,
  "not measured: site would not load"
);

// ── 9. the defensive readers ────────────────────────────────────────────────────────────────────
//
// ‼️ EVERY FIELD NAME BELOW IS A GUESS UNTIL A LIVE CALL CONFIRMS IT, and reading the wrong key
// would make a whole batch report a gap that is not there. Same shape as RATING_TYPES in score.ts:
// widen WHERE we look, never loosen what counts as measured.

eq("category reads from `category`", readPrimaryCategory({ category: "Med Spa" }), "Med Spa");
eq("or `primary_category`", readPrimaryCategory({ primary_category: "Med Spa" }), "Med Spa");
eq("or `category_name`", readPrimaryCategory({ category_name: "Med Spa" }), "Med Spa");
eq("or the head of a string array", readPrimaryCategory({ categories: ["Med Spa", "Day Spa"] }), "Med Spa");
eq("or the head of an object array", readPrimaryCategory({ categories: [{ name: "Med Spa" }] }), "Med Spa");
eq("and a profile with none reads null", readPrimaryCategory({ total_photos: 3 }), null);

eq(
  "additional categories read from a string array",
  readAdditionalCategories({ additional_categories: ["A", "B"] }),
  ["A", "B"]
);
eq(
  "or from objects",
  readAdditionalCategories({ additional_categories: [{ title: "A" }, { name: "B" }] }),
  ["A", "B"]
);
eq(
  "or from one combined array minus the primary",
  readAdditionalCategories({ category: "Med Spa", categories: ["Med Spa", "Day Spa"] }),
  ["Day Spa"]
);

eq("a photo count reads as a number", readTotalPhotos({ total_photos: 12 }), 12);
eq("a comma-formatted string parses", readTotalPhotos({ total_photos: "1,204" }), 1204);
eq("an alternate spelling is read", readTotalPhotos({ photos_count: 7 }), 7);
eq("an absent count is null, never 0", readTotalPhotos({ category: "Med Spa" }), null);

eq(
  "services read from objects with a description",
  readServices({ services: [{ title: "Botox", description: "injections" }] }),
  [{ name: "Botox", snippet: "injections" }]
);
eq(
  "a bare string service has no snippet",
  readServices({ services: ["Botox"] }),
  [{ name: "Botox", snippet: null }]
);
eq("an absent services key reads NULL, not an empty array", readServices({ category: "x" }), null);
eq("an empty array reads as an empty array", readServices({ services: [] }), []);

// Only 2 of 5 services carry a snippet, so the component is a measured zero and says the ratio.
const thinServices = score({
  profile: profile({
    services: [
      { title: "Botox", description: "injections" },
      { title: "Filler", description: "volume" },
      { title: "Facial" },
      { title: "Peel" },
      { title: "Wax" },
    ],
  }),
});
eq("the services note carries the ratio", thinServices.components.services.note, "2 of 5 services described");
eq("and earns nothing below three", thinServices.components.services.earned, 0);

// ── 9b. the LIVE profile shape, confirmed against the account 2026-08-28 ────────────────────────
//
// Every field name below was a guess until this call. This fixture is the real my_business_info
// response for cid:2735628611391785789 ("The Skin Bar QC", Matthews NC), trimmed. It is here so a
// later "cleanup" of the readers has to break a real payload rather than a hand-written one.

const LIVE_PROFILE: GbpProfile = {
  title: "The Skin Bar QC",
  category: "Medical spa",
  additional_categories: ["Eyebrow bar", "Eyelash salon", "Laser hair removal service", "Spa", "Tanning salon"],
  description:
    "The Skin Bar QC is a premier medical spa in Matthews, NC, offering personalized skin care, injectables, and advanced aesthetic treatments.",
  total_photos: 15,
  // ‼️ `snippet` AT THE ROOT IS THE ADDRESS, NOT A DESCRIPTION. See readDescription.
  snippet: "101 E Matthews St #200, Matthews, NC 28105",
  address: "101 E Matthews St #200, Matthews, NC 28105",
  address_info: { city: "Matthews", region: "North Carolina", zip: "28105" },
  url: "http://www.theskinbarqc.com/",
  cid: "2735628611391785789",
  place_id: "ChIJsZmXrzglVIgRPQtnY7rn9iU",
  // Every service really does carry a `snippet` key, and this business really has filled in none.
  services: [
    { category: "Medical Spa", title: "BOTOX treatments", snippet: null, price: null },
    { category: "Medical Spa", title: "Chemical peels", snippet: null, price: null },
    { category: "Medical Spa", title: "Dermaplaning", snippet: null, price: null },
  ],
};

eq("the live category reads", readPrimaryCategory(LIVE_PROFILE), "Medical spa");
eq("the live additional categories read", readAdditionalCategories(LIVE_PROFILE).length, 5);
eq("the live photo count reads", readTotalPhotos(LIVE_PROFILE), 15);
eq("the live services read, with their null snippets intact", readServices(LIVE_PROFILE), [
  { name: "BOTOX treatments", snippet: null },
  { name: "Chemical peels", snippet: null },
  { name: "Dermaplaning", snippet: null },
]);

// ‼️ THE ADDRESS MUST NEVER BE READ AS THE DESCRIPTION. `snippet` held the street address on the
// live profile. A business with no `description` would otherwise have its address scored as its
// GBP copy, and an address always carries the city and never the category, so it would manufacture
// "description names the city, not the category" for every one of them.
check(
  "the real description is read",
  (readDescription(LIVE_PROFILE) ?? "").startsWith("The Skin Bar QC is a premier")
);
eq(
  "and a profile with NO description reads null rather than falling back to the address",
  readDescription({ snippet: "101 E Matthews St #200, Matthews, NC 28105" }),
  null
);

// 33 services listed and none described is a MEASURED zero and a real pitch line, not a gap in our
// reading: the `snippet` key exists on every service object and this business left them all empty.
const liveScore = scoreOptimization({
  serp: { ...SERP, category: null, city: null, description: null, cidSource: "local_pack" },
  profile: LIVE_PROFILE,
  page: { crawled: true, title: "The Skin Bar | Enhance Your Natural Beauty", h1: null },
});
check("undescribed services are a MEASURED zero", liveScore.components.services.attempted);
eq("and earn nothing", liveScore.components.services.earned, 0);
eq("the live business scores 65", liveScore.score, 65);
eq("off all six components", liveScore.measured, "6 of 6");

// ── 10. the verdict strings ─────────────────────────────────────────────────────────────────────
//
// These strings ARE the CSV cells, so a reader has to be able to see why a business scored badly
// without opening anything else.

const allNotes: string[] = [];
for (const r of [full, twoPhotos, noProfile, nothing, halfDescription, refused, thinServices, emptyServices]) {
  for (const key of OPTIMIZATION_KEY_ORDER) allNotes.push(r.components[key].note);
}
check("no note is empty", allNotes.every((n) => n.trim().length > 0));
check("no note contains a newline", allNotes.every((n) => !n.includes("\n")));
check(
  "no note runs past 60 characters",
  allNotes.every((n) => n.length <= 60),
  allNotes.filter((n) => n.length > 60).join(" | ")
);
check("no note carries an em dash", allNotes.every((n) => !n.includes("—")));
for (const r of [full, twoPhotos, noProfile, nothing, halfDescription, refused]) {
  for (const key of OPTIMIZATION_KEY_ORDER) {
    const c = r.components[key];
    if (c.attempted) continue;
    check(
      "every unmeasured note begins 'not measured': " + key,
      c.note.startsWith("not measured: "),
      c.note
    );
  }
}

// ── 11. what is NOT measured, and must not be ───────────────────────────────────────────────────
//
// ‼️ Google STRIPS EXIF on upload, "quality" is a judgement rather than an observation, and a plan
// to post next month is a plan rather than a state. They carry no weight and no denominator. The
// card prints them so their absence is never mistaken for a low score.

eq("there are exactly three unverifiable items", UNVERIFIABLE.length, 3);
check("none of them is a component", UNVERIFIABLE.every((u) => !(OPTIMIZATION_KEY_ORDER as string[]).includes(u)));
check(
  "the EXIF one says Google strips it",
  UNVERIFIABLE.some((u) => u.toLowerCase().includes("exif") && u.toLowerCase().includes("strip"))
);

// ── 12. the batch gap tally ─────────────────────────────────────────────────────────────────────
//
// ‼️ THE DENOMINATOR IS ATTEMPTED ROWS, NOT BATCH SIZE. "2 of 3" has to mean "of the profiles we
// could look at", or the headline number quietly becomes a statement about how many lookups failed.

const gaps = countGaps([twoPhotos, thinServices, noProfile, nothing]);
const photoGap = gaps.find((g) => g.key === "photos");
eq("photos was measurable on the two rows that had a profile", photoGap?.measured, 2);
eq("and failed on one of them", photoGap?.missing, 1);
const primaryGap = gaps.find((g) => g.key === "primary_category");
eq("primary_category was measurable on three rows, not four", primaryGap?.measured, 3);
check("the tally is sorted most-missing first", gaps[0].missing >= gaps[gaps.length - 1].missing);

// A tie breaks on OPTIMIZATION_KEY_ORDER, so two identical batches print the same list.
const tied = countGaps([twoPhotos, thinServices]);
const tiedKeys = tied.filter((g) => g.missing === 1).map((g) => g.key);
eq("a tie is broken by the declared order", tiedKeys, ["photos", "services"]);

// ── 13. the CSV ─────────────────────────────────────────────────────────────────────────────────

const HEADERS = ["Company", "Website", "services", "photos"];
const csvBoth = buildScoredCsv(
  HEADERS,
  [
    {
      raw: { Company: "Skin Bar", Website: "theskinbarqc.com", services: "KEEP ME", photos: "MINE TOO" },
      score: 71,
      measured: "6 of 6",
      optimization: 85,
      optimizationMeasured: "6 of 6",
      optNotes: { photos: "2 photos", services: "3 of 3 services described" },
    },
    {
      raw: { Company: "Nowhere", Website: "", services: "", photos: "" },
      score: null,
      measured: "not measured",
      optimization: null,
      optimizationMeasured: "not measured",
      optNotes: {},
    },
  ],
  "both"
);
const parsedBoth = parseCsv(csvBoth);

for (const h of HEADERS) {
  check("scored.csv keeps the original column " + h, parsedBoth.headers.includes(h));
}
eq(
  "it appends the three dominance columns then the eight optimization ones",
  parsedBoth.headers.slice(HEADERS.length),
  ["rank", "dominance_score", "score_measured", "optimization_score", "optimization_measured", ...OPTIMIZATION_CSV_COLUMNS]
);
eq("there are six opt_ component columns", OPTIMIZATION_CSV_COLUMNS.length, 6);

// ‼️ THE `opt_` PREFIX IS NOT DECORATION. `toCsv` is header-keyed and the row spreads `...raw`
// first, so a source file carrying a column literally named `services` or `photos` would have its
// own value silently overwritten by ours. Apollo and Outscraper exports really do carry both.
eq("a source column named `services` keeps ITS value", parsedBoth.rows[0].services, "KEEP ME");
eq("a source column named `photos` keeps ITS value", parsedBoth.rows[0].photos, "MINE TOO");
eq("and our verdict lands in the prefixed column", parsedBoth.rows[0].opt_services, "3 of 3 services described");
eq("the second verdict too", parsedBoth.rows[0].opt_photos, "2 photos");

eq("the optimization score prints", parsedBoth.rows[0].optimization_score, "85");
eq("an unmeasured optimization row says so", parsedBoth.rows[1].optimization_score, "not measured");
eq("the dominance rank still counts dominance alone", parsedBoth.rows[0].rank, "1");
eq("and an unmeasured dominance row still gets a BLANK rank", parsedBoth.rows[1].rank, "");

// The narrow shape is unchanged, which is what keeps _probe-score.ts at 107 without being edited.
const csvNarrow = buildScoredCsv(HEADERS, [
  { raw: { Company: "Skin Bar", Website: "x.com", services: "a", photos: "b" }, score: 71, measured: "6 of 6" },
]);
eq(
  "the default still appends exactly three columns",
  parseCsv(csvNarrow).headers.slice(HEADERS.length),
  ["rank", "dominance_score", "score_measured"]
);

// ── 14. the cutoff gains a second axis ──────────────────────────────────────────────────────────
//
// ‼️ THE SORT IS UNCHANGED AND IS DOMINANCE ALONE. An optimization cut is a PREDICATE over a file
// sorted by something else, so it drops scattered rows rather than a prefix.

eq("optimization > 70 parses", parseCutoff("optimization > 70"), {
  kind: "drop_optimization_above",
  score: 70,
});
eq("optimization < 40 parses", parseCutoff("optimization < 40"), {
  kind: "drop_optimization_below",
  score: 40,
});
eq("the dominance forms are untouched", parseCutoff("score > 60"), { kind: "drop_above_score", score: 60 });
eq("and score < 40 still reads as the same cut said backwards", parseCutoff("score < 40"), {
  kind: "drop_above_score",
  score: 39,
});

function orow(id: string, dominance: number | null, optimization: number | null): ScoredRow {
  return { id, company: "co-" + id, score: dominance, optimization };
}

// Sorted by DOMINANCE, so the optimization values are deliberately out of order.
const twoAxis = sortForCutoff(
  [orow("a", 90, 20), orow("b", 70, 95), orow("c", 50, 30), orow("d", 30, 80), orow("e", null, 90)],
  (r) => r.score
);
eq("the file is still ordered by dominance", twoAxis.map((r) => r.score), [90, 70, 50, 30, null]);

const optCut = applyCutoff(twoAxis, { kind: "drop_optimization_above", score: 70 });
eq("the plan names the axis it cut on", optCut.axis, "optimization");
eq("it drops the already-optimized, wherever they sit", optCut.dropped.map((r) => r.id), ["b", "d", "e"]);
eq("survivors keep file order", optCut.kept.map((r) => r.id), ["a", "c"]);
eq("the range is read off the OPTIMIZATION axis", [optCut.droppedLow, optCut.droppedHigh], [80, 95]);
check(
  "it is NOT a prefix cut: a dropped row sits below a kept one",
  optCut.dropped.some((d) => twoAxis.indexOf(d) > twoAxis.indexOf(optCut.kept[0]))
);

const belowCut = applyCutoff(twoAxis, { kind: "drop_optimization_below", score: 40 });
eq("the below form drops the other end", belowCut.dropped.map((r) => r.id), ["a", "c"]);

// ‼️ AN UNMEASURED OPTIMIZATION SCORE IS NEVER DROPPED, exactly as on the dominance axis.
const withUnmeasured = sortForCutoff([orow("x", 90, null), orow("y", 10, 95)], (r) => r.score);
const guarded = applyCutoff(withUnmeasured, { kind: "drop_optimization_above", score: 50 });
eq("only the measured row is dropped", guarded.dropped.map((r) => r.id), ["y"]);
eq("the unmeasured one is kept", guarded.kept.map((r) => r.id), ["x"]);
eq("and it is counted for the echo", guarded.keptUnmeasured, 1);
const belowGuard = applyCutoff(withUnmeasured, { kind: "drop_optimization_below", score: 50 });
eq("and an unmeasured row is not dropped by the below form either", belowGuard.dropped.length, 0);

// A row that never carried the field at all reads the same as null.
const noField = applyCutoff([{ id: "z", company: "z", score: 50 }], {
  kind: "drop_optimization_above",
  score: 10,
});
eq("a row with no optimization field is never dropped", noField.dropped.length, 0);

// The dominance plan still reports its own axis, so the echo card cannot mislabel it.
const domCut = applyCutoff(twoAxis, { kind: "drop_first", n: 2 });
eq("a dominance cut says dominance", domCut.axis, "dominance");
eq("and still slices the prefix", domCut.dropped.map((r) => r.id), ["a", "b"]);

console.log("\n" + passed + " passed, " + failures.length + " failed");
if (failures.length) for (const f of failures) console.log("  FAIL " + f);
process.exit(failures.length ? 1 : 0);
