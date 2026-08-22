// The creative half: a webinar script -> slides, chunked by idea.
//
// Rule #1 is that the script is sacred. Every word appears on a slide, word for word, in the
// original order — nothing paraphrased, tightened, reordered or invented. The model chooses
// only three things: where one spoken beat ends and the next begins, which one to four words
// carry the purple, and whether a slide earns a visual.
//
// Everything here is per BATCH, and every batch is parity-checked against its own source text
// before the next one runs. A 1,500-word script that only gets checked at the end has already
// spent every call by the time the drift is found, and the diff spans four batches.

import { callClaudeJSON, type ClaudeModel } from "@/lib/claude-calls";
import { type DeckSlide, type DeckRun, VISUAL_TYPES } from "./types";
import { runParity, splitSections, stripDelivery, collapse } from "./parity";

function model(): ClaudeModel {
  return (process.env.ANTHROPIC_MODEL as ClaudeModel) || "claude-sonnet-4-6";
}

/**
 * Roughly one Claude call per this many script words (~15 slides of JSON).
 *
 * ‼️ Sized against `MAX_TOKENS` below, not against what "feels like a passage". At 420 words
 * every batch of a live 1,119-word script came back truncated mid-JSON.
 */
const BATCH_WORDS = 260;

/**
 * ‼️ MUST STAY UNDER `MAX_RETRY_TOKENS` (8000) IN claude-calls.ts.
 *
 * That helper answers `stop_reason: "max_tokens"` by retrying once at double the budget, but
 * only `if (requestedTokens < MAX_RETRY_TOKENS)`. Passing the cap itself does not "ask for the
 * most" — it silently disables the one recovery that exists for truncation, and a cut-off
 * response then fails as an unparseable-JSON error whose message says nothing about length.
 * At 4000 a truncated batch escalates to 8000 on its own.
 */
const MAX_TOKENS = 4000;

/** Batches are independent, so they run in waves rather than end to end. */
const CONCURRENCY = 4;

const SYSTEM = `You turn a webinar / VSL script into a Hormozi-style teleprompter deck: white
slides, big bold black text saying EXACTLY what is being read out loud on that slide, purple on
the payoff words. The presenter records himself reading the deck, so the deck IS the script.

RULE 1 - THE SCRIPT IS SACRED. Every word of the script appears on a slide, word for word, in
the original order. Never paraphrase, summarize, improve, shorten, reorder or correct anything.
Do not fix typos. Do not change punctuation. Do not add a title slide, an agenda, a section
header or a thank-you slide. Concatenating every run's "t" across every slide, in order, must
reproduce the supplied text EXACTLY, including spaces and punctuation.

CHUNKING - one spoken beat per slide. Target 10-35 words, hard max 45.
- ‼️ A SLIDE ENDS WHERE A SENTENCE ENDS. Do not break a sentence across two slides unless that
  single sentence runs past ~45 words, and then break only at a comma, a dash or an ellipsis.
  "If you own a med spa," and "this is our promise to you." are HALVES OF ONE SENTENCE and
  belong on one slide. Two short neighbouring sentences may share a slide when together they
  are one thought and stay under 35 words.
- A slide under 8 words is right only when the script's own sentence is that short: a
  punchline, a price, a bare question, a transition.
- These always get their OWN slide for punch: a big claim or promise, a price or a number, a
  question to the audience, a one-word or one-line punchline, a transition ("So here's what I
  did"), and any CTA or URL.
- A list in the script becomes a bullet slide: a short lead-in line in "runs", then each item
  as an entry in "bullets". The wording stays verbatim.

EMPHASIS - 1 to 4 words per slide, never a whole slide, often none. Purple goes on the payoff
words: outcomes, numbers, pain points. Split the sentence into separate runs and mark only the
emphasized run. Spaces live INSIDE the run text ("So I called "), never between runs. "e" is
omitted, or "purple", "underline", or "purple-italic".

VISUALS - ‼️ COUNT THEM. Roughly one slide in four carries a visual, so a passage that becomes
20 slides needs about 5 of them, not one. Put them where a picture buys speed of comprehension:
a concrete scene the script describes, a number worth showing, a before/after, a comparison.
Leave them off slides that are pure setup or pure transition, and omit the "visual" key entirely
on those. type is one of icon, sketch, diagram, stat-viz, screenshot. Every visual needs all
three of: "idea" (one plain sentence describing what to draw), "prompt" (ready to paste, of the
form "black marker doodle of [SCENE], simple stick figures, thick clean hand-drawn lines,
whiteboard sketch style, pure white background, minimal, flat, no shading, no color", optionally
plus "single purple #6D28F9 accent on [ELEMENT]"), and "search" (2 or 3 short stock-icon
queries).

BRACKETS - delivery cues like [pause] have already been removed before you see this passage.
Any [bracket] still in it is a PLACEHOLDER the presenter reads out loud with the real word
substituted, like [city] or [treatment]. Reproduce it on the slide exactly as written, brackets
included. It is a teleprompter: he needs to see the bracket.

Return ONLY JSON: {"slides":[{"runs":[{"t":"..."}]}]}. OMIT every field that would be null or
empty — no "e" on an unemphasized run, no "bullets", "visual" or "notes" key unless that slide
actually has one. Do not number the slides.`;

