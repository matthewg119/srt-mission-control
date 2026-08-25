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
  /**
   * What it takes to actually CHANGE a listing here, and roughly how long one fix runs.
   *
   * Both live on the platform rather than on a client row because they are facts about the
   * platform: fixing a Google listing needs GBP manager access whoever the client is. The
   * citation cleanup list prints them so the work can be sequenced against what access we
   * have, instead of discovering halfway down the list that four of the fixes are blocked
   * on a login nobody has asked for yet.
   *
   * Optional, and an absent value prints as "unknown" rather than as a guess.
   */
  access?: string;
  minutes?: number;
  /**
   * What a person actually TYPES when they mean this platform, beyond the key and the label.
   *
   * The manual sweep is filed by posting a screenshot with the platform named in the message,
   * and nobody types "Google Business Profile" eighteen times. These are matched on word
   * boundaries alongside the key and the label. Kept here, next to the platform they belong to,
   * so there is still one list rather than a lookup table somewhere else that drifts.
   */
  aliases?: string[];
}
const nameCity = (a: { name: string; city: string }) => `${a.name} ${a.city}`;
const nameCityState = (a: { name: string; city: string; state: string }) =>
  `${a.name} ${a.city} ${a.state}`;

export const CORE_SIX: PresencePlatform[] = [
  {
    key: "google",
    aliases: ["gbp", "google business", "google business profile", "google maps", "google my business", "gmb"],
    label: "Google Business Profile",
    tier: "core_six",
    api: false,
    search: nameCityState,
    url: "https://www.google.com/maps",
    access: "GBP manager access on the client's Google Business Profile",
    minutes: 20,
    note: "Look for a SECOND listing at an old address. Duplicates are the finding that matters most here.",
  },
  {
    key: "apple",
    aliases: ["apple maps", "apple business connect", "business connect"],
    label: "Apple Maps",
    tier: "core_six",
    api: false,
    search: nameCity,
    url: "https://maps.apple.com",
    access: "Apple Business Connect account, claimed with the business phone",
    minutes: 25,
    note: "No search API and Apple Business Connect is claim-only. Manual, always.",
  },
  { key: "bing", label: "Bing Places", tier: "core_six", api: false, aliases: ["bing places", "bing maps"], search: nameCityState, url: "https://www.bing.com/maps", access: "Bing Places account, claimed by post or phone", minutes: 20 },
  { key: "yelp", label: "Yelp", tier: "core_six", api: false, aliases: ["yelp for business"], search: nameCityState, url: "https://www.yelp.com", access: "Yelp for Business login", minutes: 15 },
  {
    key: "realself",
    aliases: ["real self"],
    label: "RealSelf",
    tier: "core_six",
    api: false,
    search: nameCityState,
    url: "https://www.realself.com",
    access: "RealSelf provider account, or their support desk",
    minutes: 30,
    note: "Med spa specific. Often the only place a procedure-level review exists.",
  },
  { key: "facebook", label: "Facebook Page", tier: "core_six", api: false, aliases: ["fb", "facebook page", "meta page"], search: nameCity, url: "https://www.facebook.com", access: "Facebook Page admin", minutes: 15 },
];

export const EXTENDED: PresencePlatform[] = [
  { key: "foursquare", label: "Foursquare", tier: "extended", api: false, aliases: ["four square"], search: nameCityState, url: "https://foursquare.com", access: "Foursquare for Business claim", minutes: 20 },
  { key: "yellowpages", label: "Yellow Pages", tier: "extended", api: false, aliases: ["yellow pages", "yp"], search: nameCityState, url: "https://www.yellowpages.com", access: "YP account, or the free listing correction form", minutes: 15 },
  { key: "bbb", label: "BBB", tier: "extended", api: false, aliases: ["better business bureau"], search: nameCityState, url: "https://www.bbb.org", access: "BBB business login, or a written correction request", minutes: 25 },
  { key: "nextdoor", label: "Nextdoor", tier: "extended", api: false, aliases: ["next door"], search: nameCity, url: "https://nextdoor.com", access: "Nextdoor Business Page admin", minutes: 15 },
  { key: "manta", label: "Manta", tier: "extended", api: false, search: nameCityState, url: "https://www.manta.com", access: "Manta claim, email verification", minutes: 15 },
  { key: "healthgrades", label: "Healthgrades", tier: "extended", api: false, aliases: ["health grades"], search: nameCityState, url: "https://www.healthgrades.com", access: "Healthgrades provider claim, licence verification", minutes: 30 },
  {
    key: "npi",
    aliases: ["npi registry", "nppes"],
    label: "NPI Registry",
    tier: "extended",
    api: false,
    search: nameCityState,
    url: "https://npiregistry.cms.hhs.gov",
    access: "NPPES login. Changes here are a records update, not a listing edit",
    minutes: 30,
    note: "Only relevant where a licensed provider is named. Skip cleanly if the clinic has no NPI.",
  },
  { key: "chamber", label: "Local chamber of commerce", tier: "extended", api: false, aliases: ["chamber of commerce", "local chamber"], search: nameCity, url: "https://www.google.com/search", access: "Whoever at the chamber maintains the directory. Usually an email", minutes: 20 },
  { key: "mapquest", label: "MapQuest", tier: "extended", api: false, aliases: ["map quest"], search: nameCityState, url: "https://www.mapquest.com", access: "MapQuest is fed by its data partners, so this is a correction request", minutes: 15 },
  { key: "superpages", label: "Superpages", tier: "extended", api: false, aliases: ["super pages"], search: nameCityState, url: "https://www.superpages.com", access: "Superpages claim, shares an account with YP", minutes: 15 },
  { key: "hotfrog", label: "Hotfrog", tier: "extended", api: false, search: nameCityState, url: "https://www.hotfrog.com", access: "Hotfrog free claim, email verification", minutes: 10 },
  { key: "citysearch", label: "Citysearch", tier: "extended", api: false, aliases: ["city search"], search: nameCityState, url: "https://www.citysearch.com", access: "Citysearch correction form", minutes: 15 },
];

