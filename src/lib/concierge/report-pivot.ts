// What the widget says when the report lands, and how it names what is weakest without inventing it.
//
// It used to say "Want me to walk you through what it found? Ask me anything below." That hands control
// back to somebody who has just spent three minutes and sells nothing. This is the pivot to the free AI
// Referral Engine instead: name what the report found, say why reviews are the lever, offer the tool,
// ask for the yes.
//
// ‼️ THE LINE IS BUILT HERE, IN THE EXECUTOR, AND THE MODEL NEVER SEES THE REPORT. That was the real
// decision. The alternative was feeding the report into the prompt, which would widen what the model may
// say about a real business and would need the header of tools.ts rewritten: "THE MODEL IS HANDED NO
// BUSINESS NAMES AND NO NUMBERS. Not in the prompt, not in the config, nowhere." This route keeps that
// rule exactly as it is, because afterAudit() is frame code and no model turn happens here at all.
// engine.ts set the precedent: openingFor() is deterministic for the same reason, because the first line
// has to name a real competitor and a real count and hoping is not a mechanism.
//
// ‼️ IT NAMES A BLOCK, NEVER A PILLAR, AND THAT IS NOT A STYLE CHOICE. Findable, Familiar and Fresh exist
// NOWHERE in the data: they are hand-written sales prose in audit-engine/loom-script.ts and
// config/pitch.ts. audit_reports carries ONE aggregate `score`. The only per-dimension breakdown that
// exists is the audit BLOCK (MARCA / SERVICIO / INFO / COMPARATIVO), computed in memory by
// report-view.ts and already reduced to a worst case by loom-beatsheet.ts. So "your weakest pillar is
// Familiar" is a sentence this codebase cannot honestly produce, and "you came up in 1 of 6 of the
// questions about your treatments" is one it can.
//
// ‼️ AND THE DENOMINATOR TRAVELS WITH THE NUMBER. Doctrine rule 5: not "you scored badly on service" but
// "1 of 6". A proportion with no denominator is the kind of number weekly-report.ts refuses to print.
//
// ‼️ NO FINDING IS BETTER THAN A GUESSED ONE. Every path that cannot produce a real count returns null
// and the pivot runs without a finding. A made-up fact about a real business, inside a sales pitch, is
// the one thing this lane must never do.

import { guard } from "@/lib/copy-guard";
import type { BlockStat } from "@/lib/audit-engine/report-view";

/**
 * How each audit block reads to somebody who has not seen the report.
 *
 * ‼️ NOT THE REPORT PAGE'S LABELS. BlockBreakdown.tsx renders "Brand", "Service", "Info",
 * "Comparison", which work as column headings next to a number and mean nothing in a sentence. These are
 * the same four facts said out loud. The {m} and {t} are filled from the real counts.
 */
const BLOCK_SENTENCE: Record<string, string> = {
  // ‼️ "in {m} of {t}" RATHER THAN "{m} times out of {t}", because the first draft of this produced
  // "you came up 1 times out of 6". The fix is not a plural rule per count: it is a phrasing that reads
  // correctly for every value, including one and including none.
  SERVICIO: guard(
    "pivot servicio",
    "On the questions people ask about the treatments you offer, you came up in {m} of {t}."
  ),
  MARCA: guard("pivot marca", "When people asked about you by name, you came up in {m} of {t}."),
  INFO: guard(
    "pivot info",
    "On the questions people ask while they are still deciding, you came up in {m} of {t}."
  ),
  COMPARATIVO: guard(
    "pivot comparativo",
    "When people asked the assistants to compare their options, you came up in {m} of {t}."
  ),
};

/** The same four, for the case where the answer is none at all. "0 times out of 6" reads like a typo. */
const BLOCK_ZERO: Record<string, string> = {
  SERVICIO: guard(
    "pivot servicio zero",
    "On the {t} questions people ask about the treatments you offer, you did not come up once."
  ),
  MARCA: guard(
    "pivot marca zero",
    "On the {t} questions that asked about you by name, you did not come up once."
  ),
  INFO: guard(
    "pivot info zero",
    "On the {t} questions people ask while they are still deciding, you did not come up once."
  ),
  COMPARATIVO: guard(
    "pivot comparativo zero",
    "On the {t} questions comparing the options, you did not come up once."
  ),
};

/**
 * The weakest block, as one finished sentence, or null when there is nothing honest to say.
 *
 * Null on: no stats at all (the view failed to load, or the report has no runs yet), every block empty,
 * and every block perfect. That last one matters: a business that came up in everything has no weakest
 * anything, and picking one anyway to have something to say would be inventing a weakness.
 */
export function weakestFinding(blockStats: BlockStat[] | null | undefined): string | null {
  const usable = (blockStats ?? []).filter((b) => b.total > 0 && BLOCK_SENTENCE[b.block]);
  if (usable.length === 0) return null;

  const worst = [...usable].sort((a, b) => a.mentioned / a.total - b.mentioned / b.total)[0];
  // Nothing is weakest when nothing is weak. See the note above.
  if (worst.mentioned >= worst.total) return null;

  const template = worst.mentioned === 0 ? BLOCK_ZERO[worst.block] : BLOCK_SENTENCE[worst.block];
  return template.replace("{m}", String(worst.mentioned)).replace("{t}", String(worst.total));
}

/**
 * The pivot itself. Matthew's words, tightened, split so the frame can say them as separate bubbles.
 *
 * The finding sits between `ready` and `lever`, and is simply absent when there is none. Read without
 * it the sequence still works, which is the test a conditional line has to pass.
 */
export const REPORT_PIVOT = {
  ready: guard("pivot ready", "Your report is ready."),
  lever: guard(
    "pivot lever",
    "The part that moves fastest is reviews. The assistants weigh what other people say about you more " +
      "heavily than anything you write about yourself."
  ),
  tool: guard(
    "pivot tool",
    "We have a free tool that helps your customers write better reviews. Not more reviews, better ones: " +
      "the kind an assistant can actually quote."
  ),
  ask: guard("pivot ask", "It is free and you keep it either way. Want me to set it up for you?"),
  /** The chip. It drops into the same walk the second door opens, never a second copy of it. */
  chip: guard("pivot chip", "Yes, set it up"),
  /** And the way out, so the ask is an offer rather than a wall. */
  decline: guard("pivot decline", "No thanks, I have questions"),
} as const;
