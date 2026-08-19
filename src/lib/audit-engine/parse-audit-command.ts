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
//   /audit Hernandez Complete Auto Repair                    name, city researched
//   /audit Hernandez Complete Auto Repair | Chicago, IL      name, city pinned
//   /audit "Smith & Co. Plumbing" | Chicago, IL              quotes force name mode
//
// A dot in segment 1 is what makes it a domain. Everything else is a name.

export type ParsedCommand =
  | { kind: "website"; website: string; city?: string; competitors?: string[] }
  | { kind: "name"; name: string; city?: string; competitors?: string[] }
  | { kind: "error"; message: string };

export const AUDIT_USAGE = [
  "Usage:",
  "• `/audit https://website.com` — city and competitors are optional, the system researches those itself.",
  "• `/audit Business Name` — for a business with no website. The city is researched too; you are asked if the name turns out to be ambiguous.",
  "• `/audit Business Name | City, ST` — pin the city yourself when you already know it.",
  "",
  'Wrap the name in quotes if it contains a dot: `/audit "Smith & Co. Plumbing"`.',
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

  // A dot is what makes something a domain. Anything without one is a name — which also means a
  // mistyped domain ("hernandezauto", the .com dropped) lands in name mode. That used to be
  // caught by the missing-city error below; now that a bare name is legal, the research step is
  // what catches it, by failing to find any such business.
  const looksLikeDomain = !wasQuoted && target.includes(".");
  if (looksLikeDomain) return { kind: "website", website: target, city, competitors };

  // ‼️ A missing city is no longer an error here.
  //
  // It was, and the reasoning was sound: a trading name on its own is not unique, so a run with
  // no city scores whichever Hernandez Auto Repair search happened to surface. But refusing at
  // the door put the whole job on Matthew — he had to know the city before he could ask about
  // the business, for the one segment of prospects who by definition have the least published
  // about them.
  //
  // The guarantee moved instead of being dropped. claude-research.ts treats finding the city as
  // part of the task and must report every candidate metro in `alternates`; run-audit-pipeline
  // then ASKS when the answer is ambiguous and refuses to score until it is settled. What is
  // still forbidden is the thing this check was really protecting against — a run that quietly
  // picks a city and never says so.
  return { kind: "name", name: target, city, competitors };
}

/** How the target reads back in the ack and in log lines. */
export function describeCommand(parsed: Exclude<ParsedCommand, { kind: "error" }>): string {
  if (parsed.kind === "website") return parsed.website;
  return parsed.city ? `${parsed.name} (${parsed.city})` : parsed.name;
}