interface AuthoredBatch {
  slides: Array<{
    runs: DeckRun[];
    bullets?: DeckRun[][] | null;
    visual?: DeckSlide["visual"];
    notes?: string[] | null;
  }>;
}

function isAuthoredBatch(v: unknown): v is AuthoredBatch {
  if (!v || typeof v !== "object") return false;
  const slides = (v as AuthoredBatch).slides;
  if (!Array.isArray(slides) || slides.length === 0) return false;
  return slides.every((s) => {
    if (!s || typeof s !== "object" || !Array.isArray(s.runs)) return false;
    if (!s.runs.every((r) => r && typeof r.t === "string")) return false;
    if (s.bullets != null && (!Array.isArray(s.bullets) || !s.bullets.every((b) => Array.isArray(b)))) return false;
    if (s.visual != null) {
      const v2 = s.visual;
      if (!VISUAL_TYPES.includes(v2.type)) return false;
      if (!v2.idea || !v2.prompt || !Array.isArray(v2.search) || v2.search.length === 0) return false;
    }
    return true;
  });
}


/**
 * Repair the decoration, never the words.
 *
 * ‼️ THE ASYMMETRY IS THE WHOLE RULE. A slide's TEXT is Matthew's copy and is never touched
 * here — drift in it is caught by the parity check and sent back to the model to fix. Emphasis
 * and visuals are decoration this feature invented, so a malformed one is dropped rather than
 * being allowed to fail a batch whose words were perfect. A live run threw away four otherwise
 * correct batches over a visual `type` the model spelled `stat_viz`.
 *
 * Dropping is deliberate and beats guessing: a visual whose type could not be read is one whose
 * intent could not be read either, and a wrong sketch prompt in the speaker notes is worse than
 * an empty one. Every drop is invisible in the deck's words and shows up in the visual-density
 * warning, which is the honest place for it.
 */
export function coerceBatch(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const slides = (value as { slides?: unknown }).slides;
  if (!Array.isArray(slides)) return value;

  const emphasis = (e: unknown): string | undefined => {
    if (typeof e !== "string") return undefined;
    const key = e.trim().toLowerCase().replace(/[\s_]+/g, "-");
    return key === "purple" || key === "underline" || key === "purple-italic" ? key : undefined;
  };
  const visualType = (t: unknown): string | undefined => {
    if (typeof t !== "string") return undefined;
    const key = t.trim().toLowerCase().replace(/[\s_]+/g, "-");
    if (key === "statviz" || key === "stat-vis" || key === "stat") return "stat-viz";
    return VISUAL_TYPES.includes(key as never) ? key : undefined;
  };

  return {
    slides: slides.map((raw) => {
      const s = (raw ?? {}) as Record<string, unknown>;
      const runs = Array.isArray(s.runs)
        ? s.runs
          .filter((r) => r && typeof (r as { t?: unknown }).t === "string")
          .map((r) => {
            const run = r as { t: string; e?: unknown };
            const e = emphasis(run.e);
            return e ? { t: run.t, e } : { t: run.t };
          })
        : s.runs;

      const bullets = Array.isArray(s.bullets)
        ? s.bullets
          .filter(Array.isArray)
          .map((b) =>
            (b as unknown[])
              .filter((r) => r && typeof (r as { t?: unknown }).t === "string")
              .map((r) => {
                const run = r as { t: string; e?: unknown };
                const e = emphasis(run.e);
                return e ? { t: run.t, e } : { t: run.t };
              })
          )
        : null;

      let visual: unknown = null;
      const v = s.visual as Record<string, unknown> | null | undefined;
      if (v && typeof v === "object") {
        const type = visualType(v.type);
        const search = typeof v.search === "string" ? [v.search] : v.search;
        if (type && v.idea && v.prompt && Array.isArray(search) && search.length) {
          visual = { type, idea: String(v.idea), prompt: String(v.prompt), search: search.map(String) };
        }
      }

      const notes = Array.isArray(s.notes) ? s.notes.map(String) : [];
      return { runs, bullets: bullets?.length ? bullets : null, visual, notes };
    }),
  };
}

