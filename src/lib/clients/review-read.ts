// Reading a review listing off a screenshot of it — the review audit step.
//
// Matthew: "the review audit it will be better if we can just send screenshots inside of slack
// and it groups them all automatically and creates the report, that section in mission control
// seems hard to use."
//
// ‼️ FOUR OF THE FIVE FIELDS ARE TRANSCRIPTION. THE FIFTH IS A SUMMARY AND IT IS NOT HERE.
//
// A total, a rating, a date and a tally of owner replies are numbers printed on a page: reading
// them off a picture is the same act as typing them off the same picture, and it is checkable
// against the screenshot that produced it. "Themes in the negatives" is not. review-audit.ts's
// own header says why, and it is the reason there is no negativeThemes field in this file:
//
//   "NO MODEL WRITES THEMES IN THE NEGATIVES IN V1. It is the obvious place to put a Claude
//   call and it is the wrong place. That sentence lands verbatim in a client-facing PDF, and a
//   hallucinated theme in that document cannot be walked back."
//
// ‼️ IT PROPOSES. IT DOES NOT RECORD.
// Everything here lands in review_audit_rows.proposed and nowhere else. review_count stays NULL
// until a person taps [Confirm these readings], which is the human action the doctrine requires
// and is one tap for a whole batch. Number("") is 0, and 0 reviews and un-checked are opposite
// claims about a business.

import { callClaudeJSON, camelizeKeys, type ClaudeImageInput } from "@/lib/claude-calls";

/** Haiku, temperature 0. Transcription, same model and settings as the address-bar reader. */
const MODEL = "claude-haiku-4-5-20251001" as const;

export interface ReviewRead {
  /** The business name as printed on the listing, so a caller can match it to a subject. */
  subjectName: string | null;
  /** Total reviews. Null when it is not on screen. Never 0 as a stand-in for "could not see". */
  reviewCount: number | null;
  averageRating: number | null;
  /** ISO date if one is legible, else the phrase as printed ("3 weeks ago"), else null. */
  mostRecentReviewAt: string | null;
  /** How many of the ten most recent visible reviews carry an owner reply. Null if not visible. */
  ownerRepliesInLastTen: number | null;
  /** The address bar, verbatim, which is how the platform is resolved. */
  listingUrl: string | null;
  /** How clearly the review block is readable on screen. NOT confidence about the business. */
  legible: number;
  evidence: string;
}

const EMPTY: ReviewRead = {
  subjectName: null,
  reviewCount: null,
  averageRating: null,
  mostRecentReviewAt: null,
  ownerRepliesInLastTen: null,
  listingUrl: null,
  legible: 0,
  evidence: "nothing readable",
};

export async function readReviewListing(image: ClaudeImageInput): Promise<ReviewRead> {
  try {
    const { data } = await callClaudeJSON<ReviewRead>({
      model: MODEL,
      system: [
        "You are looking at a screenshot of a business listing page that carries public reviews: Google Maps, Yelp, Trustpilot or the BBB. Read the numbers printed on it.",
        "",
        "TRANSCRIBE, DO NOT INFER, AND DO NOT COMPUTE:",
        "- Every field is either printed on this page or it is null. Never estimate a total from how many reviews are visible, never average the star ratings yourself, never convert a rating from a different scale.",
        "- reviewCount is the TOTAL the page states (1,248 reviews), not how many are on screen. If the page shows only the ones loaded so far and states no total, return null.",
        "- averageRating is the overall score the page prints, on the scale it prints it. If the page shows stars with no number, return null rather than counting stars.",
        "- mostRecentReviewAt: if a date is printed, copy it. If it is relative (3 weeks ago, a month ago), copy that phrase exactly as written. Never convert one into the other.",
        "- ownerRepliesInLastTen: look at the reviews actually visible, take up to the ten most recent, and count how many carry a reply from the business. If no reviews are visible at all, return null. It is a count from 0 to 10, never a percentage.",
        "- subjectName is the business name as the LISTING prints it, including any suffix like LLC. Do not tidy it and do not correct it.",
        "- listingUrl is the browser address bar, character for character. If it is not visible or not legible, return null. Never reconstruct it from the page content.",
        "",
        "ZERO IS A REAL NUMBER AND IT IS NOT THE SAME AS NULL. A page that says No reviews yet is reviewCount 0. A page where you cannot find the total is null. Those are opposite claims about a business and one of them will be printed in a document the owner reads.",
        "",
        "DO NOT SUMMARISE THE REVIEWS. Do not report themes, complaints, sentiment, or what people say. You are reading numbers off a page and nothing else. There is no field for it and there must not be one.",
        "",
        "legible is 0 to 1 and measures how clearly the review block is readable on this screen: a crisp listing with the totals in view is 0.9; a page scrolled past the header so the total is off screen is 0.3; something that is not a review listing at all is 0.",
        "evidence is one short phrase naming what you are looking at: google maps listing, yelp business page, trustpilot profile, bbb profile, a search results page rather than a listing.",
      ].join("\n"),
      user:
        "Read this review listing. Return the business name as printed, the totals, the most recent review date, how many of the last ten got an owner reply, and the address bar verbatim. Return null for anything not printed on the page.",
      images: [image],
      maxTokens: 600,
      temperature: 0,
      schemaHint:
        '{ "subjectName": string|null, "reviewCount": number|null, "averageRating": number|null, "mostRecentReviewAt": string|null, "ownerRepliesInLastTen": number|null, "listingUrl": string|null, "legible": number, "evidence": string }',
      coerce: camelizeKeys,
      validate: (v: unknown): v is ReviewRead => {
        const o = v as ReviewRead;
        return !!o && typeof o === "object" && typeof o.legible === "number";
      },
      describeInvalid: () =>
        "Return the object with every key present, null for anything not printed on the page, and a numeric legible between 0 and 1.",
    });

    return {
      subjectName: blankToNull(data.subjectName),
      reviewCount: numOrNull(data.reviewCount),
      averageRating: numOrNull(data.averageRating),
      mostRecentReviewAt: blankToNull(data.mostRecentReviewAt),
      ownerRepliesInLastTen: clamp10(numOrNull(data.ownerRepliesInLastTen)),
      listingUrl: blankToNull(data.listingUrl),
      legible: Number.isFinite(data.legible) ? data.legible : 0,
      evidence: data.evidence?.trim() || "not stated",
    };
  } catch (e) {
    console.error("[clients/review-read] vision read failed:", (e as Error).message);
    return { ...EMPTY, evidence: `read failed: ${(e as Error).message}` };
  }
}

function blankToNull(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t.length > 0 ? t : null;
}

/**
 * ‼️ A STRING "" MUST NOT BECOME 0. Number("") is 0, which is the trap review-audit.ts names by
 * name, and 0 reviews is a claim about a business rather than an absence of one.
 */
function numOrNull(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const t = v.trim().replace(/,/g, "");
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Out of range means it read something that is not this count, so it reports nothing. */
function clamp10(n: number | null): number | null {
  if (n === null) return null;
  return n >= 0 && n <= 10 ? Math.round(n) : null;
}

/** Below this the read is treated as no reading at all. Same threshold the address bar uses. */
export const MIN_LEGIBLE = 0.5;

export function isUsableReviewRead(read: ReviewRead): boolean {
  return read.legible >= MIN_LEGIBLE;
}
