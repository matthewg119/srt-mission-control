// The nineteen platforms, in two tiers that are not the same thing.
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

/**
 * One address-bar shape that identifies this platform.
 *
 * ‼️ THIS IS ITS OWN FIELD BECAUSE `url` IS NOT A DOMAIN MAP AND DERIVING ONE FROM IT COLLIDES.
 *
 * `google`'s url is `google.com/maps` and `chamber`'s is `google.com/search`. `bing` is
 * `bing.com/maps` while a Bing WEB search is `bing.com`. A naive hostname map would file a
 * chamber-of-commerce screenshot as Google Business Profile, which is a green tick over a
 * platform nobody looked at.
 *
 * `host` matches the hostname exactly or as a suffix after a dot, so `www.` and `m.` need no
 * entries of their own. `pathPrefix`, where present, is REQUIRED rather than preferred.
 */
export interface PlatformDomain {
  host: string;
  pathPrefix?: string;
}

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
  /**
   * The address bar shapes that identify this platform.
   *
   * ‼️ ONE LIST. This sits next to `aliases` rather than in a lookup table somewhere else,
   * because the moment there are two lists they drift and a screenshot gets filed under a
   * platform nobody swept. See PlatformDomain above for why it is not derived from `url`.
   *
   * A platform with NO entry is unmappable from a screenshot, which is an honest answer and
   * not an omission. `chamber` is the worked example.
   */
  domains?: PlatformDomain[];
}
const nameCity = (a: { name: string; city: string }) => `${a.name} ${a.city}`;
const nameCityState = (a: { name: string; city: string; state: string }) =>
  `${a.name} ${a.city} ${a.state}`;

export const CORE_SIX: PresencePlatform[] = [
  {
    key: "google",
    aliases: ["gbp", "google business", "google business profile", "google maps", "google my business", "gmb"],
    // ‼️ `/maps` IS REQUIRED AND `google.com` ALONE IS NEVER THIS PLATFORM. A Google WEB search
    // is where `chamber` is swept, and a bare hostname match would file a chamber screenshot as
    // a Google Business Profile that nobody ever looked at.
    domains: [{ host: "google.com", pathPrefix: "/maps" }, { host: "maps.google.com" }],
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
    domains: [{ host: "maps.apple.com" }],
    label: "Apple Maps",
    tier: "core_six",
    api: false,
    search: nameCity,
    url: "https://maps.apple.com",
    access: "Apple Business Connect account, claimed with the business phone",
    minutes: 25,
    note: "No search API and Apple Business Connect is claim-only. Manual, always.",
  },
  { key: "bing", label: "Bing Places", tier: "core_six", api: false, aliases: ["bing places", "bing maps"], domains: [{ host: "bing.com", pathPrefix: "/maps" }], search: nameCityState, url: "https://www.bing.com/maps", access: "Bing Places account, claimed by post or phone", minutes: 20 },
  { key: "yelp", label: "Yelp", tier: "core_six", api: false, aliases: ["yelp for business"], domains: [{ host: "yelp.com" }], search: nameCityState, url: "https://www.yelp.com", access: "Yelp for Business login", minutes: 15 },
  {
    key: "realself",
    aliases: ["real self"],
    domains: [{ host: "realself.com" }],
    label: "RealSelf",
    tier: "core_six",
    api: false,
    search: nameCityState,
    url: "https://www.realself.com",
    access: "RealSelf provider account, or their support desk",
    minutes: 30,
    note: "Med spa specific. Often the only place a procedure-level review exists.",
  },
  { key: "facebook", label: "Facebook Page", tier: "core_six", api: false, aliases: ["fb", "facebook page", "meta page"], domains: [{ host: "facebook.com" }, { host: "fb.com" }], search: nameCity, url: "https://www.facebook.com", access: "Facebook Page admin", minutes: 15 },
];

