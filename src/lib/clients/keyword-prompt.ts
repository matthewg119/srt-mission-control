// The keyword research prompt: one thing to paste into claude.com, already knowing the offer.
//
// ‼️ WHY THIS EXISTS. Step 12 auto-expands 200+ phrases with a model and then asks somebody to
// approve them. The expansion rows are labelled `expansion` and deliberately rank below anything
// the market or the owner actually said, but on a fresh client they are most of what there is, so
// "approve" ends up meaning "accept what a model guessed". This prompt is the door for real
// research to arrive BEFORE that decision, and its answers come back as `manual` rows, which
// PRECEDENCE puts above every expansion row.
//
// ‼️ IT NEVER ASKS FOR WHAT IS ON FILE. Every block below is pre-filled from context-blocks.ts,
// the same eight builders final-prompt.ts renders, so the two prompts cannot describe one business
// differently. What is left blank is only what nothing has answered.
//
// ‼️ ONE NUMBERED LIST COMES BACK, AND NOTHING ELSE IS NUMBERED. This is the load-bearing detail.
// The answer is pasted back with `keywords add:`, and addList() (keyword-expansion.ts) takes the
// NUMBERED lines and only those, treating each whole line as one phrase. So a second numbered list
// anywhere in the reply, or a judgement appended to a phrase's own line, is stored as a keyword.
// "1. more google reviews, post, articles rank" becomes a phrase nobody searches. The prompt
// therefore asks for the reasoning as prose under its own heading and says, in words, not to paste
// that half back.
//
// ‼️ THE TRIAGE RULE IS REPRODUCED VERBATIM. It is Matthew's wording and it is what decides
// whether a phrase becomes a post, gets merged under a bigger one, or becomes a service page. It
// is stated here so the research arrives already sorted, and checked again later against real
// SERPs in the step's own thread, because a model's guess about what Google shows is not evidence.
//
// PURE. No database, no model, no Slack. Same enforcement final-prompt.ts is held to.

import type { LeadContext } from "./lead-context";
import type { DocText } from "./doc-text";
import type { ResearchContext } from "./artifacts/deep-research-run";
import type { FieldSpec } from "./dataset-spec";
// ‼️ THE TRIAGE RULE IS IMPORTED, NEVER RETYPED. keyword-expansion.ts owns the one copy; the SERP
// reader and the strategy card quote the same constant, and a probe greps it out of all three.
import { SERP_TRIAGE_RULE } from "./keyword-expansion";
// ‼️ THE "WHAT WE HOLD" BLOCKS ARE IMPORTED, NEVER COPIED. final-prompt.ts renders the same eight,
// from the same module, so the two prompts cannot describe one business differently.
import {
  value,
  identityBlock,
  audienceBlock,
  offerBlock,
  documentBlock,
  beliefsAndLadderBlock,
  measuredBlock,
  ownerWordsBlock,
  uploadedBlock,
} from "./context-blocks";

/**
 * The only part of a gap this file reads.
 *
 * ‼️ NOT `FieldGap`, AND NOT `Gap`. dataset-spec.ts's FieldGap carries `reason`, step-gaps.ts's Gap
 * carries `ref`, `blocks`, `because` and `fill`, and neither is assignable to the other. Both carry
 * `field`, which is all a prompt needs, so asking for the intersection lets either be passed in
 * without a cast and without this file caring which lane assembled it.
 */
export interface GapLike {
  field: FieldSpec;
}

/** How many phrases already on file are listed back, so the reply does not repeat them. */
const EXISTING_SAMPLE = 150;

/** One phrase already on file. */
export interface ExistingPhrase {
  phrase: string;
  origin: string;
  category: string;
  approved: boolean;
}

export interface KeywordPromptInput {
  ctx: LeadContext;
  /** Identity, offer and the owner's own intake words. Null when no avatar is confirmed. */
  research: ResearchContext | null;
  /** The text of every readable document filed against this client. */
  docs: readonly DocText[];
  /** What is already in client_keywords, so the reply adds rather than repeats. */
  existing: readonly ExistingPhrase[];
  /** The gaps this step declares it needs or wants, already filtered by the caller. */
  stepGaps: readonly GapLike[];
  /** How many phrases one paste may carry, from ADD_MAX, so the prompt cannot ask for more. */
  addMax: number;
}

