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

import { knownVerticals } from "./icp";
import { cityNameFrom, stateNameFrom } from "./geo";

/** Printed verbatim on every refusal, so the operator never has to guess the shape. */
export const MAPS_GRAMMAR = [
  "`pull maps <vertical> | <metro> | <what to search> [| limit <n>]`",
  "",
  "For example:",
  "  `pull maps medspa | Dallas TX | med spa`",
  "  `pull maps dentist | Phoenix AZ | dental implants | limit 40`",
  "  `pull maps medspa | Miami FL | med spa | limit 200 | radius 50`",
  "",
  "`limit`, `radius` and `via` are optional and can come in any order.",
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
    const m = /^limit\s+(\d{1,4})$/i.exec(tail);
    if (!m) {
      return {
        ok: false,
        reason:
          "I did not understand `" + tail + "`. After the query you can add `limit <n>`, `radius <km>` " +
          "or `via <source>`, in any order.",
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
      query,
      // Outscraper takes one string. The metro goes on the end, which is the shape medspa.ts's
      // buildQuery already uses for ZIPs.
      searchQuery: query + " " + metro,
      limit,
    },
  };
}