export const EXTENDED: PresencePlatform[] = [
  { key: "foursquare", label: "Foursquare", tier: "extended", api: false, aliases: ["four square"], domains: [{ host: "foursquare.com" }], search: nameCityState, url: "https://foursquare.com", access: "Foursquare for Business claim", minutes: 20 },
  { key: "yellowpages", label: "Yellow Pages", tier: "extended", api: false, aliases: ["yellow pages", "yp"], domains: [{ host: "yellowpages.com" }], search: nameCityState, url: "https://www.yellowpages.com", access: "YP account, or the free listing correction form", minutes: 15 },
  { key: "bbb", label: "BBB", tier: "extended", api: false, aliases: ["better business bureau"], domains: [{ host: "bbb.org" }], search: nameCityState, url: "https://www.bbb.org", access: "BBB business login, or a written correction request", minutes: 25 },
  // ‼️ ADDED 2026-08-25, AND IT IS AN EXTENDED DIRECTORY, NOT A PROMOTION.
  // Matthew wants it among the four he is STEERED to (see RECOMMENDED_KEYS below), and those
  // are two different facts: the tier decides what week-one cleanup means in a document a
  // client reads, and a suggestion on a card decides nothing. Intake already collects it as
  // clients.review_destination_primary.
  { key: "trustpilot", label: "Trustpilot", tier: "extended", api: false, aliases: ["trust pilot"], domains: [{ host: "trustpilot.com" }], search: nameCity, url: "https://www.trustpilot.com", access: "Trustpilot business account, free profile claim", minutes: 20, note: "Often the review destination a client already sends people to. Check the profile is claimed." },
  { key: "nextdoor", label: "Nextdoor", tier: "extended", api: false, aliases: ["next door"], domains: [{ host: "nextdoor.com" }], search: nameCity, url: "https://nextdoor.com", access: "Nextdoor Business Page admin", minutes: 15 },
  { key: "manta", label: "Manta", tier: "extended", api: false, domains: [{ host: "manta.com" }], search: nameCityState, url: "https://www.manta.com", access: "Manta claim, email verification", minutes: 15 },
  { key: "healthgrades", label: "Healthgrades", tier: "extended", api: false, aliases: ["health grades"], domains: [{ host: "healthgrades.com" }], search: nameCityState, url: "https://www.healthgrades.com", access: "Healthgrades provider claim, licence verification", minutes: 30 },
  {
    key: "npi",
    aliases: ["npi registry", "nppes"],
    domains: [{ host: "npiregistry.cms.hhs.gov" }],
    label: "NPI Registry",
    tier: "extended",
    api: false,
    search: nameCityState,
    url: "https://npiregistry.cms.hhs.gov",
    access: "NPPES login. Changes here are a records update, not a listing edit",
    minutes: 30,
    note: "Only relevant where a licensed provider is named. Skip cleanly if the clinic has no NPI.",
  },
  // ‼️ NO `domains` ENTRY, DELIBERATELY, AND IT MUST NOT ACQUIRE ONE.
  // Its search surface IS a Google search page, so its address bar is indistinguishable from
  // any other Google search: google.com/search?q=... says nothing about which platform the
  // picture shows. Unmappable from a screenshot is the honest answer, and the same reasoning
  // applies to anything else whose surface is a general engine. It is still swept, still
  // attributable by NAME in the message, and still counts toward the gate when named.
  { key: "chamber", label: "Local chamber of commerce", tier: "extended", api: false, aliases: ["chamber of commerce", "local chamber"], search: nameCity, url: "https://www.google.com/search", access: "Whoever at the chamber maintains the directory. Usually an email", minutes: 20, note: "Its surface is a Google search page, so the address bar cannot identify it. This one always needs its name typed in the message." },
  { key: "mapquest", label: "MapQuest", tier: "extended", api: false, aliases: ["map quest"], domains: [{ host: "mapquest.com" }], search: nameCityState, url: "https://www.mapquest.com", access: "MapQuest is fed by its data partners, so this is a correction request", minutes: 15 },
  { key: "superpages", label: "Superpages", tier: "extended", api: false, aliases: ["super pages"], domains: [{ host: "superpages.com" }], search: nameCityState, url: "https://www.superpages.com", access: "Superpages claim, shares an account with YP", minutes: 15 },
  { key: "hotfrog", label: "Hotfrog", tier: "extended", api: false, domains: [{ host: "hotfrog.com" }], search: nameCityState, url: "https://www.hotfrog.com", access: "Hotfrog free claim, email verification", minutes: 10 },
  { key: "citysearch", label: "Citysearch", tier: "extended", api: false, aliases: ["city search"], domains: [{ host: "citysearch.com" }], search: nameCityState, url: "https://www.citysearch.com", access: "Citysearch correction form", minutes: 15 },
];

