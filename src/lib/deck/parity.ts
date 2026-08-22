// Word-level parity: the pasted script vs the slides Claude authored.
//
// Rule #1 of the deck builder is that the script is sacred, so this is the guard that proves
// it. A bare word count only says THAT something drifted; across 200 slides that is useless.
// So this diffs the two token streams and names the slide where the drift starts, which is
// also what gets fed back to the model on the repair pass.
//
// Port of vsl-deck-builder/parity.py.

import { type DeckSlide, slideText, VISUAL_TYPES, EMPHASES } from "./types";

const TRANSLATE: Record<string, string> = {
  "‘": "'", "’": "'", "‚": "'", "‛": "'",
  "“": '"', "”": '"', "„": '"', "‟": '"',
  "–": "-", "—": "-", "−": "-",
  "…": "...", " ": " ", "•": " ",
};

// Note "-" is deliberately absent: "twenty-five" must stay one token.
const PUNCT = new Set([...'"\'`.,;:!?()[]{}<>*_~/\\|@#$%^&+=', "•"]);

// A parenthetical is dropped from the script only when its ENTIRE contents look like a
// delivery cue. Anything else in parens is real copy and stays. Whatever gets dropped is
// reported, never silently swallowed.
const STAGE_WORDS = new Set([
  "pause", "long pause", "short pause", "beat", "two beats",
  "laugh", "laughs", "laughter", "smile", "smiles", "grin", "sigh",
  "breathe", "breath", "slower", "faster", "louder", "softer", "quieter",
  "lean in", "look at camera", "to camera", "on screen", "cut", "music",
  "silence", "whisper", "emphasis", "b-roll", "broll", "slide", "next slide",
]);

function normalize(text: string): string {
  let out = text;
  for (const [src, dst] of Object.entries(TRANSLATE)) out = out.split(src).join(dst);
  return out;
}

export function collapse(text: string): string {
  return normalize(text).replace(/\s+/g, " ").trim();
}

export function tokens(text: string): string[] {
  const out: string[] = [];
  for (const raw of collapse(text).toLowerCase().split(" ")) {
    let start = 0;
    let end = raw.length;
    while (start < end && PUNCT.has(raw[start])) start++;
    while (end > start && PUNCT.has(raw[end - 1])) end--;
    const word = raw.slice(start, end);
    if (word) out.push(word);
  }
  return out;
}

/**
 * An ALL-CAPS structural header line ("THE THREE PROMISES", "HOOK / PROMISE + GUARANTEE").
 *
 * These are how a webinar script gets organized into ideas. They are labels for the writer,
 * not words anyone says out loud, so they must never land on a slide — but they DO mark where
 * one idea ends and the next begins, so they are captured rather than discarded.
 */
export function isSectionHeader(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 70) return false;
  if (/[.!?]$/.test(t)) return false;
  const letters = t.replace(/[^A-Za-z]/g, "");
  if (letters.length < 3) return false;
  if (letters !== letters.toUpperCase()) return false;
  return t.split(/\s+/).length <= 9;
}

export interface SectionSplit {
  /** The script with header lines removed — the only text that must reach the slides. */
  body: string;
  /** Ordered {header, text} chunks. A script with no headers yields one untitled chunk. */
  sections: Array<{ header: string | null; text: string }>;
  headers: string[];
}

