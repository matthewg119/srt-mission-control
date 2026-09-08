// Which phrases in question_bank are actually usable, and which are extraction debris.
//
// ─────────────────────────────────────────────────────────────────────────────
// ‼️ MEASURED, NOT ASSUMED. SRT Agency's corpus, vertical `aeo-agency-med-spa`, 2026-09-08:
//
//     451 rows total
//     harvest         107 of 145 usable   (74%)
//     deep_research     37 of 306 usable   (12%)
//     ---------------------------------------------
//     144 of 451 usable                    (32%)
//
// Matthew, about the step 12 PDF: "the pdf shows a lot of BS, tbh most of it is not even usable".
// He was right, and this is the number. Two thirds of the corpus every downstream artifact is
// built from is not a phrase anybody said. It is:
//
//   • a URL glued onto the end of a quote          60 rows
//   • an arrow joining a quote to its source       57 rows
//   • a headline or a label with a colon           heading fragments, "Why:", "Out of scope of $900:"
//   • a citation marker the model left in           the 【41†L65-L69】 shape
//   • a whole paragraph of somebody's prose         quoted, 20+ words, not a question
//
// The tracked question set then fills sixty slots out of that, and the composition targets make
// sure it fills all sixty, so the padding is guaranteed rather than incidental.
//
// ─────────────────────────────────────────────────────────────────────────────
// ‼️ THIS FILTERS ON READ, NOT ON WRITE, AND THAT IS A DELIBERATE CHOICE FOR NOW.
//
// Filtering at extraction time would stop the pollution and do nothing for the 306 rows already
// stored, on a table with NO client_id that is shared by every client in the vertical forever.
// Filtering at read time fixes every existing client immediately and is reversible: nothing is
// deleted, the rows stay, and a rule that turns out to be wrong is one edit away from being
// undone. The extractor should adopt this too, and when it does these two facts stay true.
//
// ‼️ IT IMPORTS NOTHING AND MAKES NO MODEL CALL, same discipline as readability.ts. Every rule
// below is a mechanical property of the string, so a phrase that was dropped can be shown the
// reason it was dropped. "A model thought it was low quality" is not a reason anybody can act on
// and would re-rank on every run.
//
// ‼️ IT NEVER REWRITES THE WORDS. tidyPhrase() decodes HTML entities and collapses whitespace,
// and that is not the same thing: `&#x27;` is an artifact of OUR scraper, not how the market
// said it. The corpus rule that typos are kept is intact. Nothing here fixes spelling, grammar
// or phrasing.
// ─────────────────────────────────────────────────────────────────────────────

/** Why a phrase was dropped. One reason per rule, so a rejection can be explained. */
export type PhraseFault =
  /** A URL in the phrase. It is a citation, not something somebody typed. */
  | "url"
  /** The 【41†L65-L69】 shape. A model's citation marker leaked into the extraction. */
  | "citation_marker"
  /** "quote -> source". An extraction artifact joining two things that are not one phrase. */
  | "arrow"
  /** Wrapped in quotes end to end. A quotation of somebody's prose, not a question. */
  | "quoted"
  /** "Why:", "Out of scope of $900:", "Tools & buying". A label or a heading, not a query. */
  | "label"
  /** Fewer than three words. Not enough to be a question anybody asked. */
  | "too_short"
  /** More than sixteen words. A sentence from an article, not something typed at an assistant. */
  | "too_long"
  /** Ends on a colon or semicolon, so it introduces something that is not here. */
  | "dangling"
  /** Markdown or HTML that survived the extraction. */
  | "markup"
  /** Navigation or form furniture scraped in front of the real sentence. */
  | "nav_chrome"
  /** Begins mid-thought, so it is the back half of somebody's paragraph. */
  | "fragment";

/** Below this a phrase is a fragment; above it, a sentence out of an article. */
const MIN_WORDS = 3;
const MAX_WORDS = 16;

