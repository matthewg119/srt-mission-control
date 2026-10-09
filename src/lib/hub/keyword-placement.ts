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

/**
 * The same keyword with its ordinary English inflections, as variants for `carriesAnyKeyword`.
 *
 * ‼️ A FAMILY GENERATOR, NOT A CHANGE TO carriesKeyword, AND THE DISTINCTION IS THE WHOLE REASON
 * THIS EXISTS. Measured on 2026-10-08 against Matthew's own ten worked headlines:
 * `carriesKeyword` refused three of his five H1s and one of his five title tags, almost all of it
 * morphology. "How ChatGPT Ranks Local Businesses (2026)" does not carry `chatgpt local business
 * ranking` because "Businesses" is not "business" and "Ranks" is not "ranking". "Why Facebook Ads
 * Stop Working for Med Spas" does not carry `... for med spa` because "Spas" is not "spa".
 *
 * Teaching `carriesKeyword` to stem would have been the obvious fix and it is the wrong one:
 * _probe-headline-page.ts states that function must stay unchanged because it is the hard hinge
 * between a kept headline and its keyword row, and its "a prefix is not a match" case is what
 * stops "spa" matching "spacious". So the shape of the answer here is the one the file already
 * chose for synonyms: hand `carriesAnyKeyword` more strings to try.
 *
 * Morphology ONLY. A synonym is a different question with a different answer: `pricing` does not
 * become `cost` here, and the lane that wants that latitude says so by warning rather than
 * refusing. Pure, and the probe asserts both halves.
 */
/**
 * The words of a keyword that actually distinguish it, in order.
 *
 * The same stripping `carriesKeyword` and `keywordSlug` do, exported because the title-tag lane
 * needs to know WHERE the keyword starts in a line and cannot answer that from a boolean. An
 * all-stopword keyword returns its words unstripped, matching `keywordSlug`'s own fallback.
 */
export function keywordContentWords(keyword: string): string[] {
  const all = flat(keyword)
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(" ")
    .filter(Boolean);
  const kept = all.filter((w) => !CONTENT_NOISE.has(w));
  return kept.length ? kept : all;
}

/**
 * How many of the keyword's content words the text carries, counting inflections as the word.
 *
 * ‼️ A MEASURE, NOT A VERDICT, AND THAT IS WHY IT IS SEPARATE FROM carriesKeyword. The H1 lane
 * needs three answers from one question and a boolean only gives it two: a headline carrying
 * every word is clean, one carrying SOME is the right headline phrased naturally and is worth a
 * note, and one carrying NONE is about a different page. Measured on Matthew's own five H1s,
 * `present < total` is the normal case for a good headline, which is exactly why this lane
 * reports it instead of refusing it. See client-headlines.ts's own note at `faultsFor`.
 */
