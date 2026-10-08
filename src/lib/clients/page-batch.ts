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
import { storyCardLines } from "@/lib/hub/page-stories";

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

/**
 * `page 3`, `page 3 more`, `page 3 pick 2`, `page 3 draft`, `page 3 check`, `page 3 ads`.
 *
 * ONE page through its own stages, rather than the whole batch through one. The verbs above are
 * every decision a page needs, and which one a bare `page 3` answers is worked out from what that
 * page already has, so there is nothing to remember and no order to keep the pages in.
 *
 * ‼️ ANCHORED AT BOTH ENDS, AND "page" ALONE IS NOT A COMMAND. Same rule BATCH_COMMAND states:
 * these threads take dictation, research pastes and call notes, and "page" is a word somebody says
 * in a sentence. The digit is required.
 *
 * ‼️ IT ADDRESSES BY RANK, WHICH IS NOT WHAT `headline 3 pick 2` DOES, AND THE DIFFERENCE IS
 * DELIBERATE. See the banner above pageAtRank: the older per-page verbs index POSITION over the
 * approved rows and this one indexes the RANK the plan card prints. Rank is what every typed verb
 * outside this file already means (`plan drop 4`, `cta 3:`, the launch chat's own actions), and it
 * is the only one of the two that cannot silently name a different page after a swap.
 */
export const PAGE_WALK_COMMAND =
  /^\s*[`*_]*page\s+([0-9]{1,2})(?:\s+(?:title\s+(pick)\s+([0-9]{1,2})|(pick)\s+([0-9]{1,2})|(more|draft|check|ads|title)))?[`*_]*\s*$/i;

export type PageWalkCommand =
  | { page: number; verb: "show" | "more" | "draft" | "check" | "ads" | "title" }
  | { page: number; verb: "pick"; option: number }
  | { page: number; verb: "title_pick"; option: number };

/**
 * Read one of the page verbs, or null.
 *
 * ‼️ NULL FOR A BARE DIGIT, AND THAT IS LOAD-BEARING RATHER THAN AN OMISSION. page-studio.ts
 * records what a bare digit cost the last time one was claimed: "1" typed under five numbered
 * offers was filed as the page body, verbatim. parseAngleCommand refuses a bare number for the
 * same reason and _probe-page-angles.ts pins it. In the chat a model resolves "1" against the
 * transcript and sends an explicit rank; here the person types the page.
 *
 * ‼️ `title pick N` IS MATCHED BEFORE `pick N`, AND THE ORDER IS THE CORRECTNESS. Two artifacts
 * on one page are now pickable, the H1 and the title tag, so an unqualified `pick` has to keep
 * meaning the H1: that is what every card, every earlier thread and page-studio.ts already
 * teaches. Reversing the two alternatives would make `page 3 title pick 2` parse as the H1 pick
 * with a stray word, which is the class of bug that files one answer against another question.
 */
export function parsePageWalk(text: string): PageWalkCommand | null {
  const m = PAGE_WALK_COMMAND.exec(text);
  if (!m) return null;

  const page = Number(m[1]);
  // A page is addressed by rank and rank is 1-based, so zero names nothing. Refused here rather
  // than resolved to null later, because "page 0" is a typo and not a page that has gone away.
  if (!Number.isInteger(page) || page < 1) return null;

  if (m[2]) {
    const option = Number(m[3]);
    if (!Number.isInteger(option) || option < 1) return null;
    return { page, verb: "title_pick", option };
  }

  if (m[4]) {
    const option = Number(m[5]);
    if (!Number.isInteger(option) || option < 1) return null;
    return { page, verb: "pick", option };
  }

  const verb = (m[6] ?? "show").toLowerCase();
  if (verb === "more" || verb === "draft" || verb === "check" || verb === "ads" || verb === "title") {
    return { page, verb };
  }
  return { page, verb: "show" };
}

export function isPageWalkCommand(text: string): boolean {
  return parsePageWalk(text) !== null;
}

/** Where a batch has got to. Derived, never stored. */
export type BatchStage =
  | "no_plan"
  | "angles"
  | "headlines"
  | "formats"
  | "skeletons"
  | "handover"
  | "research"
  | "drafting"
  | "done";

export interface BatchState {
  stage: BatchStage;
  rows: PlanRow[];
  pillar: PlanRow | null;
  supports: PlanRow[];
  outlines: Map<string, PageOutline | null>;
  /**
   * Plan rows with no picked angle yet.
   *
   * ‼️ EMPTY WHEN THE ANGLE READ FAILED, NOT "ALL OF THEM". page-angles.ts states the rule this
   * follows: on a database without the table or the column, reporting every page as needing an
   * angle is "a missing column presenting as work that was never done", and here it would also
   * wedge the headline stage shut for every client with no way through. A failed read costs the
   * gate, never the lane.
   */
  needAngle: PlanRow[];
  /** Plan rows with no headline yet. Not conditioned on the angle: the GATE is, this count is not. */
  needHeadline: PlanRow[];
  /**
   * Plan rows whose H1 is picked but which are missing one of the other two artifacts.
   *
   * ‼️ THE PER-PAGE HALF OF "BEFORE THAT PAGE MOVES ON", AND IT IS EMPTY ON THE HAPPY PATH.
   * Matthew, 2026-10-07: the walk "works ONE page at a time to at least 6 concepts in all three
   * formats before that page moves on". `writeHeadlinesFor` writes all three together, so a page
   * that ran normally never lands here. What this catches is the run where the title tags or the
   * ad bank failed and were reported in `notes`: without it that page keeps its H1, looks
   * finished, and goes to draft missing an artifact nobody will notice is absent.
   *
   * Same posture `needAngle` keeps: a FAILED READ leaves this empty rather than reporting every
   * page as incomplete, because a missing table must not wedge the lane shut.
   */
  needFormats: PlanRow[];
  /** Plan rows with a headline and no skeleton. */
  needSkeleton: PlanRow[];
  /** Plan rows with a skeleton and no handover: no cta line, and not the page carrying the tool. */
  needHandover: PlanRow[];
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
      needAngle: [],
      needHeadline: [],
      needFormats: [],
      needSkeleton: [],
      needHandover: [],
      drafted: [],
    };
  }

  const outlines = new Map<string, PageOutline | null>();
  for (const row of rows) {
    outlines.set(row.id, row.pageId ? await readPageOutline(clientId, row.pageId) : null);
  }

  const headlines = await headlinesOnPlan(clientId, rows.map((r) => r.id));
  const bodies = await pagesWithBodies(clientId, rows.map((r) => r.pageId).filter((id): id is string => Boolean(id)));
  const angles = await anglesOnPlan(clientId, rows.map((r) => r.id));
  const toolPageId = await toolPageFor(clientId);

  const formats = await formatsOnPlan(clientId, rows.map((r) => r.id));

  const needAngle = angles.ok ? rows.filter((r) => !angles.picked.has(r.id)) : [];
  const needHeadline = rows.filter((r) => !headlines.get(r.id));
  // A page only owes its other two artifacts once its H1 exists: before that it is at the
  // headline stage anyway, and writeHeadlinesFor is what produces all three.
  const needFormats = formats.ok
    ? rows.filter((r) => headlines.get(r.id) && !formats.complete.has(r.id))
    : [];
  // ‼️ NOT NARROWED BY needFormats, AND NARROWING IT WAS A REAL BUG FOR ONE EDIT. These two lists
  // are independent facts about a row and the STAGE CHAIN below is the only thing that decides
  // which question is asked first. Excluding format-incomplete rows from needSkeleton left a page
  // with an H1, no title tags and no outline in neither list, which walked it straight past
  // draft_wave's gate and drafted a page off no skeleton at all.
  const needSkeleton = rows.filter((r) => headlines.get(r.id) && !outlines.get(r.id));
  const drafted = rows.filter((r) => r.pageId && bodies.has(r.pageId));

  // A page has answered the handover question once it carries a sentence of its own, or once it is
  // the page the client's one tool renders inside. Those are the only two ways a page hands over.
  const needHandover = rows.filter(
    (r) => outlines.get(r.id) && !r.ctaLine?.trim() && !(toolPageId && r.pageId === toolPageId)
  );

  // ‼️ HANDOVER SITS BETWEEN THE SKELETON AND THE RESEARCH AND NEVER AFTER A DRAFT. Putting it in
  // the chain ahead of `drafted` would report a finished batch as unfinished forever, because a
  // page that was drafted before this stage existed has no cta line and never will.
  // ‼️ `formats` SITS BETWEEN `headlines` AND `skeletons`, AND IT IS NOT AFTER `drafted` FOR THE
  // SAME REASON handover is not: a page drafted before the three-format split existed has no
  // title tags and never will, so ordering this after `drafted` would report every old batch as
  // unfinished forever.
  const stage: BatchStage = needAngle.length
    ? "angles"
    : needHeadline.length
      ? "headlines"
      : drafted.length === rows.length
        ? "done"
        : needFormats.length
          ? "formats"
          : needSkeleton.length
            ? "skeletons"
            : drafted.length
              ? "drafting"
              : needHandover.length
                ? "handover"
                : "research";

  return {
    stage,
    rows,
    pillar: rows.find((r) => r.role === "pillar") ?? null,
    supports: rows.filter((r) => r.role === "support"),
    outlines,
    needAngle,
    needHeadline,
    needFormats,
    needSkeleton,
    needHandover,
    drafted,
  };
}

