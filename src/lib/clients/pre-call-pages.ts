// The pages drafted before the call: one pillar for the offer and eight supports, written by the
// onboarding workflow rather than only by hand in the studio.
//
// Matthew, 2026-09-11: "I want 9 pages ready before we actually even talk to the customer on the
// phone." And the decisions that shape this file:
//   - 1 pillar + 8 supports. The pillar is the offer page.
//   - FULL drafts, no gaps, written from what is on file. Drafts only: nothing publishes before
//     Day 0 and the evidence gate, and both still stand.
//   - Every page's magnet is the anchor offer in disguise.
//   - Drafting belongs to the ONBOARDING workflow (a delivery step). The studio is where a person
//     finishes the pages.
//
// ‼️ THE PLAN DRAWS ONLY FROM THE APPROVED KEYWORD SET, AND ONLY FROM WHAT IS ABOUT THE OFFER.
// selectOfferPlan in page-plan.ts is pure and never pads: a short plan says what would fill it.
//
// ‼️ THE DRAFTING RUNS IN WAVES AND CAN BE RESUMED. Nine drafts are nine model calls, more than a
// 300 second route can hold, so `plan approve` drafts three at a time until the time budget is
// spent and then hands the rest to a fresh request (/api/internal/pre-call-pages). Each plan row is
// LEASED while it is drafted, so two waves never write the same page, and a page that already has
// a body is never redrafted: it may carry somebody's words.

import { supabaseAdmin } from "@/lib/db";
import { randomUUID } from "crypto";
import type { AutoResult } from "./artifacts/registry";
import {
  ANCHOR_COMMAND,
  PLAN_COMMAND,
  PRE_CALL_SUPPORTS,
  approvePlan,
  dropPlanRow,
  editPlanTitle,
  formatPlan,
  framePages,
  loadPlan,
  markClaimed,
  selectOfferPlan,
  swapPlanRow,
  type FrameContext,
  type OfferPoolItem,
  type PlanRow,
  type PoolItem,
} from "./page-plan";
import { categoryLabel, isRelevantKeyword, tierOf } from "./keyword-expansion";
import { normalizePhrase } from "./phrase-quality";

/** One request's drafting time. The route's ceiling is 300s; the rest is the summary and the chain. */
const WAVE_BUDGET_MS = 240_000;
/** A page is only started if this much of the budget is left: one draft takes up to a minute. */
const PAGE_BUDGET_MS = 80_000;
const CONCURRENCY = 3;
/** Longer than the route's 300 second limit, so a live wave never loses its lease to another. */
const LEASE_MS = 6 * 60_000;
/** A chain that makes no progress stops; this bounds one that does. Nine pages need three or four. */
const MAX_HOPS = 6;

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";
}

async function say(clientId: string, text: string): Promise<void> {
  const { notifyStep } = await import("./step-board");
  await notifyStep(clientId, "pre_call_pages", text).catch(() => {});
}