export interface KeywordPrompt {
  /** The whole thing, ready to paste into a chat. */
  body: string;
  /** Declared fields on file, and declared fields in total, across every audience. */
  held: number;
  total: number;
  /** How many phrases are already on file, so the summary can say what it is building on. */
  existing: number;
  /** Fields this prompt asks another person for. */
  asks: string[];
  /** Missing fields no researcher can answer: they are Matthew's, on the board. */
  mine: string[];
  /** What was shortened, named. Empty when nothing was. */
  clipped: string[];
}

export type KeywordPromptResult = { ok: true; prompt: KeywordPrompt } | { ok: false; error: string };

/** Fields a researcher could answer, as one line each. */
function askable(gaps: readonly GapLike[]): string[] {
  const out: string[] = [];
  for (const gap of gaps) {
    const f = gap.field.filledBy;
    if (f.kind === "step") continue;
    out.push(`${gap.field.label}: ${gap.field.usedFor}`);
  }
  return out;
}

/** Fields nobody outside this business can answer: they are written by a command on the board. */
function minesOwn(gaps: readonly GapLike[]): string[] {
  const out: string[] = [];
  for (const gap of gaps) {
    const f = gap.field.filledBy;
    if (f.kind !== "step") continue;
    out.push(`${gap.field.label}: ${f.how}${f.built ? "" : " (not built yet)"}`);
  }
  return out;
}

/**
 * What is already on file, grouped by where it came from.
 *
 * ‼️ THE ORIGIN TRAVELS WITH THE PHRASE. A model handed a flat list treats every row as equally
 * settled and writes variations of whatever is most numerous, which on a fresh client is the
 * expansion rows it is being asked to improve on. Saying which rows are evidence and which are a
 * previous guess is what makes "do not just rephrase these" a followable instruction.
 */
function existingBlock(existing: readonly ExistingPhrase[]): string[] {
  if (!existing.length) {
    return ["", "## What is already on file", "", "Nothing yet. This is the first pass."];
  }

  const out: string[] = ["", "## What is already on file", ""];
  const evidenced = existing.filter((e) => e.origin !== "expansion");
  const guessed = existing.filter((e) => e.origin === "expansion");

  out.push(
    `${existing.length} phrase${existing.length === 1 ? "" : "s"} are stored: ${evidenced.length} came from the market or the owner, ${guessed.length} were proposed by a model and are not evidence of anything.`,
    "",
    "Do not repeat these and do not hand back reworded versions of them. Everything you propose should be something this list does not already cover.",
    ""
  );

  const show = (label: string, rows: ExistingPhrase[]) => {
    if (!rows.length) return;
    const shown = rows.slice(0, EXISTING_SAMPLE);
    out.push(`### ${label}`, "");
    for (const r of shown) out.push(`- ${r.phrase} (${r.category})`);
    if (rows.length > shown.length) out.push(`- and ${rows.length - shown.length} more of the same kind`);
    out.push("");
  };

  show("From the market or the owner", evidenced);
  show("Proposed by a model, unverified", guessed);
  return out;
}

