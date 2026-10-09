// The ad headline for a page, which is not the page's H1.
//
// Matthew, 2026-10-07, looking at the headline card for a planned page: "im not sure how we are
// currently getting the headlines, but i did some stuff in a project i have in claude code so I
// basically just asked it to create headlines for this keywords based on X context from a project,
// lets make sure the next time we ask for headlines we use those parameters". The favourites he
// pasted were "Stop Paying Meta to Send You Ghosts" and "Agencies Sell You Clicks. ChatGPT Sends
// You Patients. Only One of Them Gets Paid Whether You Grow or Not."
//
// ‼️ THOSE ARE NOT H1s AND THE PAGE LANE IS RIGHT TO REFUSE THEM. isQueryShaped in
// client-headlines.ts rejects anything that is not a question or a first-person confession, and
// that rule is his own: _probe-aeo-headlines.ts carries twenty of his headlines as the GOOD
// fixture and his DON'T column as BAD, every one of which dies on exactly this shape. The H1 has
// to read like the thing a patient types into ChatGPT, because being the page an engine cites
// when she types it is the entire mechanism the lane sells. Replacing it with an ad headline
// would win the card and lose the product.
//
// ‼️ SO THIS IS A SECOND ARTIFACT PER PAGE, NOT A REPLACEMENT, AND THE TWO HAVE DIFFERENT JOBS.
// The H1 gets her to the page from an engine. These get her to the page from an ad, an
// advertorial or a VSL, which is the traffic the page cannot generate for itself. One page, two
// headlines, neither trying to do the other's job.
//
// ‼️ THE ENGINE WAS ALREADY IN THIS REPO AND WAS SIMPLY UNREACHABLE FROM A PAGE.
// src/data/reel/dr-headline-engine.ts was distilled from the three documents he supplied ("THE
// DIRECT RESPONSE HEADLINE ENGINE" and its seven laws, "100 Greatest Headlines Ever Used", and
// Halbert's "349 Great Headlines"), and until now its only callers were the reel drop channel and
// the sales letter. Nothing here re-authors it: a second copy of those laws is two sets of laws
// that drift. See src/config/guideline-rules.ts for why the RULES and never the CORPUS go in a
// prompt.

import { supabaseAdmin } from "@/lib/db";
import { callClaudeJSON } from "@/lib/claude-calls";
import { hasBannedDash } from "@/lib/copy-guard";
import { loadDrHeadlineEngine } from "@/data/reel/dr-headline-engine";
import { approvedNumbersBlock } from "@/lib/reel/creative-director";
import { vocBlock } from "@/lib/reel/voc-quotes";
import { headlineContext, normalizeHeadline, type HeadlineContext } from "./client-headlines";
import type { PlanRow } from "./page-plan";

const MODEL = "claude-sonnet-4-6" as const;

/**
 * Twenty, which is the number his own prompt asks for and the number the angle menu is sized to.
 *
 * ‼️ NOT THREE. Three is the right count for an H1, where the three are candidates for ONE slot
 * and a person picks one. These are a bank: twenty hooks for one page, used across ads over
 * weeks, and picking one would throw away nineteen he paid for.
 */
export const DR_HEADLINES_PER_PAGE = 20;

/** What a page's ad headlines are stored as. Separate origin so optionsFor can never see them. */
export const DR_ORIGIN = "dr_ad" as const;

export interface DrHeadlineRow {
  id: string;
  headline: string;
  planId: string | null;
}

/**
 * Everything wrong with a batch of ad headlines, in words.
 *
 * ‼️ DELIBERATELY NOT headlineFaults, AND THE DIFFERENCE IS THE WHOLE POINT OF THIS FILE.
 * headlineFaults enforces isQueryShaped, which would reject every line this engine is built to
 * produce. What carries over is only what is true of any copy we publish: no invented figures, no
 * em dash, and no two headlines opening the same way more than twice.
 *
 * Pure, so the probe can prove it offline.
 */
