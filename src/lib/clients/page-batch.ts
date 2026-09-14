// One batch of pages, decided end to end before any research fires.
//
// ‼️ THE ORDER IS DECISION D3 AND IT IS THE WHOLE DESIGN: pillar, then a headline per page, then a
// skeleton per page, then ONE research for the batch, then draft them all. Every choice for every
// page is made BEFORE the research, which is what makes the research one shot. Reordering any of
// these turns 14 paste-backs a day into 98.
//
// ‼️ THE DRAFTING CHANNEL ASKS WHICH PILLAR, THE ONBOARDING CHANNEL NEVER DOES (D2). An onboarding
// always starts 1 pillar + 6 supports, so there is nothing to ask: runPreCallPlan keeps the
// behaviour it has. A later batch in the drafting channel may be supports under a pillar that
// already exists, so that one asks first.
//
// ‼️ NO STATE TABLE, AND THE STAGE IS DERIVED. A batch's stage is a question its own artifacts
// already answer: no headline on a plan row means the headline stage, no outline on its page means
// the skeleton stage, and so on. A stored stage is a second source of truth that goes stale the
// moment somebody edits a row on the board, and then the card and the database disagree about
// where the work is.

import { supabaseAdmin } from "@/lib/db";
import { loadPlan, type PlanRow } from "./page-plan";
import { readPageOutline, type PageOutline } from "@/lib/hub/pages";

/**
 * `batch`, `batch new`, `batch under 3`, `batch approve`.
 *
 * Anchored at both ends, like everything in the studio dispatch. "batch" alone is a word somebody
 * could dictate, so it is only a command as the WHOLE message.
 */
export const BATCH_COMMAND = /^batch(?:\s+(new|approve|under\s+[0-9]{1,2}))?$/i;

/** `headline 3 pick 2`, `headline 3 more`. */
export const HEADLINE_COMMAND = /^headline\s+([0-9]{1,2})\s+(?:pick\s+([0-9]{1,2})|(more))$/i;

/** `skeleton`, `skeleton 3 more`. */
export const SKELETON_COMMAND = /^skeleton(?:\s+([0-9]{1,2})\s+more)?$/i;

/** Where a batch has got to. Derived, never stored. */
export type BatchStage = "no_plan" | "headlines" | "skeletons" | "research" | "drafting" | "done";

export interface BatchState {
  stage: BatchStage;
  rows: PlanRow[];
  pillar: PlanRow | null;
  supports: PlanRow[];
  outlines: Map<string, PageOutline | null>;
  /** Plan rows with no headline yet. */
  needHeadline: PlanRow[];
  /** Plan rows with a headline and no skeleton. */
  needSkeleton: PlanRow[];
  /** Plan rows whose page has a body. */
  drafted: PlanRow[];
}

/**
 * The batch id, for the dataset.
 *
 * ‼️ IT IS THE PILLAR'S OWN PLAN ROW ID, NOT A NEW UUID, AND THAT IS DELIBERATE. A batch is
 * "a pillar and the supports under it", which page_plan.pillar_id already records. Minting a
 * separate id would need somewhere to store it, and a stored id is a second way of saying the
 * same thing that can disagree with the first. Everything in one batch shares this, which is all
 * page_dataset.batch_id is for.
 */
export function batchIdFor(state: BatchState): string | null {
  return state.pillar?.id ?? null;
}

/**
 * Read where the batch is from what exists.
 *
 * The rows are the pre-call plan: a row with a role, approved or claimed. That is the same filter
 * pre-call-pages.ts's approvedRows uses, deliberately, so the batch card and the drafter can never
 * disagree about which pages are in play.
 */
export async function readBatch(clientId: string): Promise<BatchState | { error: string }> {
  const plan = await loadPlan(clientId);
  if ("error" in plan) return { error: plan.error };

  const rows = plan.rows
    .filter((r) => r.role && (r.status === "approved" || r.status === "claimed"))
    .sort((a, b) => a.rank - b.rank);

  if (!rows.length) {
    return {
      stage: "no_plan",
      rows: [],
      pillar: null,
      supports: [],
      outlines: new Map(),
      needHeadline: [],
      needSkeleton: [],
      drafted: [],
    };
  }

  const outlines = new Map<string, PageOutline | null>();
  for (const row of rows) {
    outlines.set(row.id, row.pageId ? await readPageOutline(clientId, row.pageId) : null);
  }

  const headlines = await headlinesOnPlan(clientId, rows.map((r) => r.id));
  const bodies = await pagesWithBodies(clientId, rows.map((r) => r.pageId).filter((id): id is string => Boolean(id)));

  const needHeadline = rows.filter((r) => !headlines.get(r.id));
  const needSkeleton = rows.filter((r) => headlines.get(r.id) && !outlines.get(r.id));
  const drafted = rows.filter((r) => r.pageId && bodies.has(r.pageId));

  const stage: BatchStage = needHeadline.length
    ? "headlines"
    : needSkeleton.length
      ? "skeletons"
      : drafted.length === rows.length
        ? "done"
        : drafted.length
          ? "drafting"
          : "research";

  return {
    stage,
    rows,
    pillar: rows.find((r) => r.role === "pillar") ?? null,
    supports: rows.filter((r) => r.role === "support"),
    outlines,
    needHeadline,
    needSkeleton,
    drafted,
  };
}

/**
 * page_plan.headline per row.
 *
 * ‼️ ITS OWN SELECT, degrading to an empty map. Same blast-radius rule as everywhere else that
 * touches this column: PostgREST fails a whole select on one unknown column, and `headline` is
 * newer than the rest of page_plan. Without the 2026-09-12 migration this reports "no headlines
 * yet" rather than taking the batch card down.
 */
