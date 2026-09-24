// More ways to say the phrases somebody already picked.
//
// ‼️ THIS IS NOT THE EXPANSION AND THE DIFFERENCE IS THE INPUT. expandKeywords writes ways the OFFER
// is said, from the offer, by category, and it is how a set of 200 comes into being. This takes the
// handful of phrases a person CHOSE and writes the other ways each of those is typed. The first
// widens the subject list; this widens the phrase family inside subjects that are already decided.
//
// ‼️ AND IT DOES NOT CREATE MORE SCREENSHOTS, WHICH IS THE THING TO SAY OUT LOUD. shortlistOf()
// dedupes by sameSubject before it caps, and "botox cost" and "how much does botox cost" are one
// subject by containment. So twenty variations of five picked phrases still produce five rows on the
// shortlist and five SERP checks. That is the point: a page ranks for a family of phrasings, and the
// family is what gets written into the title, the H1 and the subheads. Anyone expecting the
// shortlist to grow will think this is broken, so the card says so.
//
// ‼️ PROPOSALS, NEVER AUTO-APPROVED. A variation is a model's idea about wording. It joins the set
// as `expansion`, which PRECEDENCE already ranks below anything a person typed, and it waits for
// `keywords approve 411-423` like every other proposal. The 2026-09-23 measurement is the reason:
// one bare `keywords approve` turned 149 unread model rows into the pool every page is chosen from.

import { callClaudeJSON, camelizeKeys } from "@/lib/claude-calls";
import { hasBannedDash } from "@/lib/copy-guard";
import type { ExpansionContext } from "./keyword-expansion";

const MODEL = "claude-sonnet-4-6" as const;

/** At most this many picked phrases go in. Beyond it the prompt stops being about a batch. */
export const VARIATION_SOURCE_MAX = 40;
/** At most this many variations come back per picked phrase. */
export const VARIATIONS_EACH = 4;

export interface Variation {
  phrase: string;
  /** The picked phrase this is a way of saying. Kept so the card can group them. */
  of: string;
}

/**
 * Write the other ways each picked phrase is typed.
 *
 * Never throws: every caller is a Slack command where a thrown error is a card that never posts.
 */
export async function variationsFor(args: {
  ctx: ExpansionContext;
  picked: readonly string[];
}): Promise<{ ok: true; rows: Variation[] } | { ok: false; error: string }> {
  const picked = args.picked.slice(0, VARIATION_SOURCE_MAX);
  if (!picked.length) return { ok: true, rows: [] };

  const { ctx } = args;

  try {
    const { data } = await callClaudeJSON<{ rows: Variation[] }>({
      model: MODEL,
      system: [
        `You write the other ways one search is typed, for ${ctx.clientName}.`,
        `What they sell: ${ctx.treatment}.`,
        ctx.avatarLabel ? `Who is searching: ${ctx.avatarLabel}.` : "",
        ctx.city ? `They are local to ${ctx.city}.` : "",
        ctx.terms.length ? `What customers call it: ${ctx.terms.join(", ")}.` : "",
        "",
        "You are given phrases somebody has already CHOSEN. For each one, write up to " +
          `${VARIATIONS_EACH} other ways a real person types the SAME search.`,
        "",
        "WHAT COUNTS AS THE SAME SEARCH:",
        "  - the same question asked in fewer or more words",
        "  - the question form and the bare noun form of one thing",
        "  - a common misspelling, or the short name people actually use",
        "  - the same thing with a place on it, ONLY if a place is already in the phrase you were given",
        "",
        "WHAT DOES NOT COUNT, and returning one is worse than returning nothing:",
        "  - a DIFFERENT question. 'botox cost' and 'botox aftercare' are two subjects, not two wordings.",
        "  - a marketing line, a headline, or anything promising a result",
        "  - adding a city, a price or a brand that was not in the phrase you were given",
        "",
        "RULES, checked in code, and a row breaking one is thrown away:",
        "  - lowercase unless a brand needs capitals. No quotation marks. No numbering.",
        "  - never an em dash, an en dash or a double hyphen.",
        "  - do not repeat the phrase you were given back to us.",
        "  - `of` must be EXACTLY one of the phrases you were given, copied character for character.",
        "",
        "Fewer good ones beat more. A phrase nobody would type is a page aimed at nobody.",
      ]
        .filter(Boolean)
        .join("\n"),
      user: [
        "The chosen phrases:",
        ...picked.map((p) => `- ${p}`),
        "",
        "Write the other ways each one is typed.",
      ].join("\n"),
      maxTokens: 4000,
      temperature: 0.4,
      schemaHint: '{ "rows": [ { "phrase": string, "of": string } ] }',
    });

    const raw = camelizeKeys(data) as { rows?: unknown };
    const rows = Array.isArray(raw.rows) ? raw.rows : [];
    const source = new Set(picked.map((p) => p.trim().toLowerCase()));
    const seen = new Set<string>();
    const out: Variation[] = [];

    for (const r of rows) {
      const rec = r as Record<string, unknown>;
      const phrase = typeof rec.phrase === "string" ? rec.phrase.trim().replace(/\s+/g, " ") : "";
      const of = typeof rec.of === "string" ? rec.of.trim() : "";
      if (!phrase || !of) continue;
      if (phrase.length < 3 || phrase.length > 120) continue;
      if (hasBannedDash(phrase)) continue;

      const key = phrase.toLowerCase();
      // ‼️ A VARIATION THAT IS ONE OF THE PICKED PHRASES IS NOT A VARIATION. It would be written back
      // as an `expansion` row over a `manual` one, and precedence would then have a model's copy of
      // something a person typed sitting beside the original.
      if (source.has(key) || seen.has(key)) continue;
      // The parent has to be a phrase we actually sent, or the grouping on the card is invented.
      if (!source.has(of.toLowerCase())) continue;

      seen.add(key);
      out.push({ phrase, of });
    }

    return { ok: true, rows: out };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