export function drHeadlineFaults(
  headlines: readonly string[],
  /**
   * How many were asked for, or 0 to not check the count.
   *
   * ‼️ THE SAME ORDER AS headlineFaults, DELIBERATELY. These two are read side by side and
   * swapping the arguments between siblings is how a haystack gets passed as a count. The
   * compiler catches it here only because one is a string and the other a number, which is luck
   * rather than design.
   */
  count = 0,
  numberHaystack = ""
): string[] {
  const out: string[] = [];
  if (count > 0 && headlines.length !== count) {
    out.push(`expected ${count} headlines and got ${headlines.length}`);
  }

  for (const h of headlines) {
    if (hasBannedDash(h)) {
      out.push(`"${h}" carries an em dash, en dash or double hyphen`);
      continue;
    }
    // ‼️ THE SAME NUMBER RULE THE H1 KEEPS, AND IT IS THE ONE RULE THAT MUST NOT RELAX HERE.
    // Law 4 of the engine asks for unusual numbers, which is exactly the instruction that invents
    // "47% of patients" if nothing holds it. A figure is allowed only when it was given.
    const figures = h.match(/\d[\d,.]{1,}/g) ?? [];
    for (const raw of figures) {
      const digits = raw.replace(/[^\d]/g, "");
      if (digits.length < 2) continue;
      if (/^(?:19|20)\d{2}$/.test(digits)) continue;
      if (!numberHaystack.includes(digits)) {
        out.push(`"${h}" carries the figure ${raw}, which nothing you were given says`);
        break;
      }
    }
  }

  // Rule: never the same structure more than twice. Counted on the first three words, which is
  // what the reel lane counts and what a reader actually notices.
  const openings = new Map<string, number>();
  for (const h of headlines) {
    const key = h.trim().toLowerCase().split(/\s+/).slice(0, 3).join(" ");
    if (!key) continue;
    openings.set(key, (openings.get(key) ?? 0) + 1);
  }
  for (const [opening, n] of openings) {
    if (n > 2) out.push(`"${opening}" opens ${n} headlines, and the engine allows two`);
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
    // A missing page_angles table costs this prompt a block, never the run. Same posture
    // page-batch.ts keeps for the angle gate.
    return null;
  }
}

/**
 * The prompt. Exported so the probe can assert what reaches the model with no network call.
 *
 * ‼️ THE ENGINE GOES IN LAST AND WHOLE. Everything above it is this client's own material, which
 * is the more specific thing and is what stops twenty headlines that could run for any med spa in
 * America. The engine is the method; the blocks above are the only facts it may use.
 */
export function drHeadlinePrompt(args: {
  ctx: HeadlineContext;
  row: PlanRow;
  angle: { idea: string; indoctrination: string | null; narrative: string | null } | null;
  count: number;
}): string {
  const { ctx, row, angle, count } = args;
  const who = [ctx.businessType, ctx.city ? `in ${ctx.city}` : null].filter(Boolean).join(" ");

  return [
    `You are an elite direct-response copywriter working for ${ctx.clientName}${who ? `, ${who}` : ""}.`,
    `Write exactly ${count} high-converting DIRECT-RESPONSE headlines for the buyer below.`,
    "",
    "These open an advertorial, a VSL or a paid ad. They are the headlines that get her to the",
    "page. They are NOT the page's own H1 and they are NOT social captions. The H1 is a question",
    "she types into ChatGPT; these are the sentence that stops her scrolling past it.",
    "",
    "THE BUYER, AND EVERY HEADLINE IS ADDRESSED TO HER:",
    `- ${ctx.avatarLabel}`,
    ctx.buyer ? `- She is a ${ctx.buyer}` : "",
    ctx.treatment ? `- What they sell: ${ctx.treatment}` : "",
    ctx.positioning ? `- How they position it: ${ctx.positioning}` : "",
    "",
    // ‼️ THE PAGE IS THE BRIEF, AND WITHOUT IT THESE ARE TWENTY HEADLINES ABOUT THE BUSINESS.
    // Twenty per page only means something if each set is about THAT page's argument; otherwise
    // eleven pages get eleven copies of the same twenty with the keyword swapped.
    "THE ONE PAGE THESE HEADLINES SEND HER TO:",
    `- What she searched to get there: ${row.targetKeyword}`,
    `- The page's own H1, which is her question: ${row.headline || row.workingTitle}`,
    angle ? `- What the page ARGUES, and every headline must be an entrance to THIS argument: ${angle.idea}` : "",
    angle?.indoctrination ? `- The belief it installs: ${angle.indoctrination}` : "",
    angle?.narrative ? `- The story it runs on: ${angle.narrative}` : "",
    !angle
      ? "- Nobody has decided what this page argues yet, so write to the search and the buyer alone."
      : "",
    "",
    ...(ctx.avatarNotes?.length
      ? ["WHAT HER AVATAR SHEET SAYS SHE LIVES WITH. Write to THIS person, in these words:", ...ctx.avatarNotes.map((n) => `- ${n}`), ""]
      : []),
    ...(ctx.beliefs?.length
      ? ["WHAT THE PAGE WILL LEAD HER TO BELIEVE. Do not state these; open the doubt each one answers:", ...ctx.beliefs.map((b) => `- ${b}`), ""]
      : []),
    vocBlock({ voc_quotes: ctx.quotes }) ||
      "NO CUSTOMER QUOTES ARE ON FILE. Write from the buyer, the page and the offer alone, and keep every headline in her plain spoken words rather than the industry's.",
    "",
    approvedNumbersBlock({ approved_numbers: ctx.approvedNumbers }),
    "",
    loadDrHeadlineEngine(),
  ]
    .filter(Boolean)
    .join("\n");
}

function isHeadlines(v: unknown): v is { headlines: string[] } {
  const d = v as { headlines?: unknown };
  return Array.isArray(d?.headlines) && d.headlines.every((h) => typeof h === "string");
}

