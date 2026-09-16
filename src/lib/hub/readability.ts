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
//
// ─────────────────────────────────────────────────────────────────────────────
// The Hemingway pass (2026-09-08)
//
// Matthew asked for "a Hemingway-style readability screen". That is not a reversal of anything
// above: it is the SAME request the header already quotes, built out. hemingway.app draws four
// signals and this file now draws all four, in the same two directions the original hint went:
// a sentence is pointed at, a word is pointed at, and NOTHING is ever proposed in place of
// either. There is still no function here that returns modified text and there must never be.
//
// ‼️ THE WORD-LEVEL SIGNALS ARE A SEPARATE ARRAY, AND THAT IS NOT COSMETIC.
//
// `hard` is sentence spans and stays exactly what it was: same thresholds, same two reasons,
// same offsets. Two live assertions pin it (test-onboarding-artifacts.ts: three short sentences
// flag nothing, and one 41-word sentence yields exactly one span whose reason is "long"), and
// folding word flags into it would break both and change what every existing caller reads.
// `flags` is the new one, and it is separately shaped because a flagged word usually sits
// INSIDE a flagged sentence, so the two sets overlap by nature and the renderer has to merge
// them rather than concatenate them.
//
// ‼️ TWO STOP LISTS EXIST BECAUSE THE GENERIC DETECTOR IS WRONG IN THIS ONE DOMAIN.
// hemingway.app reads "I was worried" as passive voice. It is a predicate adjective, and it is
// also the literal shape of the answer to question one of four. A generic passive detector
// would underline something on nearly every review this tool has ever collected, which is how a
// hint stops being read. FEELING_ADJECTIVES is that carve-out and ADVERB_STOP is the ordinary
// -ly one.

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

/**
 * A word or short phrase worth a second look, and which kind. Never what to put there instead.
 *
 * `passive` spans the auxiliary and the participle together, because pointing at "was" alone
 * says nothing. The other three are one word each.
 */
export type FlagKind = "adverb" | "passive" | "qualifier" | "complex";

export interface WordFlag {
  /** Character offsets into the text passed to analyse(), same basis as HardSentence. */
  start: number;
  end: number;
  kind: FlagKind;
}

