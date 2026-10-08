// The title tag for a page, which is neither the page's H1 nor its ad hook.
//
// Matthew, 2026-10-07, after rejecting the headline card for SRT's own eleven pages: every
// headline run now returns THREE artifacts per page, "stored and tracked separately so each
// accumulates its own traffic data over time". This file is the first of the three, and the
// shortest-lived in a reader's eye: it is the line Google prints in a results list.
//
// ‼️ THIS IS A THIRD ARTIFACT PER PAGE, NOT A REPLACEMENT FOR EITHER OTHER ONE. The three have
// three different readers and three different jobs:
//   - the TITLE TAG (this file)      is read in a list of ten, by somebody choosing a link.
//   - the H1 (client-headlines.ts)   is matched by an answer engine against a typed question.
//   - the AD HOOK (page-dr-headlines) stops a scroll on Meta, in a cold email, in a VSL.
// One page, three lines, written from the same picked angle so they argue one thing.
//
// ‼️ DELIBERATELY NOT headlineFaults, THE SAME CUT page-dr-headlines.ts MAKES AND FOR THE SAME
// REASON. headlineFaults enforces isQueryShaped and a 4 to 12 word query core, and a title tag
// is neither a question nor measured in words. "AEO Agency Pricing: What Med Spas Should Pay in
// 2026" is a perfect title tag and would be refused by every rule in that function. A title tag
// is measured in CHARACTERS, because its budget is the pixel width of a Google result.
//
// ‼️ AND NOT A SECOND FIELD ON THE H1'S MODEL CALL. See seo-title-engine.ts's banner: a 60
// character contract and a 12 word contract in one prompt collapse into whichever is tighter.
// Two artifacts, two calls, two engines.

import { supabaseAdmin } from "@/lib/db";
import { callClaudeJSON } from "@/lib/claude-calls";
import { hasBannedDash } from "@/lib/copy-guard";
import {
  loadSeoTitleEngine,
  SEO_TITLE_HARD_MIN,
  SEO_TITLE_KEYWORD_BY_WORD,
  SEO_TITLE_TARGET_MAX,
  SEO_TITLE_TARGET_MIN,
} from "@/data/reel/seo-title-engine";
import { approvedNumbersBlock } from "@/lib/reel/creative-director";
import { carriesAnyKeyword, keywordContentWords, keywordFamily, wordForms } from "@/lib/hub/keyword-placement";
import { headlineContext, normalizeHeadline, type HeadlineContext } from "./client-headlines";
import type { PlanRow } from "./page-plan";

const MODEL = "claude-sonnet-4-6" as const;

/**
 * Six, which is what Matthew asked for on 2026-10-07: "at least 6 concepts in all three formats
 * before that page moves on".
 *
 * ‼️ NOT TWENTY. The ad hooks are a bank used across weeks of ads, so twenty is cheap there.
 * A title tag is ONE slot on one page, so these are candidates a person picks from, and six is
 * enough to choose well without turning a decision into a survey.
 */
export const SEO_TITLES_PER_PAGE = 6;

/** What a page's title tags are stored as. Its own origin, so the H1 picker cannot see them. */
export const SEO_ORIGIN = "seo_title" as const;

