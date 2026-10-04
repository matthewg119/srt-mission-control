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
import { cellKey, parseCellKey, type Cell } from "./cells";

/** Printed verbatim on every refusal, so the operator never has to guess the shape. */
export const MAPS_GRAMMAR = [
  "`pull maps <vertical> | <metro> | <what to search> [| limit <n>]`",
  "",
  "For example:",
  "  `pull maps medspa | Dallas TX | med spa`",
  "  `pull maps dentist | Phoenix AZ | dental implants | limit 40`",
  "  `pull maps medspa | Miami FL | med spa | limit 200 | radius 50`",
  "  `pull maps medspa | Dallas TX | med spa | limit 500 | offset 500`   _(the next 500 in Dallas)_",
  "  `pull maps medspa | 32.7767,-96.7970,24 | med spa | limit 500`   _(a measured cell, by coordinate)_",
  "",
  "`limit`, `radius`, `offset`, `page` and `via` are optional and can come in any order.",
  "`offset <n>` skips the first n results, which is how one cell is pulled deeper than its limit.",
  "A `lat,lon,radiusKm` triple in place of the metro names a circle directly and is not geocoded.",
].join("\n");

/** Outscraper is billed per record, so an unbounded pull is not expressible. */
export const MAPS_LIMIT_DEFAULT = 20;

/**
 * The most records one command may buy.
 *
 * ‼️ 500 WAS OUR CAP, NOT THE VENDOR'S, AND IT WAS SIZED FOR OUTSCRAPER AT $3.00 PER THOUSAND.
 * DataForSEO charges $0.37 per thousand, so the old ceiling cost $1.50 to reach and the new one costs
 * $1.80 for ten times the rows. Raised on 2026-10-03 after a 500-record Dallas pull yielded 101
 * qualified companies and 64 addresses: the yield is fine, the VOLUME was the constraint.
 *
 * ‼️ ONE COMMAND, SEVERAL VENDOR CALLS. The endpoint clamps `limit` to 1000 per task, so anything
 * above that is paged internally by `pullFromDataForSeo` at 1000 a time. That is why the estimate
 * card charges ceil(limit / 1000) task fees rather than one.
 *
 * ‼️ WHAT THIS DOES NOT CHANGE IS THE SLOW PART. Every kept row is crawled for an address, about 30
 * to 100 per cron tick, so a 5,000-record pull is a crawl measured in hours rather than minutes. The
 * pull is seconds; the pipeline behind it is not.
 */
export const MAPS_LIMIT_MAX = 5000;

/**
 * The most records the vendor will return for ONE task.
 *
 * Measured against the endpoint's own clamp in src/lib/dataforseo-places.ts, which silently reduces
 * anything larger. Paging above this is the caller's job, so the clamp can never quietly truncate a
 * pull into a short page that looks like an exhausted cell.
 */
export const MAPS_PAGE_MAX = 1000;

/** A metro, roughly. Wide enough to cover the suburbs, tight enough to stay one market. */
export const MAPS_RADIUS_KM_DEFAULT = 30;

/**
 * The widest circle a RECORD pull may ask for.
 *
 * ‼️ RAISED FROM 200 TO 500 FOR THE NATIONAL CRAWL, AND THE CEILING IS THE OFFSET CAP RATHER THAN
 * MONEY. It has to exceed SEED_RADIUS_KM (384), because a seed circle over open country comes back
 * under the cell budget and is then PAGED at its own radius rather than split. It must not reach
 * 3,000: that circle measured 159,075 on 2026-09-28, which cannot be paged under the 100,000 offset
 * ceiling, so allowing it would be allowing a command that cannot finish. Same class of refusal as a
 * vertical with no buyer profile: cheap to refuse, expensive to discover afterwards.
 *
 * A PROBE is not bound by this. It buys one record, so its radius decides only the shape of the
 * tree; cells.ts caps that separately at CELL_RADIUS_KM_MAX.
 */
export const MAPS_RADIUS_KM_MAX = 500;

/**
 * The deepest offset that may be asked for.
 *
 * ‼️ MEASURED, NOT GUESSED. On 2026-09-28 against the national circle, offset 100,000 succeeded and
 * 110,000, 120,000, 125,000, 130,000 and 140,000 all returned HTTP 500. That probe run also took
 * over five minutes for five requests, so deep offsets are slow long before they are impossible. A
 * cell that would need to go deeper is SPLIT, never paged.
 */
