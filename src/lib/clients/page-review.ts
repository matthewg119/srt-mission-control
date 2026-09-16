// `review` in the page studio: a customer's published review becomes a page, aimed.
//
// Matthew asked for two things and the second one is the whole point of this file:
//
//   "an option within the drafter to create a new post or create from a review where we can
//    send a screenshot of the review and highlight it in a post"
//
//   "ideally point to the specific offer we want to promote and the keywords, so I want it to
//    search for context for the offer and how we can position that review within our keywords
//    strategy"
//
// So this does not merely file a quote. It files it and then says which offer it supports and
// which phrases from THIS client's ranked keyword set the customer actually used.
//
// ─────────────────────────────────────────────────────────────────────────────
// ‼️ THE LEGAL POSITION, BECAUSE THE NEXT READER WILL ASSUME THIS IS THE FORBIDDEN THING.
//
// FTC 16 CFR Part 465 regulates a tool that GENERATES review content its user did not write.
// Nothing here writes a review. It reproduces one a customer already published, verbatim, in
// the client's own marketing, which is the line draft-page.ts:3-8 already draws. review-read.ts
// does the same act for review counts and review-quote-read.ts does it for the words.
//
// Nothing in this module imports src/lib/hub/review-assemble.ts, the review tool, or anything
// under src/app/hub/. It must stay that way.
// ─────────────────────────────────────────────────────────────────────────────
//
// ‼️ NO MODEL RANKS THE POSITIONING. The offer is read off clients.offer, the phrase matches are
// substring containment against the keyword set, and the themes are the themes those rows
// already carry. Every number below is counted or read off a column, the same rule keyword-set.ts
// and page-candidates.ts hold, so the card can be argued with rather than believed.
//
// ‼️ THERE IS NO BACKLINK ANYTHING IN THIS REPO. Matthew's ask mentioned "backlink or whatever
// our strategy is". There is no link prospecting, no outreach table and no link target stored
// anywhere, so this card names the offer, the phrases and the pages, and does not pretend to a
// strategy that does not exist.

import { supabaseAdmin } from "@/lib/db";
import { recordSource, verifySource } from "./page-evidence";
import { normalizePhrase, type KeywordRow } from "./keyword-set";
import { readReviewQuote, isUsableQuote, quoteRefusal, type ReviewQuoteRead } from "./review-quote-read";
import type { ClaudeImageInput } from "@/lib/claude-calls";

/** What the vision read leaves in page_studio_sessions.proposed_review. */
export interface ProposedReview {
  quote: string;
  authorAsPrinted: string | null;
  rating: number | null;
  reviewedAtAsPrinted: string | null;
  subjectName: string | null;
  listingUrl: string | null;
  platform: string | null;
  /** Which of the two doors this came through, so the stored row can say. */
  via: "review_screenshot" | "review_tool";
  readAt: string;
}

/** Image types the reader accepts, the same set hub-skin.ts uses. */
const VISION_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** Same headroom the other vision readers use. */
export const MAX_VISION_BYTES = 6 * 1024 * 1024;

export function isReviewImage(file: { mimetype?: string }): boolean {
  return VISION_TYPES.has((file.mimetype ?? "").toLowerCase());
}

// ─────────────────────────────────────────────────────────────────────────────
// The read, and the proposal it leaves behind
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read one review off a screenshot and PROPOSE it.
 *
 * ‼️ ONE SCREENSHOT, ONE QUOTE. Several images on one message means several reviews, and a
 * batch would tempt somebody into a "confirm all" that files quotes nobody read. A quote is
 * going on a page under a customer's name; it is worth one look each.
 */
export async function proposeReviewFromImage(args: {
  clientId: string;
  threadTs: string;
  image: ClaudeImageInput;
}): Promise<{ ok: true; proposal: ProposedReview; read: ReviewQuoteRead } | { ok: false; error: string }> {
  const read = await readReviewQuote(args.image);

  if (!isUsableQuote(read)) return { ok: false, error: quoteRefusal(read) };

  const proposal: ProposedReview = {
    quote: read.quote as string,
    authorAsPrinted: read.authorAsPrinted,
    rating: read.rating,
    reviewedAtAsPrinted: read.reviewedAtAsPrinted,
    subjectName: read.subjectName,
    listingUrl: read.listingUrl,
    platform: platformFromUrl(read.listingUrl),
    via: "review_screenshot",
    readAt: new Date().toISOString(),
  };

  const { error } = await supabaseAdmin
    .from("page_studio_sessions")
    .update({ proposed_review: proposal, updated_at: new Date().toISOString() })
    .eq("thread_ts", args.threadTs);

  if (error) return { ok: false, error: `could not hold that proposal: ${error.message}` };

  return { ok: true, proposal, read };
}

