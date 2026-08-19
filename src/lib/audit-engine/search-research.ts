// Fallback research for the Audit Engine: work out what a business IS without reading its
// website, by asking the same web-search engine the audit itself runs against.
//
// Three situations need it, and they are the same problem wearing different clothes:
//   1. the homepage could not be read (blocked, timed out, host unreachable)
//   2. the homepage WAS read and says almost nothing (a splash page, a JS-only shell)
//   3. there is no homepage at all — a business with a Google Business Profile and nothing else
// In all three, classify.ts would otherwise write 20 generic questions that measure nothing.
//
// The crawl was never an input to the answers — the score comes entirely from audit_runs.
// It only ever fed the QUESTIONS. So a business we can identify from third-party sources can
// still be audited for real, which is the whole point of this file.
//
// NO FABRICATED DATA, same rule as run-prompts.ts: if search cannot say who this is, this
// returns null and the pipeline fails with the real reason. An invented business would
// produce 20 confident questions about a company that does not exist.

import { runOpenAI } from "./run-prompts";
import { researchViaClaude, type BusinessIdentity } from "./claude-research";
import type { SiteResearch } from "./site-research";
import type { CrawlBlock } from "./types";

/** The model is told to return exactly this when it cannot identify the business. Checked as
 *  a substring rather than an equality, because it will wrap it in a sentence. */
const NOT_FOUND = "NOT_FOUND";

/** Under this, the answer is a shrug dressed as prose, not a profile. */
const MIN_PROFILE_CHARS = 250;

/**
 * What we are trying to identify.
 *
 * `website` is the "we could not read their site" path: a domain exists and the whole question
 * is who is behind it. `name` is the "there is no site" path, where Matthew has named the
 * business and its city off a Google result.
 *
 * ‼️ The city on the name form is what separates one trading name from another business trading
 * under the same one — search will cheerfully return the wrong Hernandez Auto Repair three
 * states away if nothing pins it down.
 *
 * It became OPTIONAL on 2026-08-19, and the guarantee moved rather than disappeared. When
 * Matthew supplies a city it still pins the search exactly as before. When he does not,
 * claude-research.ts is required to treat finding the city as part of the task and to report
 * every candidate metro in `alternates` instead of quietly choosing one; the pipeline then asks
 * rather than guesses. What must never happen is a run that silently settles on a city — that is
 * the failure this comment has always been about, and an absent city does not change it.
 */
export type ResearchTarget =
  | { kind: "website"; website: string }
  | { kind: "name"; name: string; city?: string };

/** Directory/marketplace hosts do not tell us the profile is right, but a profile assembled
 *  with NO third-party source behind it is the model talking from memory, which is the one
 *  thing this file exists to prevent.
 *
 *  Only meaningful on the website form: with no domain of our own to compare against, every
 *  citation is by definition third-party, so the name form skips this check rather than
 *  passing it vacuously. */
function hasThirdPartySource(citations: string[], website: string): boolean {
  let ownHost: string;
  try {
    ownHost = new URL(website).hostname.replace(/^www\./, "");
  } catch {
    ownHost = "";
  }
  return citations.some((c) => {
    try {
      return new URL(c).hostname.replace(/^www\./, "") !== ownHost;
    } catch {
      return false;
    }
  });
}

function hostOf(website: string): string {
  try {
    return new URL(website).hostname.replace(/^www\./, "");
  } catch {
    return website;
  }
}

/** How the target reads in a log line or an error message. */
export function describeTarget(target: ResearchTarget): string {
  if (target.kind === "website") return target.website;
  return target.city ? `${target.name} (${target.city})` : target.name;
}

function buildProfilePrompt(target: ResearchTarget): string {
  // The opening line and the give-up line are the ONLY things that differ between the two
  // forms. Everything else, third-party sources only, no gap-filling, the NOT_FOUND escape,
  // is the guarantee this file exists for and is identical either way.
  const [opening, giveUp] =
    target.kind === "website"
      ? [
          `I am trying to identify the business that operates the website ${hostOf(target.website)}.`,
          `If you cannot find a real business at ${hostOf(target.website)}, reply with exactly ${NOT_FOUND} and nothing else.`,
        ]
      : target.city
        ? [
            `I am trying to identify a business called "${target.name}" in ${target.city}. It appears to have no website of its own, so every source you find will be a third-party one.`,
            // The second sentence is load-bearing. Told only to return NOT_FOUND, the model
            // reaches for the same trading name in another metro rather than give up, and 20
            // questions then get written about a business three states away.
            `If you cannot find a real business called "${target.name}" in ${target.city}, reply with exactly ${NOT_FOUND} and nothing else. Do NOT substitute a business with a similar name in a different city.`,
          ]
        : [
            `I am trying to identify a business called "${target.name}". I do not know what city it is in, so say which city it operates from. It appears to have no website of its own, so every source you find will be a third-party one.`,
            // With no city to pin it, the same substitution risk becomes a risk of silently
            // MERGING two businesses that share a name. Naming the ambiguity is the answer.
            `If businesses trade under this name in more than one city, say so explicitly and name every city rather than picking one. If you cannot find a real business called "${target.name}" at all, reply with exactly ${NOT_FOUND} and nothing else.`,
          ];

  return [
    opening,
    "",
    "Search the web and tell me, from sources OTHER than that website itself (Google Business",
    "Profile, Yelp, Facebook, Instagram, Apple Maps, industry directories, local news, review",
    "sites):",
    "",
    "1. The exact business name it trades under.",
    "2. What it actually sells or does, in plain language.",
    "3. The city and state it serves customers from, if it is a local business.",
    "4. Its main services or products, listed.",
    "5. What customers say about it in reviews, and roughly how many reviews exist.",
    "6. Who its local competitors appear to be.",
    "",
    "Report only what the sources actually say. Do not describe the website itself, you have",
    "not seen it. Do not fill gaps from general knowledge.",
    "",
    giveUp,
  ].join("\n");
}