export const ALL_PLATFORMS: PresencePlatform[] = [...CORE_SIX, ...EXTENDED];

/** The count the Slack card and the step engine both quote. Nineteen since Trustpilot. */
export const PLATFORM_COUNT = ALL_PLATFORMS.length;

/**
 * How many DISTINCT platforms close the manual sweep, whatever tier they came from.
 *
 * ‼️ THIS IS THE GATE. `CORE_SIX` IS THE REMEDIATION TIER. THEY ARE DIFFERENT FACTS.
 *
 * Matthew: "instead of being core 6 make it core 4 also let it let me post the 6 of my
 * preference and dont force me to do those specifically." So the gate is any four distinct
 * platforms HE chooses, from all nineteen, and it is deliberately NOT a subset of the core six.
 *
 * `CORE_SIX` / `EXTENDED` are untouched by this and must stay untouched: citation-cleanup.ts
 * sorts core-six first and multiplies effort by it, presence-pdf.ts renders the two tiers
 * separately, and findings section 3 goes to the client. Cutting CORE_SIX to four would quietly
 * redefine what "week one cleanup" means in a document somebody reads.
 *
 * ‼️ IT COUNTS PLATFORMS, NEVER FILES. Every pasted Slack screenshot is called image.png, so
 * four shots of Yelp must not satisfy a four-platform gate. Four is a smaller number than six,
 * not a weaker rule.
 */
export const SWEEP_GATE_COUNT = 4;

/**
 * The four the card puts first.
 *
 * ‼️ A DISPLAY AND SUGGESTION CONCEPT. IT IS NOT A TIER, and nothing in citation-cleanup.ts or
 * presence-pdf.ts may read it: a client-facing document that treated "recommended" as a
 * severity would be inventing a third tier out of a card's running order.
 *
 * Matthew: "for the presence consistency make this options as the default and most important
 * ones and all of the rest you can leave the list with alll of them but are secondary."
 */
export const RECOMMENDED_KEYS: readonly string[] = ["google", "yelp", "trustpilot", "bbb"];

/** The recommended four as platform records, in the order Matthew named them. */
export const RECOMMENDED: PresencePlatform[] = RECOMMENDED_KEYS.map(
  (k) => ALL_PLATFORMS.find((p) => p.key === k)
).filter((p): p is PresencePlatform => Boolean(p));

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
 * Which platform an ADDRESS BAR names. Pure, so the probe can test it without a database.
 *
 * ‼️ TEXT FIRST, THIS SECOND. resolvePlatformsFromText above stays first and stays unchanged.
 * A URL cannot be misread; a screenshot can. The same ordering src/lib/call-coach/
 * resolve-target.ts records for the same shape of problem: vision confirms, it does not decide.
 *
 * Tolerant about what it is handed, because what it is handed is a model transcribing pixels:
 * a missing scheme, a trailing space, mixed case and a bare host are all normal. It is NOT
 * tolerant about what it concludes.
 *
 * ‼️ RETURNING MORE THAN ONE IS A REAL ANSWER AND THE CALLER MUST NOT TAKE THE FIRST, exactly
 * as with the text resolver. Zero matches and two matches are the same answer: nobody could
 * tell, so nothing is attributed and the thread says so.
 *
 * MOST SPECIFIC FIRST. Where two platforms could match one URL they are on the same host by
 * definition, so the longer host and then the longer pathPrefix wins, and only the winners are
 * returned. Where a host is shared, a pathPrefix is REQUIRED rather than preferred: an entry
 * with no path cannot win a host somebody else has claimed a path on.
 */