export function splitSections(raw: string): SectionSplit {
  const sections: Array<{ header: string | null; text: string }> = [];
  const headers: string[] = [];
  let current: { header: string | null; lines: string[] } = { header: null, lines: [] };

  for (const line of normalize(raw).split(/\r?\n/)) {
    if (isSectionHeader(line)) {
      if (current.header !== null || current.lines.some((l) => l.trim())) {
        sections.push({ header: current.header, text: current.lines.join("\n").trim() });
      }
      headers.push(line.trim());
      current = { header: line.trim(), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.header !== null || current.lines.some((l) => l.trim())) {
    sections.push({ header: current.header, text: current.lines.join("\n").trim() });
  }

  const kept = sections.filter((s) => s.text.trim());
  return {
    body: kept.map((s) => s.text).join("\n\n"),
    sections: kept,
    headers,
  };
}

/**
 * Remove delivery cues from the script side: `[pause]`, `*(lean in)*`, `(beat)`.
 *
 * ‼️ A BRACKET IS ONLY A CUE WHEN IT READS LIKE ONE. `[city]` and `[treatment]` are
 * PLACEHOLDERS the presenter says out loud with the real word substituted, and stripping them
 * put a blank gap in the middle of a sentence on a slide being read to camera:
 * `lip filler in  "` on slide 7 of the med spa deck. Leaving `[city]` on the slide is what a
 * teleprompter is for — he sees the bracket and says "Greensboro".
 *
 * So brackets go through the same STAGE_WORDS test that parentheses already used. Whatever is
 * dropped is reported, never silently swallowed.
 */
export function stripDelivery(text: string): { text: string; removed: string[] } {
  const removed: string[] = [];
  const cue = (inner: string): boolean => STAGE_WORDS.has(inner.trim().toLowerCase());

  // *(...)* is explicitly marked as a direction, so its contents are not second-guessed.
  let out = text.replace(/\*\([^)\n]*\)\*/g, (m) => {
    removed.push(m.trim());
    return " ";
  });
  out = out.replace(/\[([^\]\n]*)\]/g, (m, inner: string) => {
    if (!cue(inner)) return m;
    removed.push(m.trim());
    return " ";
  });
  out = out.replace(/\(([^)\n]*)\)/g, (m, inner: string) => {
    if (!cue(inner)) return m;
    removed.push(m.trim());
    return " ";
  });
  // A dropped cue leaves the spaces that surrounded it. Collapsing them is parity-safe —
  // tokens() ignores whitespace entirely — and keeps a double space off the slide.
  return { text: out.replace(/[ \t]{2,}/g, " "), removed };
}

export interface ParityResult {
  ok: boolean;
  scriptWords: number;
  deckWords: number;
  removed: string[];
  /** Human-readable spans, first few only. Fed back to the model verbatim on repair. */
  problems: string[];
}

interface Op {
  tag: "equal" | "delete" | "insert" | "replace";
  a1: number;
  a2: number;
  b1: number;
  b2: number;
}

/**
 * Myers diff over the two token streams, collapsed to opcodes.
 *
 * difflib.SequenceMatcher has no JS equivalent, and a naive O(n*m) DP table blows up on a
 * 3,000-word webinar (9M cells). Myers walks diagonals instead, so an exact match — the
 * expected case — costs one pass, and cost scales with the size of the drift, not the script.
 */
