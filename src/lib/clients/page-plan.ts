// The page plan: which pages get written, decided before any of them is.
//
// Matthew, 2026-09-11: "I thought before writing the first page we needed to come together with
// the keywords strategy we needed for each client ... All of this needs to be selected and done
// before we start drafting pages, this way each page is done strategically and not just random for
// the specific keywords we want and the specific subject we want to bring value to."
//
// What existed: an offer, an avatar, a ranked keyword set, and a scored backlog of page
// candidates. What did not: any record of WHICH pages were chosen, with what keyword, for what
// purpose. The first persisted decision was a bare digit in a Slack thread, so a page was chosen
// by being typed at.
//
// So a plan row is the decision, made in one place, before drafting:
//   question        what the page answers, verbatim, from the market's own wording
//   target_keyword  one phrase from buildKeywordSet(), checked in code, never invented
//   working_title   how a person would say it
//   angle           the value it gives the reader, one line
//   magnet_frame    how this page frames the client's ANCHOR offer (for SRT, the AI visibility
//                   audit): its pill, its name, the line the widget opens with
//
// ‼️ CODE CHOOSES THE PAGES AND A MODEL ONLY WORDS THEM. selectPlan() is pure: it takes the ranked
// pool and spreads it across themes, so which twenty pages a client gets can be argued with and
// reproduced. The one model call writes the title, the angle and the framing for pages already
// chosen, and it may not pick a keyword that is not in the set. A model choosing the pages would
// re-choose them on every run and make the day 30 comparison meaningless, the same argument
// page-candidates.ts and keyword-set.ts make for their own rankings.

import { supabaseAdmin } from "@/lib/db";
import { callClaudeJSON } from "@/lib/claude-calls";
import { hasBannedDash } from "@/lib/copy-guard";
import { CTA_MAX, readFrame, type PlannedFrame } from "@/lib/concierge/magnet-drafts";
import { normalizePhrase, phraseFaults, type PhraseFault } from "./phrase-quality";
import { themeOf } from "./artifacts/page-candidates";

/** Matthew's number: "10-20 drafts for different pages on different subjects". The ceiling. */
export const PLAN_SIZE = 20;

/**
 * No theme may take more than this many of the twenty.
 *
 * ‼️ A SPREAD RULE, NOT A QUOTA. The backlog's own PDF tells the call to "pick from the top of
 * each theme rather than the top of the whole list, or every page ends up being the same kind of
 * page". Without a cap, SRT's twenty would be twenty objection pages, because objections carry the
 * second-largest term in the score.
 */
export const MAX_PER_THEME = 5;

export type PlanStatus = "proposed" | "approved" | "claimed";

export interface PoolItem {
  question: string;
  score: number;
  theme: string;
  origin: "harvested" | "derived";
}