/** Store a quote picked out of the client's own review tool. Same slot, different door. */
export async function proposeReviewFromTool(args: {
  threadTs: string;
  quote: string;
}): Promise<{ ok: boolean; error?: string }> {
  const proposal: ProposedReview = {
    quote: args.quote,
    authorAsPrinted: null,
    rating: null,
    reviewedAtAsPrinted: null,
    subjectName: null,
    listingUrl: null,
    platform: "the client's own review tool",
    via: "review_tool",
    readAt: new Date().toISOString(),
  };

  const { error } = await supabaseAdmin
    .from("page_studio_sessions")
    .update({ proposed_review: proposal, updated_at: new Date().toISOString() })
    .eq("thread_ts", args.threadTs);

  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function loadProposal(threadTs: string): Promise<ProposedReview | null> {
  const { data } = await supabaseAdmin
    .from("page_studio_sessions")
    .select("proposed_review")
    .eq("thread_ts", threadTs)
    .maybeSingle();

  const raw = data?.proposed_review as ProposedReview | null | undefined;
  return raw && typeof raw.quote === "string" && raw.quote.trim() ? raw : null;
}

/** Resolve the platform from the address bar. Two matches and none are the same answer. */
function platformFromUrl(url: string | null): string | null {
  if (!url) return null;
  const u = url.toLowerCase();
  const hits = [
    ["google", /google\.[a-z.]+\/maps|maps\.google\./],
    ["Yelp", /yelp\./],
    ["Trustpilot", /trustpilot\./],
    ["Facebook", /facebook\./],
    ["the BBB", /bbb\.org/],
  ].filter(([, re]) => (re as RegExp).test(u));

  return hits.length === 1 ? (hits[0][0] as string) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// The confirmation, which is the only thing that writes a row
// ─────────────────────────────────────────────────────────────────────────────

/**
 * File the proposed quote as evidence, verbatim, and clear the slot.
 *
 * ‼️ pageId IS NULL WHEN NOTHING IS CLAIMED, AND THAT IS THE FEATURE, not a fallback. A source
 * with page_id null is the CLIENT LIBRARY and is available to every page they will ever have
 * (docs/2026-08-26-evidence-and-gate.sql:24-28). So the same command covers both of Matthew's
 * entry points with one code path: with a page claimed the quote backs that page, and with
 * nothing claimed it joins the library for whatever gets written next.
 */
export async function confirmProposedReview(args: {
  clientId: string;
  threadTs: string;
  pageId: string | null;
  by: string;
}): Promise<{ ok: true; proposal: ProposedReview } | { ok: false; error: string }> {
  const proposal = await loadProposal(args.threadTs);
  if (!proposal) {
    return { ok: false, error: "There is no review waiting to be confirmed in this thread." };
  }

  const attribution = [proposal.authorAsPrinted, proposal.platform, proposal.reviewedAtAsPrinted]
    .filter(Boolean)
    .join(", ");

  const filed = await recordSource({
    clientId: args.clientId,
    pageId: args.pageId,
    sourceType: "CUSTOMER_REVIEW",
    // ‼️ THE QUOTE AND NOTHING ELSE. The attribution goes in `topic`, never glued onto the front
    // of source_content: the drafter reads source_content as the thing to reproduce, and a
    // "Sarah M. on google: " prefix would end up inside the quotation marks on a published page.
    sourceContent: proposal.quote,
    topic: attribution ? `Customer review, ${attribution}` : "Customer review",
    sourceUrl: proposal.listingUrl,
    collectedVia: proposal.via,
    slackTs: args.threadTs,
    collectedBy: args.by,
  });

  if (!filed.ok) return { ok: false, error: filed.error };

  // ‼️ COLLECTED AND VERIFIED BY THE SAME PERSON, WHICH IS UNUSUAL HERE AND IS CORRECT.
  // page-evidence.ts keeps the two apart because "collecting is transcription, verifying is a
  // claim about the world". For every other source those are different acts by different
  // people. Here they are one act: the button says "I have read this quote against the
  // screenshot it came off and it is what the customer wrote", which is exactly the claim
  // verified_by records. A quote nobody checked against its picture is the failure this whole
  // propose-then-confirm shape exists to prevent, so it is never filed unverified.
  await verifySource(filed.id, args.by);

  await supabaseAdmin
    .from("page_studio_sessions")
    .update({ proposed_review: null, updated_at: new Date().toISOString() })
    .eq("thread_ts", args.threadTs);

  return { ok: true, proposal };
}

// ─────────────────────────────────────────────────────────────────────────────
// The positioning: which offer, which phrases, which pages
// ─────────────────────────────────────────────────────────────────────────────

export interface QuotePositioning {
  treatment: string | null;
  treatmentCertain: boolean;
  /** Phrases from this client's ranked set that appear in the quote, best first. */
  matched: KeywordRow[];
  /** How many phrases were checked, so "none" is a measurement rather than an absence. */
  checked: number;
  /** The themes those phrases belong to, deduped, which is what a page gets built around. */
  themes: string[];
  /** Why there is nothing to say, when there is nothing to say. */
  note: string | null;
}

/**
 * Where this quote sits in the keyword strategy.
 *
 * ‼️ CONTAINMENT, NOT A MODEL, and it is the same blunt test page-candidates.ts:446 already uses
 * for `inOwnReviews`. Both sides are put through normalizePhrase first so punctuation and case
 * cannot decide a match. A model asked "which of these 99 does this review support" would
 * answer confidently every time, including for a review that supports none, and this card is
 * read as a reason to write a page.
 *
 * ‼️ ZERO MATCHES IS AN ANSWER AND IS SAID OUT LOUD. A quote that uses none of the market's
 * wording is still a good quote; it is just not the one to hang this offer's page on. Reporting
 * that plainly is the difference between a tool and a horoscope.
 */
export async function positionQuote(
  clientId: string,
  quote: string
): Promise<QuotePositioning> {
  const { loadOffer, effectiveTreatment } = await import("./offers");
  const { buildKeywordSet } = await import("./keyword-set");

  const offer = await loadOffer(clientId);
  // { value, certain, source }. The value is the locked treatment, or the proposal when nothing
  // is locked, and certain says which. Both are printed; a proposal never reads as a decision.
  const aim = effectiveTreatment(offer);

  const set = await buildKeywordSet(clientId);
  if ("error" in set) {
    return {
      treatment: aim.value,
      treatmentCertain: aim.certain,
      matched: [],
      checked: 0,
      themes: [],
      note: `No keyword set to place it against: ${set.error}`,
    };
  }

  const haystack = normalizePhrase(quote);
  const matched = set.rows.filter((r) => r.normalized.length >= 4 && haystack.includes(r.normalized));

  return {
    treatment: set.treatment ?? aim.value,
    treatmentCertain: set.treatmentCertain,
    matched,
    checked: set.rows.length,
    themes: [...new Set(matched.map((r) => r.theme).filter(Boolean))],
    note: null,
  };
}

/** The positioning as the studio card prints it. */
export function formatPositioning(p: QuotePositioning, limit = 8): string[] {
  const lines: string[] = ["*Where this sits*"];

  lines.push(
    p.treatment
      ? `  • Offer: *${p.treatment}*${p.treatmentCertain ? "" : " (proposed, not locked)"}`
      : "  • Offer: *none set*. `offer: <what they sell>` and this quote gets aimed at something."
  );

  if (p.note) {
    lines.push(`  • ${p.note}`);
    return lines;
  }

  if (!p.matched.length) {
    lines.push(
      `  • Phrases: *none of the ${p.checked} in this client's set appear in it.*`,
      "",
      "That is not a bad review to use, it is a review that does not carry the market's own " +
        "wording. It still backs a claim on any page you point it at. If you want one that " +
        "pulls its weight in the keyword set, `keywords` shows what the market actually says."
    );
    return lines;
  }

  lines.push(
    `  • Phrases: *${p.matched.length} of ${p.checked}* in this client's set appear in it, word for word:`
  );
  for (const row of p.matched.slice(0, limit)) {
    const named =
      row.currentlyNamed === null ? "never asked" : row.currentlyNamed ? "already named" : "not named";
    lines.push(`      ${row.phrase} _(${row.theme}, ${named})_`);
  }
  if (p.matched.length > limit) lines.push(`      …and ${p.matched.length - limit} more.`);

  if (p.themes.length) {
    lines.push("", `  • Themes it strengthens: ${p.themes.slice(0, 6).join(", ")}.`);
  }

  return lines;
}

// ─────────────────────────────────────────────────────────────────────────────
// The other door: quotes the client's own review tool already collected
// ─────────────────────────────────────────────────────────────────────────────

export interface ToolQuote {
  index: number;
  text: string;
}

/**
 * Quotes out of review_tool_submissions, for `review quotes`.
 *
 * ‼️ READS ONLY, AND NO MODEL. page-candidates.ts:231-242 already reads this table for the
 * inOwnReviews signal. The answers bag is what she typed, so the values are quotable as they
 * stand; they are joined in the order the question set defines and never rewritten.
 *
 * ‼️ AND IT SELECTS `answers` AND NOTHING ELSE. That table deliberately has no column for a
 * name, email, phone, IP, user agent or session id, and the absence is the enforcement. A
 * select that started reaching for an author here would be asking for a column that must never
 * exist.
 */
export async function loadToolQuotes(clientId: string, limit = 10): Promise<ToolQuote[]> {
  const { data } = await supabaseAdmin
    .from("review_tool_submissions")
    .select("answers")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(limit);

  const out: ToolQuote[] = [];
  for (const row of data ?? []) {
    const answers = (row.answers ?? {}) as Record<string, unknown>;
    const text = Object.values(answers)
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      .map((v) => v.trim())
      .join(" ");
    if (text) out.push({ index: out.length + 1, text });
  }
  return out;
}