/**
 * Which plan rows already carry all three headline artifacts.
 *
 * ‼️ ok:false ON A FAILED READ, AND EVERY CALLER TREATS THAT AS "DO NOT GATE". Same contract
 * `anglesOnPlan` keeps and for the same reason: `page-seo-titles.ts` writes through an origin
 * that docs/2026-10-08-page-headline-formats.sql has to allow first, so on a database where that
 * migration has not run, every page would report as missing its title tags and the walk would
 * wedge shut between the headline and the skeleton with no way through.
 *
 * "Complete" is a title tag AND an ad hook on file. The counts are not compared to six: a run
 * that was refused down to four good titles has four real candidates, and demanding six would
 * block the page on a number rather than on an artifact.
 */
async function formatsOnPlan(
  clientId: string,
  ids: readonly string[]
): Promise<{ ok: true; complete: Set<string> } | { ok: false }> {
  if (!ids.length) return { ok: true, complete: new Set() };

  const { data, error } = await supabaseAdmin
    .from("client_headlines")
    .select("used_page_id, origin")
    .eq("client_id", clientId)
    .in("origin", ["seo_title", "dr_ad"])
    .is("dropped_at", null)
    .in("used_page_id", ids as string[]);

  if (error) {
    console.error(
      `[page-batch] the three-format read failed (${error.message}). If this names origin, ` +
        "docs/2026-10-08-page-headline-formats.sql has not been run, so no page is gated on its formats."
    );
    return { ok: false };
  }

  const titles = new Set<string>();
  const ads = new Set<string>();
  for (const row of data ?? []) {
    const id = String(row.used_page_id);
    if (row.origin === "seo_title") titles.add(id);
    else ads.add(id);
  }
  return { ok: true, complete: new Set(ids.filter((id) => titles.has(id) && ads.has(id))) };
}

/**
 * Which of these plan rows already have an angle somebody picked.
 *
 * ‼️ ITS OWN SELECT, AND THE FAILURE IS REPORTED RATHER THAN SWALLOWED. Same blast-radius rule as
 * headlinesOnPlan, with one difference that matters: an empty map here would mean "every page needs
 * an angle", which gates the headline stage. So the caller is told whether the read worked, and a
 * failed read opens the gate instead of closing it.
 */
async function anglesOnPlan(
  clientId: string,
  ids: readonly string[]
): Promise<{ picked: Set<string>; ok: boolean }> {
  const picked = new Set<string>();
  if (!ids.length) return { picked, ok: true };

  const { data, error } = await supabaseAdmin
    .from("page_angles")
    .select("plan_id")
    .eq("client_id", clientId)
    .eq("status", "approved")
    .in("plan_id", ids as string[]);

  if (error) {
    console.error(
      `[page-batch] angle read failed (${error.message}). If this names page_angles, ` +
        `docs/2026-09-17-page-datasets-and-angles.sql has not been run. The angle gate is open.`
    );
    return { picked, ok: false };
  }

  for (const row of data ?? []) picked.add(String(row.plan_id));
  return { picked, ok: true };
}

/**
 * The page this client's one tool renders inside, if it has been bound to one yet.
 *
 * One row at most, because client_assets carries a unique index allowing a single not-dropped row
 * per client. A failed read returns null, which only ever costs this page the handover tick.
 */