export interface PlanRow {
  id: string;
  clientId: string;
  rank: number;
  question: string;
  targetKeyword: string;
  workingTitle: string;
  angle: string;
  theme: string;
  origin: "harvested" | "derived";
  frame: PlannedFrame | null;
  status: PlanStatus;
  pageId: string | null;
  /** Read through page_id from client_pages. Never stored on the plan row. */
  pageStatus: "draft" | "published" | "archived" | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure: what is plannable, and which twenty
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The faults that disqualify a DERIVED idea.
 *
 * ‼️ NOT THE FULL SET, AND "LeadXN compared: what each is better at" IS WHY. The full rules call
 * that a label (a colon early, no question mark) and a derived cost estimator too long, because
 * they were written for phrases a buyer typed. A derived idea is a page this system proposed, in
 * its own words, so only the faults that mean the text is broken apply to it.
 */
const DERIVED_FAULTS: readonly PhraseFault[] = ["url", "citation_marker", "arrow", "markup", "dangling"];

export function isPlannable(question: string, origin: "harvested" | "derived"): boolean {
  const faults = phraseFaults(question);
  if (origin === "derived") return !faults.some((f) => DERIVED_FAULTS.includes(f));
  return faults.length === 0;
}

/**
 * Pick the pages. Highest score first, at most maxPerTheme from any one theme, no two with the
 * same normal form, and nothing in `exclude`.
 *
 * ‼️ THE CAP IS A SPREAD RULE AND NOT A REASON TO SHIP A SHORT PLAN. When the spread pass cannot
 * fill every slot, because the market's wording really is concentrated in two themes, the rest is
 * filled in score order from what the cap held back. A twelve-page plan that obeyed the cap is
 * worse than a twenty-page plan that bent it, and the card prints the theme counts either way.
 */
export function selectPlan(
  pool: readonly PoolItem[],
  size: number = PLAN_SIZE,
  maxPerTheme: number = MAX_PER_THEME,
  exclude: ReadonlySet<string> = new Set()
): PoolItem[] {
  const sorted = [...pool].sort((a, b) => b.score - a.score || a.question.localeCompare(b.question));

  const seen = new Set<string>(exclude);
  const unique: PoolItem[] = [];
  for (const item of sorted) {
    if (!isPlannable(item.question, item.origin)) continue;
    const key = normalizePhrase(item.question);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }

  const picked: PoolItem[] = [];
  const perTheme = new Map<string, number>();
  const heldBack: PoolItem[] = [];

  for (const item of unique) {
    if (picked.length >= size) break;
    const n = perTheme.get(item.theme) ?? 0;
    if (n >= maxPerTheme) {
      heldBack.push(item);
      continue;
    }
    perTheme.set(item.theme, n + 1);
    picked.push(item);
  }

  for (const item of heldBack) {
    if (picked.length >= size) break;
    picked.push(item);
  }

  return picked;
}

/** How many of each theme a plan holds, for the line under the card. */
export function themeCounts(rows: ReadonlyArray<{ theme: string }>): string {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.theme, (counts.get(r.theme) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `${n} ${t}`)
    .join(", ");
}

// ─────────────────────────────────────────────────────────────────────────────
// The one model call: words for pages already chosen
// ─────────────────────────────────────────────────────────────────────────────

export interface FramedRow {
  workingTitle: string;
  angle: string;
  targetKeyword: string;
  frame: PlannedFrame;
}

interface FramedBatch {
  rows: FramedRow[];
}

export interface FrameContext {
  clientName: string;
  treatment: string;
  positioning: string | null;
  avatarLabel: string;
  anchor: { title: string; promise: string; ctaLabel: string | null };
  /** Every phrase a target keyword may be chosen from. */
  keywords: readonly string[];
}

const FRAME_SYSTEM = `You plan the pages on one business's website. The pages have already been chosen: each one
answers a question the business's buyers actually ask. You write, for each page, four things.

1. workingTitle. How a person would say the question, under 70 characters. Not the raw phrase.
2. angle. One sentence on what the reader walks away with. Useful, specific, no promise of results.
3. targetKeyword. The one phrase this page is aimed at, COPIED EXACTLY from the KEYWORDS list.
   Usually the page's own question if it is in the list; otherwise the closest phrase in the list.
   A phrase that is not in the list is rejected.
4. frame. How the business's ANCHOR OFFER is presented on this page. Every page on this site offers
   the same one free thing, the anchor, and the frame is the door into it that fits what the reader
   of THIS page is thinking about:
     - title: what the offer is called on this page
     - ctaLabel: the button, ${CTA_MAX} characters or fewer
     - conciergeEntry: the first thing the chat widget says, first person, ending by asking for the
       one thing it needs to begin
   The reader receives exactly what the anchor delivers. A frame may narrow the focus to the part of
   the anchor this page is about; it may never add a deliverable the anchor does not produce.

HARD RULES, and a batch breaking any of them is rejected whole:
- One entry per page, in the order given. Same count.
- NO em dashes, en dashes or double hyphens, in any field.
- No numbers that do not appear in the pages, the keywords or the anchor.
- No competitor named in a title, angle or frame.`;

const FRAME_SCHEMA = `{
  "rows": [
    {
      "workingTitle": string,
      "angle": string,
      "targetKeyword": string,
      "frame": { "title": string, "ctaLabel": string, "conciergeEntry": string }
    }
  ]
}`;

function numbersNotIn(text: string, haystack: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\$?\d[\d,]*(?:\.\d+)?%?/g)) {
    const bare = m[0].replace(/[,$%]/g, "");
    if (bare.length < 2) continue;
    if (!haystack.includes(bare)) out.push(m[0]);
  }
  return [...new Set(out)];
}

