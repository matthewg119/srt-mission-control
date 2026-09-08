// Reading ONE customer review off a screenshot of it, word for word.
//
// Matthew: "an option within the drafter to create a new post or create from a review where we
// can send a screenshot of the review and highlight it in a post."
//
// ─────────────────────────────────────────────────────────────────────────────
// ‼️ READ THIS BEFORE ASSUMING THIS FILE IS THE FORBIDDEN THING. IT IS THE OPPOSITE ONE.
//
// FTC 16 CFR Part 465 regulates a tool that GENERATES review content its user did not write.
// That is the Rytr fact pattern, and it is why src/lib/hub/review-assemble.ts imports nothing
// and why no model may go near the review tool.
//
// This file writes no review. It transcribes one a customer already published, so the client
// can quote it in their own marketing, which is what draft-page.ts:3-8 already draws the line
// around: "A hub page is the CLIENT's own marketing copy on the client's own domain, published
// under their name after a person read it, the same thing an agency has always written for a
// client. Different artifact, different rule. Do not fold the two together."
//
// Nothing here imports review-assemble.ts, the review tool or anything under src/app/hub/.
// ─────────────────────────────────────────────────────────────────────────────
//
// ‼️ AND THE DANGEROUS INSTINCT IS TIDYING, NOT INVENTING.
//
// A model handed a review will fix its spelling, straighten its grammar and trim its rambling,
// because that is what being helpful looks like everywhere else. Here it is the whole failure:
// a corrected quote is a quote WE wrote, attributed to a customer who wrote something else.
// The system prompt below spends most of its length on this one point, and `verbatim` is
// checked again downstream in draft-page.ts before a claim may cite one of these.
//
// ‼️ IT PROPOSES. IT DOES NOT RECORD.
// Everything here lands in page_studio_sessions.proposed_review and nowhere else, the same slot
// discipline review-read.ts follows for review_audit_rows.proposed. A page_sources row is
// written by a person pressing [Use this quote] and by nothing else.

import { callClaudeJSON, camelizeKeys, type ClaudeImageInput } from "@/lib/claude-calls";

/** Haiku, temperature 0. Transcription, the same model and settings the other readers use. */
const MODEL = "claude-haiku-4-5-20251001" as const;

export interface ReviewQuoteRead {
  /**
   * The review body, character for character, exactly as printed.
   *
   * ‼️ THE ONE FIELD THE WHOLE FILE EXISTS FOR. Typos kept, grammar kept, capitals kept.
   */
  quote: string | null;
  /** The reviewer's name as the listing prints it ("Sarah M."). Never expanded, never guessed. */
  authorAsPrinted: string | null;
  /** The star rating printed on the review itself, not the business average. Null if absent. */
  rating: number | null;
  /** ISO date if one is printed, else the phrase as printed ("3 weeks ago"), else null. */
  reviewedAtAsPrinted: string | null;
  /** The business the review is ABOUT, as printed, so a caller can check it is this client. */
  subjectName: string | null;
  /** The address bar, verbatim, which is how the platform is resolved. */
  listingUrl: string | null;
  /** Whether the review body is fully on screen. A truncated quote is not a quote. */
  truncated: boolean;
  /** How clearly the review text is readable. NOT confidence about the business. */
  legible: number;
  evidence: string;
}

const EMPTY: ReviewQuoteRead = {
  quote: null,
  authorAsPrinted: null,
  rating: null,
  reviewedAtAsPrinted: null,
  subjectName: null,
  listingUrl: null,
  truncated: false,
  legible: 0,
  evidence: "nothing readable",
};

