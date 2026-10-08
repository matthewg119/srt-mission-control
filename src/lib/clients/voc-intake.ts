// Pasted customer phrases, filed as evidence and crumbled into what somebody would type.
//
// Matthew, 2026-10-07: he wants to paste Reddit-style phrases "and have them recognised, filed as
// VOC, and crumbled down into what somebody would actually type into ChatGPT to find that answer".
//
// ‼️ THIS IS THE OTHER HALF OF THE REALISM FIX, AND A LENGTH CAP COULD NOT HAVE DONE IT. The
// diagnosis in docs/prompts/2026-10-07-three-headline-formats.md names two causes of the Reddit
// confessions reaching page H1s: the engine's own confessional door, now closed, and the 24 voice
// of customer quotes it is handed with instructions to rebuild their SHAPE. The quotes are the
// best material in the brief and they stay. What was missing is the TRANSLATION: a quote is
// evidence of what she worries about, and the headline is what she would type to find the answer.
// That step now exists as a verb, so it can be done deliberately with the output on screen,
// rather than being left to the model to do silently inside a headline run.
//
// ‼️ AN EXPLICIT VERB AND NEVER A SNIFFER. research-intake.ts states this repo's rule: a thread
// message counts as research only when it says `research:`, because "sniffing for 'looks like a
// research dump' would eventually swallow somebody thinking out loud". A paste of customer pain
// is the same shape of hazard on a surface that also takes dictation and call notes, so the
// person says this is VOC and nothing guesses it.
//
// ‼️ FILED AS page_sources CUSTOMER_REVIEW WITH A NULL page_id, which is the client library tier
// clientVocQuotes already reads FIRST. So a pasted phrase reaches the next headline run for this
// client and reaches no other client's: page_sources is keyed on the client and never crosses,
// which is the rule audiences.ts states about tier 2 and the reason there is no tier 3.

import { callClaudeJSON } from "@/lib/claude-calls";
import { hasBannedDash } from "@/lib/copy-guard";
import { parseQuotePaste } from "@/lib/reel/voc-quotes";
import { recordSource } from "./page-evidence";

const MODEL = "claude-sonnet-4-6" as const;

/** The fewest characters a paste can be and still be worth filing. */
export const VOC_PASTE_FLOOR = 40;

/** How many quotes one paste may file. The same cap headlineContext reads back. */
export const VOC_PASTE_MAX = 24;

export interface CrumbledQuote {
  /** The customer's own words, verbatim, as filed. */
  quote: string;
  /** What she is actually worried about, in one plain sentence. */
  worry: string;
  /** What she would type into an answer engine to find the answer to it. */
  queries: string[];
}

/**
 * Split a paste into quotes, using the parser the drop channel already uses.
 *
 * ‼️ NOT A SECOND PARSER. `parseQuotePaste` already handles blank-line-separated blocks, one per
 * line, a trailing "Source:"/"Fuente:" line, an inline "(r/MedSpa)", wrapping quote marks and a
 * leading "12." numbering, and _probe-dr-headlines.ts section 6 pins all of it. A second
 * implementation here would be a second set of rules about the same paste.
 */
export function parseVocPaste(raw: string): Array<{ text: string; source?: string }> {
  return parseQuotePaste(raw).slice(0, VOC_PASTE_MAX);
}

/**
 * Turn filed quotes into the searches they imply.
 *
 * ‼️ THE QUOTE IS NEVER RETURNED AS A QUERY, and the prompt says so three ways, because that is
 * the exact failure this lane exists to correct. "I'm so embarrassed I made a throwaway account"
 * is not a search. "How do I check if ChatGPT mentions my clinic" is the search it implies.
 *
 * Pure prompt, exported so the probe can assert what reaches the model with no network call.
 */
export function crumblePrompt(args: { quotes: readonly { text: string; source?: string }[]; avatarLabel: string }): string {
  return [
    "You turn customer pain into search queries.",
    "",
    `THE BUYER: ${args.avatarLabel}`,
    "",
    "HER OWN WORDS, verbatim, as she wrote them somewhere public:",
    ...args.quotes.map((q, i) => `  ${i + 1}. "${q.text}"${q.source ? ` (${q.source})` : ""}`),
    "",
    "FOR EACH ONE, return three things:",
    "  quote   the line, copied back EXACTLY as given, so nothing is attributed wrongly",
    "  worry   what she is actually afraid of or stuck on, in one plain sentence",
    "  queries 1 to 3 things she would TYPE into ChatGPT or Google to find the answer",
    "",
    "‼️ A QUOTE IS NEVER A QUERY. This is the whole job and it is the thing most easily got wrong.",
    "Nobody types a confession into a search box. Nobody types 20 words. Nobody types their own",
    "shame. She types the shortest question that gets her the answer, usually 4 to 10 words, often",
    "with no punctuation and no capital letters. Write what she would type, not how she feels.",
    "",
    "  her words:  \"I'm so embarrassed about my situation that I've created a throwaway account\"",
    "  the worry:  she does not know whether her clinic is visible in AI search and is ashamed to ask",
    "  she types:  \"how do i check if chatgpt mentions my business\"",
    "",
    "  her words:  \"honestly feeling a bit burnt out. spent $1500 last month on FB/IG ads for my med spa\"",
    "  the worry:  her ad spend is not returning patients and she cannot tell why",
    "  she types:  \"why are my facebook ads not working for my med spa\"",
    "",
    "RULES.",
    "- Every query is something a REAL person types. Read it back and ask whether anybody would.",
    "- Keep her vocabulary, not an agency's. If she says med spa, the query says med spa.",
    "- No invented figures, no invented timeframes, nothing she did not say.",
    "- Never use em dashes or en dashes.",
    "- Write in English. A quote in another language still yields English queries.",
  ].join("\n");
}