export interface Readability {
  words: number;
  sentences: number;
  /** Flesch-Kincaid grade for the whole text. 0 when there is nothing to measure. */
  grade: number;
  hard: HardSentence[];
  /**
   * Word-level signals, sorted by offset and guaranteed NON-OVERLAPPING with each other.
   *
   * They DO overlap `hard`, always, since a flagged word is usually inside a flagged sentence.
   * A renderer must merge the two sets rather than walk them one after the other.
   */
  flags: WordFlag[];
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

// -----------------------------------------------------------------------------
// The word-level vocabularies
//
// Hand-written, short, and checked in. Every one of them is a list of things to POINT AT. None
// of them is paired with a replacement, and adding a second column to any of them would be the
// one thing this file exists not to do.
// -----------------------------------------------------------------------------

/** Words ending in -ly that are not adverbs. The ordinary trap. */
const ADVERB_STOP = new Set([
  "only", "family", "reply", "apply", "supply", "ugly", "early", "july", "italy", "holy",
  "rely", "imply", "multiply", "assembly", "anomaly", "monopoly", "comply", "belly", "jelly",
  "ally", "bully", "rally", "tally", "melancholy", "silly", "chilly", "gully",
]);

/**
 * -ly words that describe the thing rather than the manner, so pointing at them is noise.
 *
 * These are adjectives: "a friendly nurse" is not a sentence with an adverb in it.
 */
const ADJECTIVE_LY = new Set([
  "friendly", "lovely", "lonely", "likely", "unlikely", "daily", "weekly", "monthly", "yearly",
  "costly", "deadly", "orderly", "elderly", "curly", "timely", "homely", "manly", "womanly",
  "leisurely", "lively", "ghastly",
]);

/** The auxiliaries a passive construction is built on. */
const BE_VERBS = new Set(["am", "is", "are", "was", "were", "be", "been", "being"]);

/** Past participles that do not end in -ed. Common ones only; this is a hint, not a parser. */
const IRREGULAR_PARTICIPLES = new Set([
  "been", "done", "gone", "seen", "taken", "given", "known", "shown", "written", "broken",
  "spoken", "chosen", "driven", "forgotten", "hidden", "held", "kept", "left", "made", "paid",
  "put", "said", "sent", "set", "sold", "told", "brought", "bought", "caught", "taught",
  "thought", "found", "built", "lost", "met", "run", "cut", "hurt", "let",
  "beaten", "eaten", "fallen", "frozen", "worn", "torn", "drawn", "grown", "thrown", "flown",
]);

/**
 * THE CARVE-OUT, AND IT IS THE MOST IMPORTANT LIST IN THIS FILE.
 *
 * These are participle-SHAPED adjectives describing how a person felt. "I was worried" is a
 * predicate adjective, not the passive voice, and it is also the literal shape of the answer to
 * question one of the four. hemingway.app underlines every one of them. Doing that here would
 * put a mark on nearly every review this tool has ever collected, and a hint that fires on
 * everything is a hint nobody reads.
 */
const FEELING_ADJECTIVES = new Set([
  "worried", "concerned", "scared", "frightened", "terrified", "nervous", "anxious",
  "interested", "pleased", "satisfied", "delighted", "excited", "relaxed", "calm", "tired",
  "exhausted", "surprised", "shocked", "amazed", "impressed", "disappointed", "embarrassed",
  "confused", "annoyed", "frustrated", "upset", "relieved", "grateful", "thrilled", "hooked",
  "unsure", "hesitant", "reluctant", "determined", "prepared", "ready", "welcome", "welcomed",
  "booked", "closed", "opened", "involved", "married", "located", "used", "supposed",
  "kind", "well", "fine", "happy", "glad", "gentle", "honest", "clear",
]);

/** Hedges. One word each. */
const QUALIFIER_WORDS = new Set([
  "just", "really", "very", "quite", "rather", "somewhat", "actually", "basically", "literally",
  "maybe", "perhaps", "probably", "fairly", "truly", "totally", "definitely", "honestly",
  "simply", "certainly", "absolutely", "essentially", "virtually", "generally", "usually",
]);

/** Hedges that are more than one word. Matched on consecutive tokens, lowercased. */
const QUALIFIER_PHRASES: ReadonlyArray<readonly string[]> = [
  ["kind", "of"],
  ["sort", "of"],
  ["a", "bit"],
  ["a", "little"],
  ["pretty", "much"],
  ["i", "think"],
  ["i", "guess"],
  ["i", "would", "say"],
  ["to", "be", "honest"],
  ["in", "my", "opinion"],
];

/**
 * Long words with a plain equivalent everybody already uses.
 *
 * DELIBERATELY NOT "EVERY WORD OF THREE SYLLABLES". hemingway.app flags a word only where it
 * has a simpler alternative, and in this domain the difference is the whole game: appointment,
 * treatment, consultation, professional, experience and recommend are all three syllables or
 * more, all natural in a review about a clinic, and marking them would be telling somebody
 * their own subject matter is too complicated. This list holds none of them, on purpose.
 */
const COMPLEX_WORDS = new Set([
  "approximately", "additionally", "consequently", "furthermore", "nevertheless", "moreover",
  "accommodate", "accommodating", "facilitate", "facilitated", "utilize", "utilise", "utilized",
  "utilised", "utilization", "commence", "commenced", "endeavour", "endeavor", "numerous",
  "sufficient", "insufficient", "subsequently", "initiate", "initiated", "terminate",
  "terminated", "demonstrate", "demonstrated", "anticipate", "anticipated", "individuals",
  "personnel", "remainder", "assistance", "requirement", "requirements", "regarding",
  "concerning", "possess", "possessed", "inquire", "inquired", "attempted", "sufficiently",
]);

/**
 * Words, with their offsets. An apostrophe or a hyphen stays inside a token.
 *
 * Its own tokenizer rather than words() above, because that one splits on whitespace and keeps
 * the punctuation, which would put a full stop inside a flagged span and underline it.
 */
export function wordSpans(text: string): Array<{ word: string; start: number; end: number }> {
  const out: Array<{ word: string; start: number; end: number }> = [];
  const re = /[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ word: m[0], start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/** An -ly adverb, once the two lists of things that merely look like one are removed. */
function isAdverb(word: string): boolean {
  const w = word.toLowerCase();
  if (w.length <= 4 || !w.endsWith("ly")) return false;
  return !ADVERB_STOP.has(w) && !ADJECTIVE_LY.has(w);
}

/** A past participle, for the passive check only. Never true for a FEELING_ADJECTIVE. */
function isParticiple(word: string): boolean {
  const w = word.toLowerCase();
  if (FEELING_ADJECTIVES.has(w)) return false;
  if (IRREGULAR_PARTICIPLES.has(w)) return true;
  return w.length > 4 && w.endsWith("ed");
}

/**
 * Every word-level signal in the text, sorted and de-overlapped.
 *
 * THE PRIORITY ORDER IS PART OF THE ANSWER. "was really worried" is one construction with an
 * adverb inside it; marking both would put a mark inside a mark and say two things about one
 * phrase. The longest and most structural signal wins, and anything it contains is dropped.
 */
function wordFlags(text: string): WordFlag[] {
  const tokens = wordSpans(text);
  const lower = tokens.map((t) => t.word.toLowerCase());
  const found: Array<WordFlag & { rank: number }> = [];

  // Passive: a be-verb, optionally an adverb, then a participle.
  for (let i = 0; i < tokens.length; i += 1) {
    if (!BE_VERBS.has(lower[i])) continue;
    let j = i + 1;
    if (j < tokens.length && isAdverb(tokens[j].word)) j += 1;
    if (j < tokens.length && isParticiple(tokens[j].word)) {
      found.push({ start: tokens[i].start, end: tokens[j].end, kind: "passive", rank: 0 });
    }
  }

  // Hedges of more than one word, before the single ones, so "a bit" beats nothing and
  // "kind of" is one mark rather than two.
  for (let i = 0; i < tokens.length; i += 1) {
    for (const phrase of QUALIFIER_PHRASES) {
      if (i + phrase.length > tokens.length) continue;
      let hit = true;
      for (let k = 0; k < phrase.length; k += 1) {
        if (lower[i + k] !== phrase[k]) {
          hit = false;
          break;
        }
      }
      if (hit) {
        found.push({
          start: tokens[i].start,
          end: tokens[i + phrase.length - 1].end,
          kind: "qualifier",
          rank: 1,
        });
        break;
      }
    }
  }

  // Single words. A qualifier outranks an adverb, because "really" is both and the hedge is the
  // more useful thing to say about it.
  for (let i = 0; i < tokens.length; i += 1) {
    const span = { start: tokens[i].start, end: tokens[i].end };
    if (QUALIFIER_WORDS.has(lower[i])) {
      found.push({ ...span, kind: "qualifier", rank: 2 });
    } else if (isAdverb(tokens[i].word)) {
      found.push({ ...span, kind: "adverb", rank: 3 });
    } else if (COMPLEX_WORDS.has(lower[i]) && syllables(lower[i]) >= 3) {
      found.push({ ...span, kind: "complex", rank: 4 });
    }
  }

  // Keep the highest-priority signal on any stretch of text, then the next one that does not
  // touch it. Ties break by position, so the same input always gives the same marks.
  found.sort((a, b) => a.rank - b.rank || a.start - b.start);
  const kept: WordFlag[] = [];
  for (const flag of found) {
    if (kept.some((k) => flag.start < k.end && k.start < flag.end)) continue;
    kept.push({ start: flag.start, end: flag.end, kind: flag.kind });
  }
  kept.sort((a, b) => a.start - b.start);
  return kept;
}

/** One piece of the text, and what is true about it. Never what to replace it with. */
export interface Mark {
  text: string;
  /** The reason of the hard sentence covering this piece, or null. */
  hard: "long" | "dense" | null;
  /** The kind of the word flag covering this piece, or null. */
  flag: FlagKind | null;
}

/**
 * Cut the text at every span boundary, so a renderer can paint overlapping marks in one pass.
 *
 * ‼️ THE INVARIANT IS THAT THE PIECES JOIN BACK TO THE ORIGINAL STRING, CHARACTER FOR
 * CHARACTER, AND EVERYTHING ELSE HERE IS IN SERVICE OF IT.
 *
 * The review tool paints these into a div sitting exactly underneath a transparent textarea.
 * The two have to hold the same characters in the same order and wrap identically, or every
 * highlight slides off the words it is about (hub.css says the same thing about fonts and
 * padding). A renderer that dropped or duplicated one character would not look broken; it would
 * look like the hint was pointing at the wrong sentence.
 *
 * ‼️ AND IT IS WHY THE OLD SINGLE-CURSOR WALK HAD TO GO. That one advanced through `hard` alone
 * and assumed spans that never overlap. Word flags nest inside sentence spans by nature, so one
 * adverb inside a long sentence would have sliced a negative-length string and duplicated the
 * rest of the review. Boundaries and cover-tests have no such assumption: spans may overlap,
 * nest, touch, or repeat, and the output is the same either way.
 */
export function mergeMarks(text: string, reading: Readability): Mark[] {
  const bounds = new Set<number>([0, text.length]);
  for (const s of reading.hard) {
    bounds.add(s.start);
    bounds.add(s.end);
  }
  for (const f of reading.flags) {
    bounds.add(f.start);
    bounds.add(f.end);
  }

  const points = [...bounds].filter((n) => n >= 0 && n <= text.length).sort((a, b) => a - b);
  const out: Mark[] = [];

  for (let i = 0; i < points.length - 1; i += 1) {
    const from = points[i];
    const to = points[i + 1];
    if (to <= from) continue;
    const sentence = reading.hard.find((s) => s.start <= from && to <= s.end);
    const word = reading.flags.find((f) => f.start <= from && to <= f.end);
    out.push({
      text: text.slice(from, to),
      hard: sentence?.reason ?? null,
      flag: word?.kind ?? null,
    });
  }

  return out;
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
    flags: wordFlags(text),
  };
}
