// Makes a draft look like a person typed it in Outlook.
//
// The tell that gives these emails away is not word choice, it is shape: one sentence per
// paragraph with a blank line between each. The prompt asks for 2 to 4 sentence paragraphs and
// PARAGRAPH_RULES states it plainly, but a model under a word limit reliably drifts back to
// one-line stanzas. So the mechanical rules are enforced here in code, and the semantic one
// (which sentences belong together) gets a reflow pass that is verified word-for-word.
//
// Nothing in this file may change wording. Capitalization and emphasis markers are formatting;
// everything else either regroups existing text or is rejected.

import { callClaudeText } from "@/lib/claude-calls";

/** Capitalize a paragraph's first letter and any letter starting a new sentence. */
export function capitalizeSentenceStarts(body: string): string {
  return body
    .split("\n")
    .map((line) =>
      line
        // Start of a line.
        .replace(/^(\s*)([a-z])/, (_m, ws: string, ch: string) => ws + ch.toUpperCase())
        // After a sentence terminator. Requires the space, so "e.g. x" and "cellunetics.com"
        // are untouched (no terminator+space+letter pattern inside a domain).
        .replace(/([.!?])(\s+)([a-z])/g, (_m, p: string, ws: string, ch: string) => p + ws + ch.toUpperCase())
    )
    .join("\n");
}

/**
 * Remove markdown/Slack emphasis. Bold is a reveal-stage device for the price line only, and
 * an asterisk that survives into Outlook renders as a literal asterisk.
 */
export function stripEmphasis(body: string): string {
  return body
    .replace(/\*\*\*(\S(?:[\s\S]*?\S)?)\*\*\*/g, "$1")
    .replace(/\*\*(\S(?:[\s\S]*?\S)?)\*\*/g, "$1")
    .replace(/(^|[\s(])\*(\S(?:[\s\S]*?\S)?)\*(?=[\s.,;:!?)]|$)/g, "$1$2")
    .replace(/(^|[\s(])_(\S(?:[\s\S]*?\S)?)_(?=[\s.,;:!?)]|$)/g, "$1$2");
}

const BULLET_RE = /^\s*(?:[-*•‣▪]|\d+[.)])\s+/;

/** A line that is only a URL is a deliberate visual break, not a one-sentence paragraph. */
function isBareUrlLine(p: string): boolean {
  return /^\s*(?:https?:\/\/|www\.)\S+\s*$/i.test(p);
}

function sentenceCount(paragraph: string): number {
  const matches = paragraph.match(/[.!?]+(?=\s|$)/g);
  return matches ? matches.length : paragraph.trim() ? 1 : 0;
}

/**
 * Whether a paragraph ends a sentence at all. Distinct from sentenceCount, which counts
 * terminator-less prose as one sentence — correct for density, wrong for spotting the greeting
 * and the sign-off, which are single lines by convention and must not be judged as paragraphs.
 */
function hasTerminator(paragraph: string): boolean {
  return /[.!?]/.test(paragraph);
}

export interface ParagraphSmell {
  /** Paragraphs of exactly one sentence. More than one of these is the bot tell. */
  singleSentenceParas: number;
  totalParas: number;
  hasBullets: boolean;
}

/**
 * The greeting and the sign-off are single lines by convention, so they are excluded before
 * counting — otherwise every well-formed email would look like it failed.
 */
export function paragraphSmell(body: string): ParagraphSmell {
  const paras = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const hasBullets = body.split("\n").some((l) => BULLET_RE.test(l));

  // Drop the greeting (first paragraph, no sentence terminator) and the sign-off block (last
  // paragraph, short and terminator-free) from the density judgement.
  const body_ = [...paras];
  if (body_.length > 0 && !hasTerminator(body_[0]) && body_[0].length < 60) body_.shift();
  if (body_.length > 0) {
    const last = body_[body_.length - 1];
    if (!hasTerminator(last) && last.length < 60) body_.pop();
  }

  const counted = body_.filter((p) => !isBareUrlLine(p));
  return {
    singleSentenceParas: counted.filter((p) => sentenceCount(p) === 1).length,
    totalParas: counted.length,
    hasBullets,
  };
}

/** More than one single-sentence paragraph, or any bullet, means it reads like a bot. */
export function needsReflow(smell: ParagraphSmell): boolean {
  return smell.singleSentenceParas > 1 || smell.hasBullets;
}

/** Comparable word bag, so "did the model rewrite anything" is a real check and not a vibe. */
function wordBag(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9']+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

export interface ReflowResult {
  body: string;
  /** True when the reflow was accepted. False means the original survived unchanged. */
  reflowed: boolean;
  /** Set when a reflow was attempted and rejected, for the Slack footer. */
  note: string | null;
}

/**
 * Regroup sentences into paragraphs without changing a single word.
 *
 * The instruction alone is not trustworthy — a model asked to reformat will happily "improve" a
 * sentence on the way through. So the result is accepted only if its word multiset is identical
 * to the input's. If the model edited anything, the original is kept and the caller is told.
 * That check is what makes "change not a word" structural rather than hopeful.
 */
export async function reflowParagraphs(body: string): Promise<ReflowResult> {
  let candidate: string;
  try {
    const { text } = await callClaudeText({
      model: "claude-sonnet-4-6",
      system: [
        "You regroup the paragraphs of an email. You are a formatter, not an editor.",
        "Group related sentences into paragraphs of 2 to 4 sentences. A paragraph is a unit of thought, not a line of text.",
        "At most ONE single-sentence paragraph, and only where that sentence earns the emphasis.",
        "Keep the greeting on its own line and the sign-off on its own lines. A line that is only a URL stays on its own line.",
        "ABSOLUTE RULE: do not change a single word. Add nothing, delete nothing, reorder no sentences, fix no spelling, change no punctuation. You may only add and remove line breaks.",
        "Return only the reformatted email body. No preamble, no code fences, no commentary.",
      ].join("\n"),
      user: body,
      maxTokens: 1200,
      temperature: 0,
    });
    candidate = text.trim();
  } catch (e) {
    return { body, reflowed: false, note: `paragraph reflow failed (${(e as Error).message}), posting as written` };
  }

  if (!candidate) return { body, reflowed: false, note: "paragraph reflow came back empty, posting as written" };
  if (wordBag(candidate) !== wordBag(body)) {
    return { body, reflowed: false, note: "paragraph reflow altered the wording, so it was discarded. The paragraphs below are still one sentence each" };
  }
  return { body: candidate, reflowed: true, note: null };
}

export interface PolishOptions {
  /** Permission stage strips emphasis outright. The reveal may bold its price line. */
  allowEmphasis: boolean;
}

export interface PolishResult {
  body: string;
  note: string | null;
}

/**
 * The full pass: mechanical fixes always, then a reflow only when the shape is actually wrong.
 * Returns a note for the Slack footer when something needed saying.
 */
export async function polishBody(body: string, opts: PolishOptions): Promise<PolishResult> {
  let out = capitalizeSentenceStarts(body);
  if (!opts.allowEmphasis) out = stripEmphasis(out);

  if (!needsReflow(paragraphSmell(out))) return { body: out, note: null };

  const reflow = await reflowParagraphs(out);
  // Capitalization can shift when sentences merge into a paragraph, so run it once more.
  return { body: capitalizeSentenceStarts(reflow.body), note: reflow.note };
}
