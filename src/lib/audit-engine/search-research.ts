// Fallback research for the Audit Engine: work out what a business IS without reading its
// website, by asking the same web-search engine the audit itself runs against.
//
// Two situations need it, and they are the same problem wearing different clothes:
//   1. the homepage could not be read (blocked, timed out, host unreachable)
//   2. the homepage WAS read and says almost nothing (a splash page, a JS-only shell)
// In both, classify.ts would otherwise write 20 generic questions that measure nothing.
//
// The crawl was never an input to the answers — the score comes entirely from audit_runs.
// It only ever fed the QUESTIONS. So a business we can identify from third-party sources can
// still be audited for real, which is the whole point of this file.
//
// NO FABRICATED DATA, same rule as run-prompts.ts: if search cannot say who this is, this
// returns null and the pipeline fails with the real reason. An invented business would
// produce 20 confident questions about a company that does not exist.

import { runOpenAI } from "./run-prompts";
import type { SiteResearch } from "./site-research";
import type { CrawlBlock } from "./types";

/** The model is told to return exactly this when it cannot identify the business. Checked as
 *  a substring rather than an equality, because it will wrap it in a sentence. */
const NOT_FOUND = "NOT_FOUND";

/** Under this, the answer is a shrug dressed as prose, not a profile. */
const MIN_PROFILE_CHARS = 250;

/** Directory/marketplace hosts do not tell us the profile is right, but a profile assembled
 *  with NO third-party source behind it is the model talking from memory, which is the one
 *  thing this file exists to prevent. */
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

function buildProfilePrompt(website: string): string {
  const host = hostOf(website);
  return [
    `I am trying to identify the business that operates the website ${host}.`,
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
    `If you cannot find a real business at ${host}, reply with exactly ${NOT_FOUND} and nothing else.`,
  ].join("\n");
}

/**
 * Build a SiteResearch from search instead of from the page.
 *
 * `existing` is passed on the thin-content path: whatever the page DID give us is kept and the
 * search profile is appended under its own heading, so real first-party text is never thrown
 * away in favour of a directory listing.
 *
 * Returns null when the business cannot be identified — the caller then fails the audit.
 */
export async function researchViaSearch(
  website: string,
  block: CrawlBlock | null,
  existing?: SiteResearch
): Promise<SiteResearch | null> {
  // Reuses the audit's own engine call: same 45s timeout, same one retry, same web_search
  // tool, same url_citation parsing, and the same no_data contract. A second implementation
  // of this request is a second thing to keep in step.
  const result = await runOpenAI(buildProfilePrompt(website), null);

  if (result.status !== "ok") {
    console.error(`[search-research] ${website}: engine returned no data (${result.error})`);
    return null;
  }

  const profile = result.raw.trim();
  if (profile.includes(NOT_FOUND) || profile.length < MIN_PROFILE_CHARS) {
    console.error(`[search-research] ${website}: no identifiable business in the answer`);
    return null;
  }
  if (!hasThirdPartySource(result.citations, website)) {
    console.error(`[search-research] ${website}: answer cited no third-party source`);
    return null;
  }

  const header = [
    `Profile of the business at ${hostOf(website)}, assembled from third-party sources`,
    `because the site itself could not be read. Sources: ${result.citations.join(", ") || "none listed"}.`,
    "",
  ].join("\n");

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
    website,
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
    source: "search",
    blocked: block,
  };
}