async function refreshCard(clientId: string): Promise<void> {
  const { postStep } = await import("./step-engine");
  await postStep(clientId, "pre_call_pages").catch((e) =>
    console.error("[pre-call-pages] card refresh failed:", (e as Error).message)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// What the plan is worded from
// ─────────────────────────────────────────────────────────────────────────────

async function frameContext(
  clientId: string
): Promise<{ ok: true; ctx: Omit<FrameContext, "keywords">; anchorKey: string } | { ok: false; missing: string[] }> {
  const { loadOffer, isLocked } = await import("./offers");
  const { confirmedAvatarFor } = await import("./avatars");
  const { conciergeTenant } = await import("@/lib/concierge/for-client");
  const { anchorFor } = await import("@/lib/concierge/magnet-drafts");
  const { stepNumber } = await import("@/config/delivery-steps");

  const [offer, avatar, tenant, client] = await Promise.all([
    loadOffer(clientId),
    confirmedAvatarFor(clientId),
    conciergeTenant(clientId),
    supabaseAdmin.from("clients").select("legal_name, dba_name").eq("id", clientId).maybeSingle(),
  ]);
  const anchor = tenant ? await anchorFor(clientId, tenant.audience) : null;

  const missing: string[] = [];
  if (!isLocked(offer) || !offer.treatment) missing.push(`the offer, locked at step ${stepNumber("offer_locked")}`);
  if (!avatar) missing.push(`the avatar, confirmed at step ${stepNumber("avatar_confirmed")}`);
  // ‼️ THE CONCIERGE ROW IS A PREREQUISITE, NOT A NICETY. Minting a page's magnet refuses without
  // it and the drafter cannot resolve the magnet, which is why this step sits after the concierge.
  if (!tenant) missing.push(`the concierge, provisioned at step ${stepNumber("concierge_preview")}`);
  else if (!anchor) missing.push("an anchor offer: `anchor` in this thread lists the catalogue, `anchor: <key>` sets it");
  if (missing.length || !offer.treatment || !avatar || !anchor?.magnetKey) return { ok: false, missing };

  const name = ((client.data?.dba_name as string | null) || (client.data?.legal_name as string | null)) ?? "this business";
  return {
    ok: true,
    anchorKey: anchor.magnetKey,
    ctx: {
      clientName: name,
      treatment: offer.treatment,
      positioning: offer.positioning,
      avatarLabel: avatar.label,
      anchor: { title: anchor.title, promise: anchor.promise, ctaLabel: anchor.ctaLabel },
    },
  };
}

/** The approved, relevant queries as a pool, plus everything the framing call needs. */
async function offerPool(clientId: string): Promise<
  | { pool: OfferPoolItem[]; keywords: string[]; city: string | null; namingKey: string | null; labels: (key: string) => string }
  | { error: string }
> {
  const { planKeywords } = await import("./client-keywords");
  const pk = await planKeywords(clientId);
  if ("error" in pk) return { error: pk.error };

  const naming = pk.ctx.categories.find((c) => c.naming)?.key ?? null;
  const labels = (key: string) => categoryLabel(pk.ctx.categories, key);
  const pool: OfferPoolItem[] = pk.rows.map((r) => ({
    question: r.phrase,
    score: r.score,
    category: r.category,
    categoryLabel: labels(r.category),
    tier: tierOf(r.origin),
    naming: r.category === naming,
    relevant: isRelevantKeyword(r, pk.vocab),
  }));
  return { pool, keywords: pk.rows.map((r) => r.phrase), city: pk.ctx.city, namingKey: naming, labels };
}

/** Questions a new plan row may not repeat: every plan row, and every page that is not archived. */
async function takenQuestions(clientId: string, rows: readonly PlanRow[]): Promise<Set<string>> {
  const { data } = await supabaseAdmin
    .from("client_pages")
    .select("question")
    .eq("client_id", clientId)
    .neq("status", "archived");
  const taken = new Set(((data ?? []) as Array<Record<string, unknown>>).map((p) => normalizePhrase(String(p.question ?? ""))));
  for (const r of rows) taken.add(normalizePhrase(r.question));
  return taken;
}

/** Pillar first, then its supports, then anything the studio planned. Ranks close up. */
async function orderPlan(clientId: string): Promise<void> {
  const plan = await loadPlan(clientId);
  if ("error" in plan) return;
  const ordered = [
    ...plan.rows.filter((r) => r.role === "pillar"),
    ...plan.rows.filter((r) => r.role === "support"),
    ...plan.rows.filter((r) => !r.role),
  ];
  for (const [i, r] of ordered.entries()) {
    if (r.rank !== i + 1) await supabaseAdmin.from("page_plan").update({ rank: i + 1 }).eq("id", r.id);
  }
}

/**
 * Propose the pre-call plan, or fill it back up to one pillar and eight supports.
 *
 * Approved and claimed rows are kept; only proposed pre-call rows are replaced. Studio rows (no
 * role) are never touched.
 */
async function proposePreCallPlan(
  clientId: string,
  ctx: Omit<FrameContext, "keywords">
): Promise<{ ok: true; note: string } | { ok: false; error: string }> {
  const plan = await loadPlan(clientId);
  if ("error" in plan) return { ok: false, error: plan.error };

  const pool = await offerPool(clientId);
  if ("error" in pool) return { ok: false, error: pool.error };

  const kept = plan.rows.filter((r) => r.role && r.status !== "proposed");
  const keptPillar = kept.find((r) => r.role === "pillar") ?? null;
  const keptSupports = kept.filter((r) => r.role === "support").length;

  const others = plan.rows.filter((r) => !(r.role && r.status === "proposed"));
  const exclude = await takenQuestions(clientId, others);
  const sel = selectOfferPlan(pool.pool, { city: pool.city, exclude });

  const needPillar = !keptPillar;
  if (needPillar && !sel.pillar) return { ok: false, error: sel.fix ?? "there is no pillar keyword" };

  const supports = sel.supports.slice(0, Math.max(0, PRE_CALL_SUPPORTS - keptSupports));
  const items: PoolItem[] = [
    ...(needPillar && sel.pillar
      ? [{ question: sel.pillar.item.question, score: sel.pillar.item.score, theme: sel.pillar.item.categoryLabel, origin: "keyword" as const, role: "pillar" as const, category: sel.pillar.item.category }]
      : []),
    ...supports.map((s) => ({ question: s.question, score: s.score, theme: s.categoryLabel, origin: "keyword" as const, role: "support" as const, category: s.category })),
  ];

  if (items.length === 0) {
    return { ok: true, note: "The pre-call plan is already full. `plan` shows it." };
  }

  const pillarKeyword = needPillar && sel.pillar ? sel.pillar.keyword : null;
  let framed;
  try {
    framed = await framePages(items, { ...ctx, keywords: [...(pillarKeyword ? [pillarKeyword] : []), ...pool.keywords] });
  } catch (e) {
    return { ok: false, error: `the pages were chosen but could not be worded: ${(e as Error).message}` };
  }

  // Old proposals go only once the new ones exist in memory, so a failed call leaves the old plan.
  const { error: delError } = await supabaseAdmin
    .from("page_plan")
    .delete()
    .eq("client_id", clientId)
    .eq("status", "proposed")
    .not("role", "is", null);
  if (delError) return { ok: false, error: delError.message };

  const now = new Date().toISOString();
  const rowFor = (item: PoolItem, i: number, pillarId: string | null) => ({
    client_id: clientId,
    rank: 1000 + i,
    question: item.question,
    // The pillar aims at the offer plus the city when the business is local, which is not a
    // phrase in the set, so it is set here rather than left to the framing call's choice.
    target_keyword: item.role === "pillar" && pillarKeyword ? pillarKeyword : framed[i].targetKeyword,
    working_title: framed[i].workingTitle,
    angle: framed[i].angle,
    theme: item.theme,
    origin: "keyword",
    magnet_frame: framed[i].frame,
    status: "proposed",
    role: item.role,
    pillar_id: pillarId,
    keyword_category: item.category ?? null,
    updated_at: now,
  });

  let pillarId = keptPillar?.id ?? null;
  let offset = 0;
  if (needPillar) {
    const { data, error } = await supabaseAdmin.from("page_plan").insert(rowFor(items[0], 0, null)).select("id").maybeSingle();
    if (error || !data?.id) {
      return {
        ok: false,
        error:
          `the pillar could not be written: ${error?.message ?? "no row"}. If that names role or pillar_id, ` +
          "docs/2026-09-11-one-strategy.sql has not been run.",
      };
    }
    pillarId = String(data.id);
    offset = 1;
  }

  const supportRows = items.slice(offset).map((item, j) => rowFor(item, offset + j, pillarId));
  if (supportRows.length) {
    const { error } = await supabaseAdmin.from("page_plan").insert(supportRows);
    if (error) return { ok: false, error: `the supports could not be written: ${error.message}` };
  }

  await orderPlan(clientId);
  const { bustPages } = await import("@/lib/hub/pages");
  bustPages(clientId);

  const total = (keptPillar ? 1 : needPillar ? 1 : 0) + keptSupports + supports.length;
  return {
    ok: true,
    note: [
      `:clipboard: *Plan proposed: ${total} page${total === 1 ? "" : "s"}*, one pillar for the offer and ` +
        `${total - 1} support${total - 1 === 1 ? "" : "s"}, every keyword from the approved set and about the offer.`,
      ...(sel.fix ? [`:warning: ${sel.fix}`] : []),
      "Read the card below, then `plan approve` and all of them are drafted in full.",
    ].join("\n"),
  };
}

/** The auto half of the step: propose the plan once everything it is worded from exists. */
export async function runPreCallPlan(clientId: string): Promise<AutoResult> {
  const plan = await loadPlan(clientId);
  if ("error" in plan) return { ok: false, error: plan.error };

  const preCall = plan.rows.filter((r) => r.role);
  if (preCall.length) {
    const proposed = preCall.filter((r) => r.status === "proposed").length;
    return {
      ok: true,
      note: `The pre-call plan already has ${preCall.length} pages${proposed ? `, ${proposed} of them waiting on \`plan approve\`` : ""}. \`plan\` shows it.`,
    };
  }

  // ‼️ ok:true WITH A NOTE WHEN SOMETHING IS MISSING, NEVER AN ERROR. An error is terminal and never
  // retried, so a missing anchor would park this step for good. `anchor: <key>` in the thread
  // proposes the plan the moment it is set.
  const fc = await frameContext(clientId);
  if (!fc.ok) {
    return { ok: true, note: `:hourglass: No plan yet. Waiting on: ${fc.missing.join("; ")}.` };
  }

  const { verifyKeywordSet } = await import("./client-keywords");
  const kw = await verifyKeywordSet(clientId);
  if (!kw.ok) {
    return { ok: true, note: `:hourglass: No plan yet. The keyword set is not ready: ${kw.found}. ${kw.todo}` };
  }

  const res = await proposePreCallPlan(clientId, fc.ctx);
  if (!res.ok) return { ok: true, note: `:warning: No plan: ${res.error}` };
  return { ok: true, note: res.note };
}

// ─────────────────────────────────────────────────────────────────────────────
// Drafting, in waves
// ─────────────────────────────────────────────────────────────────────────────

interface PageState {
  id: string;
  slug: string;
  status: string;
  body: string;
  leadMagnetKey: string | null;
}

async function readPages(clientId: string, ids: readonly string[]): Promise<Map<string, PageState>> {
  const out = new Map<string, PageState>();
  if (ids.length === 0) return out;
  const { data } = await supabaseAdmin
    .from("client_pages")
    .select("id, slug, status, answer_md, lead_magnet_key")
    .eq("client_id", clientId)
    .in("id", [...ids]);
  for (const p of (data ?? []) as Array<Record<string, unknown>>) {
    out.set(String(p.id), {
      id: String(p.id),
      slug: String(p.slug ?? ""),
      status: String(p.status ?? "draft"),
      body: String(p.answer_md ?? "").trim(),
      leadMagnetKey: (p.lead_magnet_key as string | null) ?? null,
    });
  }
  return out;
}

/** The pre-call rows a person approved, in rank order. */
async function approvedRows(clientId: string): Promise<PlanRow[] | { error: string }> {
  const plan = await loadPlan(clientId);
  if ("error" in plan) return { error: plan.error };
  return plan.rows.filter((r) => r.role && (r.status === "approved" || r.status === "claimed"));
}

type DraftOutcome = { status: "drafted" | "skipped" | "failed"; rank: number; detail: string };

async function draftOne(
  clientId: string,
  row: PlanRow,
  env: { tier: string | null; by: string; leaseId: string }
): Promise<DraftOutcome> {
  const cutoff = new Date(Date.now() - LEASE_MS).toISOString();

  // ‼️ THE LEASE. Conditional on nobody holding a live one, so exactly one wave drafts this row.
  const { data: leased, error: leaseError } = await supabaseAdmin
    .from("page_plan")
    .update({ draft_lease_at: new Date().toISOString(), draft_lease_id: env.leaseId })
    .eq("id", row.id)
    .or(`draft_lease_at.is.null,draft_lease_at.lt."${cutoff}"`)
    .select("id");
  if (leaseError) return { status: "failed", rank: row.rank, detail: `the lease could not be taken: ${leaseError.message}` };
  if (!leased?.length) return { status: "skipped", rank: row.rank, detail: "another pass is drafting it" };

  const release = async (error: string | null) => {
    await supabaseAdmin
      .from("page_plan")
      .update({ draft_lease_at: null, draft_lease_id: null, draft_error: error })
      .eq("id", row.id)
      .eq("draft_lease_id", env.leaseId);
  };

  try {
    let page = row.pageId ? (await readPages(clientId, [row.pageId])).get(row.pageId) ?? null : null;

    // ‼️ A PAGE WITH A BODY IS NEVER REDRAFTED. It may carry somebody's words.
    if (page && page.body) {
      await release(null);
      return { status: "skipped", rank: row.rank, detail: "already drafted" };
    }

    if (!page) {
      const { startPageDraft } = await import("@/lib/hub/pages");
      const started = await startPageDraft({ clientId, question: row.question, title: row.workingTitle });
      if (!started.ok) {
        await release(started.error);
        return { status: "failed", rank: row.rank, detail: started.error };
      }
      page = (await readPages(clientId, [started.id])).get(started.id) ?? null;
      if (!page) {
        await release("the page was opened and could not be read back");
        return { status: "failed", rank: row.rank, detail: "the page was opened and could not be read back" };
      }
      // startPageDraft RESUMES any unpublished page asking the same question, archived included.
      if (page.status === "archived") {
        await release("an archived page already answers this question");
        return { status: "skipped", rank: row.rank, detail: "an archived page already answers this question. Unarchive it on the board or `plan swap` this row" };
      }
      if (page.body) {
        await markClaimed(row.id, page.id);
        await release(null);
        return { status: "skipped", rank: row.rank, detail: "a draft for this question already had words in it, so it was linked and not redrafted" };
      }
    }

    // Linked now, so the page stays tied to its plan row even if the model call below dies.
    await markClaimed(row.id, page.id);

    // ‼️ THE MAGNET FIRST, SO THE DRAFT KNOWS WHERE TO STOP. The frame was approved with the plan;
    // stageFrameCandidate copies it and approveMagnetCandidate mints it (the one insert into
    // lead_magnets). Guarded on the PAGE's key, not the candidate: a re-entered wave that staged
    // a second candidate would otherwise mint a second magnet.
    let magnetKey = page.leadMagnetKey;
    let magnetNote = "";
    if (!magnetKey && row.frame) {
      const { stageFrameCandidate, approveMagnetCandidate } = await import("@/lib/concierge/magnet-drafts");
      const staged = await stageFrameCandidate({ clientId, pageId: page.id, frame: row.frame });
      if (staged.ok) {
        const minted = await approveMagnetCandidate({ clientId, pageId: page.id, candidateId: staged.candidateId, by: env.by });
        if (minted.ok) magnetKey = minted.magnetKey;
        else magnetNote = minted.error;
      } else {
        magnetNote = staged.error;
      }
    }

    const { draftPage } = await import("@/lib/hub/draft-page");
    const drafted = await draftPage(clientId, row.question, { pageId: page.id, magnetKey });
    if (!drafted.ok) {
      await release(drafted.error);
      return { status: "failed", rank: row.rank, detail: drafted.error };
    }

    // ‼️ SAVED WITH ITS EVIDENCE MAP. A drafted page with no map reads to the gate as hand-written
    // and skips unbacked_claims, which is the check that matters most on a model-written page.
    // The slug is passed back as it is: savePage writes the slug on update.
    const { savePage } = await import("@/lib/hub/pages");
    const saved = await savePage({
      clientId,
      id: page.id,
      slug: page.slug,
      title: row.workingTitle,
      question: row.question,
      answerMd: drafted.page.answerMd,
      metaDescription: drafted.page.metaDescription,
      evidenceMap: drafted.page.evidenceUsed,
    });
    if (!saved.ok) {
      await release(saved.error);
      return { status: "failed", rank: row.rank, detail: saved.error };
    }

    // A1 D-P5a: Core sells 4 new + 4 refreshed a month, so the ninth page of month one is above
    // the sold count and is tagged, never hidden. A separate write, tolerant of the column missing.
    if (env.tier === "core" && row.rank >= 9) {
      await supabaseAdmin.from("client_pages").update({ scope: "over_delivery" }).eq("id", page.id);
    }

    await release(null);
    return { status: "drafted", rank: row.rank, detail: magnetNote ? `drafted, but no magnet: ${magnetNote}` : "drafted" };
  } catch (e) {
    await release((e as Error).message);
    return { status: "failed", rank: row.rank, detail: (e as Error).message };
  }
}

/** Rows that still need a draft: no page, or a page with no body. */
async function outstanding(clientId: string, rows: readonly PlanRow[]): Promise<PlanRow[]> {
  const pages = await readPages(clientId, rows.map((r) => r.pageId).filter((id): id is string => Boolean(id)));
  return rows.filter((r) => {
    const p = r.pageId ? pages.get(r.pageId) : null;
    return !p || (!p.body && p.status !== "archived");
  });
}

export async function draftWave(
  clientId: string,
  by: string
): Promise<{ outcomes: DraftOutcome[]; remaining: number } | { error: string }> {
  const deadline = Date.now() + WAVE_BUDGET_MS;
  const rows = await approvedRows(clientId);
  if ("error" in rows) return { error: rows.error };

  const { data: client } = await supabaseAdmin.from("clients").select("tier_scope").eq("id", clientId).maybeSingle();
  const env = {
    tier: ((client as { tier_scope?: string | null } | null)?.tier_scope ?? null) as string | null,
    by,
    leaseId: randomUUID(),
  };

  const todo = await outstanding(clientId, rows);
  const outcomes: DraftOutcome[] = [];
  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    if (Date.now() + PAGE_BUDGET_MS > deadline) break;
    outcomes.push(...(await Promise.all(todo.slice(i, i + CONCURRENCY).map((r) => draftOne(clientId, r, env)))));
  }

  const after = await approvedRows(clientId);
  const remaining = "error" in after ? todo.length : (await outstanding(clientId, after)).length;
  return { outcomes, remaining };
}

