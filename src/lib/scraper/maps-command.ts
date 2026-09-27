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

/** Printed verbatim on every refusal, so the operator never has to guess the shape. */
export const MAPS_GRAMMAR = [
  "`pull maps <vertical> | <metro> | <what to search> [| limit <n>]`",
  "",
  "For example:",
  "  `pull maps medspa | Dallas TX | med spa`",
  "  `pull maps dentist | Phoenix AZ | dental implants | limit 40`",
].join("\n");

/** Outscraper is billed per record, so an unbounded pull is not expressible. */
export const MAPS_LIMIT_DEFAULT = 20;
export const MAPS_LIMIT_MAX = 200;

export interface MapsCommand {
  vertical: string;
  metro: string;
  /** What to search for, without the metro. Kept separate so the card can say both. */
  query: string;
  /** The string actually sent to Outscraper. */
  searchQuery: string;
  limit: number;
}

export type MapsParse =
  | { ok: true; command: MapsCommand }
  | { ok: false; reason: string };

/** Does this message even claim to be a Maps pull. Checked before anything is parsed. */
export function looksLikeMapsCommand(text: string): boolean {
  return /^\s*pull\s+maps\b/i.test(text);
}

/**
 * Parse it, or say why not.
 *
 * Same discipline as `parseCutoff`: a shape that is not understood returns a refusal carrying the
 * grammar, never a best guess. Two matches and zero matches are the same answer.
 */
export function parseMapsCommand(text: string): MapsParse {
  if (!looksLikeMapsCommand(text)) return { ok: false, reason: "that is not a `pull maps` command" };

  const body = text.replace(/^\s*pull\s+maps\b/i, "").trim();
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
  if (parts.length > 3) {
    const tail = parts[3];
    const m = /^limit\s+(\d{1,4})$/i.exec(tail);
    if (!m) {
      return { ok: false, reason: "I did not understand `" + tail + "`. The fourth part can only be `limit <n>`." };
    }
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
  if (parts.length > 4) {
    return { ok: false, reason: "there are more than four parts, and I do not know what to do with the rest" };
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

  return {
    ok: true,
    command: {
      vertical,
      metro,
      query,
      // Outscraper takes one string. The metro goes on the end, which is the shape medspa.ts's
      // buildQuery already uses for ZIPs.
      searchQuery: query + " " + metro,
      limit,
    },
  };
}
