// Reading a Google results page off a screenshot.
//
// ‼️ IT TRANSCRIBES. IT DOES NOT TRIAGE. screenshot-read.ts sets this doctrine and this file is the
// fifth reader to follow it: the model reports things that are either on the screen or not, and
// verdictFrom(), clickValueFrom() and citationValueFrom() in keyword-strategy-rules.ts decide what
// they mean. A model asked "is this a post or a service page" answers confidently from a screenshot
// it half saw, and the answer is stored as evidence. A model asked "is there an AI Overview box" is
// answering a question about a picture.
//
// ‼️ EVERY FIELD IS TRI-STATE AND null IS A REAL ANSWER. "I could not tell" and "no" are different
// facts, and collapsing them sends a keyword to a page nobody checked. Same rule
// client_keywords.currently_named already carries, and the reason verdictFrom refuses to default to
// `post`.
//
// ‼️ IT RETURNS NO TEXT THAT COULD BECOME A CLAIM, AND THAT RULE IS UNCHANGED. There is no field for
// a headline, a snippet, a price, an advert or any sentence from anybody's page, and the schema is
// the enforcement, exactly as SkinRead's is.
//
// ‼️ TWO TEXT FIELDS WERE ADDED ON 2026-09-24 AND THE LINE THEY SIT ON IS: A QUERY IS NOT A CLAIM,
// AND A TERM IS NOT A SENTENCE.
//
//   paaQuestions  A "People also ask" entry is a SEARCH. It is the same class of object as the
//                 phrase being looked at, and searches are what this entire step is made of. Taking
//                 one is not taking somebody's writing, it is reading Google's own question set for
//                 the subject, which is what the language mirror needs.
//   vocabulary    WHICH of two competing words appeared ("tox" against "Botox"), what unit a price
//                 was quoted in. That is shape, the same kind of fact as resultShape, and it is what
//                 lets a page be written in the words that are already on the results page.
//
// Both are capped HERE, in code, and not only in the prompt, because a prompt is a request and a cap
// is a guarantee. Anything with a full stop in it is dropped from vocabulary: that is a sentence
// wearing a term's clothes, and it is the only way this field grows into the thing the rule forbids.

import { callClaudeJSON, camelizeKeys, type ClaudeImageInput } from "@/lib/claude-calls";
import { isResultShape, type SerpRead } from "./keyword-strategy-rules";

/**
 * Haiku, temperature 0. Observable facts about a layout, which is what Haiku is good at.
 *
 * ‼️ EXPORTED SINCE 2026-09-24. keyword-strategy.ts carried this same string as a literal so it
 * could stamp `model` onto the stored row, which meant a model bump had to be made in two files and
 * would silently mislabel every reading if it were made in one.
 */
export const SERP_MODEL = "claude-haiku-4-5-20251001" as const;

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

/** At most this many People Also Ask questions, and this many characters each. */
export const MAX_PAA = 8;
const MAX_PAA_CHARS = 100;
/** At most this many vocabulary terms, and this many characters each. A term, never a phrase. */
export const MAX_VOCABULARY = 12;
const MAX_VOCABULARY_CHARS = 40;

const EMPTY: SerpRead = {
  aiOverview: null,
  aiOverviewAnswers: null,
  aiOverviewSatisfies: null,
  resultShape: null,
  topDomains: [],
  forumRanks: null,
  clientRanks: null,
  localPack: null,
  paaPresent: null,
  adsAboveFold: null,
  paaQuestions: [],
  vocabulary: [],
  queryOnScreen: null,
  hasScript: null,
  hasSteps: null,
  hasChecklist: null,
  videosRank: null,
  evidence: "nothing readable",
  confidence: 0,
};

/** At most this many characters of search box text. A query, never a paragraph. */
export const MAX_QUERY_CHARS = 100;

/**
 * The text in the search box.
 *
 * ‼️ CAPPED IN CODE, like every other text field here, because a prompt is a request and a cap is a
 * guarantee. A model that drifts from "the search" to "the search and the first headline" does it by
 * returning something long, and this is what stops that becoming a claim in the database.
 */
function queryLine(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const q = v.trim().replace(/\s+/g, " ").slice(0, MAX_QUERY_CHARS);
  if (q.length < 2) return null;
  // The model was asked for the search and had nothing to report; that is a null, not a phrase.
  if (/^(null|none|n\/a|unknown)$/i.test(q)) return null;
  return q;
}

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

/**
 * The People Also Ask questions, capped and deduped.
 *
 * A question mark is not required: Google prints plenty of PAA entries as noun phrases. What IS
 * required is that it stays short, because the cap is what keeps this field a query rather than a
 * paragraph somebody could quote.
 */
function questions(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const raw of v) {
    if (typeof raw !== "string") continue;
    const q = raw.trim().replace(/\s+/g, " ").slice(0, MAX_PAA_CHARS);
    if (q.length < 3) continue;
    if (out.some((existing) => existing.toLowerCase() === q.toLowerCase())) continue;
    out.push(q);
    if (out.length >= MAX_PAA) break;
  }
  return out;
}

