// Reading a Google results page off a screenshot.
//
// ‼️ IT TRANSCRIBES. IT DOES NOT TRIAGE. screenshot-read.ts sets this doctrine and this file is the
// fifth reader to follow it: the model reports four things that are either on the screen or not, and
// verdictFrom() in keyword-strategy-rules.ts decides what they mean. A model asked "is this a post
// or a service page" answers confidently from a screenshot it half saw, and the answer is stored as
// evidence. A model asked "is there an AI Overview box" is answering a question about a picture.
//
// ‼️ EVERY FIELD IS TRI-STATE AND null IS A REAL ANSWER. "I could not tell" and "no" are different
// facts, and collapsing them sends a keyword to a page nobody checked. Same rule
// client_keywords.currently_named already carries, and the reason verdictFrom refuses to default to
// `post`.
//
// ‼️ IT RETURNS NO TEXT THAT COULD BECOME A CLAIM. There is no field for a headline, a snippet, a
// price or a quote, and the schema is the enforcement, exactly as SkinRead's is. What is worth
// taking from somebody else's search results is the SHAPE of the page, never its words.

import { callClaudeJSON, camelizeKeys, type ClaudeImageInput } from "@/lib/claude-calls";
import { isResultShape, type SerpRead } from "./keyword-strategy-rules";

/** Haiku, temperature 0. Four observable facts about a layout, which is what Haiku is good at. */
const MODEL = "claude-haiku-4-5-20251001" as const;

/**
 * Image types this lane will read.
 *
 * ‼️ DECLARED HERE RATHER THAN IMPORTED, the same way hub-skin.ts and page-review.ts each declare
 * their own, and for the reason hub-skin.ts writes down: a lane should not take a dependency on
 * another lane for a constant. Four copies of a four-element set is cheaper than a shared module
 * that couples the SERP reader to the skin reader.
 */
export const SERP_VISION_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** The same 6 MB ceiling every other vision reader here uses. Anthropic answers larger with a 413. */
export const MAX_SERP_BYTES = 6 * 1024 * 1024;

const EMPTY: SerpRead = {
  aiOverview: null,
  aiOverviewAnswers: null,
  resultShape: null,
  topDomains: [],
  forumRanks: null,
  clientRanks: null,
  evidence: "nothing readable",
  confidence: 0,
};

/** At most five hosts, lowercased, no scheme and no path. A host is a shape, a URL is a claim. */
function hosts(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const raw of v) {
    if (typeof raw !== "string") continue;
    const host = raw
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0]
      .slice(0, 80);
    if (host.includes(".") && !out.includes(host)) out.push(host);
    if (out.length >= 5) break;
  }
  return out;
}

function tri(v: unknown): boolean | null {
  return v === true || v === false ? v : null;
}

export async function readSerp(image: ClaudeImageInput, phrase: string): Promise<SerpRead> {
  try {
    const { data } = await callClaudeJSON<SerpRead>({
      model: MODEL,
      system: [
        `You are looking at a screenshot of a Google results page for the search "${phrase}". Report what is on the screen. Do not decide what it means.`,
        "",
        "THE FOUR THINGS TO REPORT:",
        "",
        "1. aiOverview: is there an AI Overview box (also called SGE or AI answer) above or among the results? true, false, or null if you cannot tell.",
        "2. aiOverviewAnswers: if there is one, does it FULLY answer the search on its own, so a person would have no reason to click anything? true, false, or null. Return null when there is no AI Overview at all, and null when one is present but cut off so you cannot judge it.",
        "3. resultShape: what the first screen of results mostly IS.",
        "   - 'articles'  blog posts, guides, explainers: pages that answer the question in words",
        "   - 'listings'  a map pack, local business cards, directories, review sites: places rather than answers",
        "   - 'products'  software, tools, pricing pages, app stores: things to buy rather than read",
        "   - 'mixed'     genuinely no majority",
        "   Return null if too little of the page is visible to say.",
        "4. topDomains: up to five hostnames you can actually read, lowercase, no https and no path.",
        "",
        "Also: forumRanks, is a forum in the visible results (reddit, quora, a message board)? clientRanks is always null; you have no way to know whose business this is, so never guess it.",
        "",
        "‼️ null IS A REAL ANSWER AND IS BETTER THAN A GUESS. A half-visible page scored as 'no AI Overview' sends this keyword to a page nobody checked. If the screenshot is cropped above the results, blurred, a different search engine, or not a search results page at all, return nulls and say what you saw in evidence.",
        "",
        "‼️ TRANSCRIBE NOTHING ELSE. Do not return headlines, snippets, prices, ad copy or any sentence from the page. There is no field for them.",
        "",
        "confidence is 0 to 1 and measures how much of the results page is legible on this screen. A full first screen, crisp, is 0.9. A narrow phone screenshot showing two results is 0.5. A page with no results visible is 0.",
        "evidence is one short phrase naming what you saw: 'AI Overview then four articles', 'map pack and three directories', 'cropped above the results'.",
      ].join("\n"),
      user: `Report what is on this Google results page for "${phrase}". Return nulls rather than guesses.`,
      images: [image],
      maxTokens: 500,
      temperature: 0,
      schemaHint:
        '{ "aiOverview": boolean|null, "aiOverviewAnswers": boolean|null, "resultShape": "articles"|"listings"|"products"|"mixed"|null, "topDomains": string[], "forumRanks": boolean|null, "clientRanks": null, "evidence": string, "confidence": number }',
    });

    const raw = camelizeKeys(data) as Partial<SerpRead>;
    const confidence = typeof raw.confidence === "number" ? Math.max(0, Math.min(1, raw.confidence)) : 0;

    return {
      aiOverview: tri(raw.aiOverview),
      // ‼️ "IT ANSWERS IT" IS MEANINGLESS WITH NO BOX ON SCREEN. A model that says there is no AI
      // Overview and then answers the follow-up has answered a question about nothing, and stored
      // as `false` it reads as "we checked and it does not answer it", which is a stronger claim
      // than anybody made.
      aiOverviewAnswers: tri(raw.aiOverview) === true ? tri(raw.aiOverviewAnswers) : null,
      resultShape: isResultShape(raw.resultShape) ? raw.resultShape : null,
      topDomains: hosts(raw.topDomains),
      forumRanks: tri(raw.forumRanks),
      // Never trusted from the model: it cannot know whose business this is.
      clientRanks: null,
      evidence: typeof raw.evidence === "string" ? raw.evidence.slice(0, 160) : "",
      confidence,
    };
  } catch (e) {
    // ‼️ A FAILED READ IS EMPTY, NOT A VERDICT. verdictFrom turns this into `unclear`, the card asks
    // for the typed form, and nothing is stored as though somebody had looked.
    console.error("[clients/serp-read] read failed:", (e as Error).message);
    return { ...EMPTY, evidence: `the read failed: ${(e as Error).message.slice(0, 80)}` };
  }
}
