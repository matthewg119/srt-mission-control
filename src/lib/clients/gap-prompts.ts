// The prompts that fill the gaps, pre-loaded with what we already own.
//
// Matthew, 2026-09-17: "give me the prompts to do the deep research ourselves or complete the missing
// fields by giving data that we currently own for context."
//
// This is the other half of step-gaps.ts. That one says WHAT is missing and names the command that
// files the answer; this one hands over the thing you actually run or fill in to produce that answer.
//
// ‼️ ONLY WHAT IS MISSING. A deep research report already on file means the prompt asks for the
// sections that report did not answer, never for the report. The diff is not computed here: it is the
// gap list, which is computed once from one snapshot, so there is no second opinion about what is held.
//
// ‼️ D1 STILL STANDS. The two structured research passes stay a manual paste-back. This makes the paste
// easier by handing over a prompt carrying the lead's own facts; it does not run anything.
//
// ‼️ NOTHING HERE WRITES, AND NOTHING HERE CALLS A MODEL. Every prompt is assembled from rows already
// read. A card that spent money to tell somebody what was missing would be a card nobody dares open.

import type { StepKey } from "@/config/delivery-steps";
import { AVATAR_SHEET, BELIEF_OPENING, MAX_NECESSARY_BELIEFS, SHORT_OFFER, renderTemplate } from "@/config/avatar-framework";
import { buildContext, buildGapPrompt } from "./artifacts/deep-research-run";
import { gapsFrom, type StepGaps } from "./step-gaps";
import { leadContext, type LeadContext } from "./lead-context";

export type GapPromptKey = "research" | "avatar_sheet" | "short_offer" | "necessary_beliefs";

export interface GapPrompt {
  key: GapPromptKey;
  /** What this produces, in a few words. */
  title: string;
  /** Why it is worth running, taken from the gap it answers. */
  why: string;
  /** The thing to run in a deep-research agent, or the template to fill in. */
  body: string;
  /** How the answer comes back, verbatim, including the prefix. */
  pasteBack: string;
  /** How many declared fields this one answer would fill. */
  fills: number;
}

export type GapPromptResult = { ok: true; prompts: GapPrompt[] } | { ok: false; error: string };

/**
 * The prompts that would close this step's gaps.
 *
 * `ctx` is optional for the same reason gapsFor's is: a card that already loaded the lead reads
 * nothing more, and a probe can run the whole thing against a context it built by hand.
 */
export async function gapPromptsFor(clientId: string, stepKey: StepKey, ctx?: LeadContext): Promise<GapPromptResult> {
  const context = ctx ?? (await leadContext(clientId));
  return promptsFromGaps(clientId, gapsFrom(context, stepKey));
}