/**
 * The vocabulary terms, capped and deduped.
 *
 * ‼️ ANYTHING CARRYING A FULL STOP IS DROPPED, and that single test is what holds the line this
 * field sits on. A term is "tox", "units", "per syringe". A sentence is what this lane refuses to
 * take off somebody else's page, and a model that drifts from one to the other does it by returning
 * a clause with a stop in it. Same shape of test searchable() uses to tell a statement from a
 * search, and for the same reason.
 */
function terms(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const raw of v) {
    if (typeof raw !== "string") continue;
    const t = raw.trim().replace(/\s+/g, " ");
    if (!t || t.length > MAX_VOCABULARY_CHARS) continue;
    if (t.includes(".")) continue;
    // Three words is a phrase, not a term. "per unit" is fine; "botox lasts three months" is a claim.
    if (t.split(" ").length > 2) continue;
    if (out.some((existing) => existing.toLowerCase() === t.toLowerCase())) continue;
    out.push(t);
    if (out.length >= MAX_VOCABULARY) break;
  }
  return out;
}

function tri(v: unknown): boolean | null {
  return v === true || v === false ? v : null;
}

/** A 0..5 the model may not have answered. null is a real answer here too. */
function score05(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.max(0, Math.min(5, Math.round(v)));
}

function count(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return null;
  return Math.min(20, Math.round(v));
}

/**
 * Read one Google results page.
 *
 * ‼️ `phrase` IS OPTIONAL AND THAT IS THE POINT. Pass it when somebody typed `keywords serp 12` and
 * we know which row they meant; pass null when a screenshot arrived on its own. Either way the model
 * reports `queryOnScreen`, because the search is ON THE SCREEN and always was: the number never
 * needed typing. When the phrase is known it becomes a cross-check rather than the truth, which is
 * the first time a picture filed against the wrong keyword has been detectable at all.
 */
