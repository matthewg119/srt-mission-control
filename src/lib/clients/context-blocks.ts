// Everything we already hold about a client, rendered as prompt blocks.
//
// ‼️ THIS FILE EXISTS SO TWO PROMPTS CANNOT DESCRIBE THE SAME CLIENT DIFFERENTLY.
// These eight builders were private to final-prompt.ts until 2026-09-25, when the keyword step
// needed the same context for its own research prompt. Copying them would have produced two
// descriptions of one business that drift apart on the first edit, and the failure mode is silent:
// both prompts keep working, they just stop agreeing about what the offer is.
//
// ‼️ PURE. No database, no model, no Slack, no network. Everything comes in as a LeadContext and
// goes out as lines. That is what lets a probe assert the whole of it without a client, and it is
// the same enforcement final-prompt.ts was already held to.
//
// ‼️ EVERY CLIP IS DECLARED. A reader who cannot tell a whole document from most of one assumes the
// missing part was never there, which is worse than being told it was shortened. The `clipped`
// array is threaded through rather than returned, because a block returns lines and a caller has
// to be able to report the clipping beside them.
//
// ‼️ NOTHING HERE ASKS FOR ANYTHING. These blocks are the "what we hold" half only. The "what we
// still need" half is derived from gaps and lives with whichever prompt is doing the asking,
// because what is worth asking for depends on what the prompt is for.

import type { LeadContext, Held } from "./lead-context";
import { isHeld } from "./lead-context";
import type { DocText } from "./doc-text";
import type { ResearchContext } from "./artifacts/deep-research-run";

// ─────────────────────────────────────────────────────────────────────────────
// Budgets. Generous, because these are uploaded as a file rather than posted as
// a message, and every one of them is reported when it bites.
// ─────────────────────────────────────────────────────────────────────────────

export const RESEARCH_BUDGET = 60_000;
export const DOCUMENT_BUDGET = 20_000;
export const DOC_TEXT_BUDGET = 12_000;
export const LETTER_BUDGET = 12_000;
export const QUOTE_SAMPLE = 25;

export function clip(text: string, budget: number, label: string, clipped: string[]): string {
  const t = text.trim();
  if (t.length <= budget) return t;
  clipped.push(`${label} (${t.length.toLocaleString()} characters, first ${budget.toLocaleString()} shown)`);
  return t.slice(0, budget);
}

/**
 * The value, or null.
 *
 * ‼️ IT TOLERATES A KEY THAT IS NOT THERE AT ALL, not just a Held that is missing. ctx.documents is
 * typed as a full Record<DocumentKind, Held<...>> and lead-context does populate every kind, but a
 * context assembled anywhere else (a probe, a future caller, a client with no audience) can hand
 * over a partial map, and reading .state off undefined throws in the middle of building a prompt
 * that had already succeeded. An absent key means the same thing a missing Held means.
 */
export function value<T>(h: Held<T> | undefined | null): T | null {
  return h && isHeld(h) ? h.value : null;
}

export function identityBlock(ctx: LeadContext, research: ResearchContext | null): string[] {
  const out: string[] = ["## The business", ""];
  // identity.name is a plain string on ClientRef, not a Held: a client row with no name cannot
  // exist, so there is no "missing" state to represent.
  const name = ctx.identity.name || research?.clinicName || "(not on file)";
  out.push(`Name: ${name}`);

  const pairs: Array<[string, string | null]> = [
    ["Website", value(ctx.identity.website) ?? value(ctx.identity.domain)],
    ["City", value(ctx.identity.city) ?? research?.city ?? null],
    ["Trade", research?.trade ?? value(ctx.identity.businessType)],
    ["Vertical", value(ctx.identity.vertical)],
  ];
  for (const [label, v] of pairs) if (v) out.push(`${label}: ${v}`);

  if (research?.services?.length) out.push(`Services: ${research.services.join(", ")}`);
  return out;
}

export function audienceBlock(ctx: LeadContext, research: ResearchContext | null): string[] {
  const out: string[] = ["", "## The avatar this research is about", ""];
  const label = research?.avatarLabel ?? value(ctx.avatar.slug) ?? "(not confirmed)";
  out.push(`Avatar: ${label}`);
  if (ctx.audiences.length > 1) {
    out.push(
      `This client has ${ctx.audiences.length} audiences on file. Everything below, and everything asked for, is about the one named above.`
    );
  }
  const brief = value(ctx.avatar.timesReused);
  if (typeof brief === "number" && brief > 0) {
    out.push(`This avatar's research is shared with ${brief} other client${brief === 1 ? "" : "s"} in the vertical.`);
  }
  return out;
}

export function offerBlock(ctx: LeadContext): string[] {
  const offer = ctx.primaryOffer;
  if (!offer) return ["", "## The offer", "", "Nothing is locked yet."];

  const out: string[] = ["", "## The offer", ""];
  const rows: Array<[string, string | null]> = [
    ["Offer", value(offer.treatment)],
    ["What the customer calls it", (value(offer.terms) ?? []).join(", ") || null],
    ["Outcome promised", value(offer.outcomePromise)],
    ["Price", value(offer.price)],
    ["Guarantee", value(offer.guarantee)],
    ["Positioning", value(offer.positioning)],
  ];
  for (const [label, v] of rows) if (v) out.push(`${label}: ${v}`);
  if (!out.slice(3).length) out.push("Nothing is locked yet.");
  return out;
}

