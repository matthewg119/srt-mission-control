// What is worth doing next for this lead, argued only from rows somebody wrote.
//
// Matthew, 2026-09-18: "have it make suggestable to rerun a specific step, for example after we
// start running 200 pages for X keyword and we want to focus on more pillars/keywords/narratives it
// suggests to buil new pages from new avatar or suggests diferent angles to focus on top of funnnel
// vs bottom of funnel based on the map and the performance of the actual pages that are live."
//
// This is NOT gapsFor. That answers "what does step N still need", which is a question about one
// step's inputs. This answers "what is worth doing next", which is a question about the whole lead,
// and its answers can be things no step asks for: a different rung, a second audience, more
// keywords where the build is actually pointed.
//
// ‼️ PURE, AND IT TAKES A LeadContext RATHER THAN A clientId. Same enforcement northStar gets: a
// function with no client id and no database import cannot quietly become a second read model.
//
// ‼️ EVERY SUGGESTION CARRIES ITS BASIS, AND THE BASIS IS A COUNT OF ROWS. D9 is the rule that
// binds hardest here, because a suggestion is the most actionable thing this system emits. "Top of
// funnel is underperforming" is a sentence this repo cannot currently justify: weekly-report.ts
// tells the client IN WRITING that nothing counts leads, and page-dataset.ts refuses ranking
// columns in its own words. So a suggestion either names the rows it counted or it says the thing
// is not measured. It never splits the difference.
//
// ‼️ IT PROPOSES (D7). Nothing here runs a step, and every suggestion that has a command names a
// command that already exists.

import type { StepKey } from "@/config/delivery-steps";
import { stepNumber } from "@/config/delivery-steps";
import { isHeld, type LeadContext } from "./lead-context";
import { gapsFrom } from "./step-gaps";

export interface Suggestion {
  /** What to do, in a few words. */
  title: string;
  /** Why it is worth doing, argued only from rows in the context. */
  why: string;
  /** Exactly what to type, and where. Null when the next move is a decision rather than a command. */
  command: string | null;
  /** What was counted to justify it. A suggestion with no basis is an opinion. */
  basis: string;
}

/**
 * The awareness ladder runs 5 (furthest from buying) to 1 (closest), per anchor-ladder.ts.
 *
 * ‼️ NOT RENAMED TO "top" AND "bottom" HERE. Matthew says top and bottom of funnel; the tables say
 * 5 to 1. Translating in this file would put a second vocabulary in front of the one the ladder
 * document, client_keywords.awareness_stage and page_angles all already use, and the card would
 * then disagree with every other card. The rung number is said, and what it means is said beside it.
 */
function rungWords(stage: number): string {
  return stage >= 4 ? "furthest from buying" : stage <= 2 ? "closest to buying" : "in the middle";
}

