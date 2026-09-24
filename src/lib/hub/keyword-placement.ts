// Where a page's primary keyword has to appear, and whether it does.
//
// ‼️ NONE OF THIS WAS CHECKED ANYWHERE BEFORE 2026-09-14. `page_plan.target_keyword` was picked
// through the whole keyword research loop, approved by a person, written onto the plan row, and
// then never looked at again: the drafter was handed the QUESTION, and the slug came off the
// working title. A phrase can be chosen carefully and still appear nowhere an engine reads.
//
// ‼️ EVERY CHECK HERE IS WARN TIER. Placement is style and evidence is truth, and page-gate.ts's
// two-tier rule is that BLOCK covers what can be WRONG on somebody else's domain. A page whose
// keyword is missing from its meta description is weak, not false. A gate that blocks on taste
// gets waived out of habit inside a fortnight, and a rail everybody steps over is worse than none
// because it looks like one.
//
// ‼️ PURE. No database, no model, no network. Everything it needs is passed in, which is what lets
// the probe prove all eight slots without a client.

import { pageSlug } from "@/lib/hub/pages";
import { STOPWORDS } from "@/lib/scraper/gbp-audit";

/** The eight places a primary keyword is supposed to reach. */
export type PlacementSlot =
  | "slug"
  | "title"
  | "h1"
  | "meta"
  | "first_sentence"
  | "h2"
  | "pillar_anchor"
  | "schema";

export interface PlacementInput {
  keyword: string;
  /**
   * Phrases that mean the same thing to a search engine, verbatim from approved `client_keywords`
   * rows on the plan's `secondary_keywords`.
   *
   * ‼️ THIS IS WHAT MAKES "ONE PAGE RANKS FOR DOZENS OF PHRASES" TRUE IN THE SYSTEM RATHER THAN
   * ONLY IN THE INTENTION. Matthew, 2026-09-23: "Google understands that 'get more reviews',
   * 'increase patient reviews' and 'review generation' mean the same thing, so one well-written
   * page can rank for dozens of related phrases, not just the one you picked."
   *
   * Without it a page whose H2 reads "asking patients for reviews" is reported as MISSING its
   * keyword, and the only way to clear the report is to weld the exact phrase in, which is the
   * behaviour `keyword_shaped` fails a page for and which draft-page.ts refuses to ask for. The
   * check was quietly pushing writers toward the thing the page beside it punishes.
   *
   * Empty is the honest default and behaves exactly as this file did before 2026-09-25.
   */
  variants?: readonly string[];
  slug: string | null;
  title: string | null;
  /** The headline rendered as the page's H1, which is NOT the title. See page_plan.headline. */
  h1: string | null;
  metaDescription: string | null;
  answerMd: string;
  /** The anchor text the pillar links this page with, when it is a support on a plan. */
  pillarAnchor: string | null;
  /** The JSON-LD actually emitted for this page, already serialised. */
  schema: string | null;
}

export interface PlacementResult {
  /** Slots the keyword, or one of its variants, reached. */
  present: PlacementSlot[];
  /** Slots it did not, in the order a person should fix them. */
  missing: PlacementSlot[];
  /** What each missing slot needs, in words. */
  detail: string;
}

/**
 * Words that carry no meaning of their own in a keyword phrase.
 *
 * ‼️ STOPWORDS IS IMPORTED, NOT RETYPED. gbp-audit.ts owns the one list in this repo and its
 * header says why it is mechanical. A second copy would drift, and then a slug and a placement
 * check would disagree about what a content word is.
 *
 * ‼️ THE QUESTION AND FUNCTION WORDS ARE ADDED HERE AND NOT THERE, and adding them matters twice.
 * In a URL they are pure noise: every one of these pages answers a question, so a slug that keeps
 * them reads "how-long-does-it-take-to-work" on all seven. And in a placement check they are what
 * makes a true match look false, which is the sharper problem. "How long does lip filler last"
 * against a title reading "Lip filler: how long will it actually last?" is plainly the same
 * subject, and holding out for the word "does" would fail it and push the drafter into welding
 * the phrase in whole.
 *
 * gbp-audit.ts's own list is correct to EXCLUDE these: there, a category is being matched and a
 * question word never appears in one. The difference is the input, not the opinion.
 */