export const MAPS_OFFSET_MAX = 100_000;

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
  // ‼️ WIDENED ON 2026-10-04 AGAINST MEASURED KEEP RATES, NOT BY TASTE. The 500-record Dallas pull
  // reported, by the primary category Google shows for each business:
  //
  //   medical_spa                 146 pulled, 78 kept   53%
  //   laser_hair_removal_service    6 pulled,  4 kept   67%   <- better than anything already listed
  //   permanent_make_up_clinic      6 pulled,  3 kept   50%
  //   skin_care_clinic             77 pulled,  7 kept    9%
  //   facial_spa                   71 pulled,  5 kept    7%
  //
  // The two weak ones are kept anyway: they are where most of the nail salons ride in, but they still
  // produced 12 real clinics per 500, which is ~120 per 5,000, and the junk they bring is dropped by a
  // free rule or by a Haiku call costing about four cents a batch. Noise that gets filtered is cheaper
  // than coverage that is never pulled.
  //
  // ‼️ AND day_spa AND beauty_salon ARE STILL ABSENT. They kept 0 of 35 between them. That is the line:
  // a category earns a place by converting, not by sounding adjacent.
  medspa: [
    "medical_spa",
    "facial_spa",
    "skin_care_clinic",
    "laser_hair_removal_service",
    "permanent_make_up_clinic",
  ],
  dentist: ["dentist", "cosmetic_dentist"],
};