async function toolPageFor(clientId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("client_assets")
    .select("page_id")
    .eq("client_id", clientId)
    .neq("status", "dropped")
    .maybeSingle();

  if (error) {
    console.error(`[page-batch] tool page read failed: ${error.message}`);
    return null;
  }
  return (data?.page_id as string | null) ?? null;
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
// One page's own stage
//
// ‼️ DERIVED FROM THE SAME NEED-LISTS readBatch ALREADY COMPUTES, AND NOTHING IS STORED. This is
// the rule at the top of this file applied one level down: a batch's stage is a question its own
// artifacts answer, and so is a page's. readBatch has already asked it for every row, five times
// over, so a page's stage is membership in those lists and not a second computation.
//
// ‼️ THE PRECEDENCE IS readBatch'S OWN, IN THE SAME ORDER, FOR THE SAME REASONS. Copying the
// order is not duplication: the two must agree, because the batch card and the page card are read
// side by side and a batch that says "headlines" over a page that says "skeleton" is a card
// nobody can act on.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Where ONE page has got to. Derived, never stored.
 *
 * ‼️ THERE IS NO "research" STAGE HERE AND BatchStage KEEPS ITS OWN. Research is ONE prompt for
 * the whole batch, which is the entire design decision at the top of this file: it is a fact about
 * the batch and a page cannot be at it alone. Two types, two questions.
 */
export type PageStage =
  | "angle"
  | "headline"
  | "formats"
  | "skeleton"
  | "handover"
  | "draft"
  | "review"
  | "live";

/**
 * This page's stage, from the batch state the caller already read.
 *
 * Pure and synchronous on purpose: it takes the BatchState rather than a client id, so it costs no
 * read, can be proven offline against a synthetic state, and cannot be called in a loop that turns
 * eleven pages into eleven round trips.
 *
 * ‼️ `drafted` IS TESTED BEFORE `needHandover` AND THE ORDER IS THE WHOLE CORRECTNESS OF THIS
 * FUNCTION. needHandover is computed as "has an outline, has no cta line, is not the tool page"
 * and it does NOT exclude rows that are already drafted, which is deliberate there and is why
 * readBatch puts handover ahead of research but behind `drafted` in its own chain. Every page
 * written before the handover stage existed has no cta line and never will, so asking the handover
 * question first would report those as owing a decision forever, and no answer would clear it.
 */
export function pageStage(state: BatchState, row: PlanRow): PageStage {
  const has = (list: readonly PlanRow[]) => list.some((r) => r.id === row.id);

  if (has(state.needAngle)) return "angle";
  if (has(state.needHeadline)) return "headline";
  // A body exists, so every decision behind it was made. Published or not is the only question
  // left. ‼️ AND IT IS TESTED BEFORE `needFormats` FOR THE REASON THE HANDOVER NOTE ABOVE GIVES:
  // a page drafted before the three-format split has no title tags and never will, so asking the
  // formats question first would report every old page as owing one forever.
  if (has(state.drafted)) return row.pageStatus === "published" ? "live" : "review";
  if (has(state.needFormats)) return "formats";
  if (has(state.needSkeleton)) return "skeleton";
  if (has(state.needHandover)) return "handover";
  return "draft";
}

/**
 * The page at this RANK, which is the number the plan card prints.
 *
 * ‼️ RANK AND POSITION ARE TWO DIFFERENT NUMBERS AND THIS REPO USES BOTH. The divergence is real
 * and measurable: readBatch's rows are the role rows that are approved or claimed, while rerank()
 * keeps ranks contiguous over ALL of a client's plan rows, studio rows included. So the moment any
 * role row is not approved (plan_swap sets the replacement back to `proposed`, so this is a verb
 * somebody can type, not an edge), position N and rank N name different pages.
 *
 * `headline N pick M`, `skeleton N more` and `angle N pick M` index POSITION, and the [Pn] tags in
 * buildBatchResearchPrompt must stay positional because a batch's research is written against a
 * numbering that has to hold still for the life of the batch. Everything a person types elsewhere
 * (`plan drop 4`, `cta 3:`, the launch chat's rank argument) means RANK.
 *
 * The new per-page walk uses RANK, and both resolvers live here, next to each other, so the next
 * person reading either one finds the other.
 */
export function pageAtRank(state: BatchState, rank: number): PlanRow | null {
  return state.rows.find((r) => r.rank === rank) ?? null;
}

/** The page at this 1-based POSITION over the batch rows, which is what the batch cards number. */
export function pageAtPosition(state: BatchState, n: number): PlanRow | null {
  return state.rows[n - 1] ?? null;
}

/**
 * Every page, its rank, its position and its stage.
 *
 * This is what makes "several pages in flight at different stages" something a person can see
 * rather than something they have to hold in their head. Both numbers, because the two verb
 * families disagree and a card that printed one of them would be lying to half its readers.
 */
export function pageWalkSummary(
  state: BatchState
): Array<{ rank: number; position: number; stage: PageStage; row: PlanRow }> {
  return state.rows.map((row, i) => ({
    rank: row.rank,
    position: i + 1,
    stage: pageStage(state, row),
    row,
  }));
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
      lines.push(...storyCardLines(outline));
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
    case "angles":
      return `${state.needAngle.length} of ${state.rows.length} pages still need an idea. The idea comes before the line.`;
    case "headlines":
      return `${state.needHeadline.length} of ${state.rows.length} pages still need a headline.`;
    case "formats":
      return `${state.needFormats.length} of ${state.rows.length} pages have an H1 and are missing a title tag or their ad headlines.`;
    case "skeletons":
      return `${state.needSkeleton.length} of ${state.rows.length} pages still need a skeleton.`;
    case "handover":
      return `${state.needHandover.length} of ${state.rows.length} pages still need a handover: a cta line, or the tool.`;
    case "research":
      return `${state.rows.length} pages planned and outlined. \`batch approve\` builds the one research prompt.`;
    case "drafting":
      return `${state.drafted.length} of ${state.rows.length} pages drafted.`;
    case "done":
      return `All ${state.rows.length} pages drafted.`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// One page's own card
//
// Pure string builders, exactly as the batch cards above are: no channel, no thread ts, no block
// type, no emoji. The caller decides where the strings go, which is what lets the Slack thread and
// a model's context window render the same decision.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Where this page is, in one line, for the top of its card.
 *
 * The per-page analogue of stageLine, and it carries NO counts: a count of one is not information,
 * and "1 of 1 pages still needs an idea" is how a card about one thing starts reading like a
 * report about everything.
 */
export function pageStageLine(stage: PageStage, row: PlanRow): string {
  switch (stage) {
    case "angle":
      return `Page ${row.rank} has no idea yet. The idea comes before the line.`;
    case "headline":
      return `Page ${row.rank} argues: ${row.angle || "(its idea is picked)"}. It has no headline yet.`;
    case "formats":
      return `Page ${row.rank} is "${row.headline || row.workingTitle}". Its H1 is picked and one of its other two formats is missing.`;
    case "skeleton":
      return `Page ${row.rank} is "${row.headline || row.workingTitle}". It has no skeleton yet.`;
    case "handover":
      return `Page ${row.rank} is outlined and has not said how it hands over: a sentence, or the tool.`;
    case "draft":
      return `Page ${row.rank} is decided end to end. It wants a body.`;
    case "review":
      return `Page ${row.rank} has a body that nobody has checked or published.`;
    case "live":
      return `Page ${row.rank} is live.`;
  }
}

/**
 * What a short reply means, right now, on this page.
 *
 * ‼️ THIS IS THE ONE PLACE THE REPLY GRAMMAR IS WORDED, AND IT IS WORDED PER STAGE ON PURPOSE. A
 * digit means "take this option" and the page advances because its stage is re-derived from what it
 * then has, not because anything was told to advance. The stages that offer no options say so
 * instead of offering a number nobody can use.
 */
export function pageReplyLine(stage: PageStage, rank: number): string {
  switch (stage) {
    case "angle":
      return `\`page ${rank} pick 2\` takes option 2. \`page ${rank} more\` writes three new ones.`;
    case "headline":
      return (
        `\`page ${rank} pick 2\` takes option 2, which sets the H1. \`page ${rank} more\` writes a ` +
        `fresh set of six, plus the title tags and the ad headlines. \`page ${rank} title\` numbers ` +
        "the title tags on their own."
      );
    case "formats":
      return (
        `\`page ${rank} title pick 2\` takes title tag 2. \`page ${rank} more\` writes whichever of ` +
        `the three formats is missing, and \`page ${rank} ads\` writes just the ad headlines.`
      );
    case "skeleton":
      return (
        `\`page ${rank} more\` writes its skeleton. There is nothing to choose between here. ` +
        `\`page ${rank} ads\` writes the twenty ad headlines that send her here.`
      );
    case "handover":
      return (
        `\`page ${rank} pick 1\` puts the tool on this page. \`cta ${rank}: <one sentence>\` is the ` +
        "other way, and is how every page that is not the tool page hands over."
      );
    case "draft":
      return `\`page ${rank} draft\` writes the body. One page at a time, and the batch research should be filed first.`;
    case "review":
      return (
        `\`page ${rank} check\` reads it against the evidence and Google's guidance. Publishing is a separate press. ` +
        `\`page ${rank} ads\` writes the twenty ad headlines that send her here.`
      );
    case "live":
      return `Nothing is owed. \`page ${rank} check\` reads it again after an edit.`;
  }
}

/**
 * One page, its stage, and the options for THAT stage, numbered.
 *
 * ‼️ ONLY THE CURRENT STAGE'S OPTIONS ARE NUMBERED. Printing the ideas and the headlines together
 * would put two number 2s on one card, which is exactly how `headline 3 pick 2` came to mean two
 * things in the first place. The decisions already made are shown as facts, without numbers.
 */
export function pageWalkLines(args: {
  state: BatchState;
  row: PlanRow;
  /** This page's headline candidates, from optionsFor. */
  options: readonly string[];
  /** This page's ideas, every one of them, oldest first, as anglesFor returns them. */
  angles: readonly { idea: string; status: string }[];
  /**
   * This page's title tags, from seoTitlesFor, and how many ad hooks are on file.
   *
   * ‼️ OPTIONAL, AND OMITTING THEM IS THE OLD CARD EXACTLY. Every caller that has not been
   * taught the three formats yet renders what it always did rather than printing "0 title tags"
   * about a page whose titles simply were not read.
   */
  titles?: readonly string[];
  ads?: number;
  /** This client's tool options, only read at the handover stage. */
  tools?: readonly { label: string; answers: string }[];
  /** The tool this client has already placed, when it is on another page. */
  toolOnOtherPage?: { componentKey: string; rank: number } | null;
}): string[] {
  const { state, row } = args;
  const stage = pageStage(state, row);
  const position = state.rows.findIndex((r) => r.id === row.id) + 1;

  const lines: string[] = [pageStageLine(stage, row), ""];

  // The identity: the rank a person types, the position the research tags use, and the keyword.
  lines.push(
    `Page ${row.rank}${position > 0 ? ` [P${position}]` : ""}. ${row.headline || row.workingTitle || row.question}`
  );
  if (row.targetKeyword) lines.push(`  aimed at: ${row.targetKeyword}`);

  // What is already decided, as facts rather than as numbered choices.
  const picked = args.angles.find((a) => a.status === "approved");
  if (picked && stage !== "angle") lines.push(`  argues: ${picked.idea}`);
  if (row.ctaLine) lines.push(`  hands over with: ${row.ctaLine}`);

  lines.push("");

  if (stage === "angle") {
    if (!args.angles.length) lines.push("No ideas written yet.");
    else args.angles.forEach((a, i) => lines.push(`  ${i + 1}. ${a.idea}`));
  } else if (stage === "headline") {
    // ‼️ THE H1 KEEPS THE NUMBERS AND THE OTHER TWO FORMATS DO NOT, which is this file's own rule
    // about printing two sets of options on one card: the H1 is the decision this stage is
    // waiting on, so `page N pick 2` has exactly one meaning. The title tags are numbered under
    // their own verb at the formats stage, where the H1 is already settled.
    lines.push("The H1, which is the question an engine matches. Pick one:");
    if (!args.options.length) lines.push("  No headlines written yet.");
    else args.options.forEach((h, i) => lines.push(`  ${i + 1}. ${h}`));
    if (args.titles?.length) {
      lines.push(
        "",
        `Its title tag, which is what Google prints. ${args.titles.length} written, numbered under \`page ${row.rank} title\`:`,
        ...args.titles.slice(0, 3).map((t) => `     ${t}`),
        ...(args.titles.length > 3 ? [`     and ${args.titles.length - 3} more`] : [])
      );
    }
    if (args.ads) lines.push("", `Its ad headlines: ${args.ads} on file, under \`page ${row.rank} ads\`.`);
  } else if (stage === "formats") {
    lines.push(`Its H1 is "${row.headline ?? ""}", already picked.`, "");
    if (args.titles?.length) {
      lines.push("Its title tags, which is what Google prints. Pick one:");
      args.titles.forEach((t, i) => lines.push(`  ${i + 1}. ${t}`));
    } else {
      lines.push("No title tags yet, and this page owes one.");
    }
    lines.push("", args.ads ? `Its ad headlines: ${args.ads} on file.` : "No ad headlines yet, and this page owes them.");
  } else if (stage === "skeleton") {
    const outline = state.outlines.get(row.id) ?? null;
    if (!outline) lines.push("No skeleton yet.");
    else outline.sections.forEach((s) => lines.push(`  ${s.heading}${s.keyword ? `  (${s.keyword})` : ""}`));
  } else if (stage === "handover") {
    if (args.toolOnOtherPage) {
      lines.push(
        `The tool (${args.toolOnOtherPage.componentKey}) is already on page ${args.toolOnOtherPage.rank}, and this client gets one.`,
        "So this page hands over with a sentence."
      );
    } else if (args.tools?.length) {
      args.tools.forEach((t, i) => lines.push(`  ${i + 1}. ${t.label}`, `       it answers: ${t.answers}`));
    } else {
      lines.push("No tool suits this client yet, so this page hands over with a sentence.");
    }
  }

  lines.push("", pageReplyLine(stage, row.rank));
  return lines;
}

/**
 * Google's four, named as a group on the review card.
 *
 * ‼️ A GROUP AND NOT A VERDICT, BECAUSE E-E-A-T IS SPLIT ACROSS THE TWO TIERS ON PURPOSE.
 * page-gate.ts states the reason: Experience is a claim about the world and Authoritativeness is
 * an impression, so one of these blocks and three warn. Averaging them into one line would be
 * honest about neither.
 *
 * It is a display grouping, not a policy. The tiers live in page-gate.ts and nothing here may
 * decide one: a key missing from this list prints under the evidence heading, which is wrong on a
 * card and harmless to a page.
 */
const GOOGLE_CHECKS: readonly string[] = ["experience_claims", "people_first", "authority", "spam_signals"];

/**
 * A drafted page, read back, with the gate's verdict.
 *
 * ‼️ RENDERED FROM THE VERDICT DATA AND NEVER THROUGH renderVerdict. That one emits Slack mrkdwn
 * and :emoji:, which a caller rendering into a model's context window would then be stripping back
 * out, and stripping formatting is how two surfaces start disagreeing about what the gate said.
 *
 * ‼️ GOOGLE'S GUIDANCE IS NAMED, AND UNTIL THIS CARD EXISTED IT WAS INVISIBLE. The gate has read
 * every page against Google's published guidance since 2026-09-18 (GUIDELINE_RULES reaches the
 * model inside page-gate.ts), but a person saw "pass with 2 warnings" and could not tell whether
 * that read had happened at all. A compliance check nobody can see is a compliance check nobody
 * trusts.
 */
export function pageReviewLines(args: {
  row: PlanRow;
  slug: string | null;
  words: number;
  headings: readonly string[];
  citations: { total: number; firstParty: number } | null;
  verdict: "pass" | "warn" | "block";
  checks: readonly { key: string; tier: "block" | "warn"; status: string; detail: string }[];
  ranAt: string | null;
}): string[] {
  const { row } = args;
  const lines: string[] = [
    `Page ${row.rank}. "${row.headline || row.workingTitle}"${args.slug ? `   /${args.slug}` : ""}`,
  ];

  if (row.angle) lines.push(`  argues: ${row.angle}`);
  lines.push(
    `  ${args.words.toLocaleString("en-US")} words across ${args.headings.length} section${args.headings.length === 1 ? "" : "s"}` +
      (args.headings.length ? `: ${args.headings.join(", ")}` : "")
  );
  if (args.citations) {
    lines.push(
      `  ${args.citations.total} claim${args.citations.total === 1 ? "" : "s"} cited, ${args.citations.firstParty} of them first party`
    );
  }

  const verdictWord =
    args.verdict === "pass" ? "PASSED" : args.verdict === "warn" ? "PASSED WITH WARNINGS" : "BLOCKED";
  lines.push(`  the gate: ${verdictWord}${args.ranAt ? `, read at ${args.ranAt}` : ""}`);

  // One line per check. A pass says so and stops; anything else carries its first line of detail,
  // because the rest of a detail is a quoted list and belongs in front of somebody fixing it.
  const show = (c: { key: string; tier: string; status: string; detail: string }): string =>
    `      ${c.key}${c.status === "pass" ? ": pass" : ` (${c.tier}): ${c.detail.split("\n")[0]}`}`;
  // Failures first: a card read at a glance has to lead with what is wrong.
  const worstFirst = (a: { status: string }, b: { status: string }) =>
    Number(a.status === "pass") - Number(b.status === "pass");

  const google = args.checks.filter((c) => GOOGLE_CHECKS.includes(c.key));
  const evidence = args.checks.filter((c) => !GOOGLE_CHECKS.includes(c.key));

  if (evidence.length) {
    lines.push("    the evidence, and the page's own question");
    [...evidence].sort(worstFirst).forEach((c) => lines.push(show(c)));
  }
  if (google.length) {
    lines.push("    Google's published guidance");
    [...google].sort(worstFirst).forEach((c) => lines.push(show(c)));
  }

  lines.push(
    row.pageStatus === "published"
      ? "Live. A check after an edit is what keeps the verdict true."
      : args.verdict === "block"
        ? "Not published, and the gate refuses it. The answer is a source, not a second press."
        : "Not published. Publishing is a separate press and goes through both rails."
  );
  return lines;
}

// ─────────────────────────────────────────────────────────────────────────────
// The work, shared by both doors
//
// ‼️ ONE IMPLEMENTATION, TWO DOORS, THE PRECEDENT PLAN_COMMAND SET. The batch is reachable from
// the drafting channel (a page studio session) and from step 21's own thread in the client's
// onboarding channel. Those two post through completely different machinery, so what is shared is
// the WORK and what differs is only how the text gets out.
//
// Writing this twice is how the two doors end up disagreeing about what `headline 3 pick 2` does,
// and a person would be right either time.
//
// ‼️ AND NOW TWO THINGS DIFFER PER DOOR RATHER THAN ONE. The per-page walk adds a second: HOW THE
// FOCUSED PAGE IS RESOLVED. In the launch chat a model reads the transcript and sends an explicit
// rank, so a digit never reaches the server and nothing is stored. In Slack there is no model, so
// the grammar carries the page: `page 3 pick 2`. Both doors end at the same (PlanRow, option) pair,
// and everything below that pair, the stage, the lines and the work, is one implementation.
//
// The third answer that would be needed is a bare digit in Slack, and it is deliberately not
// built. page-studio.ts records what that cost the last time one was claimed: a "1" typed under
// five numbered offers was filed as the page body, verbatim.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * All three headline artifacts for one page, written together, filed and claimed for it.
 *
 * ‼️ THREE ARTIFACTS PER RUN SINCE 2026-10-08, AND THAT IS THE WHOLE DECISION. Matthew, after
 * rejecting the H1 card for SRT's own pages: every run returns the title tag, the H1 and the ad
 * hook, "stored and tracked separately so each accumulates its own traffic data over time". They
 * are three rows under three origins, never three columns on one row, because separate tracking
 * is the point and a traffic number has to hang off an id.
 *
 * ‼️ THREE MODEL CALLS AND NOT ONE, for the reason seo-title-engine.ts's banner states: a 60
 * character budget and a 4 to 12 word budget in one prompt collapse into whichever is tighter.
 *
 * ‼️ AND THE H1 IS THE ONLY ONE THAT CAN FAIL THE RUN. A missing title tag or a missing ad bank
 * is a page that still has its H1 to pick, which is the decision the walk is waiting on. Losing
 * the whole run because the ad lane timed out would block the page on the artifact nobody picks.
 * Both are reported.
 */
export async function writeHeadlinesFor(
  clientId: string,
  row: PlanRow
): Promise<
  | { ok: true; headlines: string[]; titles: string[]; ads: number; notes: string[] }
  | { ok: false; error: string }
> {
  if (!row.targetKeyword?.trim()) {
    return { ok: false, error: `page ${row.rank} has no target keyword, so there is nothing to aim a headline at` };
  }

  const { generateKeywordHeadlines, storeHeadlines } = await import("./client-headlines");

  // ‼️ THE PICKED ANGLE IS READ HERE, AND UNTIL NOW IT NEVER WAS. This is the same read
  // writeSkeletonsFor already does below, for the same reason: the plan row only ever held the
  // one-line idea, and the story spine and the belief live on the angle. Without it the generator
  // is asked to write a line about a phrase, which is the measured failure page-angles.ts opens on.
  // Null is legal and is the old behaviour: a page with no angle still gets headlines.
  const { approvedAngleForPlan } = await import("./page-angles");
  const picked = await approvedAngleForPlan(clientId, row.id);

  // ‼️ row.postFormat WAS ALREADY HELD HERE AND WAS DISCARDED. The plan row knows the shape of the
  // page these three headlines are for, so a comparison page stopped getting a headline written for
  // a generic answer page and the two arguing past each other.
  const got = await generateKeywordHeadlines({
    clientId,
    keyword: row.targetKeyword,
    postFormat: row.postFormat ?? picked?.postFormat ?? null,
    angle: picked
      ? { idea: picked.idea, indoctrination: picked.indoctrination, narrative: picked.narrative }
      : null,
  });
  if (!got.ok) return got;

  const stored = await storeHeadlines({ clientId, headlines: got.headlines, origin: "keyword", audienceId: got.audienceId });
  if (!stored.ok) return stored;

  // ‼️ CLAIMED FOR THIS PLAN ROW IMMEDIATELY, which is what makes the card's per-page numbering
  // mean anything. used_page_id holds the PLAN ROW id, the same id approveHeadlineForPage writes,
  // so a claimed-but-unapproved row is "an option offered for this page" and an approved one is
  // "the option taken". One column, two states, no second table.
  for (const h of stored.stored) {
    await supabaseAdmin
      .from("client_headlines")
      .update({ used_page_id: row.id })
      .eq("id", h.id)
      .eq("client_id", clientId);
  }

  const notes: string[] = [];

  // The other two artifacts. Each stores itself against the plan row under its own origin, so
  // neither needs the claim loop above and neither can reach the H1 picker.
  let titles: string[] = [];
  try {
    const { generateSeoTitlesForPage, storeSeoTitles } = await import("./page-seo-titles");
    const made = await generateSeoTitlesForPage({ clientId, row, keyword: row.targetKeyword });
    if (made.ok) {
      titles = made.titles;
      const put = await storeSeoTitles({
        clientId,
        planId: row.id,
        titles: made.titles,
        audienceId: got.audienceId,
      });
      if (!put.ok) notes.push(`the title tags could not be filed: ${put.error}`);
    } else {
      notes.push(`no title tags: ${made.error}`);
    }
  } catch (e) {
    notes.push(`no title tags: ${(e as Error).message}`);
  }

  // ‼️ THE AD BANK IS WRITTEN ONCE AND NEVER REWRITTEN, which is the idempotency `page_ads`
  // already had. Twenty hooks are used across weeks of ads, so a second headline run on the same
  // page must not spend the call again or hand back a different bank than the one in use.
  let ads = 0;
  try {
    const { drHeadlinesFor, generateDrHeadlinesForPage, storeDrHeadlines } = await import("./page-dr-headlines");
    const existing = (await drHeadlinesFor(clientId, [row.id])).get(row.id) ?? [];
    if (existing.length) {
      ads = existing.length;
    } else {
      const made = await generateDrHeadlinesForPage({ clientId, row });
      if (made.ok) {
        const put = await storeDrHeadlines({
          clientId,
          planId: row.id,
          headlines: made.headlines,
          audienceId: got.audienceId,
        });
        if (put.ok) ads = put.stored;
        else notes.push(`the ad headlines could not be filed: ${put.error}`);
      } else {
        notes.push(`no ad headlines: ${made.error}`);
      }
    }
  } catch (e) {
    notes.push(`no ad headlines: ${(e as Error).message}`);
  }

  return { ok: true, headlines: stored.stored.map((h) => h.headline), titles, ads, notes };
}

/**
 * The options offered for each page, read back from the bank.
 *
 * ‼️ READ FROM client_headlines RATHER THAN HELD IN A THREAD. A Slack thread is not storage: the
 * numbering has to survive a restart, a second person opening the thread, and the hours between
 * writing the options and picking one. At 14 onboardings a day that gap is normal, not an edge.
 */
export async function optionsFor(
  clientId: string,
  rows: readonly PlanRow[]
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const { data, error } = await supabaseAdmin
    .from("client_headlines")
    .select("id, headline, used_page_id")
    .eq("client_id", clientId)
    .eq("origin", "keyword")
    .is("dropped_at", null)
    .order("created_at", { ascending: true });

  if (error) {
    console.error(`[page-batch] options read failed: ${error.message}`);
    for (const row of rows) out.set(row.id, []);
    return out;
  }

  for (const row of rows) {
    out.set(
      row.id,
      (data ?? []).filter((r) => r.used_page_id === row.id).map((r) => String(r.headline))
    );
  }
  return out;
}

/**
 * The other two artifacts for one page, for the card.
 *
 * One helper rather than two reads at four call sites, and it never throws: a card missing its
 * title tags is worth less than a card, and a card that threw is worth nothing.
 */
export async function otherFormatsFor(
  clientId: string,
  row: PlanRow
): Promise<{ titles: string[]; ads: number }> {
  try {
    const [{ seoTitlesFor }, { drHeadlinesFor }] = await Promise.all([
      import("./page-seo-titles"),
      import("./page-dr-headlines"),
    ]);
    const [titles, ads] = await Promise.all([
      seoTitlesFor(clientId, [row.id]),
      drHeadlinesFor(clientId, [row.id]),
    ]);
    return { titles: titles.get(row.id) ?? [], ads: (ads.get(row.id) ?? []).length };
  } catch (e) {
    console.error(`[page-batch] the other two formats could not be read: ${(e as Error).message}`);
    return { titles: [], ads: 0 };
  }
}

/**
 * The title tags for one page, numbered, written first if there are none.
 *
 * ‼️ NOT STAGE DISPATCHED, AND THAT IS THE POINT OF A SEPARATE VERB. A page's title tags exist
 * from the headline stage onward, so `page 3 title` has to answer at the headline stage, at the
 * formats stage and after the skeleton. `writeForStage` and `pickForStage` both switch on the
 * stage because the thing they act on IS the stage's open decision; this one names its artifact.
 */
export async function showTitlesForPage(clientId: string, row: PlanRow): Promise<PageWorkResult> {
  const { seoTitleLines, generateSeoTitlesForPage, storeSeoTitles } = await import("./page-seo-titles");

  let titles = (await otherFormatsFor(clientId, row)).titles;
  if (!titles.length) {
    if (!row.targetKeyword?.trim()) {
      return { ok: false, error: `page ${row.rank} has no target keyword, so there is nothing to aim a title at` };
    }
    const made = await generateSeoTitlesForPage({ clientId, row, keyword: row.targetKeyword });
    if (!made.ok) return { ok: false, error: made.error };
    const put = await storeSeoTitles({ clientId, planId: row.id, titles: made.titles });
    if (!put.ok) return { ok: false, error: put.error };
    titles = made.titles;
  }

  return {
    ok: true,
    stage: "formats",
    lines: [...seoTitleLines(row, titles), "", `\`page ${row.rank} title pick 2\` takes title tag 2.`],
  };
}

/** Take title tag `option` (1-based) for one page. */
export async function pickTitleForPage(
  clientId: string,
  row: PlanRow,
  option: number,
  by: string
): Promise<PageWorkResult> {
  const { approveSeoTitleFor } = await import("./page-seo-titles");
  const res = await approveSeoTitleFor(clientId, row, option, by);
  if (!res.ok) return { ok: false, error: res.error };

  const after = await readBatch(clientId);
  if ("error" in after) return { ok: false, error: after.error };
  const fresh = pageAtRank(after, row.rank) ?? row;

  return {
    ok: true,
    stage: pageStage(after, fresh),
    lines: [
      `Page ${row.rank}'s title tag is now "${res.title}".`,
      row.pageId
        ? "It is on the page now."
        : "It lands on the page when its skeleton creates one, which is the next stage.",
      "The H1 is unchanged: these are two artifacts on one page.",
    ],
  };
}

/** Take option `pick` (1-based) for one page. */
export async function pickHeadlineFor(
  clientId: string,
  row: PlanRow,
  pick: number,
  by: string
): Promise<{ ok: true; headline: string } | { ok: false; error: string }> {
  const options = (await optionsFor(clientId, [row])).get(row.id) ?? [];
  const chosen = options[pick - 1];
  if (!chosen) {
    return {
      ok: false,
      error: `page ${row.rank} has ${options.length} option${options.length === 1 ? "" : "s"}, so there is no ${pick}`,
    };
  }

  const { data: match } = await supabaseAdmin
    .from("client_headlines")
    .select("id")
    .eq("client_id", clientId)
    .eq("headline", chosen)
    .maybeSingle();

  if (!match?.id) return { ok: false, error: "that headline is no longer on file" };

  const { approveHeadlineForPage } = await import("./client-headlines");
  return approveHeadlineForPage({
    clientId,
    headlineId: String(match.id),
    planRowId: row.id,
    by,
  });
}

/**
 * Write the skeleton for each of `rows`, opening a page for any row that has none yet.
 *
 * Returns one note per row that failed, so a caller can report the failures without losing the
 * ones that worked. A batch where six of seven skeletons landed is six pages further on, and
 * failing the whole call would throw those away.
 */
export async function writeSkeletonsFor(
  clientId: string,
  rows: readonly PlanRow[],
  /**
   * Which buyer these pages are for, when the caller knows. Null lets startPageDraft decide: a
   * client with one audience resolves to it, and a client with several REFUSES rather than
   * picking, which lands in `failures` naming the audiences.
   */
  audienceId: string | null = null
): Promise<{ written: number; failures: string[] }> {
  const { draftOutline } = await import("@/lib/hub/draft-page");
  const { setPageOutline, startPageDraft } = await import("@/lib/hub/pages");

  let written = 0;
  const failures: string[] = [];

  // ‼️ THREE AT A TIME, AND THE FIRST ONE ALONE. A skeleton with three stories is one long Sonnet call,
  // often plus a correction retry (102 s for one page on the first live run, 2026-09-15), and step 21's
  // `skeletons` runs the whole batch inside ONE 300 s invocation. Sequential, a seven-page batch dies
  // part way with no card. The first page runs alone because draftOutline's crawl files the website
  // snapshot by select-then-insert (recordWebsiteSnapshot), and parallel first crawls would file it twice.
  const one = async (row: PlanRow): Promise<void> => {
    let pageId = row.pageId;

    if (!pageId) {
      const started = await startPageDraft({
        clientId,
        question: row.question,
        title: row.workingTitle,
        audienceId,
      });
      if (!started.ok) {
        failures.push(`page ${row.rank}: ${started.error}`);
        return;
      }
      pageId = started.id;
      // Linked and claimed now, so the page stays tied to its plan row even if the outline call
      // below dies. Same reasoning draftOne's markClaimed carries.
      await supabaseAdmin
        .from("page_plan")
        .update({ page_id: pageId, status: "claimed" })
        .eq("id", row.id)
        .eq("client_id", clientId);

      // The title tag is picked at the formats stage, which runs BEFORE this one, so the page row
      // that has just been created is the first place the choice can land. Applied as its own
      // update rather than passed to startPageDraft, because `title` there is also the source of
      // the SLUG and a title tag is the line Google prints, never the address it fetched.
      const { applyApprovedTitle } = await import("./page-seo-titles");
      await applyApprovedTitle(clientId, row.id, pageId);
    }

    // The picked angle carries the story spine and the belief this page has to install. Both are
    // read here rather than off the plan row, which only ever held the one-line idea.
    const { approvedAngleForPlan } = await import("./page-angles");
    const picked = await approvedAngleForPlan(clientId, row.id);

    const outline = await draftOutline(clientId, row.question, {
      pageId,
      context: {
        workingTitle: row.workingTitle,
        targetKeyword: row.targetKeyword,
        secondaryKeywords: row.secondaryKeywords ?? [],
        angle: row.angle,
        headline: row.headline,
        postFormat: row.postFormat ?? picked?.postFormat ?? null,
        narrative: picked?.narrative ?? null,
        indoctrination: picked?.indoctrination ?? null,
      },
    });
    if (!outline.ok) {
      failures.push(`page ${row.rank}: ${outline.error}`);
      return;
    }

    const saved = await setPageOutline(clientId, pageId, outline.outline);
    if (!saved.ok) {
      failures.push(`page ${row.rank}: ${saved.error}`);
      return;
    }
    written += 1;
  };

  if (rows[0]) await one(rows[0]);
  for (let i = 1; i < rows.length; i += 3) {
    await Promise.all(rows.slice(i, i + 3).map(one));
  }

  return { written, failures };
}

/**
 * The one research prompt for the whole batch.
 *
 * ‼️ IT RETURNS A PROMPT. IT DOES NOT RUN ONE (D10). Matthew was asked directly on 2026-09-14 and
 * chose the manual paste-back over automating this by API, because he reads every answer. Nothing
 * on this path calls a research model, and nothing should be added that does.
 */
export async function buildBatchPrompt(
  clientId: string
): Promise<{ ok: true; prompt: string; questions: number; pages: number } | { ok: false; error: string }> {
  const state = await readBatch(clientId);
  if ("error" in state) return { ok: false, error: state.error };

  // ‼️ THE FORMATS ARE PART OF "READY" SINCE 2026-10-08. Matthew's workflow: the deep research
  // prompt goes out only "when every page in the batch is ready", and a page whose title tags or
  // ad hooks silently failed is not ready. The research prompt is the expensive manual step he
  // runs by hand elsewhere, so sending it out over an incomplete batch costs a person's afternoon
  // rather than a model call.
  if (state.needHeadline.length || state.needFormats.length || state.needSkeleton.length) {
    const parts: string[] = [];
    if (state.needHeadline.length) parts.push(`${state.needHeadline.length} need a headline`);
    if (state.needFormats.length) parts.push(`${state.needFormats.length} need a title tag or their ad headlines`);
    if (state.needSkeleton.length) parts.push(`${state.needSkeleton.length} need a skeleton`);
    return { ok: false, error: `not yet: ${parts.join(", ")}` };
  }

  const { loadBatchPages, buildBatchResearchPrompt } = await import("./batch-research");
  const pages = await loadBatchPages(clientId, state.rows.map((r) => r.id));

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("legal_name, dba_name, city, state")
    .eq("id", clientId)
    .maybeSingle();

  const { loadOffer } = await import("./offers");
  const offer = await loadOffer(clientId).catch(() => null);
  const { confirmedAvatarFor } = await import("./avatars");
  const avatar = await confirmedAvatarFor(clientId).catch(() => null);

  const built = buildBatchResearchPrompt({
    clientName: ((client?.dba_name as string) || (client?.legal_name as string)) ?? "this client",
    city: (client?.city as string | null) ?? null,
    state: (client?.state as string | null) ?? null,
    avatarLabel: avatar?.label ?? "the buyer",
    offer: offer?.treatment ?? null,
    pages,
  });

  if (!built.ok) return built;

  // The prompt belongs to the batch, so it is attached to every dataset row of that batch rather
  // than carried through each capture. See attachResearchPrompt.
  const batchId = batchIdFor(state);
  if (batchId) {
    const { attachResearchPrompt } = await import("./page-dataset");
    void attachResearchPrompt({ clientId, batchId, prompt: built.prompt });
  }

  return { ok: true, prompt: built.prompt, questions: built.questions, pages: pages.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// One page's own work
//
// Two verbs, dispatched on the page's stage: write the options for where it is, or take one. Both
// call the batch functions above and the angle and tool lanes; neither generates anything of its
// own and neither stores anything of its own. A third implementation of "pick a headline" is how
// the two doors come to disagree, and this file exists to stop that.
// ─────────────────────────────────────────────────────────────────────────────

export type PageWorkResult =
  | { ok: true; stage: PageStage; lines: string[] }
  | { ok: false; error: string };

/**
 * Is this page's idea decided, re-read at write time?
 *
 * ‼️ A FAILED READ OPENS THE GATE AND DOES NOT CLOSE IT, which is the rule anglesOnPlan's own
 * comment states and the reason it reports `ok` separately from what it found. On a database where
 * docs/2026-09-17-page-datasets-and-angles.sql has not been run, treating "no approved angle" and
 * "could not look" as the same answer would wedge every headline shut with no way through.
 *
 * ‼️ RE-READ RATHER THAN TAKEN FROM THE STATE, AND THE GAP IS WHY. In a Slack thread the card and
 * the reply are hours apart: optionsFor's own banner records that at fourteen onboardings a day
 * that gap is normal, not an edge. A BatchState read when the card was posted is a claim about the
 * past, and this is the one claim a write must not act on stale.
 */
async function ideaDecided(clientId: string, row: PlanRow): Promise<boolean> {
  const angles = await anglesOnPlan(clientId, [row.id]);
  return angles.ok ? angles.picked.has(row.id) : true;
}

/** The page is one of this batch's, so a stage derived from this state is about this row. */
function inBatch(state: BatchState, row: PlanRow): boolean {
  return state.rows.some((r) => r.id === row.id);
}

/**
 * Write the options for wherever this page is.
 *
 * ‼️ THE PER-PAGE GATE LIVES HERE AND IT IS NOT THE BATCH GATE. The batch verbs refuse while ANY
 * page in the batch has no idea, which is the right question to ask of a batch. This asks the
 * narrower one: do not write page 3's headline until page 3 has an idea. Two scopes, two gates,
 * each written once and each reached by both doors. They are not two implementations of one rule
 * and collapsing them would mean either a batch verb that half-runs or a page verb that refuses
 * because of a decision owed on a different page.
 */
export async function writeForStage(
  clientId: string,
  row: PlanRow,
  by: string,
  state: BatchState
): Promise<PageWorkResult> {
  if (!inBatch(state, row)) {
    return {
      ok: false,
      error: `page ${row.rank} is not in this batch. Only approved plan rows are, so approve the plan first.`,
    };
  }

  const stage = pageStage(state, row);

  switch (stage) {
    case "angle": {
      const { generateAnglesForPlan, anglesFor } = await import("./page-angles");
      // rowId, never a position: this function is holding the row, so there is nothing to count.
      const res = await generateAnglesForPlan({ clientId, by, rowId: row.id });
      if (!res.ok && !res.drafted) {
        return { ok: false, error: res.lines.join(" ").replace(/:warning:\s*/g, "") };
      }
      const mine = (await anglesFor(clientId)).filter((a) => a.planId === row.id);
      return {
        ok: true,
        stage,
        lines: pageWalkLines({ state, row, options: [], angles: mine }),
      };
    }

    case "headline": {
      if (!(await ideaDecided(clientId, row))) {
        return {
          ok: false,
          error:
            `page ${row.rank} has no idea yet, so a headline for it would be a line about a phrase. ` +
            `\`page ${row.rank} more\` writes its ideas first.`,
        };
      }
      const got = await writeHeadlinesFor(clientId, row);
      if (!got.ok) return { ok: false, error: got.error };
      const options = (await optionsFor(clientId, [row])).get(row.id) ?? [];
      const { anglesFor } = await import("./page-angles");
      const mine = (await anglesFor(clientId)).filter((a) => a.planId === row.id);
      const other = await otherFormatsFor(clientId, row);
      return {
        ok: true,
        stage,
        lines: [
          ...pageWalkLines({ state, row, options, angles: mine, titles: other.titles, ads: other.ads }),
          // Said out loud, because a format that silently failed looks identical to one nobody
          // asked for. writeHeadlinesFor refuses to fail the whole run over either of these.
          ...(got.notes.length ? ["", ...got.notes.map((n) => `note: ${n}`)] : []),
        ],
      };
    }

    // ‼️ THIS STAGE ONLY EXISTS WHEN SOMETHING WENT WRONG EARLIER, which is why it writes the
    // missing artifact rather than offering a choice. A page reaches it when its H1 is picked and
    // either the title tags or the ad hooks are absent, and the only way that happens is a failed
    // or refused call inside writeHeadlinesFor, reported in its notes at the time.
    case "formats": {
      const notes: string[] = [];
      const before = await otherFormatsFor(clientId, row);

      if (!before.titles.length) {
        const { generateSeoTitlesForPage, storeSeoTitles } = await import("./page-seo-titles");
        const made = await generateSeoTitlesForPage({ clientId, row, keyword: row.targetKeyword ?? "" });
        if (made.ok) {
          const put = await storeSeoTitles({ clientId, planId: row.id, titles: made.titles });
          if (!put.ok) notes.push(`the title tags could not be filed: ${put.error}`);
        } else notes.push(`no title tags: ${made.error}`);
      }

      if (!before.ads) {
        const { generateDrHeadlinesForPage, storeDrHeadlines } = await import("./page-dr-headlines");
        const made = await generateDrHeadlinesForPage({ clientId, row });
        if (made.ok) {
          const put = await storeDrHeadlines({ clientId, planId: row.id, headlines: made.headlines });
          if (!put.ok) notes.push(`the ad headlines could not be filed: ${put.error}`);
        } else notes.push(`no ad headlines: ${made.error}`);
      }

      // Re-read, so the card prints what is now on file rather than what was missing a moment ago.
      const after = await readBatch(clientId);
      if ("error" in after) return { ok: false, error: after.error };
      const fresh = pageAtRank(after, row.rank) ?? row;
      const { anglesFor } = await import("./page-angles");
      const mine = (await anglesFor(clientId)).filter((a) => a.planId === row.id);
      const other = await otherFormatsFor(clientId, fresh);
      return {
        ok: true,
        stage,
        lines: [
          ...pageWalkLines({
            state: after,
            row: fresh,
            options: [],
            angles: mine,
            titles: other.titles,
            ads: other.ads,
          }),
          ...(notes.length ? ["", ...notes.map((n) => `note: ${n}`)] : []),
        ],
      };
    }

    case "skeleton": {
      // The buyer is read here rather than taken from the caller, so both doors pass the same
      // answer. step 21's thread used to pass null, which lands a multi-audience client in
      // `failures` with startPageDraft refusing to choose.
      const { loadOffer } = await import("./offers");
      const offer = await loadOffer(clientId).catch(() => null);
      const res = await writeSkeletonsFor(clientId, [row], offer?.audienceId ?? null);
      if (!res.written) {
        return { ok: false, error: res.failures[0] ?? `page ${row.rank}'s skeleton could not be written.` };
      }
      // Re-read: the outline is what the card prints and it did not exist a moment ago.
      const after = await readBatch(clientId);
      if ("error" in after) return { ok: false, error: after.error };
      const fresh = pageAtRank(after, row.rank) ?? row;
      const { anglesFor } = await import("./page-angles");
      const mine = (await anglesFor(clientId)).filter((a) => a.planId === row.id);
      return {
        ok: true,
        stage,
        lines: pageWalkLines({ state: after, row: fresh, options: [], angles: mine }),
      };
    }

    case "handover": {
      // ‼️ IT READS AND WRITES NOTHING. The handover options are a registry lookup, so "write the
      // options" is a listing here. One tool per client, so the question this page is being asked
      // is which page gets it, and the answer for ten of eleven pages is a cta sentence instead.
      const { toolOptions, clientTool } = await import("./tool-lane");
      const [options, current] = await Promise.all([
        toolOptions(clientId).catch(() => []),
        clientTool(clientId).catch(() => null),
      ]);

      let toolOnOtherPage: { componentKey: string; rank: number } | null = null;
      if (current?.pageId && current.pageId !== row.pageId) {
        const other = state.rows.find((r) => r.pageId === current.pageId);
        toolOnOtherPage = { componentKey: current.componentKey, rank: other?.rank ?? 0 };
      }

      const { anglesFor } = await import("./page-angles");
      const mine = (await anglesFor(clientId)).filter((a) => a.planId === row.id);
      return {
        ok: true,
        stage,
        lines: pageWalkLines({
          state,
          row,
          options: [],
          angles: mine,
          tools: options.map((o) => ({ label: o.component.label, answers: o.component.answers })),
          toolOnOtherPage,
        }),
      };
    }

    // ‼️ DRAFTING IS ITS OWN VERB AND IS NOT REACHABLE FROM HERE. `more` writes three things to
    // choose between; a body is one thing, costs about eighty seconds, and must not be something a
    // person triggers while looking for options. See draftOnePage.
    case "draft":
      return {
        ok: false,
        error: `page ${row.rank} has every decision it needs. \`page ${row.rank} draft\` writes the body.`,
      };
    case "review":
      return {
        ok: false,
        error: `page ${row.rank} already has a body. \`page ${row.rank} check\` reads it against the evidence and Google's guidance.`,
      };
    case "live":
      return { ok: false, error: `page ${row.rank} is live. Nothing is owed on it.` };
  }
}

/**
 * Take option `option` (1-based) for wherever this page is.
 *
 * ‼️ THE OPTION IS INDEXED OVER WHAT THE CARD PRINTED FOR THIS STAGE, which is what makes a digit
 * mean anything at all. The angle lane numbers over EVERY angle on the page rather than over the
 * drafts, deliberately, so a pick does not renumber the list; this passes the number straight to
 * the lane that printed it rather than re-deriving an index here.
 */
export async function pickForStage(
  clientId: string,
  row: PlanRow,
  option: number,
  by: string,
  state: BatchState
): Promise<PageWorkResult> {
  if (!inBatch(state, row)) {
    return { ok: false, error: `page ${row.rank} is not in this batch.` };
  }
  if (!Number.isInteger(option) || option < 1) {
    return { ok: false, error: `${option} is not one of the options.` };
  }

  const stage = pageStage(state, row);

  switch (stage) {
    case "angle": {
      const { anglesFor, pickAngle } = await import("./page-angles");
      const mine = (await anglesFor(clientId)).filter((a) => a.planId === row.id);
      const chosen = mine[option - 1];
      if (!chosen) {
        return {
          ok: false,
          error: `page ${row.rank} has ${mine.length} idea${mine.length === 1 ? "" : "s"} on file, so there is no option ${option}.`,
        };
      }
      const res = await pickAngle({ clientId, angleId: chosen.id, by });
      if (!res.ok) return { ok: false, error: res.error };

      const after = await readBatch(clientId);
      if ("error" in after) return { ok: false, error: after.error };
      const fresh = pageAtRank(after, row.rank) ?? row;
      return {
        ok: true,
        stage: pageStage(after, fresh),
        lines: [
          `Page ${row.rank} argues: ${res.angle.idea}`,
          ...(res.angle.indoctrination ? [`The belief it installs: ${res.angle.indoctrination}`] : []),
          "The other two are kept as rejected, which is what teaches the next set.",
          "",
          ...pageWalkLines({
            state: after,
            row: fresh,
            options: (await optionsFor(clientId, [fresh])).get(fresh.id) ?? [],
            angles: (await anglesFor(clientId)).filter((a) => a.planId === row.id),
          }),
        ],
      };
    }

    case "headline": {
      const res = await pickHeadlineFor(clientId, row, option, by);
      if (!res.ok) return { ok: false, error: res.error };

      const after = await readBatch(clientId);
      if ("error" in after) return { ok: false, error: after.error };
      const fresh = pageAtRank(after, row.rank) ?? row;
      const { anglesFor } = await import("./page-angles");
      return {
        ok: true,
        stage: pageStage(after, fresh),
        lines: [
          `Page ${row.rank} is now "${res.headline}".`,
          "",
          ...pageWalkLines({
            state: after,
            row: fresh,
            options: [],
            angles: (await anglesFor(clientId)).filter((a) => a.planId === row.id),
          }),
        ],
      };
    }

    // ‼️ AN UNQUALIFIED `pick` NEVER MEANS THE TITLE TAG, and this arm is what says so out loud.
    // A page at this stage has its H1 settled, so a bare digit here has no slot to fill and the
    // one thing it must not do is quietly fill a different one. parsePageWalk keeps the same
    // rule in the grammar by matching `title pick` ahead of `pick`.
    case "formats":
      return {
        ok: false,
        error:
          `page ${row.rank} already has its H1, so there is nothing for a bare pick to take. ` +
          `\`page ${row.rank} title pick ${option}\` takes title tag ${option}.`,
      };

    case "handover": {
      // A tool renders INSIDE a page, so the page has to exist. It does not until the skeleton
      // stage opens one, which is the ordering every other stage here keeps.
      if (!row.pageId) {
        return {
          ok: false,
          error: `page ${row.rank} has no page yet, and a tool renders inside one. Write its skeleton first.`,
        };
      }
      const { pickTool, bindToolToPage } = await import("./tool-lane");
      const picked = await pickTool(clientId, option, by);
      if (!picked.ok) return { ok: false, error: picked.error };
      const bound = await bindToolToPage({ clientId, pageId: row.pageId, by });
      if (!bound.ok) return { ok: false, error: bound.error };

      const after = await readBatch(clientId);
      if ("error" in after) return { ok: false, error: after.error };
      const fresh = pageAtRank(after, row.rank) ?? row;
      return {
        ok: true,
        stage: pageStage(after, fresh),
        lines: [
          `Page ${row.rank} is the tool page: ${bound.componentKey} renders inside it.`,
          "It hands over by being used, so it needs no cta line.",
        ],
      };
    }

    // ‼️ THE STAGES WITH NOTHING TO CHOOSE BETWEEN SAY SO, rather than silently doing the one
    // thing they can do. A digit that quietly meant something else is the failure this grammar
    // was written to avoid.
    case "skeleton":
      return {
        ok: false,
        error: `page ${row.rank} is at its skeleton, and there is nothing to choose between. \`page ${row.rank} more\` writes it.`,
      };
    case "draft":
      return { ok: false, error: `page ${row.rank} wants a body, not a choice. \`page ${row.rank} draft\`.` };
    case "review":
      return { ok: false, error: `page ${row.rank} has a body. \`page ${row.rank} check\` reads it.` };
    case "live":
      return { ok: false, error: `page ${row.rank} is live. Nothing is owed on it.` };
  }
}