/** "11 and 21", not "11, 21". A card is read by a person, not parsed. */
function andList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function suggestionsFor(ctx: LeadContext, stepKey: StepKey | null): Suggestion[] {
  const out: Suggestion[] = [];

  // ── 1. The build has never been pointed at anything ──
  if (isHeld(ctx.keywords)) {
    const k = ctx.keywords.value;
    const picked = (k.byRole.pillar ?? 0) + (k.byRole.support ?? 0);
    if (k.approved > 0 && picked === 0) {
      out.push({
        title: "Pick the pillar. Nothing has been pointed at yet",
        why:
          `${k.approved} approved searches are on file and not one of them carries a role, so there is no plan ` +
          "for the seven pages to be built from. This is the single thing standing between this client and a drafted page.",
        command: "`pillar: auto` in step 21's thread, then `supports: auto`",
        basis: `client_keywords: ${k.total} rows, ${k.approved} approved, ${k.byRole.unpicked ?? 0} with no role`,
      });
    }
  }

  // ── 2. The anchor and the keywords disagree about where the buyer is ──
  //
  // ‼️ THE TOP OF FUNNEL VERSUS BOTTOM OF FUNNEL QUESTION, AND IT IS ANSWERABLE FROM TWO COLUMNS.
  // client_offers.anchor_stage says which rung every page is written to. client_keywords
  // .awareness_stage says which rung the approved searches actually sit at. When those disagree the
  // build is aimed somewhere the research did not go, and nothing else in the system says so.
  if (isHeld(ctx.ladder) && isHeld(ctx.keywords)) {
    const anchored = ctx.ladder.value.anchoredAt;
    const byStage = ctx.keywords.value.byStage;
    if (anchored !== null) {
      const atAnchor = byStage[String(anchored)] ?? 0;
      const ranked = Object.entries(byStage)
        .filter(([s]) => s !== "null" && s !== "none")
        .sort((a, b) => b[1] - a[1]);
      const biggest = ranked[0];
      if (biggest && Number(biggest[0]) !== anchored && biggest[1] > atAnchor * 2) {
        out.push({
          title: `The anchor is rung ${anchored}, but the searches are at rung ${biggest[0]}`,
          why:
            `Every page is written to rung ${anchored} (${rungWords(anchored)}), and ${atAnchor} approved search(es) ` +
            `sit there. ${biggest[1]} sit at rung ${biggest[0]} (${rungWords(Number(biggest[0]))}) with nothing pointed at them. ` +
            "Either the anchor moves to where the research went, or the keyword set grows at the rung the offer argues from. " +
            "Both are defensible; they are different bets and this is the moment to make one on purpose.",
          command: `\`anchor at ${biggest[0]}\` in step 21's thread, or \`keywords more\` at the keyword step`,
          basis: `client_offers.anchor_stage = ${anchored}; client_keywords.awareness_stage: ${ranked.map(([s, n]) => `${n} at ${s}`).join(", ")}`,
        });
      }
    }
  }

  // ── 3. The thread is ahead of the board ──
  if (stepKey && isHeld(ctx.board.cursor)) {
    const cursor = ctx.board.cursor.value;
    if (cursor !== stepKey && stepNumber(cursor) < stepNumber(stepKey)) {
      out.push({
        title: `Step ${stepNumber(cursor)} is the one the board is waiting on`,
        why:
          `This thread is step ${stepNumber(stepKey)}, but step ${stepNumber(cursor)} (\`${cursor}\`) is the next one ` +
          "that can actually be worked on. Work done here is not lost, it is just ahead of the board.",
        command: `\`rerun step ${stepNumber(cursor)}\` in this channel`,
        basis: "client_delivery_steps, walked in order with the blockedBy declarations",
      });
    }
  }

  // ── 4. The answer that unblocks the most other steps ──
  if (stepKey) {
    const g = gapsFrom(ctx, stepKey);
    const worst = [...g.gaps].filter((x) => x.blocking).sort((a, b) => b.blocks.length - a.blocks.length)[0];
    if (worst && worst.blocks.length > 1) {
      out.push({
        title: `Answer "${worst.field.label}" first. ${worst.blocks.length} steps wait on it`,
        why:
          `It is the gap with the longest tail: steps ${andList(worst.blocks.map((k) => String(stepNumber(k))))} all ` +
          "declare they need it. Every other missing field blocks fewer.",
        command: worst.fill.commands[0] ? `\`${worst.fill.commands[0]}\`` : null,
        basis: `STEP_NEEDS, inverted: ${worst.blocks.length} step(s) name ${worst.ref}`,
      });
    }
  }

  // ── 5. A second audience, without inventing one ──
  if (ctx.audiences.length === 1 && isHeld(ctx.pages) && ctx.pages.value.length > 0) {
    out.push({
      title: "One audience is on file, and the pages are all written to it",
      why:
        "A second audience is how the same offer reaches a different buyer, with its own vocabulary, its own " +
        "objections and its own pages. Nothing here knows who that buyer is: that is a decision, not a lookup.",
      command: null,
      basis: `client_audiences: ${ctx.audiences.length} row; client_pages: ${ctx.pages.value.length}`,
    });
  }

  // ── 6. Performance, and the honest answer about it ──
  //
  // ‼️ THIS IS THE D9 GUARD, AND IT IS A SUGGESTION IN ITS OWN RIGHT. Matthew asked for suggestions
  // based on "the performance of the actual pages that are live". Nothing in this repo measures
  // that: weekly-report.ts carries ATTRIBUTION_NOT_WIRED and says so to the client in writing. A
  // suggestion engine that quietly skipped the question would let the absence read as "no problem
  // found", so it says what is not measured and what would measure it.
  const livePages = isHeld(ctx.pages) ? ctx.pages.value.filter((p) => p.status === "published").length : 0;
  out.push(
    livePages > 0
      ? {
          title: "Page performance is NOT MEASURED, so none of the above argues from it",
          why:
            `${livePages} page(s) are published. Nothing in this system counts whether any of them was ever read, ` +
            "cited or turned into a booking: weekly-report.ts says exactly that to the client in writing. " +
            "The nearest measured thing is fanout_citations, which records when an engine cited a domain in an answer.",
          command: null,
          basis: `client_pages: ${livePages} published; no traffic, ranking or attribution source is wired`,
        }
      : {
          title: "No page is live yet, so there is no performance to argue from",
          why:
            "Every suggestion above is about what is on file, not about what is working. Nothing can be said about " +
            "what works until a page is published, and even then this system measures citations rather than traffic.",
          command: null,
          basis: "client_pages: 0 published",
        }
  );

  return out;
}

/** The card, in the board's voice. PURE, so the probe can assert the copy without a database. */
export function suggestionLines(list: readonly Suggestion[]): string[] {
  if (!list.length) return ["Nothing to suggest: everything this client needs next is already on the card."];
  const lines = [`*What is worth doing next.* ${list.length} suggestion(s), each with what it was read from.`, ""];
  list.forEach((s, i) => {
    lines.push(`*${i + 1}. ${s.title}*`);
    lines.push(s.why);
    if (s.command) lines.push(`    → ${s.command}`);
    lines.push(`    _read from: ${s.basis}_`);
    lines.push("");
  });
  lines.push("_Suggestions only. Nothing here has been run._");
  return lines;
}