/**
 * Twenty ad headlines for ONE page, written from its angle and stored against its plan row.
 *
 * ‼️ THE BATCH IS FILTERED, NOT REFUSED, the rule precall-headlines.ts states at thirty three:
 * one invented figure must not throw away the other nineteen and make a person wait twice for
 * nothing. The faults are reported with what survived.
 */
export async function generateDrHeadlinesForPage(args: {
  clientId: string;
  row: PlanRow;
  count?: number;
}): Promise<
  | { ok: true; headlines: string[]; dropped: string[] }
  | { ok: false; error: string }
> {
  const count = args.count ?? DR_HEADLINES_PER_PAGE;

  const ctx = await headlineContext(args.clientId);
  if (!ctx.ok) return { ok: false, error: ctx.error };

  const angle = await angleFor(args.clientId, args.row.id);
  const prompt = drHeadlinePrompt({ ctx: ctx.ctx, row: args.row, angle, count });

  // ‼️ callClaudeJSON THROWS, it does not return a union. Same shape precall-headlines.ts uses.
  let raw: string[];
  try {
    const res = await callClaudeJSON<{ headlines: string[] }>({
      system: prompt,
      user: `Write the ${count} headlines now.`,
      model: MODEL,
      maxTokens: 4000,
      // Higher than the H1 lane's: twenty headlines across thirty angles is the whole ask, and a
      // set that converges is the failure the engine's own rule 5 names.
      temperature: 0.95,
      timeoutMs: 180_000,
      schemaHint: '{ "headlines": ["..."] }',
      validate: isHeadlines,
    });
    raw = res.data.headlines;
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const haystack = ctx.ctx.approvedNumbers.join(" ") + " " + ctx.ctx.quotes.map((q) => q.text).join(" ");
  const all = raw.map((h) => h.trim()).filter(Boolean);
  const faults = drHeadlineFaults(all, 0, haystack);

  // Drop the individual lines a fault named, keep the rest. A count fault and an opening fault
  // name no single headline, so they are reported without costing anything.
  const bad = new Set(
    faults.map((f) => f.match(/^"(.+?)" carries/)?.[1]).filter((h): h is string => Boolean(h))
  );
  const kept = all.filter((h) => !bad.has(h));

  if (!kept.length) {
    return { ok: false, error: `every headline was refused by the rules: ${faults.slice(0, 3).join("; ")}` };
  }

  return { ok: true, headlines: kept, dropped: faults };
}

/**
 * File them against the plan row.
 *
 * ‼️ origin = 'dr_ad', WHICH IS WHAT KEEPS THEM OUT OF THE H1 PICKER. optionsFor filters
 * origin='keyword', pickHeadlineFor reads that list, and client_headlines carries a unique index
 * on (client_id, normalized) so a line already on file is skipped rather than duplicated. The
 * origin CHECK constraint must already allow this value: see docs/2026-10-07-dr-ad-headlines.sql.
 */
export async function storeDrHeadlines(args: {
  clientId: string;
  planId: string;
  headlines: readonly string[];
  audienceId?: string | null;
}): Promise<{ ok: true; stored: number } | { ok: false; error: string }> {
  const rows = args.headlines
    .map((h) => h.trim())
    .filter(Boolean)
    .map((headline) => ({
      client_id: args.clientId,
      headline,
      normalized: normalizeHeadline(headline),
      origin: DR_ORIGIN,
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
      ? " If this names client_headlines_origin_check, docs/2026-10-07-dr-ad-headlines.sql has not been run."
      : "";
    return { ok: false, error: `${error.message}.${hint}` };
  }

  return { ok: true, stored: (data ?? []).length };
}

/** The ad headlines on file for these plan rows, oldest first. */
export async function drHeadlinesFor(
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
    .eq("origin", DR_ORIGIN)
    .is("dropped_at", null)
    .in("used_page_id", planIds as string[])
    .order("created_at", { ascending: true });

  if (error) {
    // Its own select with a declared blast radius, same rule anglesOnPlan keeps: a failed read
    // costs the card its ad headlines and nothing else.
    console.error(`[page-dr-headlines] read failed: ${error.message}`);
    return out;
  }

  for (const r of data ?? []) {
    const key = String(r.used_page_id);
    out.set(key, [...(out.get(key) ?? []), String(r.headline)]);
  }
  return out;
}

/** The card, as plain lines. No channel, no emoji: the caller decides where they go. */
export function drHeadlineLines(row: PlanRow, headlines: readonly string[]): string[] {
  if (!headlines.length) {
    return [`Page ${row.rank} has no ad headlines yet.`];
  }
  return [
    `Ad headlines for page ${row.rank}, "${row.headline || row.workingTitle}".`,
    "These open an ad, an advertorial or a VSL. The page keeps its own H1, which is the question an engine matches on.",
    "",
    ...headlines.map((h, i) => `  ${i + 1}. ${h}`),
    "",
    "They are a bank rather than a shortlist, so there is nothing to pick: use the one that suits the ad.",
  ];
}