export function documentBlock(ctx: LeadContext, clipped: string[]): string[] {
  const out: string[] = [];
  const docs = ctx.documents;

  const research = value(docs.deep_research);
  if (research?.content?.trim()) {
    out.push("", "## The research already on file", "");
    out.push("Do not repeat what this already answers. It is here so you can build on it.", "");
    out.push(clip(research.content, RESEARCH_BUDGET, "the research already on file", clipped));
  } else {
    const shared = value(ctx.avatar.research);
    if (typeof shared === "string" && shared.trim()) {
      out.push("", "## The research already on file (shared across this avatar)", "");
      out.push(clip(shared, RESEARCH_BUDGET, "the shared avatar research", clipped));
    }
  }

  const sheet = value(docs.avatar_sheet);
  if (sheet?.content?.trim()) {
    out.push("", "## The avatar sheet already on file", "");
    out.push(clip(sheet.content, DOCUMENT_BUDGET, "the avatar sheet on file", clipped));
  }

  const short = value(docs.short_offer);
  if (short?.content?.trim()) {
    out.push("", "## The short offer already on file", "");
    out.push(clip(short.content, DOCUMENT_BUDGET, "the short offer on file", clipped));
  }

  const letter = value(docs.sales_letter);
  if (letter?.content?.trim()) {
    out.push("", "## The sales letter", "");
    out.push(clip(letter.content, LETTER_BUDGET, "the sales letter", clipped));
  }

  return out;
}

export function beliefsAndLadderBlock(ctx: LeadContext): string[] {
  const out: string[] = [];

  const beliefs = value(ctx.beliefs);
  if (beliefs?.length) {
    out.push("", "## The beliefs already written", "");
    // `${id}: ${text}`, the way every other reader of these renders them. draft-page.ts cites
    // them by id, so the id travels or a later citation points at nothing.
    for (const b of beliefs) out.push(`${b.id}: ${b.text}`);
  }

  const ladder = value(ctx.ladder);
  if (ladder?.rungs?.length) {
    out.push("", "## The awareness ladder", "");
    out.push(
      `${ladder.rungs.length} rungs are written and ${
        ladder.anchoredAt ? `rung ${ladder.anchoredAt} is anchored` : "none is anchored yet"
      }.`
    );
  }

  return out;
}

export function measuredBlock(ctx: LeadContext, research: ResearchContext | null): string[] {
  const out: string[] = [];

  const kw = value(ctx.keywords);
  if (kw && kw.total > 0) {
    out.push("", "## What the market already searches for", "");
    out.push(`${kw.approved} approved of ${kw.total} collected.`);
    const stages = Object.entries(kw.byStage).filter(([, n]) => n > 0);
    if (stages.length) {
      out.push(`By awareness stage: ${stages.map(([s, n]) => `${s} ${n}`).join(", ")}.`);
    }
  }

  if (research?.citedDomains?.length) {
    out.push("", "## What the engines actually cited for this market", "");
    out.push(research.citedDomains.slice(0, QUOTE_SAMPLE).join("\n"));
  }
  if (research?.namedInstead?.length) {
    out.push("", "## Who the engines named instead of this business", "");
    out.push(research.namedInstead.slice(0, QUOTE_SAMPLE).join(", "));
  }

  return out;
}

export function ownerWordsBlock(research: ResearchContext | null): string[] {
  if (!research) return [];
  const out: string[] = [];
  const rows: Array<[string, string | null]> = [
    ["What the owner says customers object to", research.objections],
    ["Who the owner says the customer is", research.targetPatient],
    ["Who the owner does NOT want", research.notWanted],
    ["What they have tried before", research.triedBefore],
  ];
  const said = rows.filter(([, v]) => v && v.trim());
  if (!said.length) return out;

  out.push("", "## The owner's own words, from the prep call", "");
  out.push("Never corrected, never summarised. These are the words to write back to them in.", "");
  for (const [label, v] of said) out.push(`${label}: ${v!.trim()}`);
  return out;
}

export function uploadedBlock(docs: readonly DocText[], clipped: string[]): string[] {
  if (!docs.length) return [];
  const out: string[] = ["", "## What was already sent in, in full", ""];
  out.push(
    `${docs.length} document${docs.length === 1 ? "" : "s"} were filed against this client. Their text is below. ` +
      "Anything answered in here has already been answered: do not ask for it again.",
    ""
  );
  for (const doc of docs) {
    out.push(`### ${doc.filename}${doc.stepKey ? ` (dropped on step ${doc.stepKey})` : ""}`);
    out.push("");
    out.push(clip(doc.text, DOC_TEXT_BUDGET, `the document ${doc.filename}`, clipped));
    if (doc.clipped) clipped.push(`${doc.filename} was already shortened when it was read`);
    out.push("");
  }
  return out;
}
