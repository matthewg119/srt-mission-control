// Turning an Instagram profile into something the audit engine can scan.
//
// The extension scrapes the profile and posts it here. Everything in this file is about the gap
// between what a profile says and what runHookCheck() needs: a business name, a city, a first name
// to greet, and above all a WEBSITE, because the hook lane is written from their own pages.
//
// ‼️ EVERY FUNCTION HERE RETURNS NULL RATHER THAN A GUESS. A bio is free text written by the
// business, so the failure mode of a clever parser is not "no answer", it is a confident wrong
// answer: a city read out of a hashtag, a first name read out of a brand word, a website read out
// of a booking link. Downstream, that wrong answer is pinned into the classifier as an override
// and every alias, mention match and greeting is built on top of it. Null is recoverable, because
// the panel simply asks Matthew. A wrong value is not, because nothing downstream knows to ask.

import {
  AGGREGATOR_HOSTS,
  hostOf,
  isAggregatorHost,
  isNeverTheirSite,
} from "@/lib/audit-engine/web-hosts";
import { callClaudeJSON } from "@/lib/claude-calls";

/** `@Hairthetics_FL`, a profile URL, or a bare handle -> `hairthetics_fl`. */
export function normalizeHandle(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s) return null;

  // A full profile URL, with or without protocol, with or without query junk.
  const m = s.match(/(?:^|\/\/)(?:www\.)?instagram\.com\/([^/?#]+)/i);
  if (m) s = m[1];

  s = s.replace(/^@/, "").replace(/\/+$/, "").trim().toLowerCase();

  // Instagram's own rules: letters, digits, periods and underscores, 30 max. Anything else means
  // we were handed a page path (/direct/, /explore/) rather than a handle.
  if (!/^[a-z0-9._]{1,30}$/.test(s)) return null;
  if (RESERVED_PATHS.has(s)) return null;
  return s;
}

/** Instagram paths that look like handles in a URL but are not profiles. */
const RESERVED_PATHS = new Set([
  "direct", "explore", "reels", "reel", "stories", "p", "accounts", "about",
  "developer", "legal", "privacy", "terms", "your_activity", "challenge",
]);

/**
 * The first name to greet, or null.
 *
 * ‼️ NULL IS THE COMMON AND CORRECT ANSWER. An Instagram display name is a marketing field: it is
 * "Hairthetics | Hair & Ear Surgery FL" at least as often as it is a person. Greeting a clinic by
 * a word lifted out of its brand is worse than not greeting it at all, and draftDmVariants already
 * writes a perfectly good opener with no name. So this only answers when what it is looking at
 * really does look like a person's name.
 */
export function firstNameFrom(fullName: string | null | undefined): string | null {
  if (!fullName) return null;

  // Take the first segment only. "Han MD, PHD. Hairthetics | Hair & Ear Surgery FL" is four
  // different things joined by punctuation, and only the first can be a person.
  const head = String(fullName)
    .split(/[|/·•\-–—]|,|\.(?=\s)/)[0]
    .trim();
  if (!head) return null;

  const words = head.split(/\s+/).filter(Boolean);
  // ‼️ A ONE-WORD SEGMENT IS A BRAND, NOT A PERSON, and this is the check that decides it.
  // "Hairthetics" and "Sarah" are indistinguishable to a parser; a person's display name almost
  // always carries a surname or a credential after the first name ("Sarah Whitfield", "Han MD"),
  // and a brand almost never does. Refusing the single-word case costs a greeting on the rare
  // mononym and prevents opening a cold DM with "Hey Hairthetics," which is the tell that the
  // message was generated. Erring toward no greeting is free: draftDmVariants writes a good
  // opener without one.
  if (words.length < 2) return null;

  const first = stripNonName(words[0]);
  if (!first) return null;

  // A brand word, a service word, or a credential is not a first name.
  if (CREDENTIALS.has(first.toLowerCase())) return null;
  if (NOT_A_FIRST_NAME.test(first)) return null;
  // Real first names are letters, optionally hyphenated or apostrophed, and are not shouted.
  if (!/^[A-Za-z][A-Za-z'-]{1,19}$/.test(first)) return null;
  if (first.length < 2) return null;
  if (first === first.toUpperCase() && first.length > 3) return null;

  return first[0].toUpperCase() + first.slice(1);
}

function stripNonName(w: string): string {
  return w.replace(/^[^A-Za-z]+/, "").replace(/[^A-Za-z'-]+$/, "");
}

const CREDENTIALS = new Set([
  "dr", "doctor", "md", "do", "phd", "dds", "dmd", "rn", "np", "pa", "dpt", "lpn",
  "crna", "facs", "faad", "mba", "esq", "cpa", "lmt", "rd",
]);

/** Words that appear first in a display name and are never the person. */
const NOT_A_FIRST_NAME =
  /^(the|team|studio|clinic|center|centre|salon|spa|med|medspa|aesthetics?|beauty|hair|skin|laser|body|wellness|health|dental|derm|official|your|best|top|premier|elite|luxe|luxury|new|my)$/i;

/**
 * The city and state named in a bio, or null.
 *
 * ‼️ A HINT ONLY. It is passed to classifyBusiness as `city`, which already prefers what it reads
 * off the pages it crawled, and the crawl is the better source: a bio can carry a franchise HQ, a
 * second location or a hashtag. This exists because the no-website lane has no crawl to prefer,
 * and because a correct city noticeably improves the four questions the hook actually asks.
 *
 * Matches a US "City, ST" or "City, State Name" pair, which is what an address line in a bio looks
 * like. Anything more ambitious would start reading cities out of prose.
 */
export function cityFromBio(bio: string | null | undefined): string | null {
  if (!bio) return null;

  // ‼️ THE STATE IS MATCHED LOOSELY AND VALIDATED IN CODE, rather than by building a fifty-branch
  // alternation into the pattern. The alternation version was case-sensitive against a lowercase
  // key list, so "Hallandale Beach, Florida" silently returned null while "Austin, TX" worked:
  // the kind of half-working parser that is worse than none, because the failure looks like "this
  // bio had no address". Matching any capitalised word or two-letter code and then checking it
  // against the table below cannot drift that way.
  const re = /([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3})\s*,\s*([A-Za-z]{2}|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g;

  for (const m of bio.matchAll(re)) {
    const raw = m[2].trim();
    const abbr = STATE_ABBR.has(raw.toUpperCase())
      ? raw.toUpperCase()
      : STATE_NAMES.get(raw.toLowerCase()) ?? null;
    if (!abbr) continue;

    // The city capture runs backwards into the preceding words of an address line
    // ("601 N Federal Hwy Suite 411, Hallandale Beach"). Keep the tail, which is the city.
    const city = trimAddressPrefix(m[1].trim().replace(/\s+/g, " "));
    if (city) return `${city}, ${abbr}`;
  }
  return null;
}

/** "Suite 411 Hallandale Beach" -> "Hallandale Beach". Drops street-address words. */
function trimAddressPrefix(city: string): string | null {
  const words = city.split(/\s+/);
  const stop = /^(suite|ste|unit|apt|floor|fl|#|road|rd|street|st|ave|avenue|blvd|boulevard|hwy|highway|drive|dr|lane|ln|way|pkwy|parkway|court|ct|place|pl|n|s|e|w|ne|nw|se|sw)$/i;
  let start = 0;
  for (let i = 0; i < words.length; i++) {
    if (stop.test(words[i].replace(/[.,]/g, "")) || /\d/.test(words[i])) start = i + 1;
  }
  const out = words.slice(start).join(" ").trim();
  return out.length >= 3 ? out : null;
}

const STATE_NAMES = new Map<string, string>([
  ["alabama", "AL"], ["alaska", "AK"], ["arizona", "AZ"], ["arkansas", "AR"], ["california", "CA"],
  ["colorado", "CO"], ["connecticut", "CT"], ["delaware", "DE"], ["florida", "FL"], ["georgia", "GA"],
  ["hawaii", "HI"], ["idaho", "ID"], ["illinois", "IL"], ["indiana", "IN"], ["iowa", "IA"],
  ["kansas", "KS"], ["kentucky", "KY"], ["louisiana", "LA"], ["maine", "ME"], ["maryland", "MD"],
  ["massachusetts", "MA"], ["michigan", "MI"], ["minnesota", "MN"], ["mississippi", "MS"],
  ["missouri", "MO"], ["montana", "MT"], ["nebraska", "NE"], ["nevada", "NV"],
  ["new hampshire", "NH"], ["new jersey", "NJ"], ["new mexico", "NM"], ["new york", "NY"],
  ["north carolina", "NC"], ["north dakota", "ND"], ["ohio", "OH"], ["oklahoma", "OK"],
  ["oregon", "OR"], ["pennsylvania", "PA"], ["rhode island", "RI"], ["south carolina", "SC"],
  ["south dakota", "SD"], ["tennessee", "TN"], ["texas", "TX"], ["utah", "UT"], ["vermont", "VT"],
  ["virginia", "VA"], ["washington", "WA"], ["west virginia", "WV"], ["wisconsin", "WI"],
  ["wyoming", "WY"],
]);

const STATE_ABBR = new Set([...STATE_NAMES.values()]);

// ─────────────────────────────────────────────────────────────────────────────
// The bio link
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hosts that are never the business's own website.
 *
 * ‼️ THE LISTS THEMSELVES NOW LIVE IN audit-engine/web-hosts.ts, because mention-match.ts needs
 * the same answer and did not have it. This lane used to be the only holder of the knowledge that
 * threads.com is not a website, so buildAliases went on turning such a link into the alias
 * "threads" and matching it against every answer that mentioned a thread lift.
 */
export function isAggregator(url: string): boolean {
  return isAggregatorHost(url);
}

/** Instagram wraps outbound bio links as l.instagram.com/?u=<encoded>. Unwrap to the real URL. */
export function unwrapInstagramLink(url: string | null | undefined): string | null {
  if (!url) return null;
  const raw = String(url).trim();
  if (!raw) return null;
  try {
    const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    if (/^(l|lm)\.instagram\.com$/i.test(u.hostname)) {
      const inner = u.searchParams.get("u");
      return inner ? decodeURIComponent(inner) : null;
    }
    return u.toString();
  } catch {
    return null;
  }
}

export interface ResolvedLink {
  /** The site to scan, or null when nothing usable was found. */
  website: string | null;
  /** Why, in one line, for the panel to show when it asks Matthew to type one. */
  note: string;
}

/**
 * Work out which URL, if any, the hook lane should be pointed at.
 *
 * ‼️ IT WOULD RATHER RETURN NULL THAN A LINKTREE. Handing an aggregator to researchWebsite means
 * classifying the aggregator: the trade comes back as something like "link in bio landing page",
 * and that phrase then goes into the fixed finding sentence and into a stranger's DM. The panel
 * asking Matthew to paste the real site takes him four seconds and is always available, so there
 * is no pressure here to produce an answer.
 *
 * One hop only. An aggregator that links to another aggregator is not a chain worth walking, and
 * a resolver that follows arbitrary depth is a resolver that can be pointed anywhere.
 */
export async function resolveBioLink(rawUrl: string | null | undefined): Promise<ResolvedLink> {
  const url = unwrapInstagramLink(rawUrl);
  if (!url) return { website: null, note: "No link in the bio." };

  const host = hostOf(url);
  if (!host) return { website: null, note: `The bio link could not be read: ${rawUrl}` };

  if (isNeverTheirSite(host)) {
    return {
      website: null,
      note: `The bio link points at ${host}, which is not a site they control. The hook is written from their own pages.`,
    };
  }

  if (!AGGREGATOR_HOSTS.has(host)) return { website: url, note: `Using the bio link: ${host}` };

  const found = await firstOutboundFrom(url);
  if (!found) {
    return {
      website: null,
      note: `The bio link is a ${host} page and no site of their own was linked from it.`,
    };
  }
  return { website: found, note: `Followed ${host} to ${hostOf(found)}` };
}

/**
 * Open an aggregator page and return the first outbound link that could be their own site.
 *
 * Best effort by construction: many of these render their links from JSON in a script tag rather
 * than as anchors, so a miss is expected and is handled by returning null, never by guessing.
 */
async function firstOutboundFrom(url: string): Promise<string | null> {
  let html: string;
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: {
        // Same posture as site-research: identify as a normal browser, take whatever is served.
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    html = await res.text();
  } catch {
    return null;
  }

  const self = hostOf(url);
  // Anchors first, then bare https URLs anywhere in the markup, which is what catches the ones
  // that ship their links inside a JSON blob.
  const candidates = [
    ...[...html.matchAll(/href\s*=\s*["'](https?:\/\/[^"']+)["']/gi)].map((m) => m[1]),
    ...[...html.matchAll(/https?:\/\/[a-z0-9.-]+\.[a-z]{2,}[^\s"'<>]*/gi)].map((m) => m[0]),
  ];

  for (const c of candidates) {
    const h = hostOf(c);
    if (!h || h === self) continue;
    if (AGGREGATOR_HOSTS.has(h)) continue; // one hop only
    if (isNeverTheirSite(h)) continue;
    // Asset and analytics hosts that appear in every page's markup.
    if (/(^|\.)(cdn|static|assets|fonts|cdnjs|gstatic|googleapis|googletagmanager|jsdelivr|unpkg|cloudflare|sentry|hotjar|segment)\./i.test(h)) continue;
    if (/\.(js|css|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|map)(\?|$)/i.test(c)) continue;
    return c;
  }
  return null;
}

/**
 * The business name to hand the classifier.
 *
 * An Instagram display name is a marketing field: "Han MD, PHD. Hairthetics | Hair & Ear Surgery
 * FL" carries a person, a brand and a tagline in one string. The brand is the middle piece, and
 * finding it reliably is not something a regex does, so this only takes the obvious win: strip a
 * leading person-and-credentials segment, then take what is left before the first separator.
 *
 * ‼️ FALLS BACK TO THE EMPTY STRING, NEVER TO THE HANDLE. `hairthetics_fl` is a login, not a
 * trading name, and pinning the classifier to it would put an underscore into the greeting, the
 * aliases and the fixed finding sentence. Empty tells classifyBusiness to read the real name off
 * the pages it just crawled, which is the one place it is reliably written down.
 */
export function businessNameFrom(fullName: string): string {
  if (!fullName) return "";

  const segments = fullName
    .split(/[|·•]|(?:\.\s+)/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const seg of segments) {
    // A segment that is only a person and their credentials is not the business.
    const withoutCreds = seg
      .replace(/\b(?:MD|DO|PhD|PHD|DDS|DMD|RN|NP|PA|DPT|FACS|FAAD|MBA|Esq|CPA)\b\.?/gi, "")
      .replace(/[,\s]+$/, "")
      .trim();
    if (!withoutCreds) continue;
    // ‼️ A SEGMENT THAT IS ONLY AN HONORIFIC IS NOT A NAME. "Dr. Sarah Whitfield" splits on the
    // period into ["Dr", "Sarah Whitfield"], and without this the classifier would be pinned to
    // the string "Dr" and every alias, mention match and fixed finding sentence built from it.
    if (/^(dr|drs|mr|mrs|ms|prof|professor)$/i.test(withoutCreds)) continue;
    if (withoutCreds.length < 3) continue;
    // A short segment that was ONLY a person plus their credentials is the person, not the brand:
    // the credentials are what identify it as such, so this fires only when some were stripped.
    const words = withoutCreds.split(/\s+/);
    if (words.length <= 2 && seg !== withoutCreds) continue;
    return withoutCreds;
  }

  return segments[0] ?? "";
}

/**
 * A location Matthew typed into the panel, turned into something the scan can use.
 *
 * ‼️ THIS IS THE ONE PLACE A ZIP IS ALLOWED TO EXIST, AND IT NEVER LEAVES AS ONE. Every sentence
 * that prints a city splits it on the first comma and reads it aloud (dmRivalLine,
 * hookPositioningLine), so "when someone asks ChatGPT for laser skin treatments in 33009" is a
 * sentence no person would write. A ZIP is resolved to "City, ST" or it is refused, and refusing
 * costs one retyped word because the panel simply asks again.
 *
 * Everything else passes through trimmed. He may type "Coral Gables", "Coral Gables, FL" or
 * "Coral Gables, Florida", and all three are fine: the engine prompts take the string as given, and
 * the printed lines keep only what is before the first comma.
 *
 * Best-effort and it never throws, the same contract as tradeFromBio: a null here means the panel
 * asks again, which is recoverable, where a wrong city is not.
 */
export async function resolveCityInput(raw: string | null | undefined): Promise<string | null> {
  const s = (raw ?? "").trim();
  if (!s) return null;
  if (!/^\d{5}(?:-\d{4})?$/.test(s)) return s.replace(/\s+/g, " ");

  const zip = s.slice(0, 5);
  try {
    const { data } = await callClaudeJSON<{ city: string | null; state: string | null }>({
      model: "claude-haiku-4-5-20251001",
      system:
        "You map a US ZIP code to the city and two-letter state it is in. Return the primary city " +
        'name only, with no county and no "area". Return nulls when you are not sure which ZIP ' +
        "this is. A wrong city is worse than no city.",
      user: `ZIP: ${zip}`,
      schemaHint: '{ "city": string | null, "state": string | null }',
      maxTokens: 100,
      temperature: 0,
      validate: (v): v is { city: string | null; state: string | null } =>
        typeof v === "object" && v !== null && "city" in v && "state" in v,
    });
    const city = (data.city ?? "").trim();
    const state = (data.state ?? "").trim().toUpperCase();
    // Validated against the same table cityFromBio validates against, so a hallucinated "ZZ" or a
    // county name in the state slot is rejected rather than printed at a prospect.
    if (!city || !STATE_ABBR.has(state)) return null;
    return `${city}, ${state}`;
  } catch (e) {
    console.error("[instagram/profile] ZIP lookup failed:", (e as Error).message);
    return null;
  }
}
