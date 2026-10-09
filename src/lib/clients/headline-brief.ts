// The headline brief: a prompt Matthew runs elsewhere, and the paste-back that files the answer.
//
// Matthew, 2026-10-09, after watching the in-app walk stall at the angle stage: "instead of doing
// this just tell it to give me a prompt i can run in claude for it to give me 20 AEO and 20 SEO
// headlines for the following keywords... i copy that paste in claude and come back with the
// selected ones to build the body of the page."
//
// ‼️ IT RETURNS A PROMPT. IT DOES NOT RUN ONE. This is the same decision `buildBatchPrompt` records
// for the deep research pass, made by the same person for the same reason: he reads every answer
// and picks from it. Nothing on this path calls a model, and nothing should be added that does.
// The generators in client-headlines.ts and page-seo-titles.ts still exist and still work; this is
// a second door onto the same two contracts, for the times he would rather drive.
//
// ‼️ BOTH ENGINES IN ONE PROMPT, WHICH EVERY OTHER FILE IN THIS LANE FORBIDS, AND THE DIFFERENCE IS
// WHO READS THE ANSWER. The rule those files state is that a 60 character contract and a 4 to 12
// word contract collapse into whichever is tighter when ONE call is asked for ONE list. Here the
// ask is two separately labelled lists, the two contracts are restated immediately above each
// list rather than once at the top, and a person reads the output before a single row is stored.
// A blend is visible to him and costs a re-run; in an automated call it would be stored silently.
// That is the whole reason this is allowed to do what generateKeywordHeadlines may not.

import { AEO_HEADLINE_ENGINE } from "@/data/reel/aeo-headline-engine";
import {
  SEO_TITLE_ENGINE,
  SEO_TITLE_KEYWORD_BY_WORD,
  SEO_TITLE_TARGET_MAX,
  SEO_TITLE_TARGET_MIN,
} from "@/data/reel/seo-title-engine";
import { vocBlock } from "@/lib/reel/voc-quotes";
import { approvedNumbersBlock } from "@/lib/reel/creative-director";
import {
  headlineContext,
  headlineFaults,
  headlineWarnings,
  normalizeHeadline,
  QUERY_CORE_MAX_WORDS,
  QUERY_CORE_MIN_WORDS,
  QUERY_CORE_TARGET_WORDS,
  HEADLINE_MAX_WORDS,
  type HeadlineContext,
} from "./client-headlines";
import { seoTitleFaults, seoTitleWarnings, SEO_ORIGIN } from "./page-seo-titles";
import { supabaseAdmin } from "@/lib/db";

/** How many of each format the brief asks for, per keyword. Matthew: "20 AEO and 20 SEO". */
export const BRIEF_PER_FORMAT = 20;

/**
 * The most keywords worth putting in one brief.
 *
 * Twenty of each per keyword means forty lines per keyword, so five keywords is already a two
 * hundred line answer. Past that the model thins out and he cannot read it in one sitting, which
 * is the same reason MAX_QUOTES exists one file over.
 */
export const BRIEF_MAX_KEYWORDS = 5;

/**
 * The markers the brief asks for, and the paste-back parses. One shape, declared once.
 *
 * ‼️ NO DOUBLE HYPHEN IN ANY OF THEM, WHICH IS NOT A STYLE CHOICE. copy-guard.ts bans em dashes,
 * en dashes AND the "--" that renders as one, and this brief is copy we hand to a model. Markers
 * written as "--- AEO H1 ---" put the banned sequence in the one document whose whole job is to
 * teach the rules, and the probe caught exactly that.
 */
const KEYWORD_MARK = "=== KEYWORD:";
const AEO_MARK = "[AEO H1]";
const SEO_MARK = "[SEO TITLE TAG]";

/**
 * Read a pasted list of keywords. One per line, numbering and bullets stripped.
 *
 * ‼️ THE KEYWORDS ARE WHATEVER HE PASTES, AND THEY DO NOT HAVE TO BE IN THE PLAN. He may be
 * working a page that does not exist yet, which is the whole point of handing him a brief rather
 * than walking the eleven rows already approved. `fileHeadlinePaste` matches back to a plan row
 * when one carries the keyword and files the rest against no page rather than refusing them.
 */