/**
 * Everything wrong with a framed batch, in words.
 *
 * Exported for the probe. `keywordSet` holds normal forms, so "How much does this cost?" and
 * "how much does this cost" are the same phrase, and the check is about the words rather than
 * the punctuation the model copied.
 */
export function frameFaults(
  v: unknown,
  count: number,
  keywordSet: ReadonlySet<string>,
  numberHaystack: string
): string[] {
  const out: string[] = [];
  const d = v as Partial<FramedBatch>;
  if (!Array.isArray(d?.rows)) return ['Return { "rows": [...] }.'];
  if (d.rows.length !== count) {
    out.push(`There are ${count} pages and you returned ${d.rows.length} rows. One per page, in order.`);
  }

  d.rows.forEach((r, i) => {
    const row = r as Partial<FramedRow>;
    const where = `row ${i + 1}`;
    const title = typeof row?.workingTitle === "string" ? row.workingTitle.trim() : "";
    const angle = typeof row?.angle === "string" ? row.angle.trim() : "";
    const keyword = typeof row?.targetKeyword === "string" ? row.targetKeyword.trim() : "";
    const frame = readFrame(row?.frame);

    if (!title) out.push(`${where} has no workingTitle.`);
    if (title.length > 70) out.push(`${where}'s workingTitle is ${title.length} characters. Keep it under 70.`);
    if (!angle) out.push(`${where} has no angle.`);
    if (angle.length > 220) out.push(`${where}'s angle is too long. One sentence.`);
    if (!keyword) out.push(`${where} has no targetKeyword.`);
    else if (!keywordSet.has(normalizePhrase(keyword))) {
      out.push(`${where}'s targetKeyword "${keyword}" is not in the KEYWORDS list. Copy one exactly.`);
    }

    if (!frame) {
      out.push(`${where}'s frame needs title, ctaLabel and conciergeEntry.`);
    } else if (frame.ctaLabel.length > CTA_MAX) {
      out.push(`${where}'s ctaLabel is ${frame.ctaLabel.length} characters, the limit is ${CTA_MAX}: "${frame.ctaLabel}"`);
    }

    const fields: Array<[string, string]> = [
      ["workingTitle", title],
      ["angle", angle],
      ["frame.title", frame?.title ?? ""],
      ["frame.ctaLabel", frame?.ctaLabel ?? ""],
      ["frame.conciergeEntry", frame?.conciergeEntry ?? ""],
    ];
    for (const [field, value] of fields) {
      if (value && hasBannedDash(value)) out.push(`${where}'s ${field} contains a dash.`);
      const orphans = numbersNotIn(value, numberHaystack);
      if (orphans.length) out.push(`${where}'s ${field} states ${orphans.join(", ")}, which appears nowhere it could come from.`);
    }
  });

  return out;
}

