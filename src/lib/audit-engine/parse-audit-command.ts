// Parsing for the `/audit` slash command.
//
// Lives outside the route file because a Next route module may only export handlers and the
// route config constants — exporting the parser from there fails the build with a
// "not assignable to type never" error against .next/types. Its own module is also the only
// way to test it without signing a Slack request.
//
// GRAMMAR
//   /audit leadwebsite.com                                  website
//   /audit leadwebsite.com | Chicago, IL | comp1, comp2      website, city, competitors
//   /audit Hernandez Complete Auto Repair | Chicago, IL      name (city REQUIRED)
//   /audit "Smith & Co. Plumbing" | Chicago, IL              quotes force name mode
//
// A dot in segment 1 is what makes it a domain. Everything else is a name.

export type ParsedCommand =
  | { kind: "website"; website: string; city?: string; competitors?: string[] }
  | { kind: "name"; name: string; city: string; competitors?: string[] }
  | { kind: "error"; message: string };

export const AUDIT_USAGE = [
  "Usage:",
  "• `/audit https://website.com` — city and competitors are optional, the system researches those itself.",
  "• `/audit Business Name | City, ST` — for a business with no website. The city is required here.",
  "",
  'Wrap the name in quotes if it contains a dot: `/audit "Smith & Co. Plumbing" | Chicago, IL`.',
  "Competitors are always the last segment: `| competitor1, competitor2`.",
].join("\n");

/** Strips one matching pair of wrapping quotes, and says whether it found any. Quoting is how
 *  Matthew forces name mode for a name that happens to contain a dot. */
function unquote(raw: string): { value: string; wasQuoted: boolean } {
  const m = /^(["'])([\s\S]*)\1$/.exec(raw);
  return m ? { value: m[2].trim(), wasQuoted: true } : { value: raw, wasQuoted: false };
}

/**
 * Parse the slash-command text into a target.
 *
 * ‼️ Segments are NOT filtered for emptiness, and the old parser's `.filter(Boolean)` before
 * destructuring is the reason. `/audit site.com | | a, b` silently slid the competitors into
 * the city slot and audited a business in a city called "a, b". An empty segment now reads as
 * an absent one, which is what it looks like.
 */
export function parseCommandText(text: string): ParsedCommand {
  const parts = text.split("|").map((p) => p.trim());
  const first = parts[0] ?? "";
  const city = parts[1]?.trim() || undefined;
  const competitorsRaw = parts[2]?.trim() || undefined;
  const competitors = competitorsRaw
    ? competitorsRaw
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean)
    : undefined;

  const { value: target, wasQuoted } = unquote(first);
  if (!target) return { kind: "error", message: AUDIT_USAGE };

  // A dot is what makes something a domain. Anything without one is a name, which also means a
  // mistyped domain ("hernandezauto", the .com dropped) lands in name mode — hence the error
  // below names both possibilities rather than only complaining about a missing city.
  const looksLikeDomain = !wasQuoted && target.includes(".");
  if (looksLikeDomain) return { kind: "website", website: target, city, competitors };

  if (!city) {
    return {
      kind: "error",
      message: [
        `\`${target}\` has no dot in it, so I read it as a business name rather than a website.`,
        "",
        "Auditing by name needs a city, because a trading name on its own is not unique:",
        `\`/audit ${target} | City, ST\``,
        "",
        "If you meant a website, include the domain ending (`.com`, `.net`, and so on).",
      ].join("\n"),
    };
  }

  return { kind: "name", name: target, city, competitors };
}

/** How the target reads back in the ack and in log lines. */
export function describeCommand(parsed: Exclude<ParsedCommand, { kind: "error" }>): string {
  return parsed.kind === "name" ? `${parsed.name} (${parsed.city})` : parsed.website;
}