interface CrumbleResult {
  items: Array<{ quote?: unknown; worry?: unknown; queries?: unknown }>;
}

function isCrumble(v: unknown): v is CrumbleResult {
  const d = v as CrumbleResult;
  if (!d || !Array.isArray(d.items)) return false;
  return d.items.every(
    (i) =>
      typeof i?.quote === "string" &&
      typeof i?.worry === "string" &&
      Array.isArray(i?.queries) &&
      (i.queries as unknown[]).every((q) => typeof q === "string")
  );
}

/**
 * File a paste as this client's own voice-of-customer evidence, and crumble it into queries.
 *
 * ‼️ THE FILING IS NOT CONDITIONAL ON THE CRUMBLE. The quotes are the durable artifact and the
 * queries are a suggestion: a model call that times out must not lose a paste somebody took the
 * trouble to collect. Same posture writeHeadlinesFor keeps about its other two formats.
 */
export async function fileVocPaste(args: {
  clientId: string;
  raw: string;
  by: string;
}): Promise<
  | { ok: true; filed: number; skipped: number; crumbled: CrumbledQuote[]; notes: string[] }
  | { ok: false; error: string }
> {
  const body = args.raw.trim();
  if (body.length < VOC_PASTE_FLOOR) {
    return {
      ok: false,
      error:
        `that is ${body.length} characters, and a customer phrase worth filing is at least ` +
        `${VOC_PASTE_FLOOR}. Paste the lines themselves rather than a description of them.`,
    };
  }

  const quotes = parseVocPaste(body);
  if (!quotes.length) {
    return {
      ok: false,
      error:
        "nothing in that paste read as a customer phrase. One per line, or separated by blank " +
        "lines, and a bare URL or a two-word fragment is skipped as attribution rather than filed.",
    };
  }

  const notes: string[] = [];
  let filed = 0;
  let skipped = 0;
  for (const q of quotes) {
    if (hasBannedDash(q.text)) {
      // Filed verbatim or not at all: a customer's own words are not ours to retouch, and the
      // dash rule is about copy WE write. So this is reported rather than silently rewritten.
      notes.push(`"${q.text.slice(0, 60)}" carries an em dash, en dash or double hyphen, and was filed as she wrote it.`);
    }
    const put = await recordSource({
      clientId: args.clientId,
      // ‼️ NULL ON PURPOSE: the client LIBRARY, not one page. page-sources' own migration says so,
      // and clientVocQuotes reads the library as tier 1 for every headline run this client gets.
      pageId: null,
      sourceType: "CUSTOMER_REVIEW",
      sourceContent: q.text,
      topic: q.source ?? "pasted customer phrase",
      collectedBy: args.by,
      // The launch chat is a dashboard surface, so `board` is the honest one of the existing
      // values. Widening the collected_via list for a provenance label would mean re-declaring a
      // CHECK constraint, which is the ordering trap docs/2026-10-08-page-headline-formats.sql
      // exists to avoid repeating.
      collectedVia: "board",
    });
    if (put.ok) filed++;
    else {
      skipped++;
      notes.push(`one line could not be filed: ${put.error}`);
    }
  }

  let crumbled: CrumbledQuote[] = [];
  try {
    const { confirmedAvatarFor } = await import("./avatars");
    const avatar = await confirmedAvatarFor(args.clientId).catch(() => null);
    const res = await callClaudeJSON<CrumbleResult>({
      model: MODEL,
      system: crumblePrompt({ quotes, avatarLabel: avatar?.label ?? "the buyer" }),
      user: "Return JSON for every quote above.",
      maxTokens: 3000,
      temperature: 0.4,
      schemaHint: '{ "items": [{ "quote": "...", "worry": "...", "queries": ["..."] }] }',
      validate: isCrumble,
    });
    crumbled = res.data.items.map((i) => ({
      quote: String(i.quote),
      worry: String(i.worry),
      queries: (i.queries as string[]).map((q) => q.trim()).filter(Boolean),
    }));
  } catch (e) {
    notes.push(`the queries could not be worked out: ${(e as Error).message}. The quotes are filed either way.`);
  }

  return { ok: true, filed, skipped, crumbled, notes };
}

/** The card, as plain lines. No channel, no emoji: the caller decides where they go. */
export function vocIntakeLines(args: {
  filed: number;
  crumbled: readonly CrumbledQuote[];
  notes: readonly string[];
}): string[] {
  const lines: string[] = [
    `Filed ${args.filed} customer phrase${args.filed === 1 ? "" : "s"} as this client's own voice-of-customer evidence.`,
    "They reach every headline run for this client from now on, ahead of the shared bank.",
  ];

  if (args.crumbled.length) {
    const queries = args.crumbled.flatMap((c) => c.queries);
    lines.push(
      "",
      "What she would actually TYPE to find each of these, which is the thing a page can rank for:",
      ""
    );
    args.crumbled.forEach((c, i) => {
      lines.push(`  ${i + 1}. she wrote: "${c.quote.slice(0, 90)}${c.quote.length > 90 ? "..." : ""}"`);
      lines.push(`     the worry: ${c.worry}`);
      for (const q of c.queries) lines.push(`     she types: ${q}`);
    });
    lines.push(
      "",
      "‼️ The quotes are the evidence and these queries are the searches. A quote is never a headline.",
      `\`keywords add ${queries.slice(0, 3).join(", ")}\` puts the ones worth a page on the list.`
    );
  }

  if (args.notes.length) lines.push("", ...args.notes.map((n) => `note: ${n}`));
  return lines;
}
