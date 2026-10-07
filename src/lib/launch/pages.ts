// The whole page run for a Launch Lane client, from the plan to the published URL, with no Slack.
//
// ‼️ IT EXISTS BECAUSE THE RUN FINISHED IN A SLACK THREAD AND NOWHERE ELSE (Matthew, 2026-10-04):
// "i dont want to finish on slack i want in the onboarding launching pad." Every stage below was
// reachable only by typing into step 21's thread, which is a surface this lane does not have.
//
// ‼️ IT WRAPS, IT DOES NOT REIMPLEMENT, AND THAT IS THE WHOLE DESIGN. page-plan.ts, page-batch.ts
// and batch-research.ts already own this work and already carry no Slack import; pre-call-pages.ts
// carries exactly two Slack sinks (say and refreshCard) and neither is reachable from the functions
// called here. So the launch board and step 21's thread run the SAME code and cannot drift about
// what `plan approve` or `headline 3 pick 2` means. Writing it twice is how two doors end up
// disagreeing and a person is right either time.
//
// ‼️ THE STAGES CANNOT BE SKIPPED FROM HERE. `plan approve` stopped drafting on 2026-09-14 so that
// every decision lands before any page is written: a headline, then a skeleton, then one research
// pass for the batch, THEN the draft. Each action below refuses on the same condition the Slack
// door refuses on, read back out of readBatch rather than re-derived, because a panel that offered
// a Draft button at the wrong moment would write seven pages off nothing.
//
// ‼️ IT NEVER READS client_hosts AND NEVER IMPORTS @/lib/hub/destinations. publishPage() resolves
// the destination itself, and its own header says why: two callers means two chances to skip the
// ownership check and publish a page onto another client's hostname. This module hands the raw id
// through and renders the choices out of the refusal publishPage returns.
// scripts/_probe-launch-pages.ts asserts that.
//
// ‼️ NO WAIVER LIVES HERE. The Day-0 wall's own rule is that a waiver is offered only after a
// publish has been refused, needs a written reason, and is never a second button beside Publish.
// The one on /dashboard/clients/[id] stays the only one.

import { supabaseAdmin } from "@/lib/db";
import { readDay0 } from "@/lib/clients/day-zero";
import { autoCompleteLaunchStep } from "@/lib/launch/steps";
import {
  approvePlan,
  dropPlanRow,
  editPlanTitle,
  loadPlan,
  setPlanCtaLine,
  swapPlanRow,
  type PlanRow,
  type PlanStatus,
  type PoolItem,
} from "@/lib/clients/page-plan";
import {
  optionsFor,
  pageStage,
  pageWalkLines,
  pickForStage,
  pickHeadlineFor,
  readBatch,
  stageLine,
  writeForStage,
  writeHeadlinesFor,
  writeSkeletonsFor,
  type BatchStage,
  type BatchState,
  type PageStage,
} from "@/lib/clients/page-batch";
import { draftWave, frameContext, offerPool, proposePreCallPlan } from "@/lib/clients/pre-call-pages";
import { publishPage, type PublishRefusal } from "@/lib/hub/publish-page";

// ─────────────────────────────────────────────────────────────────────────────
// What the panel reads
// ─────────────────────────────────────────────────────────────────────────────

export interface LaunchPlanPage {
  /** page_plan.id. The panel addresses rows by RANK, which is what a person sees. */
  id: string;
  rank: number;
  role: "pillar" | "support" | null;
  question: string;
  targetKeyword: string;
  workingTitle: string;
  headline: string | null;
  slug: string | null;
  ctaLine: string | null;
  status: PlanStatus;
  pageId: string | null;
  pageStatus: "draft" | "published" | "archived" | null;
  hasOutline: boolean;
  hasBody: boolean;
  /** The three candidates written for this page, in pick order. Empty until headlines run. */
  headlineOptions: string[];
  /**
   * What this page argues, once somebody has picked its idea. Null while it still needs one.
   *
   * ‼️ READ FROM THE ANGLE, NOT FROM page_plan.angle. That column holds the idea text copied onto
   * the row, and it is also written by the planner for rows that never had an angle at all, so it
   * cannot answer "has anybody decided what this page argues".
   */
  angle: string | null;
  /** The three ideas written for this page, in pick order. Empty until angles run. */
  angleOptions: string[];
}

export interface LaunchLadderRung {
  stage: number;
  readerState: string;
  claim: string;
  anchorKey: string;
  /**
   * Whether that anchor key is in this client's catalogue AND hands something over.
   *
   * ‼️ THIS IS WHY `ladder pick N` REFUSES, AND THE PANEL HAS TO SHOW IT BEFORE THE PRESS.
   * pickRung reads the catalogue entry and refuses on `!entry?.deliverable`, so a rung naming a
   * magnet key that no longer exists looks identical to a pickable one until somebody taps it.
   */
  anchorDeliverable: boolean;
  anchorTitle: string | null;
}

export interface LaunchPagesState {
  /** readBatch's own stage, so the panel and the Slack card agree about where the run is. */
  stage: BatchStage;
  stageText: string;
  /** False when something upstream is missing; `missing` says what. */
  ready: boolean;
  missing: string[];
  plan: LaunchPlanPage[];
  proposed: number;
  approved: number;
  /** Ranks of pages with no picked idea. headlines_write refuses while this is non-empty. */
  needAngle: number[];
  needHeadline: number[];
  needSkeleton: number[];
  /** Ranks of pages with a skeleton that have not said how they hand over. */
  needHandover: number[];
  drafted: number;
  /** Rows that still want a body. The Draft button stays live while this is above zero. */
  outstanding: number;
  ladder: LaunchLadderRung[] | null;
  ladderAnchorStage: number | null;
  ladderAnchorKey: string | null;
  anchorTitle: string | null;
  /**
   * ‼️ SURFACED HERE BECAUSE THE PUBLISH PRESS NOW LIVES ON THIS PANEL. publishPage() refuses while
   * this is null, and that refusal would otherwise arrive after the whole run is done, which is the
   * worst moment to learn it. Said up front instead.
   */
  day0ArchivedAt: string | null;
}

function toPage(
  row: PlanRow,
  batch: BatchState | null,
  options: Map<string, string[]>,
  angles: Map<string, { picked: string | null; options: string[] }>
): LaunchPlanPage {
  const angle = angles.get(row.id) ?? null;
  return {
    id: row.id,
    rank: row.rank,
    role: row.role,
    question: row.question,
    targetKeyword: row.targetKeyword,
    workingTitle: row.workingTitle,
    headline: row.headline,
    slug: row.slug,
    ctaLine: row.ctaLine,
    status: row.status,
    pageId: row.pageId,
    pageStatus: row.pageStatus,
    hasOutline: Boolean(batch?.outlines.get(row.id)),
    hasBody: Boolean(batch?.drafted.some((d) => d.id === row.id)),
    headlineOptions: options.get(row.id) ?? [],
    angle: angle?.picked ?? null,
    angleOptions: angle?.options ?? [],
  };
}

