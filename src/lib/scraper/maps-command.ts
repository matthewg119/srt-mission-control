// The 4️⃣ front door's grammar: a typed command in #srt-scraper that starts a Google Maps pull.
//
// ‼️ PURE. No Slack, no database, no network, so the offline probe owns it. Same split as rules.ts
// and dedup.ts, and for the same reason: this decides whether money is spent and it must be
// testable without spending any.
//
// ‼️ IT REFUSES RATHER THAN GUESSES, AND THE VERTICAL IS THE REASON. 3️⃣ resolves a vertical from the
// drop caption and merely WARNS when nothing matched, which is right there: the file is already in
// hand and free, so a wrong default costs a wasted qualification sweep over rows we already own. A
// Maps pull decides the vertical BEFORE Outscraper is billed, so the same wrong default buys the
// wrong list. Hence an explicit vertical, and a refusal when it is absent or unknown.

import { knownVerticals, resolveVertical } from "./icp";
import { cityNameFrom, stateNameFrom } from "./geo";

/** Printed verbatim on every refusal, so the operator never has to guess the shape. */
export const MAPS_GRAMMAR = [
  "`pull maps <vertical> | <metro> | <what to search> [| limit <n>]`",
  "",
  "For example:",
  "  `pull maps medspa | Dallas TX | med spa`",
  "  `pull maps dentist | Phoenix AZ | dental implants | limit 40`",
  "  `pull maps medspa | Miami FL | med spa | limit 200 | radius 50`",
  "  `pull maps medspa | Dallas TX | med spa | limit 500 | offset 500`   _(the next 500 in Dallas)_",
  "",
  "`limit`, `radius`, `offset`, `page` and `via` are optional and can come in any order.",
  "`offset <n>` skips the first n results, which is how one metro is pulled deeper than its limit.",
].join("\n");

/** Outscraper is billed per record, so an unbounded pull is not expressible. */
export const MAPS_LIMIT_DEFAULT = 20;
export const MAPS_LIMIT_MAX = 500;

/** A metro, roughly. Wide enough to cover the suburbs, tight enough to stay one market. */
export const MAPS_RADIUS_KM_DEFAULT = 30;
export const MAPS_RADIUS_KM_MAX = 200;

/**
 * Which vendor answers the pull.
 *
 * ‼️ dataforseo IS THE DEFAULT AND THE PRICE IS THE SMALLER REASON. Measured 2026-09-27 on the account
 * that already exists: $0.37 per 1,000 records against Outscraper's $3.00, with credit already paid
 * for. What matters more is that its endpoint is SYNCHRONOUS, so there is no webhook for a delivery to
 * vanish in and no six hour timeout holding a batch open, and it is a database QUERY, so a category
 * and a metro can be asked for directly instead of hoping a search string finds them.
 */
export type MapsSource = "dataforseo" | "outscraper";
export const MAPS_SOURCE_DEFAULT: MapsSource = "dataforseo";

/**
 * Google category keys per vertical, from the 5,318 that DataForSEO publishes.
 *
 * ‼️ MORE THAN ONE, BECAUSE THE ICP DOES NOT SIT IN ONE CATEGORY. `medical_spa` alone is 85,100
 * businesses worldwide, but plenty of the target list files itself under `facial_spa` (175,899) or
 * `skin_care_clinic` (248,926). Broad enough to find them, narrow enough that the qualification sweep
 * is not paying to read nail salons: `day_spa` and `beauty_salon` are deliberately absent.
 */
export const DFS_CATEGORIES: Record<string, string[]> = {
  medspa: ["medical_spa", "facial_spa", "skin_care_clinic"],
  dentist: ["dentist", "cosmetic_dentist"],
};