/**
 * Hand the rest to a fresh request.
 *
 * ‼️ AWAITED WITH A TIMEOUT, NOT FIRE AND FORGET. A fetch nobody awaits can be frozen with the
 * lambda before it leaves. The route answers 202 as soon as it has scheduled the work, so this
 * waits a second or two, not for the drafting.
 */
async function chainNextWave(clientId: string, by: string, hop: number): Promise<{ ok: boolean; error?: string }> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return { ok: false, error: "CRON_SECRET is not set" };
  try {
    const res = await fetch(`${appUrl()}/api/internal/pre-call-pages`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify({ clientId, by, hop }),
      signal: AbortSignal.timeout(15_000),
    });
    return res.status === 202 ? { ok: true } : { ok: false, error: `the route answered ${res.status}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** One pass, then the next one or the summary. Called by `plan approve` and by the internal route. */
export async function continueDrafting(clientId: string, by: string, hop: number): Promise<void> {
  const wave = await draftWave(clientId, by);
  if ("error" in wave) return say(clientId, `:warning: Drafting could not start: ${wave.error}`);

  const drafted = wave.outcomes.filter((o) => o.status === "drafted");
  const failed = wave.outcomes.filter((o) => o.status === "failed");
  const notes = wave.outcomes.filter((o) => o.status === "drafted" && o.detail !== "drafted");

  if (failed.length || notes.length) {
    await say(
      clientId,
      [
        ...failed.map((o) => `:x: Page ${o.rank} was not drafted: ${o.detail}`),
        ...notes.map((o) => `:warning: Page ${o.rank}: ${o.detail}`),
      ].join("\n")
    );
  }

  if (wave.remaining === 0) {
    await postDraftSummary(clientId);
    const { setDeliveryStep } = await import("./delivery-checklist");
    const res = await setDeliveryStep({ clientId, stepKey: "pre_call_pages", transition: "complete", actor: by });
    if (!res.ok) await say(clientId, `:hourglass: Not ticked: ${res.error ?? "the check refused"}`);
    return;
  }

  if (drafted.length === 0) {
    return say(
      clientId,
      `:hourglass: No page was drafted on this pass, and ${wave.remaining} still need one. ` +
        "The reasons are above. `plan approve` again picks up exactly where this stopped."
    );
  }

  if (hop >= MAX_HOPS) {
    return say(clientId, `Stopped after ${hop + 1} passes with ${wave.remaining} still to draft. \`plan approve\` again continues.`);
  }

  await say(clientId, `Drafted ${drafted.length} on this pass, ${wave.remaining} to go. Continuing.`);
  const chained = await chainNextWave(clientId, by, hop + 1);
  if (!chained.ok) {
    await say(
      clientId,
      `:warning: The next pass could not start by itself (${chained.error}). \`plan approve\` again continues where this stopped.`
    );
  }
}