/**
 * The ideas written for each planned page, and which one was picked.
 *
 * ‼️ THE OPTION NUMBERS ARE OVER EVERY ANGLE ON THE PAGE, which is what `angle 3 pick 2` means on
 * the Slack door too. anglesFor returns them oldest first and the order is stable, so a number
 * beside an idea here is the same number tomorrow.
 */
async function angleOptionsFor(
  clientId: string,
  rows: readonly PlanRow[]
): Promise<Map<string, { picked: string | null; options: string[] }>> {
  const out = new Map<string, { picked: string | null; options: string[] }>();
  try {
    const { anglesFor } = await import("@/lib/clients/page-angles");
    const all = await anglesFor(clientId);
    for (const row of rows) {
      const mine = all.filter((a) => a.planId === row.id);
      out.set(row.id, {
        picked: mine.find((a) => a.status === "approved")?.idea ?? null,
        options: mine.map((a) => a.idea),
      });
    }
  } catch (e) {
    // The panel losing the ideas is worth far less than the panel going dark, and readBatch has
    // already decided the gate separately. Same posture as optionsFor's own failure path.
    console.error(`[launch-pages] angle read failed: ${(e as Error).message}`);
  }
  return out;
}

/** The ladder, each rung marked with whether its anchor can actually be picked. */
async function ladderView(clientId: string): Promise<{
  rungs: LaunchLadderRung[] | null;
  anchorStage: number | null;
  anchorKey: string | null;
  anchorTitle: string | null;
}> {
  const { ladderState } = await import("@/lib/clients/anchor-ladder");
  const st = await ladderState(clientId);
  const catalogue = st.inputs?.catalogue ?? [];

  return {
    rungs:
      st.ladder?.rungs.map((r) => {
        const entry = catalogue.find((c) => c.key === r.anchorKey);
        return {
          stage: r.stage as number,
          readerState: r.readerState,
          claim: r.claim,
          anchorKey: r.anchorKey,
          anchorDeliverable: Boolean(entry?.deliverable),
          anchorTitle: entry?.title ?? null,
        };
      }) ?? null,
    anchorStage: st.anchorStage ?? null,
    anchorKey: st.anchorKey ?? null,
    anchorTitle: catalogue.find((c) => c.key === st.anchorKey)?.title ?? null,
  };
}

/**
 * Everything the panel renders, in one read.
 *
 * ‼️ IT READS loadPlan AS WELL AS readBatch AND BOTH ARE NEEDED. readBatch deliberately sees only
 * approved and claimed rows, which is right for the batch but means a freshly proposed plan is
 * invisible to it: the panel would say "no plan yet" over seven rows waiting on approval.
 */
export async function launchPagesState(clientId: string): Promise<LaunchPagesState | { error: string }> {
  const [plan, batch, fc, day0, ladderBits] = await Promise.all([
    loadPlan(clientId),
    readBatch(clientId),
    frameContext(clientId),
    readDay0(clientId).catch(() => null),
    ladderView(clientId).catch(() => null),
  ]);

  if ("error" in plan) return { error: plan.error };
  const batchState = "error" in batch ? null : batch;

  // Only the pre-call rows. A row with no role belongs to the other lane's page studio.
  const rows = plan.rows.filter((r) => r.role).sort((a, b) => a.rank - b.rank);
  const options = rows.length ? await optionsFor(clientId, rows) : new Map<string, string[]>();
  const angles = rows.length ? await angleOptionsFor(clientId, rows) : new Map<string, { picked: string | null; options: string[] }>();

  const outstanding = rows.filter(
    (r) =>
      (r.status === "approved" || r.status === "claimed") &&
      !batchState?.drafted.some((d) => d.id === r.id)
  ).length;

  return {
    stage: batchState?.stage ?? "no_plan",
    stageText: batchState ? stageLine(batchState) : "error" in batch ? batch.error : "No plan yet.",
    ready: fc.ok,
    missing: fc.ok ? [] : fc.missing,
    plan: rows.map((r) => toPage(r, batchState, options, angles)),
    proposed: rows.filter((r) => r.status === "proposed").length,
    approved: rows.filter((r) => r.status === "approved" || r.status === "claimed").length,
    needAngle: (batchState?.needAngle ?? []).map((r) => r.rank),
    needHeadline: (batchState?.needHeadline ?? []).map((r) => r.rank),
    needSkeleton: (batchState?.needSkeleton ?? []).map((r) => r.rank),
    needHandover: (batchState?.needHandover ?? []).map((r) => r.rank),
    drafted: batchState?.drafted.length ?? 0,
    outstanding,
    ladder: ladderBits?.rungs ?? null,
    ladderAnchorStage: ladderBits?.anchorStage ?? null,
    ladderAnchorKey: ladderBits?.anchorKey ?? null,
    anchorTitle: ladderBits?.anchorTitle ?? null,
    day0ArchivedAt: day0?.archivedAt ?? null,
  };
}

/**
 * The page run as a block of text for the conversation's context.
 *
 * ‼️ IT IS IN THE CONTEXT ON EVERY TURN, NOT ONLY BEHIND read_pages, AND THE REASON IS A MEASURED
 * WRONG ANSWER. On 2026-10-05, with seven rows sitting in page_plan waiting on approval, the chat
 * answered "Pages: 0 drafted, 0 published. No page run has started yet." Both numbers were right
 * and the sentence was false: publishingFacts counts client_pages, which stays empty until drafting,
 * so a plan that exists is invisible to it and "0 pages" reads as "nothing has happened". That is
 * the same shape of error publishing-facts.ts was written for, one table further on.
 *
 * Capped, and the cap announces itself, for the reason the keyword list is capped.
 */