export function resolvePlatformFromUrl(url: string): string[] {
  const parsed = splitUrl(url);
  if (!parsed) return [];
  const { host, path } = parsed;

  // Hosts claimed by more than one platform. On those, a bare host entry never matches.
  const claims = new Map<string, number>();
  for (const p of ALL_PLATFORMS) {
    for (const d of p.domains ?? []) claims.set(d.host, (claims.get(d.host) ?? 0) + 1);
  }

  type Hit = { key: string; hostLen: number; pathLen: number };
  const hits: Hit[] = [];

  for (const p of ALL_PLATFORMS) {
    for (const d of p.domains ?? []) {
      if (!hostMatches(host, d.host)) continue;
      const shared = (claims.get(d.host) ?? 0) > 1;
      if (!d.pathPrefix) {
        if (shared) continue;
        hits.push({ key: p.key, hostLen: d.host.length, pathLen: 0 });
        continue;
      }
      if (!pathMatches(path, d.pathPrefix.toLowerCase())) continue;
      hits.push({ key: p.key, hostLen: d.host.length, pathLen: d.pathPrefix.length });
    }
  }

  if (hits.length === 0) return [];

  const best = hits.reduce((a, b) =>
    b.hostLen > a.hostLen || (b.hostLen === a.hostLen && b.pathLen > a.pathLen) ? b : a
  );
  const winners = new Set(
    hits
      .filter((h) => h.hostLen === best.hostLen && h.pathLen === best.pathLen)
      .map((h) => h.key)
  );

  // ALL_PLATFORMS order, so two matches are reported the same way every time.
  return ALL_PLATFORMS.filter((p) => winners.has(p.key)).map((p) => p.key);
}

/** `sub.example.com` matches `example.com`; `notexample.com` does not. */
function hostMatches(host: string, want: string): boolean {
  return host === want || host.endsWith(`.${want}`);
}

/**
 * A prefix has to end at a segment boundary. `/maps` must not match `/mapsomething`, and
 * `/maps?q=x` and `/maps` are the same page.
 */
function pathMatches(path: string, prefix: string): boolean {
  if (!path.startsWith(prefix)) return false;
  const next = path.charAt(prefix.length);
  return next === "" || next === "/" || next === "?" || next === "#";
}

/**
 * Host and path out of whatever a model transcribed. Returns null rather than guessing.
 *
 * new URL() is deliberately not used as the only path: it throws on `google.com/maps`, which
 * is a perfectly legible address bar in a screenshot of Chrome, where the scheme is hidden.
 */
function splitUrl(input: string): { host: string; path: string } | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;

  const withoutScheme = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const cut = withoutScheme.search(/[/?#]/);
  const hostPart = (cut < 0 ? withoutScheme : withoutScheme.slice(0, cut)).trim();
  const rest = cut < 0 ? "" : withoutScheme.slice(cut);

  const host = hostPart
    .replace(/^[^@]*@/, "")
    .replace(/:\d+$/, "")
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/\.$/, "");

  // A hostname with no dot is not a website, it is a word the model read off a tab.
  if (!host || !host.includes(".") || /\s/.test(host)) return null;

  const path = rest.startsWith("/") ? rest.toLowerCase() : `/${rest.toLowerCase()}`;
  return { host, path: path === "/" ? "/" : path.replace(/\/+$/, "") || "/" };
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