/**
 * Build a SiteResearch from search instead of from the page.
 *
 * `existing` is passed on the thin-content path: whatever the page DID give us is kept and the
 * search profile is appended under its own heading, so real first-party text is never thrown
 * away in favour of a directory listing. It is never passed on the name form, which has no page.
 *
 * Returns null when the business cannot be identified — the caller then fails the audit.
 */
export async function researchViaSearch(
  target: ResearchTarget,
  block: CrawlBlock | null,
  existing?: SiteResearch
): Promise<SiteResearch | null> {
  const label = describeTarget(target);

  // Reuses the audit engine call itself: same 45s timeout, same one retry, same web_search
  // tool, same url_citation parsing, and the same no_data contract. A second implementation
  // of this request is a second thing to keep in step.
  const result = await runOpenAI(buildProfilePrompt(target), null);

  if (result.status !== "ok") {
    console.error(`[search-research] ${label}: engine returned no data (${result.error})`);
    return null;
  }

  const profile = result.raw.trim();
  if (profile.includes(NOT_FOUND) || profile.length < MIN_PROFILE_CHARS) {
    console.error(`[search-research] ${label}: no identifiable business in the answer`);
    return null;
  }
  if (target.kind === "website" && !hasThirdPartySource(result.citations, target.website)) {
    console.error(`[search-research] ${label}: answer cited no third-party source`);
    return null;
  }

  const sources = result.citations.join(", ") || "none listed";
  const header =
    (target.kind === "website"
      ? [
          `Profile of the business at ${hostOf(target.website)}, assembled from third-party sources`,
          `because the site itself could not be read. Sources: ${sources}.`,
        ]
      : [
          `Profile of "${target.name}"${target.city ? ` in ${target.city}` : ""}, assembled from third-party`,
          `sources because the business has no website of its own. Sources: ${sources}.`,
        ]
    ).join("\n") + "\n\n";

  const searchText = `${header}${profile}`;

  if (existing) {
    return {
      ...existing,
      source: "site+search",
      blocked: block,
      bodyText: [existing.bodyText.trim(), "", "--- Third-party research ---", "", searchText]
        .join("\n")
        .slice(0, 16000),
      pages: [...existing.pages, ...result.citations.map((url) => ({ url, text: "" }))],
    };
  }

  return {
    // Null on the name form, and that is the honest value: there is no site, so nothing
    // downstream may fetch robots.txt for it or print it as a fallback display name.
    website: target.kind === "website" ? target.website : null,
    // Deliberately null, not guessed: these are facts about MARKUP we never saw. site-signals
    // is skipped entirely on this path for the same reason.
    title: null,
    metaDescription: null,
    siteName: null,
    headings: [],
    pages: result.citations.map((url) => ({ url, text: "" })),
    bodyText: searchText.slice(0, 16000),
    schemaHints: [],
    homepageHtml: "",
    // "search" = a site exists and we could not read it. "declared" = there is no site.
    // Only the first is a fact about their crawler setup. See ResearchSource in types.ts.
    source: target.kind === "website" ? "search" : "declared",
    blocked: block,
  };
}

// ---------------------------------------------------------------------------
// The dispatcher: Claude first, OpenAI second
// ---------------------------------------------------------------------------

/**
 * Identify a business, whichever engine can do it.
 *
 * ORDER, and why it is this way round:
 *   1. claude-research.ts — Anthropic's server-side web_search on ANTHROPIC_API_KEY, which is
 *      set and working in production. It also returns STRUCTURE (city, alternates, discovered
 *      websites) that the caller needs and cannot reliably regex back out of prose.
 *   2. researchViaSearch above — the original OpenAI path. Kept, not deleted: it is a genuinely
 *      independent second opinion from a different index, and the day Anthropic is having an
 *      outage is exactly the day an audit should still run.
 *
 * The backup returns no `identity`, so a caller that needs a city from it has to ask. That is
 * correct rather than unfortunate: prose does not carry a confidence, and inventing one from a
 * regex is how a low-confidence city gets promoted to a fact.
 */
export async function researchProfile(
  target: ResearchTarget,
  block: CrawlBlock | null,
  existing?: SiteResearch
): Promise<{ research: SiteResearch; identity: BusinessIdentity | null }> {
  const label = describeTarget(target);

  const viaClaude = await researchViaClaude(target, block, existing);
  if (viaClaude) return { research: viaClaude.research, identity: viaClaude.identity };

  console.warn(`[search-research] ${label}: Claude research came back empty, trying OpenAI`);
  const viaOpenAI = await researchViaSearch(target, block, existing);
  if (viaOpenAI) return { research: viaOpenAI, identity: null };

  // Both engines declined to identify the business. The caller fails the audit with a real
  // reason; nothing here invents one to keep the run alive.
  throw new ResearchFailedError(label);
}

/** Neither engine could identify the business. Thrown rather than returned null so a caller
 *  cannot accidentally treat "not identified" as "identified with empty fields". */
export class ResearchFailedError extends Error {
  constructor(public readonly label: string) {
    super(
      `Could not identify "${label}" from any third-party source, so there was nothing to build ` +
        `questions from. Check the spelling. Nothing was scored.`
    );
    this.name = "ResearchFailedError";
  }
}