export const ALL_PLATFORMS: PresencePlatform[] = [...CORE_SIX, ...EXTENDED];

/** The count the Slack card and the step engine both quote. Eighteen. */
export const PLATFORM_COUNT = ALL_PLATFORMS.length;

export function platformByKey(key: string): PresencePlatform | undefined {
  return ALL_PLATFORMS.find((p) => p.key === key);
}

/**
 * The six that gate the manual sweep. The twelve extended are context and never block.
 *
 * ‼️ THIS IS NOT PLATFORM_COUNT AND THE TWO ARE NOT INTERCHANGEABLE. nap_sweep seeds all
 * EIGHTEEN rows and its verifier really does want eighteen. presence_sweep_manual closes on the
 * SIX, because the card has always described the extended tier as "context only. Findings, not
 * week-one cleanup", while the gate silently demanded all eighteen screenshots. Making the gate
 * agree with what the card already said is Matthew's call, 2026-08-24.
 */
export const CORE_SIX_KEYS: ReadonlySet<string> = new Set(CORE_SIX.map((p) => p.key));
export const CORE_SIX_COUNT = CORE_SIX.length;

/** A letter or a digit. What counts as being inside a word for the boundary check below. */
function isWordChar(c: string): boolean {
  return /[a-z0-9]/.test(c);
}

/**
 * Which platforms a Slack message NAMES. Pure, so the probe can test it without a database.
 *
 * ‼️ WORD BOUNDARIES, NEVER includes(). "yp" is an alias for Yellow Pages and appears inside
 * "type", "typical" and half a dozen other ordinary words. A substring match would attribute a
 * screenshot to a platform nobody mentioned, which is worse than not attributing it at all: the
 * whole point of this column is that the six the gate counts are the six that were filed.
 *
 * ‼️ RETURNING MORE THAN ONE IS A REAL ANSWER AND THE CALLER MUST NOT TAKE THE FIRST.
 * "couldn't find them on Bing so I googled it" names two platforms, and there is no honest way
 * to decide which of them the attached screenshot shows. The capture path treats a multi-match
 * as unattributed and says so in the thread, which is fixable in one message. Guessing is not.
 *
 * The markup strip is deliberately local rather than imported from research-intake.ts: that
 * module pulls in supabaseAdmin, and this file is imported by client components and by the
 * probe. It stays dependency-free.
 */
export function resolvePlatformsFromText(text: string): string[] {
  if (!text) return [];

  const plain = text
    // <https://x|label> and <https://x> — keep the label, drop the url, so a link to
    // yelp.com in a message about Google does not name Yelp.
    .replace(/<[^|>]+\|([^>]+)>/g, "$1")
    .replace(/<(?:https?|mailto):[^>]*>/g, " ")
    // Bare urls, same reason.
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[*_~`]/g, " ")
    .toLowerCase();

  const out: string[] = [];
  for (const p of ALL_PLATFORMS) {
    const needles = [p.key, p.label, ...(p.aliases ?? [])];
    const hit = needles.some((n) => {
      const needle = n.toLowerCase();
      let from = 0;
      for (;;) {
        const at = plain.indexOf(needle, from);
        if (at < 0) return false;
        const before = at === 0 ? " " : plain[at - 1];
        const after = plain[at + needle.length] ?? " ";
        if (!isWordChar(before) && !isWordChar(after)) return true;
        from = at + 1;
      }
    });
    if (hit) out.push(p.key);
  }
  return out;
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