/** Name the field that actually failed, so the correction retry has something to act on. */
function describeInvalid(parsed: unknown): string {
  const slides = (parsed as AuthoredBatch)?.slides;
  if (!Array.isArray(slides)) return 'the payload has no "slides" array';
  if (slides.length === 0) return 'the "slides" array is empty';
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i] as AuthoredBatch["slides"][number] | null;
    const at = `slide ${i + 1}`;
    if (!s || typeof s !== "object") return `${at} is not an object`;
    if (!Array.isArray(s.runs)) return `${at} has no "runs" array`;
    if (!s.runs.every((r) => r && typeof r.t === "string")) {
      return `${at} has a run whose "t" is missing or is not a string`;
    }
    if (s.bullets != null && !Array.isArray(s.bullets)) return `${at} has a "bullets" that is not an array`;
    if (Array.isArray(s.bullets) && !s.bullets.every(Array.isArray)) {
      return `${at} has a bullet that is not an array of {t, e} runs`;
    }
    if (s.visual != null) {
      const v = s.visual;
      if (!VISUAL_TYPES.includes(v.type)) {
        return `${at} has visual.type ${JSON.stringify(v.type)}; it must be one of ${VISUAL_TYPES.join(", ")}`;
      }
      if (!v.idea) return `${at} has a visual with no "idea"`;
      if (!v.prompt) return `${at} has a visual with no "prompt"`;
      if (!Array.isArray(v.search)) return `${at} has a visual whose "search" is not an array of strings`;
      if (!v.search.length) return `${at} has a visual with an empty "search"`;
    }
  }
  return "the payload did not match the slide schema";
}

/**
 * Verbatim chunker: split on sentence boundaries, pack up to ~35 words per slide.
 *
 * The floor under the whole feature. It cannot emphasize and it cannot pick a visual, but it
 * cannot lose a word either — it only ever inserts slide breaks into the original string. When
 * a batch will not converge, a plain deck of the real script beats no deck, and beats a pretty
 * deck that quietly dropped a sentence.
 */
export function mechanicalChunk(text: string): AuthoredBatch["slides"] {
  const pieces = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const slides: AuthoredBatch["slides"] = [];
  let buffer: string[] = [];
  let words = 0;
  const flush = () => {
    if (!buffer.length) return;
    slides.push({ runs: [{ t: buffer.join(" ") }], bullets: null, visual: null, notes: [] });
    buffer = [];
    words = 0;
  };
  for (const piece of pieces) {
    const n = piece.split(/\s+/).length;
    if (words && words + n > 35) flush();
    buffer.push(piece);
    words += n;
  }
  flush();
  return slides;
}

/** Split one section's text into batches of roughly BATCH_WORDS, on paragraph boundaries. */
function batchesOf(text: string): string[] {
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  let buffer: string[] = [];
  let words = 0;
  for (const para of paras) {
    const n = para.split(/\s+/).length;
    if (words && words + n > BATCH_WORDS) {
      out.push(buffer.join("\n\n"));
      buffer = [];
      words = 0;
    }
    buffer.push(para);
    words += n;
  }
  if (buffer.length) out.push(buffer.join("\n\n"));
  return out;
}

