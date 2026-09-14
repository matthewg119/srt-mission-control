// What a Claude call cost, in dollars, so client_datasets.cost_usd is a real number.
//
// getOrFetch records `cost_usd` per paid pull and spendSoFar() sums it. Until this file existed
// every caller passed nothing, so every row recorded 0 and the ledger answered "we spent zero",
// which is worse than answering nothing: a zero looks like a measurement.
//
// ‼️ THESE ARE PUBLISHED PER-TOKEN RATES, NOT A GUESS, AND THEY CARRY THEIR SOURCE.
// Anthropic list pricing per million tokens, read 2026-09-14 from the Claude API pricing table.
// The repo's own rule is that a price which drives behaviour lives in one constant naming who set
// it and when (CLAUDE.md on config/pitch.ts), so: these are Anthropic's numbers, not ours, and the
// only correct way to change them is to re-read the pricing page and move the date below.
//
// ‼️ THIS IS A FLOOR FOR ANY CALL THAT USES SERVER-SIDE web_search, AND THE FLOOR IS DELIBERATE.
// The web_search tool is billed per search ON TOP of tokens, and no per-search rate is recorded in
// this repo. Rather than invent one, tokensOnly() reports what it can actually account for and
// says so in its name. A researchViaClaudeDetailed call runs up to MAX_SEARCHES searches, so its
// true cost is this figure plus those. An understated number with a known reason beats a
// confident wrong one, which is the same rule the approved-numbers gate applies to copy.

import type { ClaudeModel } from "@/lib/claude-calls";

/** Anthropic list pricing, USD per million tokens. Read 2026-09-14. */
const RATES: Readonly<Record<ClaudeModel, { inPerMTok: number; outPerMTok: number }>> = {
  "claude-opus-4-7": { inPerMTok: 5, outPerMTok: 25 },
  "claude-sonnet-4-6": { inPerMTok: 3, outPerMTok: 15 },
  "claude-haiku-4-5-20251001": { inPerMTok: 1, outPerMTok: 5 },
};

/** The date the rates above were read, so a stale table is visible rather than assumed current. */
export const RATES_READ_ON = "2026-09-14";

export interface ClaudeUsage {
  input_tokens: number;
  output_tokens: number;
}

/**
 * Token cost of one Claude call, in dollars.
 *
 * Named `tokensOnly` because that is the whole claim: it does not include the per-search charge
 * for server-side web_search, or anything else billed outside the token counters. A caller that
 * used tools should treat the result as a lower bound and, if it matters, say so on the card.
 *
 * Returns 0 for an unpriced model rather than throwing. A paid call that already succeeded must
 * never be failed by its own bookkeeping, which is the same posture getOrFetch takes when the
 * cache write fails: the money is spent either way, so losing the receipt is the smaller loss.
 */
export function tokensOnly(model: ClaudeModel, usage: ClaudeUsage | undefined): number {
  const rate = RATES[model];
  if (!rate || !usage) return 0;
  const input = (usage.input_tokens ?? 0) / 1_000_000;
  const output = (usage.output_tokens ?? 0) / 1_000_000;
  return input * rate.inPerMTok + output * rate.outPerMTok;
}

/** Whether a model has a published rate here, for a probe that wants to assert coverage. */
export function isPriced(model: string): boolean {
  return Object.prototype.hasOwnProperty.call(RATES, model);
}

/** The models this file prices, so a probe can assert the table covers ClaudeModel exhaustively. */
export function pricedModels(): string[] {
  return Object.keys(RATES);
}
