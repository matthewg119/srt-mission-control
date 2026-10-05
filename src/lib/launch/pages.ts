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
  pickHeadlineFor,
  readBatch,
  stageLine,
  writeHeadlinesFor,
  writeSkeletonsFor,
  type BatchStage,
  type BatchState,
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
  needHeadline: number[];
  needSkeleton: number[];
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

function toPage(row: PlanRow, batch: BatchState | null, options: Map<string, string[]>): LaunchPlanPage {
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
  };
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
    plan: rows.map((r) => toPage(r, batchState, options)),
    proposed: rows.filter((r) => r.status === "proposed").length,
    approved: rows.filter((r) => r.status === "approved" || r.status === "claimed").length,
    needHeadline: (batchState?.needHeadline ?? []).map((r) => r.rank),
    needSkeleton: (batchState?.needSkeleton ?? []).map((r) => r.rank),
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
      p.headline ? "headline" : null,
      p.hasOutline ? "skeleton" : null,
      p.hasBody ? "body" : null,
      p.pageStatus === "published" ? "LIVE" : null,
    ].filter(Boolean);
    return `    ${p.rank}. [${p.role}] ${p.headline ?? p.workingTitle} <- ${p.targetKeyword} (${p.status}${has.length ? ", " + has.join(", ") : ", nothing written yet"})`;
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
    ...(st.needHeadline.length ? [`  still need a headline: ${st.needHeadline.join(", ")}`] : []),
    ...(st.needSkeleton.length ? [`  still need a skeleton: ${st.needSkeleton.join(", ")}`] : []),
    "  ‼️ THE WORKING TITLES ARE WRITTEN AT PLAN TIME AND THE KEYWORDS ARE HIS OWN PICKS. If he does",
    "  not recognise a title, that is the title being new, not the keyword being wrong.",
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// The actions
// ─────────────────────────────────────────────────────────────────────────────

export const LAUNCH_PAGE_ACTIONS = [
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
  "headlines_write",
  "headline_pick",
  "skeletons_write",
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
    case "headlines_write": {
      const batch = await readBatch(clientId);
      if ("error" in batch) return { ok: false, error: batch.error };
      if (!batch.rows.length) {
        return { ok: false, error: "No approved pages yet. Approve the plan first." };
      }

      const existing = await optionsFor(clientId, batch.rows);
      const failures: string[] = [];
      let written = 0;
      for (const row of batch.rows) {
        // ‼️ SKIPPED WHEN OPTIONS ALREADY EXIST, so pressing again after a partial failure does not
        // bury the three somebody has already read under three more.
        if ((existing.get(row.id) ?? []).length) continue;
        const got = await writeHeadlinesFor(clientId, row);
        if (got.ok) written += 1;
        else failures.push(got.error);
      }

      return {
        ok: true,
        message: [
          written
            ? `Wrote three options for ${written} page${written === 1 ? "" : "s"}.`
            : "Every page already had its three options.",
          ...failures.map((f) => `Not written: ${f}`),
        ].join(" "),
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