function wordCount(md: string): number {
  return md.split(/\s+/).filter(Boolean).length;
}

async function postDraftSummary(clientId: string): Promise<void> {
  const rows = await approvedRows(clientId);
  if ("error" in rows) return;
  const ids = rows.map((r) => r.pageId).filter((id): id is string => Boolean(id));
  if (ids.length === 0) return;

  const { data } = await supabaseAdmin
    .from("client_pages")
    .select("id, slug, title, answer_md, evidence_map, lead_magnet_key")
    .in("id", ids);
  const pages = new Map(((data ?? []) as Array<Record<string, unknown>>).map((p) => [String(p.id), p]));

  const lines: string[] = [
    `:page_facing_up: *${ids.length} drafts are ready to walk on the call.* Share your screen on the ` +
      "dashboard preview. The client's own link shows no drafts, on purpose.",
    "",
  ];
  let unsourcedTotal = 0;
  for (const r of rows) {
    const p = r.pageId ? pages.get(r.pageId) : null;
    if (!p) continue;
    const map = Array.isArray(p.evidence_map) ? (p.evidence_map as Array<{ sourceRef?: unknown }>) : [];
    const unsourced = map.filter((c) => c?.sourceRef == null).length;
    unsourcedTotal += unsourced;
    const role = r.role === "pillar" ? "Pillar" : "Support";
    const preview = `${appUrl()}/dashboard/clients/${clientId}/preview/${String(p.slug)}`;
    lines.push(
      `*${r.rank}.* ${role}: <${preview}|${String(p.title ?? r.workingTitle)}>`,
      `      Keyword \`${r.targetKeyword}\` · ${wordCount(String(p.answer_md ?? ""))} words · ` +
        `${unsourced} claim${unsourced === 1 ? "" : "s"} with no source` +
        `${p.lead_magnet_key ? "" : " · no magnet yet"}`
    );
  }
  lines.push(
    "",
    unsourcedTotal
      ? `_${unsourcedTotal} claims across these pages have no source behind them. Those are exactly what the evidence gate blocks at publish, so they are the sentences to back up or cut before Day 0._`
      : "_Every claim on these pages traces to a source on file._",
    "_A page whose evidence is thin comes out short. That is the drafter's rule 7 working, not a fault. Nothing here is published: Day 0 and the evidence gate both still stand._"
  );
  await say(clientId, lines.join("\n"));
}