export function parseKeywordList(raw: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of raw.split(/\r?\n/)) {
    const text = line
      .replace(/^[\s>*_`~-]*(?:\d+[.)]\s*)?/, "")
      .replace(/[*_`"]/g, "")
      .trim();
    if (!text || text.length < 3) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

/**
 * The brief. Exported so the probe can assert what he is handed with no network call.
 *
 * PURE: it takes the context rather than a client id, so the probe proves the two contracts are
 * both present and both intact without a database.
 */
export function buildHeadlineBrief(args: {
  ctx: HeadlineContext;
  keywords: readonly string[];
  perFormat?: number;
}): string {
  const { ctx, keywords } = args;
  const n = args.perFormat ?? BRIEF_PER_FORMAT;
  const who = [ctx.businessType, ctx.city ? `in ${ctx.city}` : null].filter(Boolean).join(" ");

  return [
    `You are writing page headlines for ${who || "a local business"}. Two separate jobs, below.`,
    "",
    "THE BUSINESS AND THE BUYER:",
    `- The business: ${ctx.clientName}${who ? `, ${who}` : ""}`,
    `- The buyer every line is for: ${ctx.avatarLabel}`,
    ctx.treatment ? `- What they sell: ${ctx.treatment}` : "",
    ctx.positioning ? `- How they position it: ${ctx.positioning}` : "",
    "",
    "THE KEYWORDS. One page per keyword. Do all of them:",
    ...keywords.map((k, i) => `  ${i + 1}. ${k}`),
    "",
    vocBlock({ voc_quotes: ctx.quotes }) ||
      "NO CUSTOMER QUOTES ARE ON FILE. Write from the buyer and the offer alone, in her plain words.",
    "",
    approvedNumbersBlock({ approved_numbers: ctx.approvedNumbers }),
    "",
    "‼️ THESE ARE TWO DIFFERENT ARTIFACTS WITH TWO DIFFERENT LENGTH RULES, AND THE COMMONEST WAY",
    "TO GET THIS WRONG IS TO LET ONE RULE WIN. One is measured in WORDS and one in CHARACTERS.",
    "Write PART A completely, then start PART B from scratch. Do not reuse a line between them.",
    "",
    "═══════════════════════════════════════════════════════════════════════",
    `PART A. ${n} AEO H1s PER KEYWORD.`,
    "═══════════════════════════════════════════════════════════════════════",
    "",
    "This is the question a buyer TYPES into ChatGPT or Perplexity. It is what the engine matches",
    "her query against before it decides whether to cite the page. It is NOT a title tag and it is",
    "NOT an ad headline.",
    "",
    `LENGTH: ${QUERY_CORE_MIN_WORDS} to ${QUERY_CORE_TARGET_WORDS} words up to the question mark, the colon, or a ", and".`,
    `${QUERY_CORE_MAX_WORDS} is the hard ceiling. The whole line including any format suffix stays under ${HEADLINE_MAX_WORDS} words.`,
    "",
    AEO_HEADLINE_ENGINE,
    "",
    "═══════════════════════════════════════════════════════════════════════",
    `PART B. ${n} SEO TITLE TAGS PER KEYWORD.`,
    "═══════════════════════════════════════════════════════════════════════",
    "",
    "This is the line Google PRINTS in a results list, read beside nine competitors. It is measured",
    "in CHARACTERS, not words, and the word rules in PART A do not apply to it at all.",
    "",
    `LENGTH: ${SEO_TITLE_TARGET_MIN} to ${SEO_TITLE_TARGET_MAX} CHARACTERS including spaces. Never over ${SEO_TITLE_TARGET_MAX}.`,
    `The keyword appears inside the first ${SEO_TITLE_KEYWORD_BY_WORD} words.`,
    "",
    SEO_TITLE_ENGINE,
    "",
    "═══════════════════════════════════════════════════════════════════════",
    "HOW TO RETURN IT. Follow this exactly: it is parsed by a machine when I paste it back.",
    "═══════════════════════════════════════════════════════════════════════",
    "",
    "For EACH keyword, in order, output this block and nothing else between blocks:",
    "",
    `${KEYWORD_MARK} <the keyword, copied exactly as given above> ===`,
    AEO_MARK,
    "1. <h1>",
    `...through ${n}`,
    SEO_MARK,
    "1. <title tag>  (<character count>)",
    `...through ${n}`,
    "",
    "Put the character count in parentheses after every title tag, so I can see the budget at a",
    "glance. No preamble, no commentary between blocks, no markdown headings of your own.",
    "",
    "BEFORE YOU ANSWER, CHECK:",
    `- every PART A line is a question somebody would type, ${QUERY_CORE_MIN_WORDS} to ${QUERY_CORE_TARGET_WORDS} words in its core`,
    `- every PART B line is ${SEO_TITLE_TARGET_MIN} to ${SEO_TITLE_TARGET_MAX} characters and leads with the keyword`,
    "- no line in either part confesses, shames, teases, or withholds its subject",
    "- no em dashes or en dashes anywhere. Commas, periods, colons and hyphens only",
    "- no figure that the approved list above does not contain",
  ]
    .filter((l) => l !== "")
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

export interface PastedKeyword {
  keyword: string;
  aeo: string[];
  seo: string[];
}

/**
 * Read the answer back. The brief dictated the shape, so this parses rather than guesses.
 *
 * ‼️ IT PARSES A FORMAT IT ASKED FOR AND NEVER SNIFFS. research-intake.ts states the rule: a paste
 * counts as a thing only when it says so. The markers come from the brief above, so a paste that
 * does not carry them returns NOTHING rather than filing somebody's sentence as a headline.
 *
 * Tolerant of what a model actually does to a template: extra blank lines, bold markers, a
 * trailing "===", a "(52)" character count, and numbering with either a dot or a bracket.
 */
export function parseHeadlinePaste(raw: string): PastedKeyword[] {
  const out: PastedKeyword[] = [];
  const text = raw.replace(/\r\n/g, "\n");
  if (!text.includes(KEYWORD_MARK)) return out;

  const blocks = text.split(KEYWORD_MARK).slice(1);
  for (const block of blocks) {
    const [headLine, ...rest] = block.split("\n");
    const keyword = headLine.replace(/=+\s*$/, "").replace(/[*_`"]/g, "").trim();
    if (!keyword) continue;

    let bucket: "aeo" | "seo" | null = null;
    const aeo: string[] = [];
    const seo: string[] = [];

    for (const line of rest) {
      const bare = line.replace(/[*_`]/g, "").trim();
      if (!bare) continue;
      // Tolerant of what a model does to a marker: brackets dropped, dashes added back, a colon
      // appended, "H1" or "TITLE" spelled out or not. The line only has to START by naming one.
      if (/^[[\s\-*]*AEO\b/i.test(bare)) {
        bucket = "aeo";
        continue;
      }
      if (/^[[\s\-*]*SEO\b/i.test(bare)) {
        bucket = "seo";
        continue;
      }
      if (!bucket) continue;

      const m = bare.match(/^\d+[.)]\s*(.+)$/);
      if (!m) continue;
      // Drop a trailing "(52)" or "(52 chars)" the brief asked for: it is a measurement, not copy.
      const value = m[1].replace(/\s*\(\s*\d+\s*(?:chars?|characters?)?\s*\)\s*$/i, "").trim();
      if (value.length < 8) continue;
      (bucket === "aeo" ? aeo : seo).push(value);
    }

    if (aeo.length || seo.length) out.push({ keyword, aeo, seo });
  }
  return out;
}

export interface FiledFormat {
  keyword: string;
  planRank: number | null;
  stored: number;
  refused: Array<{ line: string; why: string }>;
  noted: string[];
}

export interface FileHeadlineResult {
  aeo: FiledFormat[];
  seo: FiledFormat[];
  unmatched: string[];
}

/**
 * File what he picked.
 *
 * ‼️ HIS PICKS ARE FILED AND THE REFUSALS ARE REPORTED, NEVER SILENTLY DROPPED. These are lines a
 * person chose, so a rule that quietly swallows one is worse than a rule that names it: he would
 * see four of six arrive and have no way to learn why. The same posture page-dr-headlines.ts
 * keeps, except that there the dropped lines are a model's and here they are his.
 *
 * A keyword with no matching plan row still files, against no page. He may be working a page that
 * does not exist yet, which is the reason this door exists at all.
 */
export async function fileHeadlinePaste(args: {
  clientId: string;
  blocks: readonly PastedKeyword[];
  audienceId?: string | null;
}): Promise<FileHeadlineResult> {
  const { data: plan } = await supabaseAdmin
    .from("page_plan")
    .select("id, rank, target_keyword")
    .eq("client_id", args.clientId);

  const byKeyword = new Map<string, { id: string; rank: number }>();
  for (const r of (plan ?? []) as Array<{ id: string; rank: number; target_keyword: string | null }>) {
    if (r.target_keyword) byKeyword.set(r.target_keyword.trim().toLowerCase(), { id: r.id, rank: r.rank });
  }

  const out: FileHeadlineResult = { aeo: [], seo: [], unmatched: [] };

  for (const block of args.blocks) {
    const row = byKeyword.get(block.keyword.trim().toLowerCase()) ?? null;
    if (!row) out.unmatched.push(block.keyword);

    // AEO H1s, judged by the H1 rules and filed under the origin the picker reads.
    if (block.aeo.length) {
      const refused: Array<{ line: string; why: string }> = [];
      const keep: string[] = [];
      for (const line of block.aeo) {
        const f = headlineFaults([line], 1, "");
        if (f.length) refused.push({ line, why: f[0].why });
        else keep.push(line);
      }
      const stored = await store(args.clientId, keep, "keyword", row?.id ?? null, args.audienceId);
      out.aeo.push({
        keyword: block.keyword,
        planRank: row?.rank ?? null,
        stored,
        refused,
        noted: headlineWarnings(keep, block.keyword).map((w) => `"${w.headline}" is ${w.why}`),
      });
    }

    // SEO title tags, judged by the CHARACTER rules, never the H1's.
    if (block.seo.length) {
      const refused: Array<{ line: string; why: string }> = [];
      const keep: string[] = [];
      for (const line of block.seo) {
        const f = seoTitleFaults([line], 1, block.keyword);
        if (f.length) refused.push({ line, why: f[0] });
        else keep.push(line);
      }
      const stored = await store(args.clientId, keep, SEO_ORIGIN, row?.id ?? null, args.audienceId);
      out.seo.push({
        keyword: block.keyword,
        planRank: row?.rank ?? null,
        stored,
        refused,
        noted: seoTitleWarnings(keep),
      });
    }
  }

  return out;
}

async function store(
  clientId: string,
  lines: readonly string[],
  origin: string,
  planId: string | null,
  audienceId?: string | null
): Promise<number> {
  const rows = lines
    .map((h) => h.trim())
    .filter(Boolean)
    .map((headline) => ({
      client_id: clientId,
      headline,
      normalized: normalizeHeadline(headline),
      origin,
      ...(planId ? { used_page_id: planId } : {}),
      ...(audienceId ? { audience_id: audienceId } : {}),
    }));
  if (!rows.length) return 0;

  const { data, error } = await supabaseAdmin
    .from("client_headlines")
    .upsert(rows, { onConflict: "client_id,normalized", ignoreDuplicates: true })
    .select("id");

  if (error) {
    console.error(`[headline-brief] could not file ${origin}: ${error.message}`);
    return 0;
  }
  return (data ?? []).length;
}

/** The card, as plain lines. No channel, no emoji: the caller decides where they go. */
export function filedLines(res: FileHeadlineResult): string[] {
  const lines: string[] = [];
  const all = [...res.aeo.map((f) => ["H1", f] as const), ...res.seo.map((f) => ["title tag", f] as const)];
  if (!all.length) {
    return [
      "Nothing was filed. The paste has to carry the markers the brief asked for, starting with",
      `"${KEYWORD_MARK} <keyword> ===". Paste the whole answer rather than just the lines.`,
    ];
  }

  for (const [label, f] of all) {
    const where = f.planRank ? `page ${f.planRank}` : "no page yet";
    lines.push(`${f.keyword} (${where}): ${f.stored} ${label}${f.stored === 1 ? "" : "s"} filed.`);
    for (const r of f.refused) lines.push(`   refused: "${r.line}" has ${r.why}`);
    for (const n of f.noted) lines.push(`   note: ${n}`);
  }

  if (res.unmatched.length) {
    lines.push(
      "",
      `No planned page carries ${res.unmatched.map((k) => `"${k}"`).join(", ")}, so those are filed against no page.`,
      "Add the keyword and approve a plan row, and they will attach to it."
    );
  }
  return lines;
}

/** The constants the brief and the parser share, for the probe. */
export const BRIEF_MARKS = { KEYWORD_MARK, AEO_MARK, SEO_MARK } as const;