async function headlinesOnPlan(clientId: string, ids: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;

  const { data, error } = await supabaseAdmin
    .from("page_plan")
    .select("id, headline")
    .eq("client_id", clientId)
    .in("id", ids as string[]);

  if (error) {
    console.error(
      `[page-batch] headline read failed (${error.message}). If this names headline, ` +
        `docs/2026-09-12-client-headlines.sql has not been run.`
    );
    return out;
  }

  for (const row of data ?? []) {
    const h = ((row.headline as string | null) ?? "").trim();
    if (h) out.set(String(row.id), h);
  }
  return out;
}

async function pagesWithBodies(clientId: string, pageIds: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (!pageIds.length) return out;

  const { data, error } = await supabaseAdmin
    .from("client_pages")
    .select("id, answer_md")
    .eq("client_id", clientId)
    .in("id", pageIds as string[]);

  if (error) {
    console.error(`[page-batch] body read failed: ${error.message}`);
    return out;
  }

  for (const row of data ?? []) {
    if (((row.answer_md as string | null) ?? "").trim()) out.add(String(row.id));
  }
  return out;
}

/**
 * Pillars this client already has, for `batch under N`.
 *
 * A pillar is a plan row with role 'pillar'. It does not have to be published or even drafted:
 * page_plan.pillar_id is a pointer between plan rows, and the supports under a draft pillar are
 * perfectly plannable. What plan-links.ts refuses to do is LINK to an unpublished pillar, which is
 * a separate decision made at render time.
 */
export async function existingPillars(clientId: string): Promise<PlanRow[]> {
  const plan = await loadPlan(clientId);
  if ("error" in plan) return [];
  return plan.rows.filter((r) => r.role === "pillar").sort((a, b) => a.rank - b.rank);
}

// ─────────────────────────────────────────────────────────────────────────────
// The cards
//
// ‼️ ONE CARD FOR THE WHOLE BATCH, NUMBERED (D7). Seven cards is seven notifications for one
// decision, and the numbering is what makes `headline 3 pick 2` mean anything. The numbers are
// POSITIONAL against rank order, the same numbering buildBatchResearchPrompt's [Pn] tags use, so
// a person reading the card and a researcher reading the prompt are looking at the same page 3.
// ─────────────────────────────────────────────────────────────────────────────

export function pillarQuestionLines(pillars: readonly PlanRow[]): string[] {
  if (!pillars.length) {
    return [
      "*Starting a batch.* This client has no pillar yet, so this one starts a new one.",
      "`batch new` writes a pillar and six supports from the approved keywords.",
    ];
  }

  return [
    "*Starting a batch.* Is this a new pillar, or supports under one that exists?",
    "",
    ...pillars.map((p, i) => `  ${i + 1}. ${p.workingTitle || p.question}`),
    "",
    "`batch new` starts a new pillar with six supports.",
    "`batch under 1` puts this batch under the pillar numbered above.",
  ];
}

/** The headline card: every page, its three options, numbered. */
export function headlineCardLines(
  rows: readonly PlanRow[],
  options: ReadonlyMap<string, readonly string[]>
): string[] {
  const lines = [`*Headlines for ${rows.length} pages.* Pick one per page.`, ""];

  rows.forEach((row, i) => {
    const n = i + 1;
    lines.push(`*P${n}. ${row.workingTitle || row.question}*`);
    if (row.targetKeyword) lines.push(`_aimed at: ${row.targetKeyword}_`);
    const opts = options.get(row.id) ?? [];
    if (!opts.length) lines.push("  (none written yet)");
    else opts.forEach((h, j) => lines.push(`  ${j + 1}. ${h}`));
    lines.push("");
  });

  lines.push("`headline 3 pick 2` takes option 2 for page 3. `headline 3 more` writes three new ones.");
  return lines;
}

/** The skeleton card: every page, its headings and how many gaps it will ask about. */
export function skeletonCardLines(
  rows: readonly PlanRow[],
  outlines: ReadonlyMap<string, PageOutline | null>
): string[] {
  const lines = [`*Skeletons for ${rows.length} pages.*`, ""];
  let gaps = 0;

  rows.forEach((row, i) => {
    const outline = outlines.get(row.id) ?? null;
    lines.push(`*P${i + 1}. ${row.headline || row.workingTitle || row.question}*`);
    if (!outline) {
      lines.push("  (not written yet)");
    } else {
      outline.sections.forEach((s) => lines.push(`  ${s.heading}${s.keyword ? `  _${s.keyword}_` : ""}`));
      gaps += outline.gaps.length;
      lines.push(`  _${outline.sections.length} sections, ${outline.gaps.length} questions for the business_`);
    }
    lines.push("");
  });

  // ‼️ THE QUESTION COUNT BEFORE THE PROMPT IS RUN, not after the answer comes back. It is the
  // difference between pasting a prompt and knowing whether what returns is the right size.
  lines.push(`*${gaps} questions across ${rows.length} pages*, which is ONE research prompt.`);
  lines.push("`skeleton 3 more` rewrites page 3's. `batch approve` builds the prompt.");
  return lines;
}

/** Where the batch is, in one line, for the top of any card. */
export function stageLine(state: BatchState): string {
  switch (state.stage) {
    case "no_plan":
      return "No approved plan rows yet. `plan` proposes them and `plan approve` locks them in.";
    case "headlines":
      return `${state.needHeadline.length} of ${state.rows.length} pages still need a headline.`;
    case "skeletons":
      return `${state.needSkeleton.length} of ${state.rows.length} pages still need a skeleton.`;
    case "research":
      return `${state.rows.length} pages planned and outlined. \`batch approve\` builds the one research prompt.`;
    case "drafting":
      return `${state.drafted.length} of ${state.rows.length} pages drafted.`;
    case "done":
      return `All ${state.rows.length} pages drafted.`;
  }
}