export interface MapsCommand {
  vertical: string;
  metro: string;
  source: MapsSource;
  /** DataForSEO category keys for this vertical. Empty for the Outscraper path, which searches text. */
  categories: string[];
  /** "Dallas,Texas,United States" shaped. Geocoded at pull time, because the vendor ignores names. */
  locationName: string;
  /** How far around the metro centre to look. DataForSEO takes kilometres. */
  radiusKm: number;
  /**
   * How many results into this metro to start. Sent to the vendor verbatim.
   *
   * ‼️ WITHOUT THIS A METRO IS SEEN ONCE, AND SHALLOWLY. Dallas holds 1,765 businesses matching the
   * med spa categories. A single `limit 500` pull takes the first 500 and the other 1,265 are never
   * looked at again, because the queue marks the metro done. An offset is what turns "we pulled
   * Dallas" into "we finished Dallas".
   *
   * ‼️ AN OFFSET, NOT A PAGE NUMBER, AND THE DIFFERENCE IS A MEASURED BUG. The first real Dallas
   * pull ran at `limit 50`. Had the queue stored "page 1" and then asked for "page 2" at the default
   * `limit 500`, the second pull would have started at (2-1) x 500 = 500 and silently skipped results
   * 50 through 499: 450 businesses nobody would ever have known were missed. A page number only means
   * something next to the limit it was paged at, and the limit changes between pulls. The grammar
   * still accepts `page <n>` as shorthand, resolved to an offset once, against the limit given in the
   * SAME command.
   */
  offset: number;
  /** What to search for, without the metro. Kept separate so the card can say both. */
  query: string;
  /** The string actually sent to Outscraper. */
  searchQuery: string;
  limit: number;
}

/**
 * "Dallas TX" into "Dallas,Texas,United States", which DataForSEO takes verbatim.
 *
 * ‼️ NO GEOCODER, AND THAT IS WHY THIS SOURCE IS SIMPLE. The listings endpoint also accepts a
 * lat/lng/radius triple, which would mean geocoding every metro and owning a second dependency on the
 * paid path. It accepts a NAME instead, so the state table already in geo.ts is the whole conversion.
 *
 * A metro with no state resolves to the bare city plus the country, which DataForSEO will either
 * match or refuse. Refusing is the right outcome: guessing a state is how "Springfield" buys the
 * wrong one of thirty-four.
 */
export function locationNameOf(metro: string): string {
  const city = cityNameFrom(metro);
  const state = stateNameFrom(metro);
  if (city && state) return city + "," + state + ",United States";
  if (state) return state + ",United States";
  return (city ?? metro.trim()) + ",United States";
}

export type MapsParse =
  | { ok: true; command: MapsCommand }
  | { ok: false; reason: string };

/**
 * Slack code formatting off the front and back of a command.
 *
 * ‼️ THIS COST A REAL PULL. An operator typed the command into Slack as CODE, which is the natural
 * thing to do with something that looks like a command, so `event.text` arrived as
 * `` `pull maps medspa | Dallas TX | med spa | limit 50` `` . The anchor below is `^pull maps`, so it
 * did not match, `handleScraperEvent` returned false, and the message fell through to the general
 * assistant, which answered it from the existing database. It looked like the command had run and
 * returned 25 leads. Nothing had run, and nothing was bought.
 *
 * The lesson is not about backticks: a command surface that is ALSO a chat surface must be generous
 * about formatting, because the fallback is not an error message, it is a different bot answering
 * plausibly.
 */
export function unwrapCodeText(text: string): string {
  return unwrapCode(text);
}

