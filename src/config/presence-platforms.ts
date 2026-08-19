// The eighteen platforms, in two tiers that are not the same thing.
//
// Runner v3 section 6: "Two tiers, and they are NOT the same thing. Do not blur them."
//
//   CORE SIX  — the findings gate, and the only tier remediated in week one.
//   EXTENDED  — informational. Tells us where they stand on presence consistency. Anything
//               broken here goes on the implementation list, NOT the week-one cleanup list.
//
// Every artifact must show which tier a finding came from. A core-six mismatch and a Manta
// mismatch are not equivalent and a client-facing document must not imply they are.
//
// ‼️ NO PROVIDER IS KEYED. Google Places, Bing Maps, Foursquare and Yelp Fusion were all
// checked on 2026-08-18 and none has a key in this environment. So `api: false` everywhere and
// the whole sweep is manual: a human searches the string below, screenshots what they see, and
// replying in the thread files it. `api` exists to describe reality, not aspiration — the day a
// key lands, flip one flag rather than rediscovering which platforms even have an API.
//
// ‼️ ONE VERTICAL. med_spa only, per CONSTRAINTS. RealSelf, Healthgrades and the NPI Registry
// are med_spa rows. Do not build a second vertical's list speculatively.

export type PresenceTier = "core_six" | "extended";

export interface PresencePlatform {
  /** Stable slug. This is what lands in nap_discrepancies.platform, so it never gets reworded. */
  key: string;
  label: string;
  tier: PresenceTier;
  /** Whether an official API exists AND is keyed here. Today: never. */
  api: boolean;
  /**
   * How the search string is composed. Runner v3 section 3 is emphatic: never "check the
   * listing", always the exact string to paste. A vague instruction gets a vague sweep.
   */
  search: (args: { name: string; city: string; state: string }) => string;
  /** Where to run that search. Printed on the card so nobody has to go looking. */
  url: string;
  /** Why this platform is worth a human's five minutes, for the card. */
  note?: string;
}

const nameCity = (a: { name: string; city: string }) => `${a.name} ${a.city}`;
const nameCityState = (a: { name: string; city: string; state: string }) =>
  `${a.name} ${a.city} ${a.state}`;

export const CORE_SIX: PresencePlatform[] = [
  {
    key: "google",
    label: "Google Business Profile",
    tier: "core_six",
    api: false,
    search: nameCityState,
    url: "https://www.google.com/maps",
    note: "Look for a SECOND listing at an old address. Duplicates are the finding that matters most here.",
  },
  {
    key: "apple",
    label: "Apple Maps",
    tier: "core_six",
    api: false,
    search: nameCity,
    url: "https://maps.apple.com",
    note: "No search API and Apple Business Connect is claim-only. Manual, always.",
  },
  { key: "bing", label: "Bing Places", tier: "core_six", api: false, search: nameCityState, url: "https://www.bing.com/maps" },
  { key: "yelp", label: "Yelp", tier: "core_six", api: false, search: nameCityState, url: "https://www.yelp.com" },
  {
    key: "realself",
    label: "RealSelf",
    tier: "core_six",
    api: false,
    search: nameCityState,
    url: "https://www.realself.com",
    note: "Med spa specific. Often the only place a procedure-level review exists.",
  },
  { key: "facebook", label: "Facebook Page", tier: "core_six", api: false, search: nameCity, url: "https://www.facebook.com" },
];