export interface MapsCommand {
  vertical: string;
  metro: string;
  /**
   * The circle this command names, when the metro slot held a coordinate triple rather than a name.
   *
   * ‼️ WHEN THIS IS SET THERE IS NOTHING TO GEOCODE, AND THAT IS THE POINT. A cell already IS a
   * coordinate, so `pullFromDataForSeo` sends `metro` to the vendor verbatim. A named metro still
   * resolves through Nominatim at pull time and becomes a cell there, so everything downstream of
   * the geocoder handles one shape.
   */
  cell: Cell | null;
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
  // ‼️ A COORDINATE TRIPLE IS ALREADY A LOCATION AND MUST NOT BE DECORATED. Without this guard a
  // cell pull would carry locationName "32.7767,-96.7970,24,United States", which is not a place, is
  // not a coordinate, and would be handed to the geocoder on any path that still consults it.
  if (parseCellKey(metro)) return metro;

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
  let sawRadius = false;
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
      sawRadius = true;
      radiusKm = Number(radiusMatch[1]);
      if (radiusKm < 1 || radiusKm > MAPS_RADIUS_KM_MAX) {
        return {
          ok: false,
          reason:
            "a radius of " + radiusKm + "km is outside 1 to " + MAPS_RADIUS_KM_MAX +
            "km. A metro is about 30; a national seed cell is 384.",
        };
      }
      continue;
    }
    const off = /^offset\s+(\d{1,7})$/i.exec(tail);
    if (off) {
      offset = Number(off[1]);
      // ‼️ THE CEILING IS A MEASUREMENT, SO THE REFUSAL CARRIES IT. See MAPS_OFFSET_MAX.
      if (offset > MAPS_OFFSET_MAX) {
        return {
          ok: false,
          reason:
            "offset " + offset + " is past the ceiling of " + MAPS_OFFSET_MAX + ". Measured " +
            "2026-09-28: offset 100,000 succeeded and 110,000 through 140,000 all returned HTTP 500. " +
            "A cell that needs to go deeper is split, not paged.",
        };
      }
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
          ". Every record is crawled and qualified downstream, so the cap is about how much work one " +
          "batch can carry rather than about the record price. Pull the next slice with `offset " +
          MAPS_LIMIT_MAX + "`.",
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

  const query = parts[2];

  // ‼️ A COORDINATE TRIPLE IN THE METRO SLOT IS A CELL, AND IT IS RE-CANONICALISED BEFORE IT IS
  // STORED. `cellKey(cell)` rather than the text as typed, because the label this command came from
  // is written to scraper_batches.batch_label and later read back by postPullEstimate and joined on
  // as a STRING by cellDepthFrom. "-96.797" and "-96.7970" are one circle and two strings; a cell
  // whose label does not match its key has a paging depth of zero forever, so it would be re-bought
  // from offset 0 on every tick.
  const parsedCell = parseCellKey(parts[1]);
  const metro = parsedCell ? cellKey(parsedCell) : parts[1];

  if (parsedCell) {
    // ‼️ TWO RADII IS A REFUSAL, NOT A RECONCILIATION. The triple already carries one, and silently
    // preferring either would buy a circle the operator did not describe. Same discipline as
    // `offset` and `page` together.
    if (sawRadius) {
      return {
        ok: false,
        reason:
          "the coordinate triple already carries a radius of " + parsedCell.radiusKm + "km, and " +
          "`radius " + radiusKm + "` says something different. Give one, not both.",
      };
    }
    if (parsedCell.radiusKm > MAPS_RADIUS_KM_MAX) {
      return {
        ok: false,
        reason:
          "a radius of " + parsedCell.radiusKm + "km is outside 1 to " + MAPS_RADIUS_KM_MAX +
          "km. A circle that big cannot be paged under the offset ceiling, so it has to be split " +
          "rather than pulled.",
      };
    }
    radiusKm = parsedCell.radiusKm;
  }

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
      cell: parsedCell ? { ...parsedCell } : null,
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
    "  `cells medspa`  MEASURES the next circles: asks how many businesses are in each one, for about " +
      "a penny each, before buying any of them. Do this first.",
    "  `pull maps medspa | limit 500`  works the next measured circle, deepest-first, until the whole " +
      "country is covered. Run it, work the batch, run it again.",
    "  `coverage medspa`  how much of the map is measured and pulled, by state.",
    "  `pull maps medspa | Dallas TX | med spa | limit 500`  names a place yourself.",
    "  `pull maps medspa | 32.7767,-96.7970,24 | med spa`  names a circle yourself (lat,lon,km).",
    "  Or just ask: `get me med spa leads in Dallas TX`",
    "  `limit`, `radius <km>` and `via <source>` are optional, in any order.",
    "  Only one pull runs at a time, so the crawl and the verifier are not fighting for the same tick.",
    "  A circle holding more than 2,000 businesses is split into four and each part measured, so a " +
      "dense city gets worked properly instead of skimmed.",
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
 * Is this pipe-separated part an OPTION rather than a metro or a query?
 *
 * ‼️ THIS IS WHAT SEPARATES THE TWO COMMAND FORMS, AND COUNTING PARTS DOES NOT.
 * `pull maps medspa | limit 500 | radius 50` and `pull maps medspa | Dallas TX | med spa` both have
 * three parts and mean completely different things. What tells them apart is whether the parts after
 * the vertical are options, so that is the test.
 */
function isOptionToken(part: string): boolean {
  // ‼️ `offset` AND `page` WERE MISSING UNTIL 2026-09-28, AND IT WAS A REAL BUG RATHER THAN AN
  // OMISSION. `pull maps medspa | limit 500 | offset 500` has three parts and every part after the
  // vertical is an option, so it is the queue form. With `offset` absent from this list it was not
  // recognised as one, fell through to the explicit parser, and was read as a pull whose METRO IS
  // LITERALLY NAMED "limit 500" -- which then reached the geocoder, failed, and did so only after a
  // card had already been posted. Latent while the queue form was rarely typed with an offset; it is
  // load-bearing now that walking the country is the primary command.
  return /^(limit\s+\d{1,4}|radius\s+\d{1,4}|offset\s+\d{1,7}|page\s+\d{1,4}|via\s+[a-z]+)$/i.test(part.trim());
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
    // ‼️ THE QUEUE DECIDES HOW DEEP TO GO, SO NAMING AN OFFSET HERE IS REFUSED RATHER THAN HONOURED.
    // isOptionToken accepts `offset` and `page` so that the queue form is recognised at all (see the
    // note there), which means they now arrive in this loop. Letting one through would set a depth
    // the walk is about to compute for itself from the cell's own history, and the two would fight.
    const depthToken = /^(offset|page)\s+\d+$/i.exec(tail);
    if (depthToken) {
      return {
        ok: false,
        reason:
          "`" + tail + "` cannot be given to the queue form, because the queue works out how deep " +
          "each cell already is from what has landed. Name the cell itself if you want a specific " +
          "offset: `pull maps <vertical> | <lat,lon,radiusKm> | <query> | " + tail + "`.",
      };
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
  /**
   * Did this pull actually LAND, meaning it finished and recorded no error.
   *
   * ‼️ WITHOUT THIS THE FRONTIER ADVANCES OVER RECORDS THAT WERE NEVER BOUGHT, AND THAT WAS A LIVE
   * BUG. Depth is computed from the LABEL, and a label survives a pull that failed: the batch row and
   * its `batch_label` are written before anything is spent, and `fail()` does not remove them. So a
   * pull that errored to zero rows looked identical to a finished one, and the queue stepped past 500
   * businesses nobody had paid for. The old short-pull rule hid this, because an errored pull also
   * looked "short" and merely ended the metro early.
   *
   * With `total_count` as the stop condition the two cases finally separate, and they must: an
   * unfinished pull leaves its cell UNFINISHED and the same offset is offered again.
   */
  finished: boolean;
}