const CONTENT_NOISE = new Set([
  ...STOPWORDS,
  "how", "what", "why", "when", "where", "which", "who", "does", "do", "did", "is", "it", "to",
  "a", "an", "of", "in", "on", "at", "by", "or", "if", "my", "me", "i", "be", "am",
]);

/**
 * A slug built from the keyword rather than from the working title.
 *
 * ‼️ FOR A NEW PAGE ONLY, AND THE CALLER IS RESPONSIBLE FOR THAT. pageSlug's own comment says a
 * slug "must not silently change for an existing page": it is part of a public URL a crawler has
 * indexed, and changing it is a 404 plus the loss of whatever standing the old URL had. This
 * function cannot tell a new page from a published one, so it never decides. It is passed as
 * `input.slug` at creation and never on an update.
 *
 * Stopwords are stripped because "how-long-does-lip-filler-last" spends half its length on words
 * that distinguish nothing. If stripping leaves nothing at all, the whole phrase is kept: an empty
 * slug is worse than a noisy one.
 */
export function keywordSlug(keyword: string): string {
  const kept = keyword
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length > 0 && !CONTENT_NOISE.has(w));

  return pageSlug(kept.length ? kept.join(" ") : keyword);
}

/** Collapse whitespace and case so a rewrapped line still matches. Same trick draft-page.ts uses. */
function flat(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Does this text carry the keyword?
 *
 * ‼️ THE CONTENT WORDS, NOT THE STRING. An exact substring test fails "lip filler near me" against
 * a title reading "How long does lip filler last?", which is a page that plainly IS about the
 * keyword. That was the measured problem the whole-string test had in plan-links.ts, recorded in
 * _probe-page-plan.ts, and it is the same mistake twice if repeated here. Every content word has
 * to be present; the order and the filler between them do not matter.
 *
 * A keyword that is ENTIRELY stopwords falls back to the whole phrase, so it can still fail
 * honestly rather than pass vacuously against any text at all.
 */
export function carriesKeyword(text: string | null | undefined, keyword: string): boolean {
  const haystack = flat(text);
  if (!haystack) return false;

  const words = flat(keyword)
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(" ")
    .filter((w) => w.length > 0 && !CONTENT_NOISE.has(w));

  if (!words.length) return haystack.includes(flat(keyword));

  // Word-boundary matched, so "spa" does not match "spacious" and inflate every check.
  return words.every((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(haystack));
}

/**
 * Does this text carry the keyword, or any phrase that means the same thing?
 *
 * ‼️ A SIBLING OF carriesKeyword, NEVER A WIDENING OF IT. That function is also a HARD validator in
 * client-headlines.ts, where every one of thirty-three candidate headlines must carry the keyword it
 * was written for, and a headline that merely carried a synonym would break the hinge that keeps a
 * kept headline attached to its keyword row. Two callers, two questions, two functions.
 *
 * An empty variant list makes this identical to carriesKeyword, which is what every caller got
 * before the family existed.
 */
export function carriesAnyKeyword(
  text: string | null | undefined,
  keyword: string,
  variants: readonly string[] = []
): boolean {
  if (carriesKeyword(text, keyword)) return true;
  return variants.some((v) => v.trim() && carriesKeyword(text, v));
}

/** The first sentence of the body, skipping any heading. */
export function firstSentence(answerMd: string): string {
  const prose = answerMd
    .split(/\r?\n/)
    .filter((l) => !/^\s*#{1,6}\s/.test(l))
    .join("\n")
    .trim();
  const m = /^[\s\S]*?[.!?](\s|$)/.exec(prose);
  return (m ? m[0] : prose).trim();
}

/** Every "## " heading, in order. */
export function h2Headings(answerMd: string): string[] {
  const out: string[] = [];
  for (const line of answerMd.split(/\r?\n/)) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
}

const SLOT_FIX: Record<PlacementSlot, string> = {
  slug: "the URL. Only fixable before the page is published.",
  title: "the page title.",
  h1: "the headline rendered at the top of the page.",
  meta: "the meta description.",
  first_sentence: "the first sentence of the body, which is the part an engine quotes.",
  h2: "at least one subheading.",
  pillar_anchor: "the anchor text the pillar links this page with.",
  schema: "the structured data, which is what an engine parses rather than reads.",
};

/**
 * Check all eight slots.
 *
 * ‼️ A SLOT THAT DOES NOT APPLY IS NOT MISSING. A pillar has no pillar to link it, and a page that
 * has not been given schema yet has none to check. Those come back in neither list, because
 * reporting them as missing would teach a person to ignore this check on every pillar they ever
 * write, which is how a real fault gets ignored beside them.
 */
export function checkPlacement(input: PlacementInput): PlacementResult {
  const present: PlacementSlot[] = [];
  const missing: PlacementSlot[] = [];

  // ‼️ THE SLUG IS THE ONE SLOT THE FAMILY DOES NOT OPEN UP, and it is deliberate. Every other slot
  // asks "is this page about that subject", which a natural variant answers just as well. The URL
  // asks something narrower: it is one string, it is permanent once published, and it is built from
  // the primary keyword by keywordSlug(). A slug matching a variant instead would mean the plan and
  // the address disagree about which phrase this page was chosen for.
  const variants = (input.variants ?? []).filter((v) => v.trim().length > 0);
  const carries = (text: string | null | undefined) => carriesAnyKeyword(text, input.keyword, variants);

  const test = (slot: PlacementSlot, text: string | null | undefined, applies = true) => {
    if (!applies) return;
    if (carries(text)) present.push(slot);
    else missing.push(slot);
  };

  // The slug is matched on its own shape: hyphens are its word separator, and it has already had
  // stopwords stripped out of it, so the content words are what has to survive. PRIMARY ONLY, for
  // the reason above.
  if (input.slug !== null) {
    if (carriesKeyword(input.slug.replace(/-/g, " "), input.keyword)) present.push("slug");
    else missing.push("slug");
  }

  test("title", input.title);
  test("h1", input.h1, input.h1 !== null);
  test("meta", input.metaDescription);
  test("first_sentence", firstSentence(input.answerMd));

  // ‼️ THE SUBHEADING IS THE SLOT THE FAMILY MATTERS MOST FOR. Matthew's own example is a page
  // titled for "more google reviews" whose subheads say "asking patients for reviews". Demanding
  // the exact phrase in an H2 is what turns a naturally written page into a stuffed one.
  const headings = h2Headings(input.answerMd);
  if (headings.length) {
    if (headings.some((h) => carries(h))) present.push("h2");
    else missing.push("h2");
  }

  test("pillar_anchor", input.pillarAnchor, input.pillarAnchor !== null);
  test("schema", input.schema, input.schema !== null);

  // The family is named in the detail when there is one, because "missing from 3 of 8 places" reads
  // very differently once you know six other phrasings were also accepted and none of them landed.
  const family = variants.length
    ? ` Its ${variants.length} approved variation${variants.length === 1 ? "" : "s"} counted too.`
    : "";

  const detail = missing.length
    ? `"${input.keyword}" is missing from ${missing.length} of ${present.length + missing.length} places: ` +
      missing.map((m) => SLOT_FIX[m]).join(" ") +
      family
    : `"${input.keyword}" reaches all ${present.length} places.${family}`;

  return { present, missing, detail };
}