/**
 * Page furniture that harvest.ts scrapes in front of a real question.
 *
 * ‼️ MEASURED, AND THE EXAMPLES ARE REAL ROWS. "Continue Back Best number to reach you?",
 * "Playbook Why doesn't AI recommend my business?", "Tools & buying What are the best AI
 * visibility tools for small businesses?". The question inside each one is genuine; what is
 * wrong is the nav label or form button glued to the front of it by the text extraction.
 *
 * ‼️ DROPPED, NOT TRIMMED, AND THAT IS THE WHOLE RESTRAINT OF THIS FILE. Cutting the prefix off
 * would mean deciding where the market's own words start, which is editing the corpus rather
 * than filtering it. There is no punctuation to cut at, so any trim would be a guess. The phrase
 * is almost certainly in the corpus a second time without the chrome, because the same question
 * appears on more than one cited page.
 *
 * Anchored at the START and requiring more text after it: a question that merely CONTAINS the
 * word "continue" is a question.
 */
const NAV_CHROME = new RegExp(
  "^(continue|back|next|previous|menu|close|skip to (main )?content|toggle|search|submit|" +
    "home|read more|learn more|get started|sign in|log in|playbook|share|subscribe)" +
    String.raw`\s+\S`,
  "i"
);

/** Field names from a brief or a template. A label even when what follows is a question. */
const LABEL_WORD = new RegExp(
  "^(headline|title|subject|hook|caption|note|summary|tldr|tl;dr|example|answer|question|" +
    "prompt|section|step [0-9]+|h[1-6])" +
    String.raw`\s*:`,
  "i"
);

/**
 * Words no question and no sentence starts with.
 *
 * A phrase opening on one of these is the back half of a paragraph the extractor cut in the
 * wrong place. Dropped rather than repaired, for the same reason nav chrome is: deciding where
 * the missing front half started would be writing it.
 */
const FRAGMENT_OPENER = new RegExp(
  "^(that|which|whom|whose|and|but|so|because|although|though|however|therefore|thus|" +
    "moreover|furthermore|whereas|while)" +
    String.raw`\s+`,
  "i"
);

/**
 * The entities our own scraper leaves behind.
 *
 * Restoring these is not cleaning up the market's wording, it is undoing damage we did on the
 * way in: nobody typed `&#x27;`. Kept deliberately short. A general entity decoder would be a
 * dependency and an invitation to start "improving" the text.
 */