async function authorBatch(
  source: string,
  section: string | null,
  onNote: (msg: string) => void
): Promise<{ slides: AuthoredBatch["slides"]; fellBack: boolean }> {
  const where = section ? `This passage is from the "${section}" section of the script.\n\n` : "";
  // Filled in after a failed parity pass so the retry is told exactly which words moved. A bare
  // "try again" gets the same answer back; the diff is the only thing that changes the outcome.
  let correction = "";

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { data } = await callClaudeJSON<AuthoredBatch>({
        model: model(),
        system: SYSTEM,
        user:
          `${where}Chunk this passage into slides. Reproduce it word for word.\n\n` +
          `<<<SCRIPT\n${source}\nSCRIPT>>>` +
          correction,
        maxTokens: MAX_TOKENS,
        temperature: 0.2,
        validate: isAuthoredBatch,
        coerce: coerceBatch,
        describeInvalid,
      });

      // Parity for THIS batch only, against this batch's own text.
      const check = runParity(source, data.slides.map((s, i) => ({ ...s, n: i + 1 })));
      if (check.ok) return { slides: data.slides, fellBack: false };

      if (attempt === 0) {
        onNote(`re-running one batch: ${check.problems[0]?.split("\n")[0] ?? "text drifted"}`);
        correction =
          `\n\nYour previous answer did not reproduce the passage exactly. The words between ` +
          `<< >> are where it diverged — "script" is what the passage says, "slides" is what you ` +
          `returned:\n\n${check.problems.join("\n\n")}\n\n` +
          `Chunk the passage again and copy every word exactly as written above. Change only ` +
          `where the slide breaks fall, never the words themselves.`;
        continue;
      }
      onNote(`a passage would not come back verbatim, so it was chunked plainly: ${check.problems[0]?.split("\n")[0] ?? ""}`);
    } catch (e) {
      if (attempt === 0) {
        onNote(`re-running one batch after an error: ${(e as Error).message}`);
        continue;
      }
      onNote(`a passage failed twice (${(e as Error).message}), so it was chunked plainly`);
    }
  }
  return { slides: mechanicalChunk(source), fellBack: true };
}

export interface AuthorResult {
  slides: DeckSlide[];
  sections: string[];
  /** Passages that fell back to the mechanical chunker. Empty on a clean run. */
  notes: string[];
  fellBackBatches: number;
  totalBatches: number;
}

/**
 * Script -> numbered slides.
 *
 * ALL-CAPS header lines are treated as idea boundaries and never reach a slide: they are how a
 * webinar script is organized on the page, not words anyone says. Each one becomes the
 * `section` label carried in the speaker notes and the slide plan.
 */
export async function authorDeck(
  script: string,
  onProgress?: (msg: string) => void
): Promise<AuthorResult> {
  const { sections } = splitSections(script);
  const notes: string[] = [];
  const note = (m: string) => {
    notes.push(m);
    onProgress?.(m);
  };

  const jobs: Array<{ section: string | null; text: string }> = [];
  for (const section of sections) {
    // Delivery notes come off before chunking so a [bracket] cannot end up on a slide, and the
    // model never sees a cue it might try to render.
    const { text } = stripDelivery(section.text);
    for (const batch of batchesOf(text)) jobs.push({ section: section.header, text: batch });
  }

  // Batches run in waves, not end to end. Each one is chunked and parity-checked entirely
  // against its own passage, so nothing about batch 4 depends on batch 3 having finished, and
  // a 5,000-word webinar run sequentially would not fit the route's 300s budget. Results are
  // written back BY INDEX so the deck stays in script order whatever order they land in.
  const done: Array<{ slides: AuthoredBatch["slides"]; fellBack: boolean }> = new Array(jobs.length);
  let finished = 0;
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = cursor++;
      if (i >= jobs.length) return;
      done[i] = await authorBatch(jobs[i].text, jobs[i].section, note);
      finished++;
      onProgress?.(`chunked ${finished} of ${jobs.length} passages...`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));

  const slides: DeckSlide[] = [];
  let fellBackBatches = 0;
  jobs.forEach((job, i) => {
    const result = done[i];
    if (result.fellBack) fellBackBatches++;
    for (const s of result.slides) {
      // Numbering is assigned here rather than asked for: continuity across batches is
      // arithmetic, and a model that has to count is a model that can produce a gap.
      slides.push({
        n: slides.length + 1,
        section: job.section,
        runs: s.runs,
        bullets: s.bullets ?? null,
        visual: s.visual ?? null,
        notes: s.notes ?? [],
      });
    }
  });

  return {
    slides,
    sections: sections.map((s) => s.header).filter((h): h is string => Boolean(h)),
    notes,
    fellBackBatches,
    totalBatches: jobs.length,
  };
}

/** Trim a script down to something usable as a filename / deck title. */
export function deckTitle(script: string): string {
  const { sections } = splitSections(script);
  const first = collapse(sections[0]?.text ?? script).slice(0, 60);
  return first || "Webinar deck";
}