/** Word the chosen pages. Throws on a model failure; the caller says so in the thread. */
export async function framePages(pages: readonly PoolItem[], ctx: FrameContext): Promise<FramedRow[]> {
  const keywordSet = new Set(ctx.keywords.map(normalizePhrase));
  for (const p of pages) if (p.origin === "harvested") keywordSet.add(normalizePhrase(p.question));

  // The list the model is shown: every page's own question first (so "usually its own question"
  // is always available), then the ranked set.
  const shown = [...new Set([...pages.filter((p) => p.origin === "harvested").map((p) => p.question), ...ctx.keywords])];

  const numberHaystack = [
    ...pages.map((p) => p.question),
    ...shown,
    ctx.anchor.title,
    ctx.anchor.promise,
    ctx.positioning ?? "",
  ]
    .join(" ")
    .replace(/[,$]/g, "");

  const user = [
    `THE BUSINESS: ${ctx.clientName}`,
    `WHAT THEY SELL, which every page is aimed at: ${ctx.treatment}`,
    ctx.positioning ? `HOW THEY POSITION IT: ${ctx.positioning}` : "",
    `WHO THE PAGES ARE WRITTEN FOR: ${ctx.avatarLabel}`,
    "",
    "THE ANCHOR OFFER, the one free thing every page hands over:",
    `Name: ${ctx.anchor.title}`,
    `What it delivers: ${ctx.anchor.promise}`,
    `Its own pill: ${ctx.anchor.ctaLabel ?? ctx.anchor.title}`,
    "",
    "THE PAGES, in order:",
    ...pages.map((p, i) => `${i + 1}. [${p.theme}] ${p.question}`),
    "",
    "KEYWORDS, the only phrases a targetKeyword may be:",
    ...shown.map((k) => `- ${k}`),
  ]
    .filter((l) => l !== "")
    .join("\n");

  const res = await callClaudeJSON<FramedBatch>({
    model: "claude-sonnet-4-6",
    system: FRAME_SYSTEM,
    user,
    maxTokens: 6000,
    temperature: 0.3,
    schemaHint: FRAME_SCHEMA,
    validate: (v): v is FramedBatch => frameFaults(v, pages.length, keywordSet, numberHaystack).length === 0,
    describeInvalid: (v) =>
      `Fix these and return every row again:\n${frameFaults(v, pages.length, keywordSet, numberHaystack)
        .map((f) => `  - ${f}`)
        .join("\n")}`,
  });

  return res.data.rows.map((r) => ({
    workingTitle: r.workingTitle.trim(),
    angle: r.angle.trim(),
    targetKeyword: r.targetKeyword.trim(),
    frame: readFrame(r.frame) as PlannedFrame,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads and writes
// ─────────────────────────────────────────────────────────────────────────────

const PLAN_COLUMNS =
  "id, client_id, rank, question, target_keyword, working_title, angle, theme, origin, magnet_frame, status, page_id";

function toPlanRow(r: Record<string, unknown>): PlanRow {
  const status = r.status === "approved" || r.status === "claimed" ? r.status : "proposed";
  return {
    id: String(r.id),
    clientId: String(r.client_id),
    rank: Number(r.rank ?? 0),
    question: String(r.question ?? ""),
    targetKeyword: String(r.target_keyword ?? ""),
    workingTitle: String(r.working_title ?? ""),
    angle: String(r.angle ?? ""),
    theme: String(r.theme ?? "General"),
    origin: r.origin === "derived" ? "derived" : "harvested",
    frame: readFrame(r.magnet_frame),
    status,
    pageId: (r.page_id as string | null) ?? null,
    pageStatus: null,
  };
}

/**
 * The plan, in rank order, with each page's live status read through page_id.
 *
 * ‼️ A READ FAILURE IS RETURNED, NOT SWALLOWED INTO AN EMPTY PLAN. "No plan" and "the table is not
 * there" send somebody to two different places, and the second one is what happens between a
 * deploy and docs/2026-09-11-page-plan.sql being run.
 */
export async function loadPlan(clientId: string): Promise<{ rows: PlanRow[] } | { error: string }> {
  const { data, error } = await supabaseAdmin
    .from("page_plan")
    .select(PLAN_COLUMNS)
    .eq("client_id", clientId)
    .order("rank", { ascending: true });

  if (error) {
    return {
      error:
        `the page plan could not be read (${error.message}). If that names page_plan, ` +
        `docs/2026-09-11-page-plan.sql has not been run on this database.`,
    };
  }

  const rows = ((data ?? []) as Array<Record<string, unknown>>).map(toPlanRow);
  const pageIds = rows.map((r) => r.pageId).filter((id): id is string => Boolean(id));

  if (pageIds.length) {
    const { data: pages } = await supabaseAdmin
      .from("client_pages")
      .select("id, status")
      .in("id", pageIds);
    const byId = new Map(((pages ?? []) as Array<Record<string, unknown>>).map((p) => [String(p.id), p.status as string]));
    for (const r of rows) {
      const s = r.pageId ? byId.get(r.pageId) : undefined;
      r.pageStatus = s === "draft" || s === "published" || s === "archived" ? s : null;
    }
  }

  return { rows };
}

/** The rows a digit may claim: approved or already claimed, in rank order. */
export function claimableRows(rows: readonly PlanRow[]): PlanRow[] {
  return rows.filter((r) => r.status === "approved" || r.status === "claimed");
}

/** Everything a plan is built from, read once. */
export interface PlanInputs {
  pool: PoolItem[];
  keywords: string[];
}

/**
 * The pool: the ranked keyword set, plus the derived ideas from step 14.
 *
 * ‼️ THE KEYWORD SET IS THE SPINE, NOT page_candidates. It already merges the market corpus, the
 * audit's measured questions and the per-client backlog, filtered for debris, deduped on one
 * normal form and ranked with the offer bonus. Reading page_candidates straight is how the studio
 * menu ended up offering "Why: Vendor lock-in fear" as a page.
 */
export async function planInputs(clientId: string): Promise<PlanInputs | { error: string }> {
  const { buildKeywordSet } = await import("./keyword-set");
  const set = await buildKeywordSet(clientId);
  if ("error" in set) return { error: set.error };

  const pool: PoolItem[] = set.rows.map((r) => ({
    question: r.phrase,
    score: r.score,
    theme: r.theme,
    origin: "harvested" as const,
  }));

  const { data: derived } = await supabaseAdmin
    .from("page_candidates")
    .select("question, score")
    .eq("client_id", clientId)
    .eq("origin", "derived");

  for (const d of (derived ?? []) as Array<Record<string, unknown>>) {
    const question = String(d.question ?? "").trim();
    if (!question) continue;
    pool.push({ question, score: Number(d.score ?? 0), theme: themeOf(question), origin: "derived" });
  }

  return { pool, keywords: set.rows.map((r) => r.phrase) };
}

/** Questions that already have a page, in normal form, so a plan does not propose them twice. */
async function existingPageQuestions(clientId: string): Promise<Set<string>> {
  const { data } = await supabaseAdmin
    .from("client_pages")
    .select("question")
    .eq("client_id", clientId)
    .neq("status", "archived");
  return new Set(((data ?? []) as Array<Record<string, unknown>>).map((p) => normalizePhrase(String(p.question ?? ""))));
}

/**
 * Propose a plan, or top an existing one back up to PLAN_SIZE.
 *
 * ‼️ APPROVED AND CLAIMED ROWS ARE KEPT, ONLY PROPOSED ONES ARE REPLACED. `plan new` is "give me
 * different suggestions", not "forget what I decided". A claimed row has a page being written
 * against it, and deleting it would orphan that page from the plan it came from.
 */
export async function proposePlan(
  clientId: string,
  ctx: Omit<FrameContext, "keywords">
): Promise<{ ok: true; rows: PlanRow[]; added: number } | { ok: false; error: string }> {
  const current = await loadPlan(clientId);
  if ("error" in current) return { ok: false, error: current.error };

  const kept = current.rows.filter((r) => r.status !== "proposed");
  const inputs = await planInputs(clientId);
  if ("error" in inputs) return { ok: false, error: inputs.error };

  const exclude = await existingPageQuestions(clientId);
  for (const r of kept) exclude.add(normalizePhrase(r.question));

  const need = Math.max(0, PLAN_SIZE - kept.length);
  const chosen = selectPlan(inputs.pool, need, MAX_PER_THEME, exclude);

  if (chosen.length === 0 && kept.length === 0) {
    return {
      ok: false,
      error:
        "there is nothing usable to plan from. The keyword set came back empty after the quality " +
        "filter, which means the phrase harvest has not produced anything a buyer typed yet.",
    };
  }

  let framed: FramedRow[] = [];
  if (chosen.length) {
    try {
      framed = await framePages(chosen, { ...ctx, keywords: inputs.keywords });
    } catch (e) {
      return { ok: false, error: `the pages were chosen but could not be worded: ${(e as Error).message}` };
    }
  }

  // Delete the old proposals only AFTER the new ones exist in memory, so a failed model call
  // leaves the previous plan on screen rather than an empty one.
  const { error: delError } = await supabaseAdmin
    .from("page_plan")
    .delete()
    .eq("client_id", clientId)
    .eq("status", "proposed");
  if (delError) return { ok: false, error: delError.message };

  const now = new Date().toISOString();
  if (chosen.length) {
    const { error: insError } = await supabaseAdmin.from("page_plan").insert(
      chosen.map((c, i) => ({
        client_id: clientId,
        rank: kept.length + i + 1,
        question: c.question,
        target_keyword: framed[i].targetKeyword,
        working_title: framed[i].workingTitle,
        angle: framed[i].angle,
        theme: c.theme,
        origin: c.origin,
        magnet_frame: framed[i].frame,
        status: "proposed",
        updated_at: now,
      }))
    );
    if (insError) return { ok: false, error: insError.message };
  }

  await rerank(clientId);
  const after = await loadPlan(clientId);
  if ("error" in after) return { ok: false, error: after.error };
  return { ok: true, rows: after.rows, added: chosen.length };
}

/** Close the gaps in rank after a drop, keeping the order. */
async function rerank(clientId: string): Promise<void> {
  const current = await loadPlan(clientId);
  if ("error" in current) return;
  for (const [i, row] of current.rows.entries()) {
    if (row.rank === i + 1) continue;
    await supabaseAdmin.from("page_plan").update({ rank: i + 1 }).eq("id", row.id);
  }
}

export async function approvePlan(
  clientId: string,
  by: string
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const { data, error } = await supabaseAdmin
    .from("page_plan")
    .update({ status: "approved", approved_at: new Date().toISOString(), approved_by: by, updated_at: new Date().toISOString() })
    .eq("client_id", clientId)
    .eq("status", "proposed")
    .select("id");

  if (error) return { ok: false, error: error.message };
  return { ok: true, count: (data ?? []).length };
}

async function rowAtRank(clientId: string, rank: number): Promise<PlanRow | { error: string }> {
  const current = await loadPlan(clientId);
  if ("error" in current) return { error: current.error };
  const row = current.rows.find((r) => r.rank === rank);
  if (!row) return { error: `there is no page ${rank} in the plan. It has ${current.rows.length}.` };
  return row;
}

export async function dropPlanRow(clientId: string, rank: number): Promise<{ ok: true; dropped: PlanRow } | { ok: false; error: string }> {
  const row = await rowAtRank(clientId, rank);
  if ("error" in row) return { ok: false, error: row.error };
  if (row.status === "claimed") {
    return { ok: false, error: `page ${rank} is already being written. Archive the draft on the board instead.` };
  }
  const { error } = await supabaseAdmin.from("page_plan").delete().eq("id", row.id);
  if (error) return { ok: false, error: error.message };
  await rerank(clientId);
  return { ok: true, dropped: row };
}

/**
 * Replace one row with the next best page, same theme when there is one.
 *
 * The replacement goes back to `proposed` even when the row it replaced was approved: a different
 * page is a different decision, and approving it is a separate act.
 */
export async function swapPlanRow(
  clientId: string,
  rank: number,
  ctx: Omit<FrameContext, "keywords">
): Promise<{ ok: true; row: PlanRow; replaced: string } | { ok: false; error: string }> {
  const row = await rowAtRank(clientId, rank);
  if ("error" in row) return { ok: false, error: row.error };
  if (row.status === "claimed") {
    return { ok: false, error: `page ${rank} is already being written, so it cannot be swapped out.` };
  }

  const current = await loadPlan(clientId);
  if ("error" in current) return { ok: false, error: current.error };
  const inputs = await planInputs(clientId);
  if ("error" in inputs) return { ok: false, error: inputs.error };

  const exclude = await existingPageQuestions(clientId);
  for (const r of current.rows) exclude.add(normalizePhrase(r.question));

  const sameTheme = selectPlan(inputs.pool.filter((p) => p.theme === row.theme), 1, 1, exclude);
  const next = sameTheme[0] ?? selectPlan(inputs.pool, 1, 1, exclude)[0];
  if (!next) return { ok: false, error: "there is nothing left in the keyword set that is not already planned." };

  let framed: FramedRow;
  try {
    [framed] = await framePages([next], { ...ctx, keywords: inputs.keywords });
  } catch (e) {
    return { ok: false, error: `the replacement was chosen but could not be worded: ${(e as Error).message}` };
  }

  const { error } = await supabaseAdmin
    .from("page_plan")
    .update({
      question: next.question,
      target_keyword: framed.targetKeyword,
      working_title: framed.workingTitle,
      angle: framed.angle,
      theme: next.theme,
      origin: next.origin,
      magnet_frame: framed.frame,
      status: "proposed",
      approved_at: null,
      approved_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);

  if (error) return { ok: false, error: error.message };

  const after = await rowAtRank(clientId, rank);
  if ("error" in after) return { ok: false, error: after.error };
  return { ok: true, row: after, replaced: row.workingTitle };
}

export async function editPlanTitle(
  clientId: string,
  rank: number,
  title: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const clean = title.trim();
  if (!clean) return { ok: false, error: "that title is empty." };
  if (clean.length > 70) return { ok: false, error: `that title is ${clean.length} characters. Keep it under 70.` };
  if (hasBannedDash(clean)) return { ok: false, error: "that title has a dash in it. Use a comma or a period." };

  const row = await rowAtRank(clientId, rank);
  if ("error" in row) return { ok: false, error: row.error };

  const { error } = await supabaseAdmin
    .from("page_plan")
    .update({ working_title: clean, updated_at: new Date().toISOString() })
    .eq("id", row.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** A digit claimed this row. Records which page it became. */
export async function markClaimed(planId: string, pageId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("page_plan")
    .update({ status: "claimed", page_id: pageId, updated_at: new Date().toISOString() })
    .eq("id", planId);
  if (error) console.error(`[page-plan] claim not recorded: ${error.message}`);
}

/** The plan row a page came from, for the outline. Null when it did not come off a plan. */
export async function planRowForPage(clientId: string, pageId: string): Promise<PlanRow | null> {
  const { data, error } = await supabaseAdmin
    .from("page_plan")
    .select(PLAN_COLUMNS)
    .eq("client_id", clientId)
    .eq("page_id", pageId)
    .maybeSingle();
  if (error || !data) return null;
  return toPlanRow(data as Record<string, unknown>);
}

// ─────────────────────────────────────────────────────────────────────────────
// The card
// ─────────────────────────────────────────────────────────────────────────────

function statusMark(row: PlanRow): string {
  if (row.pageStatus === "published") return "  `[published]`";
  if (row.status === "claimed") return "  `[drafting]`";
  if (row.status === "proposed") return "  _(proposed)_";
  return "";
}

/** The plan as Slack reads it. Pure, so the probe can check it carries no dash. */
export function formatPlan(rows: readonly PlanRow[], anchorTitle: string | null): string {
  if (rows.length === 0) return "No page plan yet. `plan` proposes one.";

  const proposed = rows.filter((r) => r.status === "proposed").length;
  const lines: string[] = [
    `*Page plan, ${rows.length} page${rows.length === 1 ? "" : "s"}.*` +
      (proposed ? ` ${proposed} proposed and waiting on \`plan approve\`.` : " All approved."),
    anchorTitle ? `_Every page's magnet is a framing of *${anchorTitle}*._` : "",
    `_Spread: ${themeCounts(rows)}._`,
    "",
  ];

  for (const r of rows) {
    lines.push(`*${r.rank}.* ${r.workingTitle}${statusMark(r)}  _(${r.theme})_`);
    lines.push(`      Keyword: \`${r.targetKeyword}\``);
    lines.push(`      ${r.angle}`);
    if (r.frame) lines.push(`      Pill: "${r.frame.ctaLabel}", ${r.frame.title}`);
  }

  lines.push(
    "",
    "`plan approve` locks the proposed pages in. `plan drop 4` removes one, `plan swap 4` replaces it " +
      "with the next best page in the same theme, `plan edit 4: <title>` renames it, `plan new` " +
      "re-proposes everything not yet approved."
  );

  return lines.filter((l, i, all) => !(l === "" && all[i - 1] === "")).join("\n");
}