const ENTITIES: ReadonlyArray<readonly [RegExp, string]> = [
  [/&#x27;|&#39;|&apos;/gi, "'"],
  [/&quot;|&#34;/gi, '"'],
  [/&amp;|&#38;/gi, "&"],
  [/&nbsp;|&#160;/gi, " "],
  [/&lt;|&#60;/gi, "<"],
  [/&gt;|&#62;/gi, ">"],
  [/&mdash;|&ndash;/gi, " "],
  [/&hellip;/gi, "..."],
];

/** Decode what we broke, collapse whitespace, and change nothing else. */
export function tidyPhrase(raw: string): string {
  let out = raw;
  for (const [pattern, replacement] of ENTITIES) out = out.replace(pattern, replacement);
  return out.replace(/\s+/g, " ").trim();
}

/**
 * Everything wrong with this phrase, in the order it is worth saying.
 *
 * Returns an empty array for a usable phrase. Every caller that drops rows should be able to
 * COUNT these, because "144 of 451 survived" is a fact about the corpus worth printing and
 * "the list came back short" is not.
 */
export function phraseFaults(raw: string): PhraseFault[] {
  const phrase = tidyPhrase(raw);
  const faults: PhraseFault[] = [];

  if (/https?:\/\//i.test(phrase) || /\bwww\.\w/i.test(phrase)) faults.push("url");
  // The 【..†..】 shape, and the bare dagger, which is the half that survives a truncation.
  if (/[【】†]/.test(phrase)) faults.push("citation_marker");
  if (/->|→/.test(phrase)) faults.push("arrow");
  if (/^["“”'‘].*["“”'’]$/.test(phrase)) faults.push("quoted");

  // ‼️ A COLON EARLY IN THE STRING, AND ONLY WHERE THERE IS NO QUESTION MARK. "Why: Regulatory
  // risk" is a label. "How much does this cost? Is there a deposit:" is a question with a typo,
  // and dropping it would throw away the market's own wording over punctuation.
  if (!phrase.includes("?") && /^[A-Z0-9][^:?]{0,45}:/.test(phrase)) faults.push("label");

  // ‼️ EXCEPT FOR THESE, WHICH ARE LABELS EVEN WHEN THE THING THEY LABEL IS A QUESTION. Observed
  // live: `Headline: "Spending $2K/Month on Ads But Clients Won't Book?` survived the rule above
  // because it contains a question mark, and it is a copywriting brief's field name followed by
  // an ad headline, not something a customer typed.
  else if (LABEL_WORD.test(phrase)) faults.push("label");

  // A sentence that begins mid-thought. "that agencies are either snake oil or too expensive."
  // is the back half of somebody's paragraph, cut at the wrong place by the extractor.
  //
  // ‼️ NEVER ON A QUESTION, AND "So how much does it cost?" IS WHY. Caught by an earlier version
  // of this rule, and it is exactly the kind of phrase this corpus exists to hold: a real person
  // opening on a discourse marker. A question mark means somebody was asking, whatever word they
  // started with, and the corpus rule is that the market's own wording is kept.
  if (!phrase.includes("?") && FRAGMENT_OPENER.test(phrase)) faults.push("fragment");

  if (/[<>]|\]\(|\*\*|&#\d|&[a-z]+;/i.test(phrase)) faults.push("markup");
  if (NAV_CHROME.test(phrase)) faults.push("nav_chrome");
  if (/[:;]\s*$/.test(phrase)) faults.push("dangling");

  const words = phrase.split(/\s+/).filter(Boolean).length;
  if (words < MIN_WORDS) faults.push("too_short");
  if (words > MAX_WORDS) faults.push("too_long");

  return faults;
}

/** Is this something a person could plausibly have typed or said? */
export function isUsablePhrase(raw: string): boolean {
  return phraseFaults(raw).length === 0;
}

export interface PhraseFilterResult<T> {
  kept: T[];
  dropped: number;
  /** How many rows each fault accounted for. A row with two faults is counted under both. */
  faults: Record<string, number>;
}

/**
 * Filter a list of rows, keeping the count of what went and why.
 *
 * ‼️ THE COUNT IS NOT OPTIONAL. A corpus that silently loses two thirds of itself looks like a
 * small corpus, and "the vertical only has 144 phrases" sends somebody to run another harvest
 * when the truth is that 306 rows of debris are already stored. Every caller prints this.
 */
export function filterPhrases<T>(rows: readonly T[], of: (row: T) => string): PhraseFilterResult<T> {
  const kept: T[] = [];
  const faults: Record<string, number> = {};
  let dropped = 0;

  for (const row of rows) {
    const found = phraseFaults(of(row));
    if (found.length === 0) {
      kept.push(row);
      continue;
    }
    dropped += 1;
    for (const fault of found) faults[fault] = (faults[fault] ?? 0) + 1;
  }

  return { kept, dropped, faults };
}

/** One line naming what was dropped, for a card or a PDF. Says nothing when nothing was. */
export function droppedLine(result: PhraseFilterResult<unknown>, total: number): string | null {
  if (result.dropped === 0) return null;
  const top = Object.entries(result.faults)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([fault, n]) => `${n} ${fault.replace(/_/g, " ")}`)
    .join(", ");
  return (
    `${result.kept.length} of ${total} phrases were usable. ${result.dropped} were extraction ` +
    `debris rather than anything anybody said (${top}).`
  );
}