export async function readReviewQuote(image: ClaudeImageInput): Promise<ReviewQuoteRead> {
  try {
    const { data } = await callClaudeJSON<ReviewQuoteRead>({
      model: MODEL,
      system: [
        "You are looking at a screenshot of ONE public customer review of a business, on Google Maps, Yelp, Trustpilot, Facebook or the BBB. Your job is to copy it out, character for character.",
        "",
        "YOU ARE A TRANSCRIBER. YOU ARE NOT AN EDITOR, AND THIS IS THE ONLY RULE THAT MATTERS:",
        "- Copy the review body EXACTLY as written. Keep every typo, every misspelling, every missing apostrophe, every run-on sentence, every ALL CAPS word, every repeated letter.",
        "- Do not fix grammar. Do not fix punctuation. Do not fix capitalisation. Do not tidy spacing beyond joining lines the layout broke.",
        "- Do not shorten it. Do not summarise it. Do not remove a rambling middle. Do not drop a sentence because it is off topic.",
        "- Do not translate it. If it is in Spanish, return the Spanish.",
        "- Do not merge two reviews. If several are visible, return the single one that is most fully in view and ignore the rest.",
        "- Emoji stay. If the customer typed a heart, the heart is part of what they wrote.",
        "",
        "Someone is going to publish this on the business's own website with the customer's name against it. A word you improved is a word that customer never said, attributed to them in public. Returning nothing is always better than returning something close.",
        "",
        "TRUNCATION IS A REAL ANSWER:",
        "- Many listings cut a long review off behind a More or Read more link. If the body is cut off, set truncated true and return the part you CAN see in quote. Never continue it, never guess the ending, never write a closing sentence.",
        "- If nothing but a headline is visible and there is no body, quote is null.",
        "",
        "THE OTHER FIELDS ARE ALSO TRANSCRIPTION, NOT INFERENCE:",
        "- authorAsPrinted: the reviewer's name exactly as shown, including an initial or a Local Guide suffix if that is how it reads. Never expand S. to Sarah. If it is anonymous, null.",
        "- rating: the stars on THIS review, on the scale printed. Not the business average shown at the top of the page. If this review shows no rating, null.",
        "- reviewedAtAsPrinted: if an absolute date is printed, copy it. If it is relative (3 weeks ago, a month ago), copy that phrase exactly. Never convert one into the other and never work out a date from today.",
        "- subjectName: the business the review is about, as the page prints it. Do not tidy it.",
        "- listingUrl: the browser address bar, character for character. If it is not visible or not legible, null. Never reconstruct it from the page.",
        "",
        "legible is 0 to 1 and measures how clearly the REVIEW TEXT is readable on this screen: crisp and fully in view is 0.9; small, blurry or half scrolled away is 0.3; something that is not a customer review at all is 0.",
        "evidence is one short phrase naming what you are looking at: google maps review, yelp review, trustpilot review, a business profile with no review body in view.",
      ].join("\n"),
      user:
        "Copy out this customer review exactly as written, with the reviewer's name as printed, the rating on this review, the date as printed, the business it is about, and the address bar verbatim. Keep every typo. Return null for anything not on the page.",
      images: [image],
      maxTokens: 1400,
      temperature: 0,
      schemaHint:
        '{ "quote": string|null, "authorAsPrinted": string|null, "rating": number|null, "reviewedAtAsPrinted": string|null, "subjectName": string|null, "listingUrl": string|null, "truncated": boolean, "legible": number, "evidence": string }',
      coerce: camelizeKeys,
      validate: (v: unknown): v is ReviewQuoteRead => {
        const o = v as ReviewQuoteRead;
        return !!o && typeof o === "object" && typeof o.legible === "number";
      },
      describeInvalid: () =>
        "Return the object with every key present, null for anything not printed on the page, and a numeric legible between 0 and 1.",
    });

    return {
      // ‼️ TRIMMED AT THE ENDS ONLY. Leading and trailing whitespace is layout; anything inside
      // the quote is what they typed and is not this function's to normalise.
      quote: blankToNull(data.quote),
      authorAsPrinted: blankToNull(data.authorAsPrinted),
      rating: ratingOrNull(data.rating),
      reviewedAtAsPrinted: blankToNull(data.reviewedAtAsPrinted),
      subjectName: blankToNull(data.subjectName),
      listingUrl: blankToNull(data.listingUrl),
      truncated: data.truncated === true,
      legible: Number.isFinite(data.legible) ? data.legible : 0,
      evidence: data.evidence?.trim() || "not stated",
    };
  } catch (e) {
    console.error("[clients/review-quote-read] vision read failed:", (e as Error).message);
    return { ...EMPTY, evidence: `read failed: ${(e as Error).message}` };
  }
}

function blankToNull(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t.length > 0 ? t : null;
}

/**
 * ‼️ A STRING "" MUST NOT BECOME 0. Number("") is 0, the trap review-audit.ts names by name, and
 * a zero-star review is a claim about a customer rather than an absence of one.
 *
 * Out of range means it read something that is not this rating, so it reports nothing.
 */
function ratingOrNull(v: unknown): number | null {
  const n =
    typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v.trim()) : NaN;
  if (!Number.isFinite(n)) return null;
  return n >= 0 && n <= 5 ? n : null;
}

/** Below this the read is treated as no reading at all. Same threshold review-read.ts uses. */
export const MIN_LEGIBLE = 0.5;

/**
 * Is this a quote somebody could actually publish?
 *
 * ‼️ A TRUNCATED QUOTE FAILS, and that is stricter than legibility. A half-review reads as a
 * whole one once it is on a page, and the missing half is the part that said "but". Scroll and
 * take the shot again is a cheap ask; publishing three quarters of what a customer said under
 * their name is not.
 */
export function isUsableQuote(read: ReviewQuoteRead): boolean {
  return read.legible >= MIN_LEGIBLE && !!read.quote && !read.truncated;
}

/** Why an unusable read was refused, in the words the studio card prints. */
export function quoteRefusal(read: ReviewQuoteRead): string {
  if (read.legible < MIN_LEGIBLE) {
    return `I could not read a review off that (${read.evidence}). Take the shot with the review text fully on screen.`;
  }
  if (!read.quote) {
    return "That looks like a listing rather than one review. Open the review itself so its text is on screen.";
  }
  return (
    "The review is cut off behind a More link, so I can only see part of it. Expand it and " +
    "screenshot it again. Publishing three quarters of what somebody said under their name is " +
    "not something to guess at."
  );
}