export async function readSerp(image: ClaudeImageInput, phrase: string | null): Promise<SerpRead> {
  try {
    const { data } = await callClaudeJSON<SerpRead>({
      model: SERP_MODEL,
      system: [
        phrase
          ? `You are looking at a screenshot of a Google results page. Somebody says it is for the search "${phrase}", but READ THE SEARCH BOX YOURSELF and report what is actually in it. Report what is on the screen. Do not decide what it means.`
          : `You are looking at a screenshot of a Google results page. The search is the text in the box at the top of the screen: read it first. Report what is on the screen. Do not decide what it means.`,
        "",
        "WHAT TO REPORT:",
        "",
        "0. queryOnScreen: the text typed in the search box at the top of the page, exactly as written. THIS IS A SEARCH, the same kind of thing as a 'People also ask' entry. Return null if the search box is cropped off or unreadable. Never guess it from the results.",
        "1. aiOverview: is there an AI Overview box (also called SGE or AI answer) above or among the results? true, false, or null if you cannot tell.",
        "2. aiOverviewAnswers: if there is one, does it FULLY answer the search on its own, so a person would have no reason to click anything? true, false, or null. Return null when there is no AI Overview at all, and null when one is present but cut off so you cannot judge it.",
        "3. aiOverviewSatisfies: 0 to 5, how completely that box resolves the search on its own. 0 is it barely touches the question, 5 is a person would have no reason to click anything. Return null when there is no AI Overview, and null when it is cut off so you cannot judge it.",
        "4. resultShape: what the first screen of results mostly IS.",
        "   - 'articles'  blog posts, guides, explainers: pages that answer the question in words",
        "   - 'listings'  a map pack, local business cards, directories, review sites: places rather than answers",
        "   - 'products'  software, tools, pricing pages, app stores: things to buy rather than read",
        "   - 'mixed'     genuinely no majority",
        "   Return null if too little of the page is visible to say.",
        "5. topDomains: up to five hostnames you can actually read, lowercase, no https and no path.",
        "6. localPack: is there a map with business cards on it? paaPresent: is there a 'People also ask' box? forumRanks: is a forum in the visible results (reddit, quora, a message board)? Each true, false, or null.",
        "7. adsAboveFold: how many sponsored or ad results sit above the first normal result. 0 if none, null if you cannot tell.",
        "8. paaQuestions: the questions inside the 'People also ask' box, exactly as written, at most eight. THESE ARE SEARCHES, the same kind of thing as the phrase at the top of this prompt. Empty array if there is no such box.",
        "9. vocabulary: at most twelve single words or two-word terms that the results themselves use for this subject, so we can write in the words already on the page. For example a word the results prefer over its synonym, or the unit a price is quoted in. TERMS ONLY. Never a phrase from a headline, never anything with a full stop in it.",
        "10. Four questions about whether there is a THING on this page, as against an explanation of a subject. Each true, false, or null.",
        "   - hasScript:    are there words somebody is meant to SAY or SEND, quoted? A line to read to a customer, a text message, an email template.",
        "   - hasSteps:     is there a numbered or ordered list of things to do?",
        "   - hasChecklist: is there a list of things to tick off, a form, or something printable?",
        "   - videosRank:   are there video results in the visible list, a video carousel or a YouTube result?",
        "   ‼️ These are four questions about a PICTURE. Do not tell us whether the page is useful, whether the advice is good, or what the steps say. Only whether the thing is on the screen. Do NOT transcribe any of it.",
        "",
        "clientRanks is always null; you have no way to know whose business this is, so never guess it.",
        "",
        "‼️ null IS A REAL ANSWER AND IS BETTER THAN A GUESS. A half-visible page scored as 'no AI Overview' sends this keyword to a page nobody checked. If the screenshot is cropped above the results, blurred, a different search engine, or not a search results page at all, return nulls and say what you saw in evidence.",
        "",
        "‼️ TRANSCRIBE NOTHING ELSE. No headlines, no snippets, no prices, no advert copy, no sentence from any result, and nothing out of the AI Overview itself. queryOnScreen, paaQuestions and vocabulary are the only text fields on this form, all three are SEARCHES or TERMS rather than anybody's writing, and all three are capped. There is no field for anything else and there will not be one.",
        "",
        "confidence is 0 to 1 and measures how much of the results page is legible on this screen. A full first screen, crisp, is 0.9. A narrow phone screenshot showing two results is 0.5. A page with no results visible is 0.",
        "evidence is one short phrase naming what you saw: 'AI Overview then four articles', 'map pack and three directories', 'cropped above the results'.",
      ].join("\n"),
      user: phrase
        ? `Report what is on this Google results page. Read the search box and report queryOnScreen from it, not from the phrase you were given. Return nulls rather than guesses.`
        : `Report what is on this Google results page, starting with the search in the box at the top. Return nulls rather than guesses.`,
      images: [image],
      maxTokens: 1000,
      temperature: 0,
      schemaHint:
        '{ "queryOnScreen": string|null, "aiOverview": boolean|null, "aiOverviewAnswers": boolean|null, "aiOverviewSatisfies": number|null, "resultShape": "articles"|"listings"|"products"|"mixed"|null, "topDomains": string[], "localPack": boolean|null, "paaPresent": boolean|null, "forumRanks": boolean|null, "adsAboveFold": number|null, "paaQuestions": string[], "vocabulary": string[], "hasScript": boolean|null, "hasSteps": boolean|null, "hasChecklist": boolean|null, "videosRank": boolean|null, "clientRanks": null, "evidence": string, "confidence": number }',
    });

    const raw = camelizeKeys(data) as Partial<SerpRead>;
    const confidence = typeof raw.confidence === "number" ? Math.max(0, Math.min(1, raw.confidence)) : 0;
    const aiOverview = tri(raw.aiOverview);

    return {
      aiOverview,
      // ‼️ "IT ANSWERS IT" IS MEANINGLESS WITH NO BOX ON SCREEN. A model that says there is no AI
      // Overview and then answers the follow-up has answered a question about nothing, and stored
      // as `false` it reads as "we checked and it does not answer it", which is a stronger claim
      // than anybody made.
      aiOverviewAnswers: aiOverview === true ? tri(raw.aiOverviewAnswers) : null,
      // Same rule, same reason. A satisfaction score for a box that is not there would be read by
      // clickValueFrom as a real deduction, and a page with no AI Overview would score as though it
      // had one that answered nothing.
      aiOverviewSatisfies: aiOverview === true ? score05(raw.aiOverviewSatisfies) : null,
      resultShape: isResultShape(raw.resultShape) ? raw.resultShape : null,
      topDomains: hosts(raw.topDomains),
      forumRanks: tri(raw.forumRanks),
      localPack: tri(raw.localPack),
      paaPresent: tri(raw.paaPresent),
      adsAboveFold: count(raw.adsAboveFold),
      // ‼️ QUESTIONS ARE KEPT EVEN WHEN paaPresent READS null, because the questions ARE the
      // evidence the box was there. Dropping them on a null flag would throw away the better answer
      // in deference to the worse one.
      paaQuestions: questions(raw.paaQuestions),
      vocabulary: terms(raw.vocabulary),
      queryOnScreen: queryLine(raw.queryOnScreen),
      // ‼️ NOT NULLED AGAINST ANYTHING, unlike aiOverviewAnswers above. A script can be in an AI
      // Overview, in a featured snippet, or in the first organic result, and all three are "there is
      // a deliverable on this page". Tying these to aiOverview would throw away the reading on every
      // SERP that has no box, which is most of the ones worth building for.
      hasScript: tri(raw.hasScript),
      hasSteps: tri(raw.hasSteps),
      hasChecklist: tri(raw.hasChecklist),
      videosRank: tri(raw.videosRank),
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