export function keywordOverlap(text: string | null | undefined, keyword: string): { present: number; total: number } {
  const haystack = flat(text);
  const content = keywordContentWords(keyword);
  if (!haystack || !content.length) return { present: 0, total: content.length };

  let present = 0;
  for (const w of content) {
    const hit = wordForms(w).some((form) =>
      new RegExp(`\\b${form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(haystack)
    );
    if (hit) present++;
  }
  return { present, total: content.length };
}

export function wordForms(word: string): string[] {
  const w = flat(word);
  if (!w) return [];
  const out = new Set<string>([w]);

  // Plurals, both directions. "spas" <-> "spa", "businesses" <-> "business",
  // "agencies" <-> "agency".
  if (w.endsWith("ies") && w.length > 4) out.add(`${w.slice(0, -3)}y`);
  if (w.endsWith("es") && w.length > 3) out.add(w.slice(0, -2));
  if (w.endsWith("s") && !w.endsWith("ss") && w.length > 3) out.add(w.slice(0, -1));
  // ‼️ THE "ss" CASE IS SPELLED OUT, AND MISSING IT COST A REAL HEADLINE. A word ending in a
  // double s already ends in "s", so a guard reading `!w.endsWith("s")` skips it and "business"
  // never reaches "businesses". That is precisely the miss that refused "How ChatGPT Ranks Local
  // Businesses (2026)" for the keyword `chatgpt local business ranking`.
  if (/(?:ss|sh|ch|x|z)$/.test(w)) out.add(`${w}es`);
  if (!w.endsWith("s")) {
    out.add(`${w}s`);
    if (w.endsWith("y") && w.length > 3) out.add(`${w.slice(0, -1)}ies`);
  }
  // The verb and gerund a keyword and a headline disagree about. "ranking" <-> "ranks".
  if (w.endsWith("ing") && w.length > 5) {
    const stem = w.slice(0, -3);
    for (const f of [stem, `${stem}s`, `${stem}e`, `${stem}es`]) out.add(f);
  }
  // ‼️ THE IRREGULARS, BECAUSE NO SUFFIX RULE REACHES THEM AND ONE COST A REAL TITLE. Matthew's
  // own "How to Get Your Business Found on ChatGPT" was refused for the keyword `clients find my
  // business on chatgpt` (2026-10-09): "found" is not "find" plus any ending, so the keyword read
  // as absent. A closed list, kept to the verbs that actually appear in search phrases.
  for (const group of IRREGULARS) {
    if (group.includes(w)) for (const f of group) out.add(f);
  }
  return [...out];
}

/**
 * Verbs whose forms no suffix rule produces. Each group is one verb, all its forms.
 *
 * Deliberately short. This is not an English lexicon: it is the handful of irregulars that turn up
 * in the keywords this repo actually targets, and every entry widens the SPELLING of a word and
 * never its meaning. A synonym does not belong here, which is the same line `keywordFamily` draws.
 */
const IRREGULARS: ReadonlyArray<readonly string[]> = [
  ["find", "finds", "finding", "found"],
  ["get", "gets", "getting", "got", "gotten"],
  ["grow", "grows", "growing", "grew", "grown"],
  ["choose", "chooses", "choosing", "chose", "chosen"],
  ["buy", "buys", "buying", "bought"],
  ["pay", "pays", "paying", "paid"],
  ["spend", "spends", "spending", "spent"],
  ["bring", "brings", "bringing", "brought"],
  ["lose", "loses", "losing", "lost"],
  ["keep", "keeps", "keeping", "kept"],
  ["sell", "sells", "selling", "sold"],
  ["tell", "tells", "telling", "told"],
  ["win", "wins", "winning", "won"],
  ["cost", "costs", "costing"],
  ["show", "shows", "showing", "showed", "shown"],
  ["rise", "rises", "rising", "rose", "risen"],
  ["write", "writes", "writing", "wrote", "written"],
  ["take", "takes", "taking", "took", "taken"],
  ["make", "makes", "making", "made"],
  ["see", "sees", "seeing", "saw", "seen"],
  ["rank", "ranks", "ranking", "ranked"],
];

/** The most phrase variants worth generating. A cap, so a long keyword cannot explode. */
const MAX_FAMILY = 240;

export function keywordFamily(keyword: string): string[] {
  const words = flat(keyword)
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(" ")
    .filter(Boolean);
  if (!words.length || words.length > 8) return [];

  // ‼️ THE CROSS PRODUCT, NOT ONE SWAP AT A TIME, AND A REAL HEADLINE IS WHY. "How ChatGPT Ranks
  // Local Businesses (2026)" disagrees with `chatgpt local business ranking` in TWO words at
  // once, so a family that swaps a single word per variant never reaches it. The cap below is
  // what keeps that honest: every variant still has to match every word of the phrase, so this
  // widens the spelling and never the meaning.
  let phrases: string[][] = [[]];
  for (const w of words) {
    const next: string[][] = [];
    for (const prefix of phrases) {
      for (const form of wordForms(w)) {
        next.push([...prefix, form]);
        if (next.length >= MAX_FAMILY) break;
      }
      if (next.length >= MAX_FAMILY) break;
    }
    phrases = next;
  }

  const original = words.join(" ");
  const out = new Set<string>();
  for (const p of phrases) {
    const joined = p.join(" ");
    if (joined !== original) out.add(joined);
  }
  return [...out];
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
