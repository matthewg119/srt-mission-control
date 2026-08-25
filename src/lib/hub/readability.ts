// How her review READS. Pure arithmetic, and it never suggests different words.
//
// ‼️ THIS FILE IMPORTS NOTHING, FOR THE SAME REASON review-assemble.ts IMPORTS NOTHING.
//
// Matthew asked for reviews to be rewritten to a sixth-grade reading level with an emotional
// hook added. That is GENERATING review content the customer did not write, attributed to her,
// published on the client's Google profile — FTC 16 CFR Part 465, the Rytr fact pattern, which
// is the enforcement action about a tool that produced review text its users had not written.
// He was told why, and chose this instead: a readability HINT, in his words, "like
// hemingway.app... this way they clean the review themselves after speaking directly to the
// mic and it looks fire and they write it themselves."
//
// ‼️ SO: IT MAY POINT AT A SENTENCE. IT MAY NOT REWRITE ONE.
//
// There is no function here that returns modified text, there is no "fix it for me" button in
// the UI, and neither may be added. The moment software supplies the replacement words we are
// back across the line this whole tool is designed to stay on. The difference between "this
// sentence runs long" and "try this sentence instead" is the entire legal distinction between
// a tool that reformats what she typed and one that writes it for her.
//
// The test suite asserts this file exports nothing returning a rewritten string. That check is
// grep-able on purpose, the same way `no issues found` is in the artifact tests.
//
// No model call, no network, no API. Syllables, words and sentences, counted.

/** A sentence that is worth pointing at, and why. Never what to do about it. */
export interface HardSentence {
  /** Character offsets into the text passed to analyse(), so the UI can highlight in place. */
  start: number;
  end: number;
  words: number;
  grade: number;
  /** `long` is too many words in one breath. `dense` is short words doing heavy work. */
  reason: "long" | "dense";
}

export interface Readability {
  words: number;
  sentences: number;
  /** Flesch-Kincaid grade for the whole text. 0 when there is nothing to measure. */
  grade: number;
  hard: HardSentence[];
}

/** Over this many words in one sentence and it is hard to read aloud in one breath. */
const LONG_WORDS = 20;
/** Flesch-Kincaid grade at or above this, for a single sentence, reads as dense. */
const DENSE_GRADE = 12;

/**
 * Syllables in one word, by the standard vowel-group heuristic.
 *
 * Approximate, and that is fine: this drives a hint, not a decision. It is deliberately the
 * same well-known approximation every readability tool uses, so a number here matches what
 * somebody would get if they pasted the text into one of them and compared.
 */
export function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;

  const trimmed = w
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "")
    .replace(/^y/, "");

  const groups = trimmed.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

/** Words, by whitespace, with anything carrying no letter or digit dropped. */
export function words(text: string): string[] {
  return text
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => /[a-z0-9]/i.test(w));
}

/**
 * Split into sentences, keeping each one's offsets in the original string.
 *
 * Offsets rather than just the substrings, because the UI highlights the flagged sentence where
 * she typed it. Re-finding a substring would land on the wrong copy when she has written the
 * same sentence twice, which people do.
 */
export function sentences(text: string): Array<{ text: string; start: number; end: number }> {
  const out: Array<{ text: string; start: number; end: number }> = [];
  const re = /[^.!?…]+(?:[.!?…]+|$)/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    const leading = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (!trimmed || !/[a-z0-9]/i.test(trimmed)) continue;
    out.push({
      text: trimmed,
      start: m.index + leading,
      end: m.index + leading + trimmed.length,
    });
    if (re.lastIndex === m.index) re.lastIndex += 1;
  }
  return out;
}

/** Flesch-Kincaid grade level for a block of text. */
export function gradeLevel(text: string): number {
  const ws = words(text);
  const ss = sentences(text);
  if (!ws.length || !ss.length) return 0;

  const syl = ws.reduce((n, w) => n + syllables(w), 0);
  const grade = 0.39 * (ws.length / ss.length) + 11.8 * (syl / ws.length) - 15.59;
  return Math.max(0, Math.round(grade * 10) / 10);
}

/**
 * The whole hint: a grade, a word count, and which sentences are worth a second look.
 *
 * Returns nothing to apply and nothing to accept. A caller can render it and that is all.
 */
export function analyse(text: string): Readability {
  const ss = sentences(text);
  const allWords = words(text);

  const hard: HardSentence[] = [];
  for (const s of ss) {
    const n = words(s.text).length;
    const g = gradeLevel(s.text);
    // Order matters only for which label shows: a long sentence is the more useful thing to
    // say about a sentence that is both, because shortening it fixes the density too.
    if (n > LONG_WORDS) {
      hard.push({ start: s.start, end: s.end, words: n, grade: g, reason: "long" });
    } else if (g >= DENSE_GRADE && n >= 6) {
      hard.push({ start: s.start, end: s.end, words: n, grade: g, reason: "dense" });
    }
  }

  return {
    words: allWords.length,
    sentences: ss.length,
    grade: gradeLevel(text),
    hard,
  };
}