function opcodes(a: string[], b: string[]): Op[] {
  const max = a.length + b.length;
  if (max === 0) return [];
  const offset = max;
  const trace: Int32Array[] = [];
  const v = new Int32Array(2 * max + 2);
  let found = -1;

  outer: for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      const idx = k + offset;
      let x: number;
      if (k === -d || (k !== d && v[idx - 1] < v[idx + 1])) x = v[idx + 1];
      else x = v[idx - 1] + 1;
      let y = x - k;
      while (x < a.length && y < b.length && a[x] === b[y]) { x++; y++; }
      v[idx] = x;
      if (x >= a.length && y >= b.length) { found = d; break outer; }
    }
  }
  if (found < 0) return [{ tag: "replace", a1: 0, a2: a.length, b1: 0, b2: b.length }];

  // Walk the trace backwards into a flat script of equal/delete/insert steps.
  const steps: Array<{ tag: "equal" | "delete" | "insert"; a: number; b: number }> = [];
  let x = a.length;
  let y = b.length;
  for (let d = found; d > 0; d--) {
    const prev = trace[d];
    const k = x - y;
    const down = k === -d || (k !== d && prev[k - 1 + offset] < prev[k + 1 + offset]);
    const prevK = down ? k + 1 : k - 1;
    const prevX = prev[prevK + offset];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) steps.push({ tag: "equal", a: --x, b: --y });
    if (down) steps.push({ tag: "insert", a: x, b: --y });
    else steps.push({ tag: "delete", a: --x, b: y });
  }
  while (x > 0 && y > 0) steps.push({ tag: "equal", a: --x, b: --y });
  steps.reverse();

  const ops: Op[] = [];
  for (const s of steps) {
    const last = ops[ops.length - 1];
    if (last && last.tag === s.tag) {
      if (s.tag !== "insert") last.a2 = s.a + 1;
      if (s.tag !== "delete") last.b2 = s.b + 1;
      continue;
    }
    ops.push({
      tag: s.tag,
      a1: s.a,
      a2: s.tag === "insert" ? s.a : s.a + 1,
      b1: s.b,
      b2: s.tag === "delete" ? s.b : s.b + 1,
    });
  }

  // A delete immediately followed by an insert is one changed span, not two.
  const merged: Op[] = [];
  for (const op of ops) {
    const last = merged[merged.length - 1];
    if (last && last.tag === "delete" && op.tag === "insert") {
      merged[merged.length - 1] = { tag: "replace", a1: last.a1, a2: last.a2, b1: op.b1, b2: op.b2 };
      continue;
    }
    merged.push(op);
  }
  return merged.filter((op) => op.tag !== "equal");
}

function context(seq: string[], lo: number, hi: number, pad = 8): string {
  const before = seq.slice(Math.max(0, lo - pad), lo).join(" ");
  const middle = seq.slice(lo, hi).join(" ");
  const after = seq.slice(hi, hi + pad).join(" ");
  return [before, `<<${middle}>>`, after].filter(Boolean).join(" ");
}

/** Numbering/schema validation. Throws on a gap, duplicate, or unknown enum value. */
export function validateSlides(slides: DeckSlide[]): void {
  const problems: string[] = [];
  slides.forEach((slide, i) => {
    if (slide.n !== i + 1) problems.push(`position ${i + 1} has n=${slide.n} - expected n=${i + 1}`);
    for (const run of slide.runs ?? []) {
      if (!EMPHASES.includes(run.e)) problems.push(`slide ${slide.n}: unknown emphasis ${JSON.stringify(run.e)}`);
    }
    const v = slide.visual;
    if (v && !VISUAL_TYPES.includes(v.type)) problems.push(`slide ${slide.n}: unknown visual type ${JSON.stringify(v.type)}`);
  });
  if (problems.length) {
    throw new Error(`Slide numbering/schema is broken:\n  ${problems.join("\n  ")}`);
  }
}

export function runParity(script: string, slides: DeckSlide[]): ParityResult {
  const { body } = splitSections(script);
  const { text: clean, removed } = stripDelivery(body);

  const scriptTokens = tokens(clean);
  const deckTokens: string[] = [];
  const owner: number[] = [];
  for (const slide of slides) {
    for (const tok of tokens(slideText(slide))) {
      deckTokens.push(tok);
      owner.push(slide.n);
    }
  }

  const diffs = opcodes(scriptTokens, deckTokens);
  const problems: string[] = [];
  for (const op of diffs.slice(0, 4)) {
    const where = owner.length ? `slide ${owner[Math.min(op.b1, owner.length - 1)]}` : "empty deck";
    const label =
      op.tag === "delete" ? "MISSING from slides"
        : op.tag === "insert" ? "ADDED to slides (not in the script)"
          : "CHANGED wording";
    problems.push(
      `${where} - ${label}\n     script: ${context(scriptTokens, op.a1, op.a2)}\n     slides: ${context(deckTokens, op.b1, op.b2)}`
    );
  }

  return {
    ok: diffs.length === 0,
    scriptWords: scriptTokens.length,
    deckWords: deckTokens.length,
    removed,
    problems,
  };
}