// ─────────────────────────────────────────────────────────────────────────────
// The card, the verifier
// ─────────────────────────────────────────────────────────────────────────────

export async function preCallPagesCardLines(clientId: string): Promise<string[]> {
  const { stepNumber } = await import("@/config/delivery-steps");
  const plan = await loadPlan(clientId);
  if ("error" in plan) return [`:warning: ${plan.error}`];

  const rows = plan.rows.filter((r) => r.role);
  const fc = await frameContext(clientId);
  const anchorTitle = fc.ok ? fc.ctx.anchor.title : null;

  if (rows.length === 0) {
    return [
      "*No plan yet.* It is proposed here by itself once these exist:",
      ...(fc.ok ? [`  • the keyword set approved at step ${stepNumber("keyword_set")}`] : fc.missing.map((m) => `  • ${m}`)),
      "",
      "`anchor` lists the catalogue, `anchor: <key>` sets the anchor and proposes the plan.",
    ];
  }

  const approved = rows.filter((r) => r.status !== "proposed");
  const pages = await readPages(clientId, rows.map((r) => r.pageId).filter((id): id is string => Boolean(id)));
  const drafted = rows.filter((r) => r.pageId && pages.get(r.pageId)?.body).length;

  return [
    formatPlan(rows, anchorTitle),
    "",
    approved.length === 0
      ? `*Nothing drafted yet.* \`plan approve\` locks these ${rows.length} in and drafts every one in full, from what is on file, three at a time.`
      : `*Drafted:* ${drafted} of ${approved.length} approved.${drafted < approved.length ? " `plan approve` again resumes the drafting if it stopped." : ""}`,
    ...(rows.length < 1 + PRE_CALL_SUPPORTS
      ? [
          `:warning: *${rows.length} of ${1 + PRE_CALL_SUPPORTS}.* The approved keywords could not supply more supports about the offer. ` +
            "Run the deep research KEYWORDS block for this offer, or `keywords more <category>` at step " +
            `${stepNumber("keyword_set")}, approve, then \`plan new\`. It is never padded.`,
        ]
      : []),
    "_The pillar cannot be dropped, only swapped: every support links to it._",
  ];
}