function unwrapCode(text: string): string {
  let t = text.trim();
  // A fenced block, with or without a language tag, then a single or double backtick span.
  const fenced = /^```(?:[a-z]+\r?\n|\r?\n)?([\s\S]*?)```$/i.exec(t);
  if (fenced) t = fenced[1].trim();
  // `...` or ``...``
  const inline = /^`{1,2}([^`][\s\S]*?)`{1,2}$/.exec(t);
  if (inline) t = inline[1].trim();
  return t;
}

/** Does this message even claim to be a Maps pull. Checked before anything is parsed. */
export function looksLikeMapsCommand(text: string): boolean {
  return /^\s*pull\s+maps\b/i.test(unwrapCode(text));
}

/**
 * Parse it, or say why not.
 *
 * Same discipline as `parseCutoff`: a shape that is not understood returns a refusal carrying the
 * grammar, never a best guess. Two matches and zero matches are the same answer.
 */
export function parseMapsCommand(text: string): MapsParse {
  if (!looksLikeMapsCommand(text)) return { ok: false, reason: "that is not a `pull maps` command" };

  const body = unwrapCode(text).replace(/^\s*pull\s+maps\b/i, "").trim();
  if (!body) {
    return { ok: false, reason: "a Maps pull needs a vertical, a metro and something to search for" };
  }

  const parts = body.split("|").map((p) => p.trim()).filter((p) => p.length > 0);
  // ‼️ AN ALL-OPTIONS COMMAND IS THE QUEUE FORM, NOT A MALFORMED EXPLICIT ONE. Refusing it here with
  // "I need three parts" would tell the operator to add a metro to a command whose entire point is
  // not having one.
  if (parts.length >= 1 && parts.slice(1).every(isOptionToken)) {
    return {
      ok: false,
      reason:
        "that is the queue form (`pull maps " + parts[0] + "`), which takes the next metro on the " +
        "list. It is handled elsewhere, so reaching this is a bug.",
    };
  }
  if (parts.length < 3) {
    return {
      ok: false,
      reason:
        "I need three parts separated by `|`, and I counted " + parts.length +
        ". A vertical, a metro, and what to search for.",
    };
  }

  let limit = MAPS_LIMIT_DEFAULT;
  let source: MapsSource = MAPS_SOURCE_DEFAULT;
  let radiusKm = MAPS_RADIUS_KM_DEFAULT;
  let offset: number | null = null;
  let pageSugar: number | null = null;
  let sawLimit = false;
  for (const tail of parts.slice(3)) {
    const viaMatch = /^via\s+([a-z]+)$/i.exec(tail);
    if (viaMatch) {
      const want = viaMatch[1].toLowerCase();
      if (want !== "dataforseo" && want !== "outscraper") {
        return { ok: false, reason: "`" + viaMatch[1] + "` is not a source I have. Use `dataforseo` or `outscraper`." };
      }
      source = want;
      continue;
    }
    const radiusMatch = /^radius\s+(\d{1,4})$/i.exec(tail);
    if (radiusMatch) {
      radiusKm = Number(radiusMatch[1]);
      if (radiusKm < 1 || radiusKm > MAPS_RADIUS_KM_MAX) {
        return {
          ok: false,
          reason: "a radius of " + radiusKm + "km is outside 1 to " + MAPS_RADIUS_KM_MAX + "km. A metro is about 30.",
        };
      }
      continue;
    }
    const off = /^offset\s+(\d{1,6})$/i.exec(tail);
    if (off) {
      offset = Number(off[1]);
      continue;
    }
    // Resolved to an offset AFTER the loop, never here: `page 2 | limit 100` puts the limit to the
    // right of the page, so converting in place would use whatever limit had been seen so far.
    const pg = /^page\s+(\d{1,4})$/i.exec(tail);
    if (pg) {
      pageSugar = Number(pg[1]);
      if (pageSugar < 1) return { ok: false, reason: "page " + pageSugar + " does not exist; pages start at 1." };
      continue;
    }
    const m = /^limit\s+(\d{1,4})$/i.exec(tail);
    if (!m) {
      return {
        ok: false,
        reason:
          "I did not understand `" + tail + "`. After the query you can add `limit <n>`, `radius <km>`, " +
          "`offset <n>`, `page <n>` or `via <source>`, in any order.",
      };
    }
    if (sawLimit) return { ok: false, reason: "two limits were given and I will not choose between them" };
    sawLimit = true;
    limit = Number(m[1]);
    if (limit < 1) return { ok: false, reason: "a limit of " + limit + " would pull nothing" };
    if (limit > MAPS_LIMIT_MAX) {
      return {
        ok: false,
        reason:
          "a limit of " + limit + " is above the cap of " + MAPS_LIMIT_MAX +
          ". Outscraper bills per record, so the cap is deliberate. Split the pull by metro instead.",
      };
    }
  }

  if (offset !== null && pageSugar !== null) {
    return { ok: false, reason: "`offset` and `page` say the same thing two ways. Give one, not both." };
  }
  const startAt = offset ?? (pageSugar !== null ? (pageSugar - 1) * limit : 0);

  // ‼️ THE VERTICAL IS MATCHED AGAINST THE REGISTRY, NOT RESOLVED WITH A FALLBACK. icpFor returns
  // null for anything outside the registry and beginListPrepWorkflow fails hard on that, so
  // accepting an unknown slug here would buy a list and then refuse to judge it.
  const vertical = parts[0].toLowerCase().replace(/\s+/g, "");
  if (!knownVerticals().includes(vertical)) {
    return {
      ok: false,
      reason:
        "`" + parts[0] + "` is not a vertical I have a buyer profile for. Known: " +
        knownVerticals().map((v) => "`" + v + "`").join(", ") +
        ". Add one in `src/lib/scraper/icp.ts` first, because a pull that cannot be judged is money spent for nothing.",
    };
  }

  const metro = parts[1];
  const query = parts[2];

  // ‼️ THE DATAFORSEO CATEGORY LIST IS REQUIRED FOR THAT SOURCE AND MUST NOT DEFAULT. Falling back to
  // a guess would buy a list filed under the wrong category, which is the same class of mistake as
  // defaulting the vertical: cheap to refuse, expensive to discover afterwards.
  const categories = DFS_CATEGORIES[vertical] ?? [];
  if (source === "dataforseo" && !categories.length) {
    return {
      ok: false,
      reason:
        "there are no DataForSEO categories mapped for `" + vertical + "`, so a pull would search for " +
        "nothing. Add them to DFS_CATEGORIES in `src/lib/scraper/maps-command.ts`, or run it " +
        "`via outscraper`, which searches on the text instead.",
    };
  }

  return {
    ok: true,
    command: {
      vertical,
      metro,
      source,
      categories,
      locationName: locationNameOf(metro),
      radiusKm,
      offset: startAt,
      query,
      // Outscraper takes one string. The metro goes on the end, which is the shape medspa.ts's
      // buildQuery already uses for ZIPs.
      searchQuery: query + " " + metro,
      limit,
    },
  };
}

/**
 * A plain-English ask for leads, turned into a pull.
 *
 * ‼️ IT PRODUCES THE ESTIMATE CARD, NOT A PULL, WHICH IS WHY GUESSING IS SAFE HERE. Everything this
 * infers is shown back on a card that buys nothing until somebody reacts, so a wrong guess costs a
 * glance rather than money. That is the only reason loose parsing is allowed anywhere near this lane.
 *
 * ‼️ AND IT STILL REFUSES RATHER THAN DEFAULTS. No vertical or no city means null, and the caller
 * prints the grammar. "Get me some leads" cannot become a Dallas med spa pull just because that was
 * the last thing anybody ran.
 */
export function parseNaturalPull(text: string): MapsParse | null {
  const t = unwrapCode(text).trim();
  if (!t || looksLikeMapsCommand(t)) return null;

  // An intent, not a keyword: "leads", "pull", "scrape", "find" near a business word.
  if (!/\b(lead|leads|pull|scrape|scraping|find|get)\b/i.test(t)) return null;

  const vertical = knownVerticals().find((v) => resolveVertical(t).matched && resolveVertical(t).slug === v);
  if (!vertical) return null;

  const where = metroFrom(t);
  if (!where) {
    return {
      ok: false,
      reason:
        "I can tell you want `" + vertical + "` leads, but not from where. Name a city and state, " +
        "for example `get me med spa leads in Dallas TX`.",
    };
  }

  const limitMatch = /\b(\d{1,4})\s*(?:leads|results|records|of them)?\b/i.exec(t.replace(/\b\d{5}\b/g, ""));
  const asked = limitMatch ? Number(limitMatch[1]) : MAPS_LIMIT_DEFAULT;
  const limit = Math.max(1, Math.min(MAPS_LIMIT_MAX, asked));

  return parseMapsCommand("pull maps " + vertical + " | " + where + " | " + vertical + " | limit " + limit);
}

/**
 * The city and state out of a sentence.
 *
 * Anchored on "in" / "near" / "around" / "from" when present, because that is where a person puts a
 * place. Failing that, any "City ST" or "City, State" pair anywhere in the text.
 */
function metroFrom(text: string): string | null {
  const prep = /\b(?:in|near|around|from|for)\s+([A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,3}(?:\s*,\s*| )[A-Z]{2}\b|[A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,3}\s*,\s*[A-Z][a-z]+)/.exec(text);
  const candidate = prep?.[1] ?? /\b([A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,3}(?:\s*,\s*| )[A-Z]{2})\b/.exec(text)?.[1];
  if (!candidate) return null;
  const cleaned = candidate.replace(/\s*,\s*/, " ").trim();
  // Only accept it if geo.ts recognises the tail as a state, or it is not a place at all.
  return stateNameFrom(cleaned) ? cleaned : null;
}

/**
 * What this channel can do, in the words an operator would use.
 *
 * ‼️ IT EXISTS BECAUSE THE ANSWER USED TO COME FROM THE GENERAL ASSISTANT, AND IT WAS WRONG. Asked
 * "workflows" on 2026-09-27, BrainHeart replied "I don't have a pull maps or lead scrape workflow"
 * and offered to search the CRM instead. It was not lying; it simply has no idea this lane exists.
 * A channel whose help text is generated by something that cannot see the feature will confidently
 * describe a different product.
 */
export function laneHelp(): string {
  return [
    "*What this channel does.* Everything here ends in one place: a `sendable.csv` of verified " +
      "addresses, with everyone you have already contacted removed.",
    "",
    "*Two ways to start.*",
    "",
    "*A. Pull businesses from Google Maps.* Nothing is bought until you react.",
    "  `pull maps medspa | limit 500`  takes the NEXT metro that vertical has not had yet, working " +
      "down a list of 50 US metros. This is the one to use to cover a market: run it, work the batch, " +
      "run it again.",
    "  `pull maps medspa | Dallas TX | med spa | limit 500`  names the metro yourself.",
    "  Or just ask: `get me med spa leads in Dallas TX`",
    "  `metros` shows how far through the list each vertical is.",
    "  `limit`, `radius <km>` and `via <source>` are optional, in any order.",
    "  Only one pull runs at a time, so the crawl and the verifier are not fighting for the same tick.",
    "",
    "*B. Drop a CSV.* It needs a company column and a website column. The caption says which " +
      "vertical it is, which decides who the rows are judged against.",
    "",
    "*Then pick what happens to it, by reacting on the card:*",
    "  :one: *filter and verify* - you already have addresses. Cleans them, drops the junk, " +
      "verifies the rest. Gives you `clean.csv` and `junk.csv`.",
    "  :two: *score first* - you have companies and want to know who is worth contacting before " +
      "spending anything on them. Searches each one and ranks them.",
    "  :three: *build a send list* - you have companies and websites but NO addresses. This is the " +
      "one that crawls each site for the owner's name and an email, verifies what it finds, removes " +
      "anyone already contacted, and hands back `sendable.csv`. A Maps pull always uses this.",
    "",
    "*The two check marks you will be asked for, and what each one spends:*",
    "  1. After a pull, before the crawl. Shows what was kept and why.",
    "  2. Before MillionVerifier. Junk is rejected for free first, and the card says how much.",
    "",
    "*Other things you can type:* `status` for the latest batch, `help` or `workflows` for this.",
  ].join("\n");
}

/**
 * The metro list a campaign walks, largest first.
 *
 * ‼️ ORDER IS THE PLAN. A campaign has no queue table: "what is next" is "the first of these that has
 * no batch yet", which makes it idempotent, crash-safe and inspectable with one query. Reordering
 * this list reorders the campaign; removing an entry skips it; adding one appends to the end.
 *
 * Written as "City ST" because that is what `stateNameFrom` reads and what an operator would type.
 */
export const US_METROS: readonly string[] = [
  "New York NY", "Los Angeles CA", "Chicago IL", "Dallas TX", "Houston TX",
  "Atlanta GA", "Washington DC", "Philadelphia PA", "Miami FL", "Phoenix AZ",
  "Boston MA", "Riverside CA", "San Francisco CA", "Detroit MI", "Seattle WA",
  "Minneapolis MN", "San Diego CA", "Tampa FL", "Denver CO", "Baltimore MD",
  "St Louis MO", "Orlando FL", "Charlotte NC", "San Antonio TX", "Portland OR",
  "Sacramento CA", "Pittsburgh PA", "Austin TX", "Las Vegas NV", "Cincinnati OH",
  "Kansas City MO", "Columbus OH", "Indianapolis IN", "Cleveland OH", "Nashville TN",
  "San Jose CA", "Virginia Beach VA", "Providence RI", "Jacksonville FL", "Milwaukee WI",
  "Raleigh NC", "Oklahoma City OK", "Memphis TN", "Richmond VA", "Louisville KY",
  "New Orleans LA", "Salt Lake City UT", "Hartford CT", "Buffalo NY", "Birmingham AL",
];

/**
 * Is this pipe-separated part an OPTION rather than a metro or a query?
 *
 * ‼️ THIS IS WHAT SEPARATES THE TWO COMMAND FORMS, AND COUNTING PARTS DOES NOT.
 * `pull maps medspa | limit 500 | radius 50` and `pull maps medspa | Dallas TX | med spa` both have
 * three parts and mean completely different things. What tells them apart is whether the parts after
 * the vertical are options, so that is the test.
 */
function isOptionToken(part: string): boolean {
  return /^(limit\s+\d{1,4}|radius\s+\d{1,4}|via\s+[a-z]+)$/i.test(part.trim());
}

export interface NextMetroCommand {
  vertical: string;
  limit: number;
  radiusKm: number;
  source: MapsSource;
}

export type NextMetroParse =
  | { ok: true; command: NextMetroCommand }
  | { ok: false; reason: string };

/**
 * `pull maps medspa`, with no metro: take the next one that has not been pulled.
 *
 * ‼️ IT IS A SEPARATE PARSE, NOT A LOOSER VERSION OF THE OTHER ONE. `parseMapsCommand` refuses a
 * missing metro on purpose, because a pull that guesses its own location buys the wrong city. This
 * does not guess: it reads an ordered list and takes the first unclaimed entry, which is a different
 * thing and has to look different at the call site.
 *
 * Returns null when the text is not this shape at all, so the caller can fall through.
 */
export function parseNextMetroCommand(text: string): NextMetroParse | null {
  const t = unwrapCode(text);
  if (!looksLikeMapsCommand(t)) return null;

  const body = t.replace(/^\s*pull\s+maps\b/i, "").trim();
  const parts = body.split("|").map((p) => p.trim()).filter(Boolean);
  // Every part after the vertical must be an option. A part that is not one is a metro, and the
  // explicit parser owns that shape.
  if (parts.length === 0) return null;
  if (!parts.slice(1).every(isOptionToken)) return null;

  const vertical = parts[0].toLowerCase().replace(/\s+/g, "");
  if (!knownVerticals().includes(vertical)) {
    return {
      ok: false,
      reason:
        "`" + parts[0] + "` is not a vertical I have a buyer profile for. Known: " +
        knownVerticals().map((v) => "`" + v + "`").join(", ") +
        ". Add one in `src/lib/scraper/icp.ts` first, because a pull that cannot be judged is money " +
        "spent for nothing.",
    };
  }

  let limit = MAPS_LIMIT_DEFAULT;
  let radiusKm = MAPS_RADIUS_KM_DEFAULT;
  let source: MapsSource = MAPS_SOURCE_DEFAULT;
  for (const tail of parts.slice(1)) {
    const via = /^via\s+([a-z]+)$/i.exec(tail);
    if (via) {
      const want = via[1].toLowerCase();
      if (want !== "dataforseo" && want !== "outscraper") {
        return { ok: false, reason: "`" + via[1] + "` is not a source I have. Use `dataforseo` or `outscraper`." };
      }
      source = want;
      continue;
    }
    const rad = /^radius\s+(\d{1,4})$/i.exec(tail);
    if (rad) {
      radiusKm = Number(rad[1]);
      if (radiusKm < 1 || radiusKm > MAPS_RADIUS_KM_MAX) {
        return { ok: false, reason: "a radius of " + radiusKm + "km is outside 1 to " + MAPS_RADIUS_KM_MAX + "km." };
      }
      continue;
    }
    const lim = /^limit\s+(\d{1,4})$/i.exec(tail);
    if (!lim) {
      return {
        ok: false,
        reason: "I did not understand `" + tail + "`. After the vertical you can add `limit <n>`, `radius <km>` or `via <source>`.",
      };
    }
    limit = Math.max(1, Math.min(MAPS_LIMIT_MAX, Number(lim[1])));
  }
  return { ok: true, command: { vertical, limit, radiusKm, source } };
}

/** One past pull: the command that ran, and how many rows it actually produced. */
export interface MapsPull {
  label: string;
  rawCount: number;
}

/** Where the queue should go next: a metro, and how far into it to start. */
export interface MapsTarget {
  metro: string;
  offset: number;
}

interface MetroState {
  /** Results consumed so far: the deepest pull's offset plus the limit it asked for. */
  depth: number;
  /** Rows that deepest pull produced. */
  lastCount: number;
  /** The limit that deepest pull asked for. */
  lastLimit: number;
}

/**
 * Re-parse the labels into per-metro depth.
 *
 * Depth is `offset + limit` of the DEEPEST pull, not a count of pulls and not a sum of row counts.
 * Offset plus limit is where the vendor stopped looking, which is the only number the next pull can
 * safely start from: summing rows delivered would drift below it the moment any page returned fewer
 * rows than it asked for, and re-pull ground already covered.
 */
function metroStates(vertical: string, history: readonly MapsPull[]): Map<string, MetroState> {
  const byMetro = new Map<string, MetroState>();
  for (const pull of history) {
    const parsed = parseMapsCommand(pull.label);
    if (!parsed.ok || parsed.command.vertical !== vertical) continue;
    const key = parsed.command.metro.toLowerCase();
    const depth = parsed.command.offset + parsed.command.limit;
    const prior = byMetro.get(key);
    // Pulls can arrive out of order if a human names a deep offset by hand, so keep the DEEPEST
    // rather than the most recent. The deepest is the frontier, which is what the queue needs.
    if (prior && prior.depth > depth) continue;
    byMetro.set(key, { depth, lastCount: pull.rawCount, lastLimit: parsed.command.limit });
  }
  return byMetro;
}

/** A metro is finished when its deepest pull came back short of what it asked for. */
function exhausted(state: MetroState): boolean {
  return state.lastCount < state.lastLimit;
}

/**
 * Where to pull next: deeper into the current metro, or the start of the next one.
 *
 * ‼️ DONE-NESS IS DERIVED FROM THE COMMANDS THEMSELVES, NOT FROM A QUEUE TABLE. Every Maps batch
 * stores its command verbatim in `scraper_batches.batch_label`, so re-parsing those answers "which
 * metros has this vertical had, and how deep" exactly, with no second copy of the truth to drift. A
 * campaign that dies halfway resumes correctly because nothing was ever written down about its intent.
 *
 * ‼️ A SHORT PULL ENDS THE METRO, AND THAT INCLUDES ZERO. Dallas holds 1,765 med spas, so one
 * `limit 500` leaves 1,265 unseen and stepping straight to the next metro would abandon them. The
 * source returning fewer rows than the limit is the only signal available that a metro has run out,
 * short of storing DataForSEO's total_count. The cost is that a pull which errored to zero rows looks
 * identical to an exhausted metro and gets skipped. That is deliberate over the alternative: treating
 * zero as "not finished" would park a genuinely empty metro in an infinite retry. Name the metro
 * directly to redo it.
 */
export function nextTarget(vertical: string, history: readonly MapsPull[]): MapsTarget | null {
  const byMetro = metroStates(vertical, history);
  for (const metro of US_METROS) {
    const state = byMetro.get(metro.toLowerCase());
    if (!state) return { metro, offset: 0 };
    if (!exhausted(state)) return { metro, offset: state.depth };
  }
  return null;
}

/** How far through the list this vertical is. For the progress card. */
export function metroProgress(
  vertical: string,
  history: readonly MapsPull[]
): { done: string[]; started: string[]; remaining: string[]; pulls: number; rows: number } {
  const byMetro = metroStates(vertical, history);
  const done: string[] = [];
  const started: string[] = [];
  const remaining: string[] = [];
  for (const metro of US_METROS) {
    const state = byMetro.get(metro.toLowerCase());
    if (!state) remaining.push(metro);
    else if (exhausted(state)) done.push(metro);
    else started.push(metro);
  }
  let pulls = 0;
  let rows = 0;
  for (const pull of history) {
    const parsed = parseMapsCommand(pull.label);
    if (!parsed.ok || parsed.command.vertical !== vertical) continue;
    pulls += 1;
    rows += pull.rawCount;
  }
  return { done, started, remaining, pulls, rows };
}