export async function pageRunText(clientId: string): Promise<string> {
  const st = await launchPagesState(clientId);
  if ("error" in st) return "THE PAGE RUN: could not be read just now. Say so rather than guessing.";

  if (!st.plan.length) {
    return [
      "THE PAGE RUN:",
      st.ready
        ? "  No pages are planned yet. run_pages stage=plan_new proposes one pillar and six supports from the SELECTED keywords."
        : `  Nothing can be planned yet. Waiting on: ${st.missing.join("; ")}.`,
    ].join("\n");
  }

  const CAP = 20;
  const shown = st.plan.slice(0, CAP);
  const lines = shown.map((p) => {
    const has = [
      p.angle ? "idea" : null,
      p.headline ? "headline" : null,
      p.hasOutline ? "skeleton" : null,
      p.ctaLine ? "cta" : null,
      p.hasBody ? "body" : null,
      p.pageStatus === "published" ? "LIVE" : null,
    ].filter(Boolean);
    return [
      `    ${p.rank}. [${p.role}] ${p.headline ?? p.workingTitle} <- ${p.targetKeyword} (${p.status}${has.length ? ", " + has.join(", ") : ", nothing written yet"})`,
      // The idea is what the headline and the skeleton are both written from, so it belongs on the
      // page's own line rather than being something the chat has to go and ask for.
      ...(p.angle ? [`         argues: ${p.angle}`] : []),
    ].join("\n");
  });

  return [
    "THE PAGE RUN, COUNTED FROM page_plan AND client_pages:",
    `  ‼️ ${st.plan.length} page(s) ARE PLANNED. A plan exists before any page does, so "0 drafted" never means "nothing has started".`,
    `  ${st.proposed} proposed, ${st.approved} approved, ${st.drafted} with a body, ${st.outstanding} still to draft.`,
    `  stage: ${st.stageText}`,
    "  the planned pages, and the keyword each one aims at:",
    ...lines,
    ...(st.plan.length > shown.length
      ? [`    ...and ${st.plan.length - shown.length} more not listed. Say so rather than implying this is all of them.`]
      : []),
    ...(st.needAngle.length
      ? [
          `  still need an IDEA: ${st.needAngle.join(", ")}`,
          "  ‼️ headlines_write REFUSES while any page has no idea. Run angles_write, then angle_pick",
          "  for each page. A headline written before the idea is a line about a phrase.",
        ]
      : []),
    ...(st.needHeadline.length ? [`  still need a headline: ${st.needHeadline.join(", ")}`] : []),
    ...(st.needSkeleton.length ? [`  still need a skeleton: ${st.needSkeleton.join(", ")}`] : []),
    ...(st.needHandover.length ? [`  still need a handover (plan_cta, or tool_pick for one of them): ${st.needHandover.join(", ")}`] : []),
    "  ‼️ THE WORKING TITLES ARE WRITTEN AT PLAN TIME AND THE KEYWORDS ARE HIS OWN PICKS. If he does",
    "  not recognise a title, that is the title being new, not the keyword being wrong.",
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// The actions
// ─────────────────────────────────────────────────────────────────────────────

export const LAUNCH_PAGE_ACTIONS = [
  "keywords_add",
  "keywords_drop",
  "keywords_select",
  "keywords_unselect",
  "strategy_set",
  "ladder_write",
  "ladder_pick",
  "plan_new",
  "plan_approve",
  "plan_drop",
  "plan_swap",
  "plan_edit",
  "plan_cta",
  // ─────────────────────────────────────────────────────────────────────────
  // The per-page walk: ONE page, through whatever stage it is at
  //
  // ‼️ THESE SIT ABOVE THE BATCH VERBS BECAUSE THE ORDER IN THIS ARRAY IS WHAT TEACHES. A person
  // working an onboarding works one keyword at a time and leaves several in flight at different
  // stages; the batch verbs are the same work asked of every page at once. Both are real and
  // neither replaces the other, so the narrower one is listed first.
  //
  // ‼️ THERE ARE TWO ANGLE GATES AND THEY ARE NOT TWO IMPLEMENTATIONS OF ONE RULE. The batch verb
  // below refuses while ANY page has no idea, which is the right question to ask of a batch about
  // to spend eleven model calls. writeForStage asks the narrower one: do not write page 3's
  // headline until page 3 has an idea. Collapsing them gives either a batch verb that half-runs or
  // a page verb that refuses over a decision owed on a different page.
  "page_write",
  "page_pick",
  "page_draft",
  "page_check",
  // ─────────────────────────────────────────────────────────────────────────
  // ‼️ THE IDEA COMES BEFORE THE LINE, AND LISTING THEM IN THIS ORDER IS HALF OF WHY. The chat is
  // handed this array as the stages it may run, so the order it reads in is the order it teaches.
  // Angles were missing from this lane entirely until now: the plan was approved and a headline was
  // asked for straight away, which is the failure page-angles.ts opens on.
  "angles_write",
  "angle_pick",
  "headlines_write",
  "headline_pick",
  "skeletons_write",
  "tool_options",
  "tool_pick",
  "research_prompt",
  "research_file",
  "draft_wave",
  "publish",
  "unpublish",
] as const;

export type LaunchPageAction = (typeof LAUNCH_PAGE_ACTIONS)[number];

export function isLaunchPageAction(v: string): v is LaunchPageAction {
  return (LAUNCH_PAGE_ACTIONS as readonly string[]).includes(v);
}

export type LaunchPagesResult =
  | {
      ok: true;
      message: string;
      /** A prompt for the person to run somewhere else. Rendered in a copy block, never auto-run. */
      prompt?: string;
      /** Set by publish, which is the only action that knows a public URL. */
      pageUrl?: string | null;
      /** draft_wave: how many still want a body, so the panel can say "press again". */
      remaining?: number;
    }
  | { ok: false; error: string; refusal?: PublishRefusal };

export interface LaunchPagesInput {
  clientId: string;
  action: LaunchPageAction;
  actor: string;
  /** The page's RANK, 1-based, as the panel shows it. Not a row id. */
  rank?: number | null;
  /** Which of the three headline candidates, 1-based. */
  pick?: number | null;
  /** ladder_pick: the rung, 5 (furthest from buying) to 1. */
  stage?: number | null;
  /** plan_edit: the new working title. plan_cta: the sentence, or empty to clear it. */
  text?: string | null;
  /** publish / unpublish: client_pages.id. */
  pageId?: string | null;
  /** publish: which destination, once the picker has been answered. */
  destinationId?: string | null;
  /** keywords_select / keywords_unselect: the phrases, exactly as they are spelled in the pool. */
  phrases?: string[] | null;
  /** strategy_set: the one pillar phrase, and the supports under it. */
  pillar?: string | null;
  supports?: string[] | null;
  /** keywords_add: the cluster the new phrases join. Given, never guessed. */
  category?: string | null;
}

/**
 * Typed phrases to this client's own keyword rows.
 *
 * ‼️ IT REFUSES AN UNKNOWN PHRASE AND NAMES IT, rather than selecting what it did match. A partial
 * write here is the worst outcome available: the caller believes a list of seven is in play, six
 * are, and the page plan that comes out is built off a set nobody chose. Keywords are never minted
 * here either, by anybody: this resolves against what the pool already holds.
 */
async function resolvePhrases(
  clientId: string,
  phrases: readonly string[]
): Promise<{ ok: true; rows: Array<{ id: string; phrase: string }> } | { ok: false; error: string }> {
  const want = phrases.map((p) => String(p ?? "").trim()).filter(Boolean);
  if (!want.length) return { ok: false, error: "No keywords were named." };

  const { data, error } = await supabaseAdmin
    .from("client_keywords")
    .select("id, phrase, normalized, dropped_at")
    .eq("client_id", clientId);
  if (error) return { ok: false, error: error.message };

  // Matched on a squashed lower-case form, and on `normalized` as well as `phrase`, because he
  // types these from memory and "CHATGPT local business ranking" should not miss on its capitals.
  const key = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();
  const byKey = new Map<string, { id: string; phrase: string }>();
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    if (r.dropped_at) continue;
    const row = { id: String(r.id), phrase: String(r.phrase) };
    byKey.set(key(row.phrase), row);
    if (r.normalized) byKey.set(key(String(r.normalized)), row);
  }

  const rows: Array<{ id: string; phrase: string }> = [];
  const missing: string[] = [];
  for (const w of want) {
    const hit = byKey.get(key(w));
    if (hit) rows.push(hit);
    else missing.push(w);
  }
  if (missing.length) {
    return {
      ok: false,
      error:
        `Not in this client's keyword pool: ${missing.join("; ")}. Nothing was changed. ` +
        "A keyword has to exist before it can be picked, so add it where the pool is built rather than here.",
    };
  }
  return { ok: true, rows };
}

/** The pre-call rows at the moment of the action, rank-ordered. */
async function planRows(clientId: string): Promise<PlanRow[] | { error: string }> {
  const plan = await loadPlan(clientId);
  if ("error" in plan) return { error: plan.error };
  return plan.rows.filter((r) => r.role).sort((a, b) => a.rank - b.rank);
}

function atRank(rows: readonly PlanRow[], rank: number | null | undefined): PlanRow | null {
  return rows.find((r) => r.rank === rank) ?? null;
}

export async function runLaunchPagesAction(input: LaunchPagesInput): Promise<LaunchPagesResult> {
  const { clientId, actor } = input;

  switch (input.action) {
    // ── The keywords, and which of them the whole build hangs off ─────────────
    //
    // ‼️ selectKeywordIds AND unselectKeywordIds ARE CALLED, NEVER AN UPDATE WRITTEN HERE.
    // client_keywords.selected_at has exactly one writer by design: step-needs.ts declares it as
    // living in keyword-decisions.ts and _probe-dead-wires.ts greps that file before believing the
    // declaration. A second writer in this lane would make the generated docs wrong about the one
    // column that decides what every page is built from.
    // ‼️ THE ONE THAT MINTS. Everything else on this list PICKS from phrases that already exist;
    // this is the only door that creates one, and until 2026-10-05 the lane had none, so the chat
    // correctly told him it could not add a keyword. The shared filter still decides what may join.
    case "keywords_add": {
      const { mintKeywords } = await import("@/lib/clients/keyword-mint");
      const res = await mintKeywords({
        clientId,
        phrases: input.phrases ?? [],
        // Hand-added keywords land in their own named cluster, so they stay visibly distinct from
        // the harvested ones. Matthew's rule, 2026-10-05.
        category: input.category ?? "",
        by: actor,
      });
      if (!res.ok) return { ok: false, error: res.error };

      const r = res.report;
      return {
        ok: true,
        message: [
          r.added.length ? `Added ${r.added.length}: ${r.added.join("; ")}.` : "",
          r.restored.length ? `Brought back ${r.restored.length}: ${r.restored.join("; ")}.` : "",
          r.already.length ? `Already in the set: ${r.already.join("; ")}.` : "",
          r.hooks.length
            ? `Stored as hooks, which can never be a page's keyword: ${r.hooks.join("; ")}.`
            : "",
          r.refused.length
            ? `Refused: ${r.refused.map((f) => `${f.phrase} (${f.why})`).join("; ")}.`
            : "",
          `${r.selected} are now approved and in the page pool.`,
          "Re-propose the plan to build pages off them.",
        ]
          .filter(Boolean)
          .join(" "),
      };
    }

    // ‼️ DROPPED, NOT DELETED, AND NOT THE SAME AS UNSELECTING. A drop is remembered so a later
    // expansion cannot propose the phrase back; unselecting leaves it approved and measurable and
    // only takes it out of the page pool. Matthew picked drop as what "remove" means here.
    case "keywords_drop": {
      const got = await resolvePhrases(clientId, input.phrases ?? []);
      if (!got.ok) return { ok: false, error: got.error };
      const { dropKeywordIds } = await import("@/lib/clients/keyword-mint");
      const res = await dropKeywordIds({ clientId, ids: got.rows.map((r) => r.id), by: actor });
      if (!res.ok) return { ok: false, error: res.error };
      return {
        ok: true,
        message:
          `Dropped ${res.dropped}: ${got.rows.map((r) => r.phrase).join("; ")}. ` +
          "They are remembered as unwanted, so a later expansion will not propose them again.",
      };
    }

    case "keywords_select": {
      const got = await resolvePhrases(clientId, input.phrases ?? []);
      if (!got.ok) return { ok: false, error: got.error };
      const { selectKeywordIds } = await import("@/lib/clients/keyword-decisions");
      const res = await selectKeywordIds({ clientId, ids: got.rows.map((r) => r.id), by: actor });
      if (!res.ok) return { ok: false, error: res.error };
      return {
        ok: true,
        message:
          `Selected ${res.selected}: ${got.rows.map((r) => r.phrase).join("; ")}. ` +
          "The page plan is built from the selected pool, so re-propose it if it was already planned.",
      };
    }

    case "keywords_unselect": {
      const got = await resolvePhrases(clientId, input.phrases ?? []);
      if (!got.ok) return { ok: false, error: got.error };
      const { unselectKeywordIds } = await import("@/lib/clients/keyword-decisions");
      const res = await unselectKeywordIds({ clientId, ids: got.rows.map((r) => r.id), by: actor });
      if (!res.ok) return { ok: false, error: res.error };
      return {
        ok: true,
        message:
          `Stepped ${res.unselected} back to undecided: ${got.rows.map((r) => r.phrase).join("; ")}. ` +
          "They are still approved and still measurable; they are just out of the page pool.",
      };
    }

    // ‼️ THE PILLAR AND THE SUPPORTS ARE THE PLAN'S SKELETON, so this is the decision that matters
    // most on this list. One page aims at the pillar and every other page links to it.
    case "strategy_set": {
      const { pickPillarById, pickSupportsByIds } = await import("@/lib/clients/anchor-ladder");
      const notes: string[] = [];

      if (input.pillar) {
        const got = await resolvePhrases(clientId, [input.pillar]);
        if (!got.ok) return { ok: false, error: got.error };
        const res = await pickPillarById(clientId, got.rows[0].id, actor);
        if (!res.ok) return { ok: false, error: res.message };
        notes.push(res.message);
      }

      if (input.supports?.length) {
        const got = await resolvePhrases(clientId, input.supports);
        if (!got.ok) return { ok: false, error: got.error };
        // setRole clears every row holding this role before it writes, so this REPLACES the set
        // rather than adding to it. Said out loud because "supports: a, b" meaning "only a and b"
        // is the opposite of what a person usually expects from a list.
        const res = await pickSupportsByIds(clientId, got.rows.map((r) => r.id), actor);
        if (!res.ok) return { ok: false, error: res.message };
        notes.push(res.message);
      }

      if (!notes.length) return { ok: false, error: "Name a pillar, or supports, or both." };
      return {
        ok: true,
        message: `${notes.join(" ")} The supports named REPLACE the previous set. Re-propose the plan to build pages off this.`,
      };
    }

    // ── The ladder, which is what the anchor offer is picked off ───────────────
    //
    // ‼️ NO CRON_SECRET AND NO WAVE HERE. writeLadder is one model call that stores one document, so
    // it completes inside this request. The chaining trap belongs to the DRAFTING, lower down.
    case "ladder_write": {
      const { writeLadder } = await import("@/lib/clients/anchor-ladder");
      const res = await writeLadder(clientId, actor);
      return res.ok
        ? {
            ok: true,
            message: "The awareness ladder is rewritten against the catalogue as it stands today.",
          }
        : { ok: false, error: res.error };
    }

    case "ladder_pick": {
      const stage = Number(input.stage);
      if (!Number.isInteger(stage) || stage < 1 || stage > 5) {
        return { ok: false, error: "A rung is 1 to 5, where 5 is furthest from buying." };
      }
      const { pickRung } = await import("@/lib/clients/anchor-ladder");
      const res = await pickRung(clientId, stage, actor);
      return res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error };
    }

    // ── The plan ──────────────────────────────────────────────────────────────
    case "plan_new": {
      const fc = await frameContext(clientId);
      if (!fc.ok) return { ok: false, error: `Not yet. Waiting on: ${fc.missing.join("; ")}.` };
      const res = await proposePreCallPlan(clientId, fc.ctx);
      return res.ok ? { ok: true, message: res.note } : { ok: false, error: res.error };
    }

    case "plan_approve": {
      const res = await approvePlan(clientId, actor, { roleOnly: true });
      if (!res.ok) return { ok: false, error: res.error };
      // ‼️ IT DOES NOT DRAFT, AND SAYING SO IS THE POINT. This press used to be the end of the
      // decisions and has been the START of the batch since 2026-09-14, so the message names what
      // comes next rather than implying pages are being written.
      return {
        ok: true,
        message: res.count
          ? `Approved ${res.count} page${res.count === 1 ? "" : "s"}. Next is a headline for each one, then a skeleton, then one research pass for the whole batch.`
          : "Nothing was waiting on approval.",
      };
    }

    case "plan_drop": {
      const res = await dropPlanRow(clientId, Number(input.rank));
      return res.ok
        ? {
            ok: true,
            message: `Dropped "${res.dropped.workingTitle}". The pages after it moved up one, and a new plan fills the slot.`,
          }
        : { ok: false, error: res.error };
    }

    case "plan_swap": {
      const rows = await planRows(clientId);
      if ("error" in rows) return { ok: false, error: rows.error };
      const target = atRank(rows, input.rank);
      if (!target) return { ok: false, error: `There is no page ${input.rank} in this plan.` };

      const fc = await frameContext(clientId);
      if (!fc.ok) return { ok: false, error: `Not yet. Waiting on: ${fc.missing.join("; ")}.` };
      const pool = await offerPool(clientId);
      if ("error" in pool) return { ok: false, error: pool.error };

      // The same filter the thread uses: a swapped support stays about the offer, and a swapped
      // pillar stays a naming variant rather than becoming any high-scoring question.
      const items: PoolItem[] = pool.pool
        .filter((p) => p.relevant && (target.role !== "pillar" || p.naming))
        .sort((a, b) => a.tier - b.tier || b.score - a.score)
        .map((p) => ({
          question: p.question,
          score: p.score,
          theme: p.categoryLabel,
          origin: "keyword" as const,
          category: p.category,
        }));

      const res = await swapPlanRow(clientId, target.rank, fc.ctx, {
        pool: items,
        keywords: pool.keywords,
        synonyms: pool.synonyms,
      });
      return res.ok
        ? {
            ok: true,
            message: `Swapped "${res.replaced}" for "${res.row.workingTitle}". It is proposed again, so approve it to lock it in.`,
          }
        : { ok: false, error: res.error };
    }

    case "plan_edit": {
      const res = await editPlanTitle(clientId, Number(input.rank), String(input.text ?? ""));
      return res.ok
        ? { ok: true, message: `Renamed page ${input.rank}.` }
        : { ok: false, error: res.error };
    }

    case "plan_cta": {
      const rows = await planRows(clientId);
      if ("error" in rows) return { ok: false, error: rows.error };
      const row = atRank(rows, input.rank);
      if (!row) return { ok: false, error: `There is no page ${input.rank} in this plan.` };
      const res = await setPlanCtaLine(clientId, row, input.text?.trim() ? input.text : null);
      return res.ok
        ? {
            ok: true,
            message: res.stored
              ? `Page ${row.rank} offers the magnet with: ${res.stored}`
              : `Page ${row.rank} falls back to the magnet's own lines.`,
          }
        : { ok: false, error: res.error };
    }

    // ── The batch: headline, then skeleton, then research, then draft ──────────
    // ─────────────────────────────────────────────────────────────────────
    // The idea, which is the layer this lane was missing
    //
    // ‼️ IT WRAPS page-angles.ts AND REIMPLEMENTS NOTHING, the same rule the rest of this file
    // keeps. The Slack door reaches the identical functions through handlePageAngleThreadReply,
    // so `angle 3 pick 2` cannot come to mean two things.
    // ─────────────────────────────────────────────────────────────────────

    case "angles_write": {
      const rows = await planRows(clientId);
      if ("error" in rows) return { ok: false, error: rows.error };
      if (!rows.length) {
        return { ok: false, error: "No planned pages yet. Propose the plan and approve it first." };
      }

      const { generateAnglesForPlan, anglesFor } = await import("@/lib/clients/page-angles");

      // ‼️ THE ROW'S ID, NOT A POSITION, AND THIS USED TO BE NINE LINES OF INDEX ARITHMETIC UNDER A
      // COMMENT EXPLAINING THE TRAP. generateAnglesForPlan's `only` is a position on the
      // rank-ordered card and every number this lane takes is a RANK, so the conversion had to
      // happen somewhere, and anywhere it happens it can name the wrong page after a drop leaves a
      // gap. It now takes `rowId`, so there is nothing to convert and nothing to get wrong.
      let rowId: string | undefined;
      if (input.rank) {
        const named = atRank(rows, input.rank);
        if (!named) {
          return { ok: false, error: `There is no page ${input.rank} in this plan. There are ${rows.length}.` };
        }
        rowId = named.id;
      }

      const res = await generateAnglesForPlan({ clientId, by: actor, rowId });

      // The options come back with the result, for the reason headlines_write states below: a count
      // is a true sentence that answers nothing, in front of somebody whose next move is to pick one.
      const angles = await anglesFor(clientId);
      const lines = rows.flatMap((row) => {
        const mine = angles.filter((a) => a.planId === row.id);
        if (!mine.length) return [`${row.rank}. ${row.targetKeyword}: no ideas written`];
        const picked = mine.find((a) => a.status === "approved");
        return [
          `${row.rank}. ${row.targetKeyword}${picked ? `: picked ${picked.idea}` : ""}`,
          ...(picked ? [] : mine.map((a, i) => `     option ${i + 1}: ${a.idea}`)),
        ];
      });

      if (!res.ok && !res.drafted) {
        return { ok: false, error: res.lines.join(" ").replace(/:warning:\s*/g, "") };
      }

      return {
        ok: true,
        message: [
          res.drafted
            ? `Wrote three ideas for ${res.drafted} page${res.drafted === 1 ? "" : "s"}.`
            : "Every page already had its ideas.",
          ...(res.failed ? [`${res.failed} failed.`] : []),
          "Show these to him verbatim and ask which idea he wants per page:",
          ...lines,
        ].join("\n"),
      };
    }

    case "angle_pick": {
      const rows = await planRows(clientId);
      if ("error" in rows) return { ok: false, error: rows.error };
      const row = atRank(rows, input.rank);
      if (!row) {
        return { ok: false, error: `There is no page ${input.rank} in this plan. There are ${rows.length}.` };
      }

      const { anglesFor, pickAngle } = await import("@/lib/clients/page-angles");

      // ‼️ INDEXED OVER EVERY ANGLE ON THE PAGE, NOT OVER THE DRAFTS, and that matches the Slack
      // door exactly. Numbering the drafts alone would renumber the list the moment one was picked.
      const mine = (await anglesFor(clientId)).filter((a) => a.planId === row.id);
      const choice = mine[Number(input.pick) - 1];
      if (!choice) {
        return {
          ok: false,
          error: `Page ${row.rank} has ${mine.length} idea${mine.length === 1 ? "" : "s"} on file, so there is no option ${input.pick}.`,
        };
      }

      const res = await pickAngle({ clientId, angleId: choice.id, by: actor });
      if (!res.ok) return { ok: false, error: res.error };

      const after = await readBatch(clientId);
      const left = "error" in after ? 0 : after.needAngle.length;

      return {
        ok: true,
        message: [
          `Page ${row.rank} argues: ${res.angle.idea}`,
          ...(res.angle.indoctrination ? [`The belief it installs: ${res.angle.indoctrination}`] : []),
          "The other two are kept as rejected, which is what teaches the next set.",
          left
            ? `${left} page${left === 1 ? "" : "s"} still need an idea.`
            : "Every page has its idea. Headlines next, and they are written from these rather than from the keyword alone.",
        ].join("\n"),
      };
    }

    case "headlines_write": {
      const batch = await readBatch(clientId);
      if ("error" in batch) return { ok: false, error: batch.error };
      if (!batch.rows.length) {
        return { ok: false, error: "No approved pages yet. Approve the plan first." };
      }
      // ‼️ THE IDEA COMES BEFORE THE LINE, AND THIS IS THE GATE THAT WAS MISSING. Without it the
      // generator is asked to write a line about a phrase, and thirty three candidates come back
      // reading as thirty three ways of saying the phrase out loud. Same shape as the skeleton
      // gate below: it refuses on the condition, and the condition is read back out of readBatch.
      if (batch.needAngle.length) {
        return {
          ok: false,
          error:
            `${batch.needAngle.length} page${batch.needAngle.length === 1 ? "" : "s"} still need an idea. ` +
            "Run the angles first: a headline written before anybody decided what the page argues is a line about a phrase.",
        };
      }

      // ‼️ NARROWED AFTER THE GATE AND NEVER INSIDE IT. The gate above refuses on the BATCH and
      // its condition is read character for character by _probe-launch-pages.ts; adding
      // `&& !input.rank` to it would make a per-page press skip the batch question entirely, which
      // is how eleven pages get headlines written off one page's idea. The per-page question is
      // asked by writeForStage, reached through page_write.
      const targets = input.rank
        ? [atRank(batch.rows, input.rank)].filter((r): r is PlanRow => Boolean(r))
        : batch.rows;
      if (!targets.length) {
        return { ok: false, error: `There is no page ${input.rank} in this batch. There are ${batch.rows.length}.` };
      }

      const existing = await optionsFor(clientId, targets);
      const failures: string[] = [];
      let written = 0;
      for (const row of targets) {
        // ‼️ SKIPPED WHEN OPTIONS ALREADY EXIST, so pressing again after a partial failure does not
        // bury the three somebody has already read under three more.
        if ((existing.get(row.id) ?? []).length) continue;
        const got = await writeHeadlinesFor(clientId, row);
        if (got.ok) written += 1;
        else failures.push(got.error);
      }

      // ‼️ IT HANDS BACK THE OPTIONS, AND RETURNING ONLY A COUNT WAS A DEAD END (2026-10-06).
      // Asked to show the headline options the chat ran this, got "Every page already had its three
      // options", and stopped: a true sentence that answers nothing, in front of a person whose next
      // move is to pick one. Whichever verb the model reaches for, the candidates come back with it.
      const after = await optionsFor(clientId, targets);
      const lines = targets.flatMap((row) => {
        const opts = after.get(row.id) ?? [];
        if (row.headline) return [`${row.rank}. ${row.targetKeyword}: picked ${row.headline}`];
        if (!opts.length) return [`${row.rank}. ${row.targetKeyword}: no options written`];
        return [
          `${row.rank}. ${row.targetKeyword}`,
          ...opts.map((h, i) => `     option ${i + 1}: ${h}`),
        ];
      });

      return {
        ok: true,
        message: [
          written
            ? `Wrote three options for ${written} page${written === 1 ? "" : "s"}.`
            : "Every page already had its three options.",
          ...failures.map((f) => `Not written: ${f}`),
          "Show these to him verbatim and ask which he wants per page:",
          ...lines,
        ]
          .filter(Boolean)
          .join("\n"),
      };
    }

    case "headline_pick": {
      const batch = await readBatch(clientId);
      if ("error" in batch) return { ok: false, error: batch.error };
      const row = atRank(batch.rows, input.rank);
      if (!row) {
        return {
          ok: false,
          error: `There is no page ${input.rank} in this batch. There are ${batch.rows.length}.`,
        };
      }
      const res = await pickHeadlineFor(clientId, row, Number(input.pick), actor);
      if (!res.ok) return { ok: false, error: res.error };

      const after = await readBatch(clientId);
      const left = "error" in after ? 0 : after.needHeadline.length;
      return {
        ok: true,
        message:
          `Page ${row.rank} is now "${res.headline}". ` +
          (left
            ? `${left} page${left === 1 ? "" : "s"} still need one.`
            : "Every page has a headline."),
      };
    }

    case "skeletons_write": {
      const batch = await readBatch(clientId);
      if ("error" in batch) return { ok: false, error: batch.error };
      // ‼️ THE SAME REFUSAL THE THREAD GIVES. A skeleton written before its headline is an outline
      // for a page that does not know what it is promising.
      if (batch.needHeadline.length) {
        return {
          ok: false,
          error: `${batch.needHeadline.length} page${batch.needHeadline.length === 1 ? "" : "s"} still need a headline. Pick those first.`,
        };
      }

      const targets = input.rank
        ? [atRank(batch.rows, input.rank)].filter((r): r is PlanRow => Boolean(r))
        : batch.rows.filter((r) => !batch.outlines.get(r.id));
      if (!targets.length) return { ok: true, message: "Every page already has a skeleton." };

      // The buyer these pages are for, passed explicitly so a client with several audiences does
      // not land in `failures` with startPageDraft refusing to pick one.
      const { loadOffer } = await import("@/lib/clients/offers");
      const offer = await loadOffer(clientId).catch(() => null);

      const res = await writeSkeletonsFor(clientId, targets, offer?.audienceId ?? null);
      return {
        ok: true,
        message: [
          `Wrote ${res.written} skeleton${res.written === 1 ? "" : "s"}.`,
          ...res.failures.map((f) => `Not written: ${f}`),
        ].join(" "),
      };
    }

    // ‼️ IT HANDS BACK A PROMPT AND STOPS, WHICH IS THE WHOLE DESIGN OF THIS STAGE (D10). One
    // prompt for the batch, run wherever the research is actually done, pasted back below.
    // ─────────────────────────────────────────────────────────────────────
    // How a page hands over
    //
    // ‼️ ONE TOOL PER CLIENT, AND THIS DOES NOT CHANGE THAT. tool-lane.ts calls the tool "the
    // eighth page, its own slot beside the seven", and client_assets carries a unique index
    // allowing one not-dropped row each. What was missing was never a second tool, it was the
    // writer that puts the one tool ON a page. Every other page hands over with `plan_cta`.
    // ─────────────────────────────────────────────────────────────────────

    case "tool_options": {
      const { toolOptions, clientTool } = await import("@/lib/clients/tool-lane");
      const options = await toolOptions(clientId);
      if (!options.length) {
        return { ok: false, error: "There are no tools in the registry that suit this client yet." };
      }
      const current = await clientTool(clientId);

      return {
        ok: true,
        message: [
          "One page of the build is a thing the reader uses rather than reads. These are the ones that suit this client:",
          ...options.flatMap((o, i) => [
            `${i + 1}. ${o.component.label}${o.existingAssetId ? "  (already in the library for this vertical)" : ""}`,
            `     it answers: ${o.component.answers}`,
            `     it is wrong when: ${o.component.limits}`,
            ...(o.because ? [`     they rank for: ${o.because}`] : []),
          ]),
          current
            ? `Picked already: ${current.componentKey}${current.pageId ? ", and it is on a page." : ", but it is not on a page yet."}`
            : "Nothing picked yet. Say which one, and which page it goes on.",
        ].join("\n"),
      };
    }

    case "tool_pick": {
      const rows = await planRows(clientId);
      if ("error" in rows) return { ok: false, error: rows.error };
      const row = atRank(rows, input.rank);
      if (!row) {
        return { ok: false, error: `There is no page ${input.rank} in this plan. There are ${rows.length}.` };
      }
      // A tool renders INSIDE a page, so the page has to exist. It does not exist until the
      // skeleton stage opens one, which is the same ordering every other stage here keeps.
      if (!row.pageId) {
        return {
          ok: false,
          error: `Page ${row.rank} has no page yet, and a tool renders inside one. Write its skeleton first.`,
        };
      }

      const { pickTool, bindToolToPage, clientTool } = await import("@/lib/clients/tool-lane");

      // Choosing is optional here: the tool is normally picked at step twelve, in front of the
      // keyword evidence, and this stage is only being asked WHICH page it goes on.
      if (input.pick) {
        const picked = await pickTool(clientId, Number(input.pick), actor);
        if (!picked.ok) return { ok: false, error: picked.error };
      } else if (!(await clientTool(clientId))) {
        return {
          ok: false,
          error: "No tool has been picked for this client yet. Ask for the tool options first, then say which one.",
        };
      }

      const bound = await bindToolToPage({ clientId, pageId: row.pageId, by: actor });
      if (!bound.ok) return { ok: false, error: bound.error };

      return {
        ok: true,
        message:
          `Page ${row.rank} is the tool page: ${bound.componentKey} renders inside it. ` +
          "It hands over by being used, so it needs no cta line.",
      };
    }

    case "research_prompt": {
      const { buildBatchPrompt } = await import("@/lib/clients/page-batch");
      const built = await buildBatchPrompt(clientId);
      if (!built.ok) return { ok: false, error: built.error };
      return {
        ok: true,
        message: `One prompt, ${built.questions} questions across ${built.pages} pages. Run it, then paste the whole answer back below.`,
        prompt: built.prompt,
      };
    }

    case "research_file": {
      const text = String(input.text ?? "");
      if (!text.trim()) return { ok: false, error: "There was nothing in that paste to file." };

      const batch = await readBatch(clientId);
      if ("error" in batch) return { ok: false, error: batch.error };

      const { loadBatchPages, ingestBatchResearch, batchIngestLine } = await import(
        "@/lib/clients/batch-research"
      );
      const pages = await loadBatchPages(
        clientId,
        batch.rows.map((r) => r.id)
      );
      const filed = await ingestBatchResearch({
        clientId,
        pages,
        text,
        collectedBy: actor,
        // No Slack message carries this paste, so there is no timestamp to record and a made-up one
        // would be worse than none.
        slackTs: null,
      });
      if (!filed.ok) return { ok: false, error: filed.error };
      return { ok: true, message: batchIngestLine(filed.report, pages.length) };
    }

    // ── Drafting: ONE WAVE PER PRESS ──────────────────────────────────────────
    //
    // ‼️ DELIBERATELY NOT THE SELF-CHAINING JOB THE SLACK LANE RUNS. continueDrafting() narrates
    // only into Slack and hands the rest to itself through /api/internal/pre-call-pages with
    // CRON_SECRET, which is absent from .env.local: locally that chain never starts and the only
    // record of it stopping is a Slack message this lane never sees. draftWave already returns
    // `remaining`, the per-row lease makes a second press safe, and a page that already has a body
    // is never redrafted, so pressing again IS the resume. Seven pages take about three presses.
    case "draft_wave": {
      const batch = await readBatch(clientId);
      if ("error" in batch) return { ok: false, error: batch.error };
      if (batch.needHeadline.length || batch.needSkeleton.length) {
        const parts: string[] = [];
        if (batch.needHeadline.length) parts.push(`${batch.needHeadline.length} need a headline`);
        if (batch.needSkeleton.length) parts.push(`${batch.needSkeleton.length} need a skeleton`);
        return {
          ok: false,
          error: `Not ready: ${parts.join(", ")}. A page drafted off no outline is a page written from nothing.`,
        };
      }

      const wave = await draftWave(clientId, actor);
      if ("error" in wave) return { ok: false, error: wave.error };

      const drafted = wave.outcomes.filter((o) => o.status === "drafted");
      const failed = wave.outcomes.filter((o) => o.status === "failed");
      const notes = wave.outcomes.filter((o) => o.status === "drafted" && o.detail !== "drafted");

      // The step is ticked off what EXISTS, through the verifier, exactly as every other launch step
      // is. A runner that believes it succeeded is not evidence that it did.
      if (drafted.length) await autoCompleteLaunchStep(clientId, "pages_drafted", actor);

      return {
        ok: true,
        remaining: wave.remaining,
        message: [
          drafted.length
            ? `Drafted ${drafted.length} on this pass.`
            : "No page was drafted on this pass.",
          wave.remaining
            ? `${wave.remaining} to go: press again and it picks up where this stopped.`
            : "Every page has a body.",
          ...failed.map((o) => `Page ${o.rank} was not drafted: ${o.detail}`),
          ...notes.map((o) => `Page ${o.rank}: ${o.detail}`),
        ].join(" "),
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // The per-page walk
    //
    // ‼️ IT WRAPS page-batch.ts AND REIMPLEMENTS NOTHING, the same rule the rest of this file
    // keeps. writeForStage and pickForStage own which stage a page is at and what a number means
    // there; the Slack door reaches the identical two functions through handlePreCallThreadReply,
    // so `page 3 pick 2` cannot come to mean two things.
    //
    // ‼️ THE RANK IS RESOLVED HERE AND THE DIGIT IS NEVER GUESSED. In this door a model reads the
    // transcript and sends an explicit rank, which is the one thing that differs from the Slack
    // door: there the grammar carries the page. Both arrive at the same (row, option) pair.
    // ─────────────────────────────────────────────────────────────────────────

    case "page_write": {
      const batch = await readBatch(clientId);
      if ("error" in batch) return { ok: false, error: batch.error };
      const row = atRank(batch.rows, input.rank);
      if (!row) {
        return {
          ok: false,
          error: `There is no page ${input.rank} in this batch. There are ${batch.rows.length}.`,
        };
      }

      const res = await writeForStage(clientId, row, actor, batch);
      if (!res.ok) return { ok: false, error: res.error };
      return { ok: true, message: ["Show these to him verbatim:", ...res.lines].join("\n") };
    }

    case "page_pick": {
      const batch = await readBatch(clientId);
      if ("error" in batch) return { ok: false, error: batch.error };
      const row = atRank(batch.rows, input.rank);
      if (!row) {
        return {
          ok: false,
          error: `There is no page ${input.rank} in this batch. There are ${batch.rows.length}.`,
        };
      }
      if (!input.pick) {
        return { ok: false, error: `Which option for page ${row.rank}? There are three.` };
      }

      const res = await pickForStage(clientId, row, Number(input.pick), actor, batch);
      if (!res.ok) return { ok: false, error: res.error };
      return { ok: true, message: res.lines.join("\n") };
    }

    // ‼️ ONE PAGE, AND IT IS A SEPARATE VERB FROM draft_wave RATHER THAN A FLAG ON IT. A wave runs
    // to a 240 s budget inside a route that allows 300, and a per-page press is about eighty
    // seconds: the two have different shapes and a caller choosing between them is choosing how
    // long to wait. The per-row lease in draftOne is what makes them safe side by side, so a wave
    // and a press cannot both write the same page.
    case "page_draft": {
      const batch = await readBatch(clientId);
      if ("error" in batch) return { ok: false, error: batch.error };
      const row = atRank(batch.rows, input.rank);
      if (!row) {
        return {
          ok: false,
          error: `There is no page ${input.rank} in this batch. There are ${batch.rows.length}.`,
        };
      }

      // ‼️ GATED ON THIS PAGE AND NOT ON THE BATCH, which is the whole point of a per-page draft:
      // ten pages owing a headline must not stop the eleventh being written. Same two conditions
      // draft_wave refuses on, asked of one row, and read off the same readBatch.
      if (batch.needHeadline.some((r) => r.id === row.id) || batch.needSkeleton.some((r) => r.id === row.id)) {
        return {
          ok: false,
          error: `Page ${row.rank} is not ready: a page drafted off no headline or no outline is a page written from nothing.`,
        };
      }

      const { draftOnePage } = await import("@/lib/clients/pre-call-pages");
      const out = await draftOnePage(clientId, row, actor);
      if ("error" in out) return { ok: false, error: out.error };

      // The step is ticked off what EXISTS, through the verifier, exactly as draft_wave does it.
      if (out.status === "drafted") await autoCompleteLaunchStep(clientId, "pages_drafted", actor);

      const after = await readBatch(clientId);
      const left = "error" in after ? 0 : after.rows.length - after.drafted.length;
      return {
        ok: true,
        remaining: left,
        message: [
          out.status === "drafted"
            ? `Page ${row.rank} has a body.`
            : out.status === "skipped"
              ? `Page ${row.rank} was not drafted: ${out.detail}.`
              : `Page ${row.rank} failed: ${out.detail}`,
          out.status === "drafted"
            ? `Read it, then \`page_check\` on ${row.rank} reads it against the evidence and Google's guidance.`
            : "",
          left ? `${left} page${left === 1 ? "" : "s"} still want a body.` : "Every page has a body.",
        ]
          .filter(Boolean)
          .join(" "),
      };
    }

    // ‼️ THIS IS THE CHECK THE LANE HAD NO DOOR TO, AND WITHOUT IT PUBLISHING WAS UNREACHABLE.
    // assertGatePassed refuses a page whose gate has never run, and `never_run` is deliberately NOT
    // waivable because the answer is to press Check rather than to sign a waiver. The press existed
    // on /dashboard/clients/[id] and in the page studio thread, which are two surfaces this lane
    // does not have, so a launch publish refused and named nowhere to go.
    //
    // ‼️ IT CALLS runGate AND NEVER assertGatePassed. test-onboarding-artifacts.ts asserts
    // assertGatePassed has exactly ONE call site and that it is inside publishPage; a second would
    // put a hole in both rails at once. This records a verdict and publishes nothing, and
    // publishPage still re-reads and re-hashes the body itself.
    //
    // ‼️ IT OFFERS NO WAIVER, for the reason stated at the top of this file.
    case "page_check": {
      const rows = await planRows(clientId);
      if ("error" in rows) return { ok: false, error: rows.error };
      const row = atRank(rows, input.rank);
      if (!row) {
        return { ok: false, error: `There is no page ${input.rank} in this plan. There are ${rows.length}.` };
      }
      if (!row.pageId) {
        return {
          ok: false,
          error: `Page ${row.rank} has no body yet, so there is nothing to check. Draft it first.`,
        };
      }

      const { runGate } = await import("@/lib/hub/page-gate");
      const res = await runGate(clientId, row.pageId, { runBy: actor });
      if (!res.ok) return { ok: false, error: res.error };

      // What the card counts. Its own select, in this path only and never in readBatch, because
      // readBatch runs on every turn and a body is the largest column on the row.
      const { data: page } = await supabaseAdmin
        .from("client_pages")
        .select("slug, answer_md")
        .eq("id", row.pageId)
        .eq("client_id", clientId)
        .maybeSingle();

      const body = String((page as { answer_md?: string | null } | null)?.answer_md ?? "");
      const { bodySections } = await import("@/lib/hub/draft-page");
      const sections = bodySections(body).filter((s) => s.heading);

      const { loadNumberedEvidence, isFirstParty } = await import("@/lib/clients/page-evidence");
      const refs = await loadNumberedEvidence(clientId, row.pageId).catch(() => []);

      const { pageReviewLines } = await import("@/lib/clients/page-batch");
      return {
        ok: true,
        message: pageReviewLines({
          row,
          slug: ((page as { slug?: string | null } | null)?.slug as string | null) ?? row.slug,
          words: body.split(/\s+/).filter(Boolean).length,
          headings: sections.map((s) => s.heading),
          citations: refs.length
            ? { total: refs.length, firstParty: refs.filter((r) => isFirstParty(r.type)).length }
            : null,
          verdict: res.run.verdict,
          checks: res.run.checks,
          ranAt: res.run.createdAt,
        }).join("\n"),
      };
    }

    // ── Publishing, through the one publisher, with both rails intact ─────────
    case "publish":
    case "unpublish": {
      const pageId = String(input.pageId ?? "");
      if (!pageId) return { ok: false, error: "Which page?" };

      const res = await publishPage({
        clientId,
        pageId,
        publish: input.action === "publish",
        by: actor,
        // Absent until the picker has been answered. publishPage refuses rather than guessing when
        // several destinations are wired, and hands back the list for the panel to render.
        destinationId: input.destinationId ?? null,
      });

      if (!res.ok) return { ok: false, error: res.refusal.error, refusal: res.refusal };
      return {
        ok: true,
        message: input.action === "publish" ? `Published ${res.slug}.` : `Took ${res.slug} down.`,
        pageUrl: res.pageUrl,
      };
    }
  }
}