export type PreCallCheck =
  | { ok: true; evidence: string[] }
  | { ok: false; broken: boolean; found: string; todo: string };

export async function verifyPreCallPages(clientId: string): Promise<PreCallCheck> {
  const plan = await loadPlan(clientId);
  if ("error" in plan) {
    return { ok: false, broken: true, found: plan.error, todo: "Run docs/2026-09-11-page-plan.sql and docs/2026-09-11-one-strategy.sql, then Re-check." };
  }
  const rows = plan.rows.filter((r) => r.role);
  if (rows.length === 0) return { ok: false, broken: false, found: "no pre-call plan has been proposed", todo: "The card says what it is waiting on." };
  if (!rows.some((r) => r.role === "pillar")) {
    return { ok: false, broken: false, found: "the plan has no pillar", todo: "`plan new` proposes one from the approved naming variants." };
  }

  const proposed = rows.filter((r) => r.status === "proposed").length;
  if (proposed) return { ok: false, broken: false, found: `${proposed} of ${rows.length} planned pages are proposed and not approved`, todo: "`plan approve` in this thread." };

  const pages = await readPages(clientId, rows.map((r) => r.pageId).filter((id): id is string => Boolean(id)));
  const withBody = rows.filter((r) => r.pageId && pages.get(r.pageId)?.body);
  if (withBody.length < rows.length) {
    return {
      ok: false,
      broken: false,
      found: `${withBody.length} of ${rows.length} approved pages have a drafted body`,
      todo: "Drafting runs in passes after `plan approve`. `plan approve` again resumes it; any page that failed says why in this thread.",
    };
  }

  const magnets = withBody.filter((r) => pages.get(r.pageId as string)?.leadMagnetKey).length;
  return {
    ok: true,
    evidence: [
      `${withBody.length} drafts in client_pages linked to approved plan rows (1 pillar, ${withBody.length - 1} supports)`,
      `${magnets} of them carry a magnet framing the anchor offer`,
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The thread
// ─────────────────────────────────────────────────────────────────────────────

export interface PreCallReply {
  message: string;
  after?: () => Promise<void>;
}

function unwrap(text: string): string {
  return text.trim().replace(/^[`*_]+|[`*_]+$/g, "").trim();
}

/** `plan ...` and `anchor ...` in the pre-call step's thread. Anything else falls through. */
export async function handlePreCallThreadReply(input: {
  clientId: string;
  stepKey: string | null;
  text: string;
  by: string;
}): Promise<PreCallReply | null> {
  if (input.stepKey !== "pre_call_pages") return null;
  const command = unwrap(input.text);

  const anchor = ANCHOR_COMMAND.exec(command);
  if (anchor) return anchorReply(input.clientId, anchor[1] ?? "");

  const plan = PLAN_COMMAND.exec(command);
  if (!plan) return null;
  const sub = (plan[1] ?? "").trim();
  const lower = sub.toLowerCase();
  const { clientId, by } = input;

  if (lower === "") {
    const card = await preCallPagesCardLines(clientId);
    return { message: card.join("\n") };
  }

  if (lower === "new") {
    return {
      message: "Re-proposing every page that is not approved yet. About a minute.",
      after: async () => {
        const fc = await frameContext(clientId);
        if (!fc.ok) return say(clientId, `:hourglass: Not yet. Waiting on: ${fc.missing.join("; ")}.`);
        const res = await proposePreCallPlan(clientId, fc.ctx);
        await say(clientId, res.ok ? res.note : `:warning: No plan: ${res.error}`);
        await refreshCard(clientId);
      },
    };
  }

  if (lower === "approve") {
    const res = await approvePlan(clientId, by, { roleOnly: true });
    if (!res.ok) return { message: `:warning: ${res.error}` };
    return {
      message: res.count
        ? `:white_check_mark: Approved ${res.count} page${res.count === 1 ? "" : "s"}. Drafting every one in full now, three at a time. ` +
          "Each lands on the board as a draft; the summary posts here when the last one is done."
        : "Nothing was waiting on approval. Resuming the drafting of anything not written yet.",
      after: async () => {
        await refreshCard(clientId);
        await continueDrafting(clientId, by, 0);
        await refreshCard(clientId);
      },
    };
  }

  const current = await loadPlan(clientId);
  if ("error" in current) return { message: `:warning: ${current.error}` };

  const drop = /^drop\s+([0-9]{1,2})$/i.exec(sub);
  if (drop) {
    const target = current.rows.find((r) => r.rank === Number(drop[1]));
    if (target?.role === "pillar") {
      return { message: "The pillar is the offer page and every support links to it, so it is not dropped. `plan swap " + target.rank + "` replaces it with another naming variant." };
    }
    const res = await dropPlanRow(clientId, Number(drop[1]));
    if (!res.ok) return { message: `:warning: ${res.error}` };
    return { message: `Dropped *${res.dropped.workingTitle}*. The pages after it moved up one. \`plan new\` fills the slot.`, after: () => refreshCard(clientId) };
  }

  const swap = /^swap\s+([0-9]{1,2})$/i.exec(sub);
  if (swap) {
    const rank = Number(swap[1]);
    const target = current.rows.find((r) => r.rank === rank);
    if (!target?.role) return { message: `There is no pre-call page ${rank}. \`plan\` shows the plan.` };
    return {
      message: `Finding the next best ${target.role === "pillar" ? "naming variant for the pillar" : `page in the same category for slot ${rank}`}.`,
      after: async () => {
        const fc = await frameContext(clientId);
        if (!fc.ok) return say(clientId, `:hourglass: Not yet. Waiting on: ${fc.missing.join("; ")}.`);
        const pool = await offerPool(clientId);
        if ("error" in pool) return say(clientId, `:warning: ${pool.error}`);
        const items: PoolItem[] = pool.pool
          .filter((p) => p.relevant && (target.role !== "pillar" || p.naming))
          .sort((a, b) => a.tier - b.tier || b.score - a.score)
          .map((p) => ({ question: p.question, score: p.score, theme: p.categoryLabel, origin: "keyword" as const, category: p.category }));
        const res = await swapPlanRow(clientId, rank, fc.ctx, { pool: items, keywords: pool.keywords });
        await say(
          clientId,
          res.ok
            ? `Swapped *${res.replaced}* for *${res.row.workingTitle}*. It is proposed again, so \`plan approve\` locks it in.`
            : `:warning: ${res.error}`
        );
        await refreshCard(clientId);
      },
    };
  }

  const edit = /^edit\s+([0-9]{1,2})\s*:\s*(.+)$/i.exec(sub);
  if (edit) {
    const res = await editPlanTitle(clientId, Number(edit[1]), edit[2]);
    if (!res.ok) return { message: `:warning: ${res.error}` };
    const { bustPages } = await import("@/lib/hub/pages");
    bustPages(clientId);
    return { message: `Renamed page ${edit[1]}.`, after: () => refreshCard(clientId) };
  }

  return null;
}

async function anchorReply(clientId: string, arg: string): Promise<PreCallReply> {
  const { magnetsForClient } = await import("@/lib/concierge/for-client");
  const { loadOffer, setAnchorMagnet } = await import("./offers");
  const { stepNumber } = await import("@/config/delivery-steps");
  const wanted = arg.trim();

  const [choices, offer] = await Promise.all([magnetsForClient(clientId), loadOffer(clientId)]);
  if (choices.length === 0) {
    return {
      message: `This client has no concierge catalogue yet, so there is nothing to anchor on. Step ${stepNumber("concierge_preview")} provisions it.`,
    };
  }

  if (!wanted) {
    const current = offer.magnetKey ? choices.find((c) => c.magnetKey === offer.magnetKey) : null;
    return {
      message: [
        current
          ? `The anchor is *${current.title}* (\`${current.magnetKey}\`). Every page's magnet is a framing of it.`
          : "No anchor is set. Every page's magnet leads back to one offer, and this names it.",
        "",
        "*The catalogue:*",
        ...choices.map((c) => `  • \`${c.magnetKey}\` is ${c.title} (${c.scope})${c.deliverable ? "" : ", asset missing"}`),
        "",
        "`anchor: <key>` sets it.",
      ].join("\n"),
    };
  }

  const picked = choices.find((c) => c.magnetKey.toLowerCase() === wanted.toLowerCase());
  if (!picked) return { message: `There is no \`${wanted}\` in this client's catalogue. \`anchor\` on its own lists it.` };
  if (!picked.deliverable) {
    return { message: `:warning: *${picked.title}* has no asset configured, so the widget could not hand it over. Pick another, or configure it first.` };
  }

  const res = await setAnchorMagnet({ clientId, magnetKey: picked.magnetKey });
  if (!res.ok) return { message: `:warning: ${res.error}` };

  return {
    message: `:white_check_mark: Anchor set: *${picked.title}*. Every page's magnet is a framing of it. Proposing the plan now.`,
    after: async () => {
      const r = await runPreCallPlan(clientId);
      if (r.note) await say(clientId, r.note);
      if (!r.ok && r.error) await say(clientId, `:warning: ${r.error}`);
      await refreshCard(clientId);
    },
  };
}
