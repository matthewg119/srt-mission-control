// Voice-of-customer quote bank — the raw emotional source material for the direct-response
// headline lane. Reddit confessions, reviews, DMs: whatever the buyer actually wrote.
//
// Stored on `verticals.voc_quotes` (jsonb) and ROW-ONLY, the same treatment
// `sales_letter_examples` gets. An avatar with an empty bank generates WITHOUT quotes and
// the Slack post says so; it never borrows another avatar's customers, the same rule
// `salesLetterExamplesFor()` enforces one file over. Pest control owners and med spa owners
// are not interchangeable sources of pain.
//
// Written by `quotes` in the drop channel (append only, never replace).

import { supabaseAdmin } from "@/lib/db";
import type { Vertical, VocQuote } from "@/config/verticals";

/**
 * Slack rewrites straight quotes and apostrophes into curly ones on the way in, so the same
 * sentence pasted twice is two different strings byte for byte. Normalizing before the
 * dedupe compare is what stops a re-paste from doubling the bank. Also collapses whitespace,
 * because a paste that wrapped differently is still the same quote.
 */
export function normalizeQuote(text: string): string {
  return text
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Strip one layer of matching wrapping quotes, straight or curly. */
function unwrap(text: string): string {
  const t = text.trim();
  const pairs: [string, string][] = [
    ['"', '"'],
    ["“", "”"],
    ["'", "'"],
    ["‘", "’"],
  ];
  for (const [open, close] of pairs) {
    if (t.length > 1 && t.startsWith(open) && t.endsWith(close)) return t.slice(1, -1).trim();
  }
  return t;
}

// A trailing attribution: (r/MedSpa), (r/Esthetics), or a full thread URL in parens.
const SOURCE_RE = /\s*[([]\s*((?:https?:\/\/\S+)|(?:r\/[A-Za-z0-9_]+)|(?:Fuente|Source):[^)\]]+)\s*[)\]]\s*$/i;
// A "Fuente: https://..." / "Source: https://..." line, which is how the operator's PDF
// renders attribution: on its own line under the quote rather than inline after it.
const SOURCE_LINE_RE = /^\s*(?:fuente|source)\s*:\s*(\S+)/i;
// Leading list numbering the paste carried over from a document ("1. ", "12) ").
const LEAD_NUM_RE = /^\s*\d{1,3}[.)]\s+/;

/**
 * Parse a pasted block of quotes.
 *
 * Blank-line-separated paragraphs first, because that is what a real paste from a document
 * looks like and a quote routinely wraps across lines. Only when the whole block has no
 * blank line at all does it fall back to one-quote-per-line. Getting that order backwards
 * shreds every multi-line quote into fragments.
 *
 * Pure: no network, no DB. The probe covers it.
 */
export function parseQuotePaste(raw: string): VocQuote[] {
  const body = raw.trim();
  if (!body) return [];

  const blocks = body.includes("\n\n")
    ? body.split(/\n\s*\n/)
    : body.split(/\n/);

  const out: VocQuote[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;

    // A "Fuente:"/"Source:" line belongs to the quote above it, not to itself.
    let source: string | undefined;
    const kept: string[] = [];
    for (const line of lines) {
      const m = line.match(SOURCE_LINE_RE);
      if (m) {
        source = m[1];
        continue;
      }
      kept.push(line);
    }
    if (!kept.length) continue;

    let text = kept.join(" ").replace(LEAD_NUM_RE, "").trim();
    const inline = text.match(SOURCE_RE);
    if (inline) {
      source = source ?? inline[1].replace(/^(?:fuente|source)\s*:\s*/i, "").trim();
      text = text.slice(0, inline.index).trim();
    }
    text = unwrap(text);
    // A bare URL or a two-word fragment is attribution or noise, not a quote.
    if (text.length < 20 || /^https?:\/\//i.test(text)) continue;

    out.push(source ? { text, source } : { text });
  }
  return out;
}

/**
 * Append quotes to an avatar's bank. Never replaces. Dedupes against what is already stored
 * AND within the paste itself. Returns what actually landed so Slack can report a real
 * number rather than echoing back what was pasted.
 */
export async function appendVocQuotes(
  verticalId: string,
  incoming: VocQuote[]
): Promise<{ added: number; skipped: number; total: number }> {
  const { data, error } = await supabaseAdmin
    .from("verticals")
    .select("voc_quotes")
    .eq("id", verticalId)
    .maybeSingle();
  if (error) throw new Error(`could not read the quote bank: ${error.message}`);
  // No row means the UPDATE below would match nothing, succeed, and report a total that is
  // not there. An avatar with no `verticals` row is a real state (seedFor covers reads), so
  // this has to be said rather than counted as a write.
  if (!data) throw new Error(`no verticals row for "${verticalId}", so there is nowhere to save them`);

  const existing: VocQuote[] = Array.isArray(data.voc_quotes) ? data.voc_quotes : [];
  const seen = new Set(existing.map((q) => normalizeQuote(q.text)));

  const fresh: VocQuote[] = [];
  for (const q of incoming) {
    const key = normalizeQuote(q.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    fresh.push(q);
  }

  if (fresh.length) {
    const next = [...existing, ...fresh];
    const { error: wErr } = await supabaseAdmin
      .from("verticals")
      .update({ voc_quotes: next })
      .eq("id", verticalId);
    if (wErr) throw new Error(`could not save the quote bank: ${wErr.message}`);
  }

  return {
    added: fresh.length,
    skipped: incoming.length - fresh.length,
    total: existing.length + fresh.length,
  };
}

/**
 * The quotes as prompt text. Returns "" for an empty bank, which is what makes the caller
 * able to say "no quotes on file" out loud instead of silently writing thinner headlines.
 *
 * ‼️ The instruction sits WITH the quotes, not down in the rules block. What the model does
 * wrong by default is tidy a raw confession into a clean summary sentence, and the guard
 * against that has to be readable in the same breath as the material it governs.
 */
export function vocBlock(vertical: Pick<Vertical, "voc_quotes">): string {
  const quotes = (vertical.voc_quotes ?? []).filter((q) => q?.text?.trim());
  if (!quotes.length) return "";
  const rendered = quotes
    .map((q, i) => `${i + 1}. "${q.text.trim()}"${q.source ? ` (${q.source})` : ""}`)
    .join("\n");
  return [
    "RAW CUSTOMER QUOTES (the emotional source. These people wrote these words themselves):",
    rendered,
    "",
    "HOW TO USE THEM: this is the heat, and it is where the headlines come from. Take the",
    "feeling, the specific detail, and the vocabulary. Then REBUILD THE SHAPE into a",
    "direct-response headline using the engine below. Do NOT summarize a quote, do NOT",
    "paraphrase it into something calmer, and do NOT quote one verbatim as a headline. Change",
    "the form, never the essence. A headline that could only have been written by someone who",
    "read these is the target.",
  ].join("\n");
}