export const EXTENDED: PresencePlatform[] = [
  { key: "foursquare", label: "Foursquare", tier: "extended", api: false, search: nameCityState, url: "https://foursquare.com" },
  { key: "yellowpages", label: "Yellow Pages", tier: "extended", api: false, search: nameCityState, url: "https://www.yellowpages.com" },
  { key: "bbb", label: "BBB", tier: "extended", api: false, search: nameCityState, url: "https://www.bbb.org" },
  { key: "nextdoor", label: "Nextdoor", tier: "extended", api: false, search: nameCity, url: "https://nextdoor.com" },
  { key: "manta", label: "Manta", tier: "extended", api: false, search: nameCityState, url: "https://www.manta.com" },
  { key: "healthgrades", label: "Healthgrades", tier: "extended", api: false, search: nameCityState, url: "https://www.healthgrades.com" },
  {
    key: "npi",
    label: "NPI Registry",
    tier: "extended",
    api: false,
    search: nameCityState,
    url: "https://npiregistry.cms.hhs.gov",
    note: "Only relevant where a licensed provider is named. Skip cleanly if the clinic has no NPI.",
  },
  { key: "chamber", label: "Local chamber of commerce", tier: "extended", api: false, search: nameCity, url: "https://www.google.com/search" },
  { key: "mapquest", label: "MapQuest", tier: "extended", api: false, search: nameCityState, url: "https://www.mapquest.com" },
  { key: "superpages", label: "Superpages", tier: "extended", api: false, search: nameCityState, url: "https://www.superpages.com" },
  { key: "hotfrog", label: "Hotfrog", tier: "extended", api: false, search: nameCityState, url: "https://www.hotfrog.com" },
  { key: "citysearch", label: "Citysearch", tier: "extended", api: false, search: nameCityState, url: "https://www.citysearch.com" },
];

export const ALL_PLATFORMS: PresencePlatform[] = [...CORE_SIX, ...EXTENDED];

/** The count the Slack card and the step engine both quote. Eighteen. */
export const PLATFORM_COUNT = ALL_PLATFORMS.length;

export function platformByKey(key: string): PresencePlatform | undefined {
  return ALL_PLATFORMS.find((p) => p.key === key);
}

/**
 * ‼️ EXCLUDED FROM THE COMPETITOR SHORTLIST, NOT FROM THE SWEEP. Integrity Law 7.
 *
 * When an engine answers "the best med spa near me" with Yelp, Groupon or a "10 Best Med Spas
 * in Greensboro" listicle, that is a CONSENSUS LOCK — the engine leaning on an aggregator
 * because no single business is clearly established. It is not a competitor, and putting it on
 * a shortlist would send Matthew to Google an aggregator before the call and would make
 * "competitors named instead of you" mean two different things in one sentence.
 *
 * National chains are excluded for the same structural reason: a clinic in Greensboro does not
 * compete with a franchise's national page, and no local remediation moves it.
 */
export const AGGREGATOR_PATTERNS: RegExp[] = [
  /\byelp\b/i,
  /\bgroupon\b/i,
  /\bthumbtack\b/i,
  /\bangi\b|\bangie'?s list\b/i,
  /\bhealthgrades\b/i,
  /\brealself\b/i,
  /\bvagaro\b/i,
  /\bbooksy\b/i,
  /\bstylese?at\b/i,
  /\btripadvisor\b/i,
  /\bfacebook\b|\binstagram\b|\btiktok\b/i,
  /\bgoogle\b|\bbing\b|\bapple maps\b/i,
  /\breddit\b|\bquora\b/i,
  /\bwikipedia\b/i,
  /\b\d+\s+best\b|\btop\s+\d+\b|\bbest\s+\d+\b/i,
  /\bnear me\b/i,
  /\bdirectory\b|\blistings?\b/i,
];

export const NATIONAL_CHAIN_PATTERNS: RegExp[] = [
  /\bideal image\b/i,
  /\bsona\s?med\s?spa\b/i,
  /\bmilan laser\b/i,
  /\blaseraway\b/i,
  /\bsev laser\b/i,
  /\bskinspirit\b/i,
  /\bewellness\b/i,
  /\bmassage envy\b/i,
  /\bsono bello\b/i,
  /\bathletico\b/i,
  /\bamerican laser\b/i,
];

/**
 * Is this name a real local competitor, or a lock?
 *
 * Deliberately conservative in ONE direction: it would rather keep a borderline name on the
 * shortlist than drop a genuine competitor, because Matthew Googles each of the ten before
 * picking three and a false positive costs him ten seconds. A false negative costs a competitor
 * that never appears anywhere in the findings.
 */
export function isExcludedFromShortlist(name: string): { excluded: boolean; reason?: string } {
  if (AGGREGATOR_PATTERNS.some((p) => p.test(name))) {
    return { excluded: true, reason: "aggregator or listicle, not a competitor" };
  }
  if (NATIONAL_CHAIN_PATTERNS.some((p) => p.test(name))) {
    return { excluded: true, reason: "national chain" };
  }
  return { excluded: false };
}