/** Hype and open loops, which rule 3 of the engine bans outright. */
const HYPE_SHAPES: ReadonlyArray<{ re: RegExp; why: string }> = [
  { re: /\byou won'?t believe\b/i, why: "a clickbait promise" },
  { re: /\bthe secret\b|\bsecrets? (?:to|of|behind)\b/i, why: '"secret", which withholds the subject' },
  { re: /\bthis one (?:trick|thing|change|fix)\b|\bone weird\b/i, why: "a one-trick tease" },
  { re: /\bhere'?s why\b|\bhere'?s what\b|\bhere'?s how\b/i, why: 'a "here\'s why" open loop' },
  { re: /\bnobody (?:tells|talks about|wants you to know)\b/i, why: "a withheld-knowledge tease" },
  { re: /\bwhat (?:they|agencies|everyone) (?:don'?t|won'?t) (?:tell|want)\b/i, why: "a conspiracy tease" },
  { re: /\bshocking\b|\binsane\b|\bcrazy\b|\bmind[- ]blowing\b/i, why: "hype wording" },
];

/** Shame and confession, which belong in the ad hook and the meta description (his rule 10). */
const AD_VOICE_SHAPES: ReadonlyArray<{ re: RegExp; why: string }> = [
  { re: /\bembarrassed\b|\bashamed\b|\bthrowaway account\b/i, why: "confession wording" },
  { re: /\bghost(?:ed|ing|s)?\b/i, why: '"ghosting", which is ad copy' },
  { re: /^\s*(?:i|i'?m|my|we|our)\b/i, why: "first person, which a title tag never uses" },
];

export interface SeoTitleRow {
  id: string;
  title: string;
  planId: string | null;
}

/** The characters a title tag spends. Trimmed, because leading space is not a design choice. */
export function seoTitleLength(title: string): number {
  return title.trim().length;
}

/**
 * Does the keyword start inside the first `byWord` words of the title?
 *
 * ‼️ POSITIONAL, WHICH IS A QUESTION carriesKeyword CANNOT ANSWER. Matthew's page rule 2 is
 * "keyword in the first 3-5 words", and a boolean "is it present" says nothing about where. The
 * match is per content word and tolerant of inflection, because "How ChatGPT Ranks Local
 * Businesses (2026)" leads with its keyword and spells two of its words differently.
 *
 * Pure.
 */
export function keywordStartsWithin(title: string, keyword: string, byWord = SEO_TITLE_KEYWORD_BY_WORD): boolean {
  const content = keywordContentWords(keyword);
  if (!content.length) return true;

  const wanted = new Set<string>();
  for (const w of content) for (const form of wordForms(w)) wanted.add(form);

  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  const at = words.findIndex((w) => wanted.has(w));
  return at >= 0 && at < byWord;
}

/**
 * Everything wrong with a batch of title tags, in words.
 *
 * ‼️ THE CEILING REFUSES AND THE FLOOR DOES NOT, decided with Matthew on 2026-10-08. Two of his
 * own five worked titles are 47 and 41 characters, under the 50 the brief named, so a hard floor
 * rejects his own quality bar. Over 60 Google truncates the line, which is a defect a reader can
 * see; under 50 is simply short. Under 30 is not a title. See `seoTitleWarnings` for the floor.
 *
 * Pure, so the probe can prove it offline.
 */
export function seoTitleFaults(
  titles: readonly string[],
  /** How many were asked for, or 0 to not check the count. Same argument order as drHeadlineFaults. */
  count = 0,
  /** The page's keyword. Pass "" to skip the keyword rules, which only a shape test would do. */
  keyword = ""
): string[] {
  const out: string[] = [];
  if (count > 0 && titles.length !== count) {
    out.push(`expected ${count} titles and got ${titles.length}`);
  }

  const family = keyword ? keywordFamily(keyword) : [];

  for (const t of titles) {
    const title = t.trim();
    const chars = seoTitleLength(title);

    if (hasBannedDash(title)) {
      out.push(`"${title}" carries an em dash, en dash or double hyphen`);
      continue;
    }
    if (chars > SEO_TITLE_TARGET_MAX) {
      out.push(
        `"${title}" is ${chars} characters, and Google truncates past ${SEO_TITLE_TARGET_MAX}. Cut it to ${SEO_TITLE_TARGET_MIN} to ${SEO_TITLE_TARGET_MAX}`
      );
      continue;
    }
    if (chars < SEO_TITLE_HARD_MIN) {
      out.push(`"${title}" is ${chars} characters, which is a fragment rather than a title`);
      continue;
    }

    const hype = HYPE_SHAPES.find(({ re }) => re.test(title));
    if (hype) {
      out.push(`"${title}" carries ${hype.why}, and rule 3 bans hype and open loops in a title tag`);
      continue;
    }
    const voice = AD_VOICE_SHAPES.find(({ re }) => re.test(title));
    if (voice) {
      out.push(
        `"${title}" carries ${voice.why}. That language is wanted, in the ad hook and the meta description, never here`
      );
      continue;
    }

    if (keyword) {
      if (!carriesAnyKeyword(title, keyword, family)) {
        out.push(`"${title}" does not carry "${keyword}". Every title must`);
        continue;
      }
      if (!keywordStartsWithin(title, keyword)) {
        out.push(
          `"${title}" does not reach "${keyword}" until past word ${SEO_TITLE_KEYWORD_BY_WORD}. The keyword leads a title tag`
        );
        continue;
      }
    }
  }

  // Never the same opening more than twice, counted on the first three words. The same rule the
  // other two lanes keep, for the same reason: six candidates that all open "How to Get" are one
  // candidate written six times.
  const openings = new Map<string, number>();
  for (const t of titles) {
    const key = t.trim().toLowerCase().split(/\s+/).slice(0, 3).join(" ");
    if (!key) continue;
    openings.set(key, (openings.get(key) ?? 0) + 1);
  }
  for (const [opening, n] of openings) {
    if (n > 2) out.push(`"${opening}" opens ${n} titles, and two is the most the engine allows`);
  }

  return out;
}

/**
 * What is worth saying about a title that is still legal. Rendered on the card, never refused.
 *
 * The soft floor lives here rather than in `seoTitleFaults` for the reason `headlineWarnings`
 * exists: every caller treats a fault as a rejection, so a warning in that list becomes a refusal.
 */
export function seoTitleWarnings(titles: readonly string[]): string[] {
  const out: string[] = [];
  for (const t of titles) {
    const title = t.trim();
    const chars = seoTitleLength(title);
    if (chars >= SEO_TITLE_HARD_MIN && chars < SEO_TITLE_TARGET_MIN) {
      out.push(
        `"${title}" is ${chars} characters, short of the ${SEO_TITLE_TARGET_MIN} to ${SEO_TITLE_TARGET_MAX} target. It is allowed, and padding it to reach the floor would be worse`
      );
    }
  }
  return out;
}

/** The angle a page argues, when one has been picked. Null is legal and widens the brief. */
async function angleFor(
  clientId: string,
  planId: string
): Promise<{ idea: string; indoctrination: string | null; narrative: string | null } | null> {
  try {
    const { approvedAngleForPlan } = await import("./page-angles");
    const picked = await approvedAngleForPlan(clientId, planId);
    return picked
      ? { idea: picked.idea, indoctrination: picked.indoctrination, narrative: picked.narrative }
      : null;
  } catch {
    return null;
  }
}

/**
 * The prompt. Exported so the probe can assert what reaches the model with no network call.
 *
 * ‼️ THE ENGINE GOES IN LAST AND WHOLE, the rule page-dr-headlines.ts states. Everything above it
 * is this client's own material, which is the more specific thing. The engine is the method.
 *
 * ‼️ NO vocBlock HERE, AND ITS ABSENCE IS DELIBERATE. The quotes are the emotional source for the
 * H1 and the ad hook. A title tag may not carry that language at all (his rule 10), so handing
 * this call 24 Reddit confessions would be handing it the one thing its own rule 4 forbids.
 */
export function seoTitlePrompt(args: {
  ctx: HeadlineContext;
  row: PlanRow;
  keyword: string;
  angle: { idea: string; indoctrination: string | null; narrative: string | null } | null;
  count: number;
}): string {
  const { ctx, row, keyword, angle, count } = args;
  const who = [ctx.businessType, ctx.city ? `in ${ctx.city}` : null].filter(Boolean).join(" ");

  return [
    `You are an SEO editor writing title tags for ${who || "a local business"}.`,
    `Write exactly ${count} candidate title tags for ONE page.`,
    "",
    "THE BUSINESS AND THE BUYER:",
    `- The business: ${ctx.clientName}${who ? `, ${who}` : ""}`,
    `- The buyer the page is for: ${ctx.avatarLabel}`,
    ctx.treatment ? `- What they sell: ${ctx.treatment}` : "",
    ctx.positioning ? `- How they position it: ${ctx.positioning}` : "",
    "",
    "THE PAGE:",
    `- Its target keyword, which every title must carry in its first ${SEO_TITLE_KEYWORD_BY_WORD} words: ${keyword}`,
    `- Its working title: ${row.workingTitle}`,
    row.headline ? `- Its H1, which is a DIFFERENT artifact and must not be repeated here: ${row.headline}` : "",
    ...(angle
      ? [
          `- What the page argues: ${angle.idea}`,
          ...(angle.indoctrination ? [`- The belief it installs: ${angle.indoctrination}`] : []),
        ]
      : []),
    "",
    approvedNumbersBlock({ approved_numbers: ctx.approvedNumbers }),
    "",
    loadSeoTitleEngine({ avatarLabel: ctx.avatarLabel }),
  ]
    .filter(Boolean)
    .join("\n");
}

function isTitles(v: unknown): v is { titles: string[] } {
  const d = v as { titles?: unknown };
  return Array.isArray(d?.titles) && d.titles.every((t) => typeof t === "string");
}

/**
 * Six title tags for ONE page, written from its angle and stored against its plan row.
 *
 * ‼️ THE BATCH IS FILTERED, NOT REFUSED, the rule page-dr-headlines.ts and precall-headlines.ts
 * both keep: one title four characters too long must not throw away the other five and make a
 * person wait twice for nothing.
 */
export async function generateSeoTitlesForPage(args: {
  clientId: string;
  row: PlanRow;
  keyword?: string;
  count?: number;
}): Promise<{ ok: true; titles: string[]; dropped: string[] } | { ok: false; error: string }> {
  const count = args.count ?? SEO_TITLES_PER_PAGE;
  const keyword = (args.keyword ?? args.row.targetKeyword ?? "").trim();
  if (!keyword) {
    return { ok: false, error: `page ${args.row.rank} has no target keyword, so there is nothing to aim a title at` };
  }

  const ctx = await headlineContext(args.clientId);
  if (!ctx.ok) return { ok: false, error: ctx.error };

  const angle = await angleFor(args.clientId, args.row.id);
  const prompt = seoTitlePrompt({ ctx: ctx.ctx, row: args.row, keyword, angle, count });

  let raw: string[];
  try {
    const res = await callClaudeJSON<{ titles: string[] }>({
      system: prompt,
      user: `Write the ${count} title tags now, each 50 to 60 characters, each carrying "${keyword}" in its first ${SEO_TITLE_KEYWORD_BY_WORD} words.`,
      model: MODEL,
      maxTokens: 2000,
      temperature: 0.8,
      timeoutMs: 120_000,
      schemaHint: '{ "titles": ["..."] }',
      validate: isTitles,
    });
    raw = res.data.titles;
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const seen = new Set<string>();
  const all = raw
    .map((t) => t.trim())
    .filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()));
  const faults = seoTitleFaults(all, 0, keyword);

  const bad = new Set(faults.map((f) => f.match(/^"(.+?)" (?:is|carries|does)/)?.[1]).filter((t): t is string => Boolean(t)));
  const kept = all.filter((t) => !bad.has(t));

  if (!kept.length) {
    return { ok: false, error: `every title was refused by the rules: ${faults.slice(0, 3).join("; ")}` };
  }

  return { ok: true, titles: kept.slice(0, count), dropped: faults };
}

/**
 * File them against the plan row.
 *
 * ‼️ origin = 'seo_title', WHICH IS WHAT KEEPS THEM OUT OF THE H1 PICKER. optionsFor filters
 * origin='keyword', so a title tag can never be offered as a page's H1. The origin CHECK
 * constraint must already allow this value: see docs/2026-10-08-page-headline-formats.sql.
 */
export async function storeSeoTitles(args: {
  clientId: string;
  planId: string;
  titles: readonly string[];
  audienceId?: string | null;
}): Promise<{ ok: true; stored: number } | { ok: false; error: string }> {
  const rows = args.titles
    .map((t) => t.trim())
    .filter(Boolean)
    .map((title) => ({
      client_id: args.clientId,
      headline: title,
      normalized: normalizeHeadline(title),
      origin: SEO_ORIGIN,
      used_page_id: args.planId,
      ...(args.audienceId ? { audience_id: args.audienceId } : {}),
    }));

  if (!rows.length) return { ok: true, stored: 0 };

  const { data, error } = await supabaseAdmin
    .from("client_headlines")
    .upsert(rows, { onConflict: "client_id,normalized", ignoreDuplicates: true })
    .select("id");

  if (error) {
    const hint = /client_headlines_origin_check/.test(error.message)
      ? " If this names client_headlines_origin_check, docs/2026-10-08-page-headline-formats.sql has not been run."
      : "";
    return { ok: false, error: `${error.message}.${hint}` };
  }

  return { ok: true, stored: (data ?? []).length };
}

/** The title tags on file for these plan rows, oldest first. */
export async function seoTitlesFor(
  clientId: string,
  planIds: readonly string[]
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const id of planIds) out.set(id, []);
  if (!planIds.length) return out;

  const { data, error } = await supabaseAdmin
    .from("client_headlines")
    .select("headline, used_page_id")
    .eq("client_id", clientId)
    .eq("origin", SEO_ORIGIN)
    .is("dropped_at", null)
    .in("used_page_id", planIds as string[])
    .order("created_at", { ascending: true });

  if (error) {
    console.error(`[page-seo-titles] read failed: ${error.message}`);
    return out;
  }

  for (const r of data ?? []) {
    const key = String(r.used_page_id);
    out.set(key, [...(out.get(key) ?? []), String(r.headline)]);
  }
  return out;
}

/** The title tag somebody chose for this page, or null. */
export async function approvedSeoTitleFor(clientId: string, planId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("client_headlines")
    .select("headline")
    .eq("client_id", clientId)
    .eq("origin", SEO_ORIGIN)
    .eq("used_page_id", planId)
    .eq("approved", true)
    .is("dropped_at", null)
    .order("approved_at", { ascending: false })
    .limit(1);

  if (error) {
    console.error(`[page-seo-titles] approved read failed: ${error.message}`);
    return null;
  }
  const row = (data ?? [])[0] as { headline?: string } | undefined;
  return row?.headline ? String(row.headline) : null;
}

/**
 * Take title tag `pick` (1-based) for one page.
 *
 * ‼️ THE SAME TWO-PART WRITE approveHeadlineForPage DOES, AND FOR THE SAME REASON. The choice is
 * recorded on the row (`approved`), which is what makes it queryable and what lets a title be
 * picked BEFORE the page row exists, which is the normal order: the formats stage runs ahead of
 * the skeleton, and the skeleton is what creates `client_pages`. Then, when a page row does
 * exist, the chosen line is copied onto `client_pages.title`, which is the actual title tag.
 *
 * ‼️ AND IT DOES NOT TOUCH THE SLUG. `startPageDraft` derives a page's URL from the working
 * title, and `pageSlug`'s own comment is that a slug "must not silently change for an existing
 * page": it is a public URL a crawler has indexed. A title tag is the line Google PRINTS, not
 * the address it fetched, so the two are deliberately not the same string.
 */
export async function approveSeoTitleFor(
  clientId: string,
  row: PlanRow,
  pick: number,
  by: string
): Promise<{ ok: true; title: string } | { ok: false; error: string }> {
  const options = (await seoTitlesFor(clientId, [row.id])).get(row.id) ?? [];
  const chosen = options[pick - 1];
  if (!chosen) {
    return {
      ok: false,
      error: options.length
        ? `page ${row.rank} has ${options.length} title tag${options.length === 1 ? "" : "s"}, so ${pick} is not one of them`
        : `page ${row.rank} has no title tags yet. \`page ${row.rank} more\` writes them.`,
    };
  }

  // One approved title per page: clear the siblings first, so a second pick replaces rather than
  // adds. The H1 lane gets this from used_page_id being single valued; here the page holds six.
  const cleared = await supabaseAdmin
    .from("client_headlines")
    .update({ approved: false, approved_at: null, approved_by: null })
    .eq("client_id", clientId)
    .eq("origin", SEO_ORIGIN)
    .eq("used_page_id", row.id);
  if (cleared.error) return { ok: false, error: cleared.error.message };

  const marked = await supabaseAdmin
    .from("client_headlines")
    .update({ approved: true, approved_at: new Date().toISOString(), approved_by: by })
    .eq("client_id", clientId)
    .eq("origin", SEO_ORIGIN)
    .eq("used_page_id", row.id)
    .eq("headline", chosen);
  if (marked.error) return { ok: false, error: marked.error.message };

  if (row.pageId) {
    const put = await supabaseAdmin
      .from("client_pages")
      .update({ title: chosen })
      .eq("id", row.pageId)
      .eq("client_id", clientId);
    if (put.error) {
      return { ok: false, error: `the pick was recorded but the page's title was not updated: ${put.error.message}` };
    }
  }

  return { ok: true, title: chosen };
}

/**
 * Put the chosen title tag onto a page row that has just been created.
 *
 * Called by `writeSkeletonsFor` right after `startPageDraft`, because the title is normally
 * picked before the page exists. A no-op when nothing was picked, and never fatal: a page with
 * its working title as the title tag is the behaviour every page had before this lane.
 */
export async function applyApprovedTitle(clientId: string, planId: string, pageId: string): Promise<void> {
  const title = await approvedSeoTitleFor(clientId, planId);
  if (!title) return;
  const { error } = await supabaseAdmin
    .from("client_pages")
    .update({ title })
    .eq("id", pageId)
    .eq("client_id", clientId);
  if (error) console.error(`[page-seo-titles] could not apply the chosen title to ${pageId}: ${error.message}`);
}

/** The card, as plain lines. No channel, no emoji: the caller decides where they go. */
export function seoTitleLines(row: PlanRow, titles: readonly string[]): string[] {
  if (!titles.length) {
    return [`Page ${row.rank} has no title tags yet.`];
  }
  const warnings = seoTitleWarnings(titles);
  return [
    `Title tags for page ${row.rank}, "${row.headline || row.workingTitle}".`,
    "This is what Google prints in a results list. The page keeps its own H1, which is the question an engine matches on.",
    "",
    ...titles.map((t, i) => `  ${i + 1}. ${t}  (${seoTitleLength(t)} chars)`),
    ...(warnings.length ? ["", ...warnings.map((w) => `  note: ${w}`)] : []),
  ];
}