export function buildKeywordPrompt(input: KeywordPromptInput): KeywordPromptResult {
  const { ctx, research, docs, existing, stepGaps, addMax } = input;

  // ‼️ UNREADABLE IS NOT EMPTY, and the same refusal final-prompt.ts makes. If the datasets could
  // not be evaluated then what is missing is UNKNOWN, and a prompt built on a failed select asks
  // for things that are already answered and quietly omits things that are not.
  const gapsHeld = ctx.gaps;
  if (!gapsHeld || gapsHeld.state === "missing") {
    return {
      ok: false,
      error: "the datasets could not be read, so what is missing is unknown rather than empty.",
    };
  }

  const offer = ctx.primaryOffer;
  const treatment = offer ? value(offer.treatment) : null;
  if (!treatment) {
    // The whole prompt is "keywords FOR THIS OFFER". Without one there is no question to ask, and
    // asking anyway would return keywords for a category rather than for this business.
    return {
      ok: false,
      error: "no offer is locked yet, so there is nothing to find keywords for. Lock it on the prep call step first.",
    };
  }

  const reports = gapsHeld.value;
  const total = reports.reduce((n, r) => n + r.total, 0);
  const held = reports.reduce((n, r) => n + r.present, 0);

  const clipped: string[] = [];
  const lines: string[] = [];
  const name = ctx.identity.name || research?.clinicName || "this business";

  lines.push(`# Keywords for ${name}: ${treatment}`);
  lines.push("");
  lines.push(`What are the best keywords for SEO for this offer: ${treatment}.`);
  lines.push("");
  lines.push(
    `Everything this business has told us is below, so nothing here needs asking about again. ${held} of ${total} things we track about this avatar and this offer are answered and reproduced in full.`
  );
  lines.push("");
  lines.push(
    "I want real searches, in the words a buyer would actually type, not a category list and not marketing language. If you are not confident a human types a phrase, leave it out: a short honest list is worth more than a long one padded with variations of itself."
  );

  // ── The rule that decides what each phrase becomes ─────────────────────────
  lines.push("", "---", "");
  lines.push("# HOW TO CHECK EACH ONE");
  lines.push("");
  lines.push(SERP_TRIAGE_RULE);
  lines.push("");
  lines.push(
    "So for every phrase you propose, look at what Google actually returns for it, and tell me which of the three it is: its own post, something to merge under a bigger post, or a service page. I will be checking the real results myself afterwards, so say what you saw rather than what you expect."
  );

  // ── Everything we hold ────────────────────────────────────────────────────
  lines.push("", "---", "");
  lines.push("# WHAT WE ALREADY KNOW");
  lines.push(...identityBlock(ctx, research));
  lines.push(...audienceBlock(ctx, research));
  lines.push(...offerBlock(ctx));
  lines.push(...ownerWordsBlock(research));
  lines.push(...beliefsAndLadderBlock(ctx));
  lines.push(...measuredBlock(ctx, research));
  lines.push(...existingBlock(existing));
  lines.push(...documentBlock(ctx, clipped));
  lines.push(...uploadedBlock(docs, clipped));

  // ── What is still missing, and who can answer it ──────────────────────────
  const asks = askable(stepGaps);
  const mine = minesOwn(stepGaps);

  if (asks.length) {
    lines.push("", "---", "");
    lines.push("# WHAT NOTHING HAS ANSWERED YET");
    lines.push("");
    lines.push(
      "These change which keywords are right, and nothing on file answers them. Answer what you can from your research, under its own heading at the end, and say plainly where you could not.",
      ""
    );
    for (const a of asks) lines.push(`- ${a}`);
  }

  // ── The output contract ───────────────────────────────────────────────────
  lines.push("", "---", "");
  lines.push("# WHAT TO SEND BACK");
  lines.push("");
  lines.push("Two parts, and they are separate on purpose.");
  lines.push("");
  lines.push("## Part 1. The phrases");
  lines.push("");
  lines.push(
    `A numbered list, one phrase per line, at most ${addMax}. Nothing else on the line: no rating, no note, no reasoning, no bold. The line is stored exactly as you write it, so anything appended to it becomes part of the keyword.`
  );
  lines.push("");
  lines.push("```");
  lines.push("1. <phrase>");
  lines.push("2. <phrase>");
  lines.push("3. <phrase>");
  lines.push("```");
  lines.push("");
  lines.push("## Part 2. What you found, as prose");
  lines.push("");
  lines.push(
    "Underneath, and NOT numbered, tell me for each phrase what Google returned and which of the three it is. Use a dash list or headings, never numbers: I paste part 1 into a parser that reads numbered lines, and a second numbered list would be stored as more keywords."
  );
  lines.push("");
  lines.push("Also say which phrases you considered and rejected, and why. A rejection I can see is worth as much as a suggestion.");

  return {
    ok: true,
    prompt: { body: lines.join("\n"), held, total, existing: existing.length, asks, mine, clipped },
  };
}

/** The one-line summary posted beside the uploaded prompt. */
export function keywordPromptSummary(p: KeywordPrompt): string {
  const out: string[] = [];
  out.push(
    `:mag: *The keyword research prompt is above.* It carries ${p.held} of ${p.total} things we hold about this avatar and this offer, and the ${p.existing} phrase${p.existing === 1 ? "" : "s"} already on file.`
  );
  if (p.asks.length) {
    out.push(`It asks for ${p.asks.length} thing${p.asks.length === 1 ? "" : "s"} nothing has answered yet.`);
  }
  out.push("");
  out.push("Run it in claude.com, then bring the numbered list back with `keywords add:` on the line above it. The prose half is for you, not for the parser.");
  if (p.mine.length) {
    out.push("", "*Nobody outside this business can answer these. They are yours, on the board:*");
    for (const m of p.mine.slice(0, 5)) out.push(`• ${m}`);
  }
  if (p.clipped.length) {
    out.push("", `_Shortened to fit: ${p.clipped.join("; ")}._`);
  }
  return out.join("\n");
}