/** The same thing from a gap list already in hand. */
export async function promptsFromGaps(clientId: string, g: StepGaps): Promise<GapPromptResult> {
  // An unreadable dataset means we do not know what is missing. Handing over "research everything"
  // on the strength of a failed select is the same lie as asking for it.
  if (g.unreadable.length) {
    return { ok: false, error: "the datasets could not be read, so what is missing is unknown rather than empty." };
  }
  if (!g.gaps.length) return { ok: true, prompts: [] };

  const prompts: GapPrompt[] = [];

  // ── The research sections a report on file did not answer ──────────────────────────────────
  const sectionKeys: string[] = [];
  let researchFields = 0;
  for (const gap of g.gaps) {
    const f = gap.field.filledBy;
    if (f.kind !== "research" || !f.asked || !f.sectionKey) continue;
    researchFields++;
    if (!sectionKeys.includes(f.sectionKey)) sectionKeys.push(f.sectionKey);
  }

  if (sectionKeys.length) {
    const built = await buildContext(clientId);
    if (!built.ok) {
      // ‼️ REFUSED, NOT RENDERED GENERICALLY. buildContext refuses when no avatar is confirmed, and a
      // prompt written about "the business" would file its phrases under the wrong avatar in a corpus
      // every client in the vertical reads from. Say what is wrong instead.
      return { ok: false, error: built.error };
    }
    const body = buildGapPrompt(built.ctx, sectionKeys);
    if (body) {
      prompts.push({
        key: "research",
        // No comma in a title: gapPromptOfferLine joins them with commas.
        title: `Deep research (${sectionKeys.length} unanswered section${sectionKeys.length === 1 ? "" : "s"})`,
        why: "the research on file does not answer these, and everything downstream is written from it",
        body,
        pasteBack: "paste the answer back into this thread as `research:` followed by the text",
        fills: researchFields,
      });
    }
  }

  // ── The three framework documents ──────────────────────────────────────────────────────────
  const docCount = (doc: string) =>
    g.gaps.filter((x) => x.field.filledBy.kind === "document" && x.field.filledBy.doc === doc).length;

  const sheet = docCount("avatar_sheet");
  if (sheet) {
    prompts.push({
      key: "avatar_sheet",
      title: "The avatar sheet",
      why: "nothing has been pasted, so every headline is written without knowing who it is for",
      // The blank template, headings and all, because the parser pairs answers to THESE headings.
      body: renderTemplate(AVATAR_SHEET),
      pasteBack: "send it back in this thread as `avatar sheet:` followed by the filled template",
      fills: sheet,
    });
  }

  const short = docCount("short_offer");
  if (short) {
    prompts.push({
      key: "short_offer",
      title: "The short offer",
      why: "without it every rung of the ladder argues from the treatment rather than from the offer",
      body: renderTemplate(SHORT_OFFER),
      pasteBack: "send it back in this thread as `short offer:` followed by the filled template",
      fills: short,
    });
  }

  const beliefs = g.gaps.filter((x) => x.ref === "offer.necessary_beliefs").length;
  if (beliefs) {
    prompts.push({
      key: "necessary_beliefs",
      title: "The necessary beliefs",
      why: "this is what every page is supposed to install, and there is no belief on file to install",
      body: [
        `Write up to ${MAX_NECESSARY_BELIEFS} beliefs this buyer must hold before the offer is presented.`,
        `Each one starts with "${BELIEF_OPENING}" and is one sentence.`,
        "",
        "They are not features and not benefits. Each is a thing the reader has to believe is TRUE",
        "about the world before the offer can land, in the order they have to believe them.",
        "",
        `${BELIEF_OPENING} `,
      ].join("\n"),
      pasteBack: "send them back in this thread as `beliefs:` followed by one per line",
      fills: beliefs,
    });
  }

  return { ok: true, prompts };
}

// ─────────────────────────────────────────────────────────────────────────────
// The card
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One Slack message per prompt.
 *
 * ‼️ ONE PER MESSAGE, NEVER APPENDED TO A CARD. A prompt is thousands of characters and a card body
 * over 3,000 fails the WHOLE message, so a prompt folded into a step card would take the card down
 * with it. These are posted as replies in the step's thread, which is also where the answer goes back.
 *
 * ‼️ THE BODY IS FENCED SO IT CAN BE COPIED WHOLE. A prompt with Slack formatting applied to it is a
 * prompt that arrives at the model with asterisks in it.
 */
export function gapPromptMessage(p: GapPrompt): string {
  return [
    `*${p.title}*`,
    `_${p.why}._`,
    "",
    "```",
    p.body,
    "```",
    `:arrow_right: ${p.pasteBack}.`,
  ].join("\n");
}

/** The one line a card shows to say these exist, without carrying them. */
export function gapPromptOfferLine(prompts: readonly GapPrompt[]): string | null {
  if (!prompts.length) return null;
  const what = prompts.map((p) => p.title.toLowerCase()).join(", ");
  return `:page_facing_up: \`prompts\` in this thread hands you ${prompts.length} ready to run: ${what}.`;
}
