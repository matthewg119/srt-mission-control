// Step 21, before any page: the ladder, the anchor picked from it, then the pillar and supports picked.
//
// The pure half is offer-ladder.ts. This file reads what the ladder is written from, stores it, and runs the
// thread and the buttons:
//
//   ladder                   write (or rewrite) the awareness ladder for the locked offer
//   ladder pick <stage>      anchor the build at that rung  (also [Anchor at 4] on the card)
//   pillar: <rank> | auto    the pillar page's keyword, by its number in the keyword CSV  (also buttons)
//   supports: 3, 7, 12 | auto   the six support pages' keywords
//   guarantee: / outcome: / price:   handled by offers.ts in this thread too
//
// ‼️ THE ORDER IS THE POINT (Matthew, 2026-09-15): "get the keywords, and select the keywords before
// starting to do the drafts for the new pages so we can build the whole skeleton/strategy around the
// specific keyword." Nothing is planned until an anchor and a pillar are picked by a person.

import { supabaseAdmin } from "@/lib/db";
import type { AwarenessStage } from "@/lib/audit-engine/awareness";
import { draftLadder, ladderLines, recommendStage, type Ladder, type LadderInputs } from "./offer-ladder";
import { recordKeywordDecisions } from "./keyword-dataset";
import type { StoredKeyword } from "./keyword-expansion";

export interface LadderState {
  inputs: LadderInputs | null;
  missing: string[];
  ladder: Ladder | null;
  docId: string | null;
  approved: boolean;
  offerId: string | null;
  audienceId: string | null;
  anchorStage: AwarenessStage | null;
  anchorKey: string | null;
}

async function inputsFor(clientId: string): Promise<{ inputs: LadderInputs | null; missing: string[]; offerId: string | null; audienceId: string | null; anchorStage: AwarenessStage | null; anchorKey: string | null }> {
  const [{ loadOffer, isLocked }, { storyContextFor }, { magnetsForClient }, { loadKeywords }, { currentDocument }, { stepNumber }] =
    await Promise.all([
      import("./offers"),
      import("./story-context"),
      import("@/lib/concierge/for-client"),
      import("./client-keywords"),
      import("./audience-documents"),
      import("@/config/delivery-steps"),
    ]);

  const [offer, story, catalogue, kw, client] = await Promise.all([
    loadOffer(clientId),
    storyContextFor(clientId),
    magnetsForClient(clientId),
    loadKeywords(clientId),
    supabaseAdmin.from("clients").select("legal_name, dba_name").eq("id", clientId).maybeSingle(),
  ]);

  const missing: string[] = [];
  if (!isLocked(offer) || !offer.treatment) missing.push(`the offer, locked at step ${stepNumber("offer_locked")}`);
  if (catalogue.length === 0) missing.push(`the concierge catalogue, provisioned at step ${stepNumber("concierge_preview")}`);
  const approved = "error" in kw ? [] : kw.rows.filter((r) => r.approved && !r.dropped && r.use === "query");
  if (approved.length === 0) missing.push(`approved keywords, at step ${stepNumber("keyword_set")}`);

  const base = {
    offerId: offer.id,
    audienceId: offer.audienceId,
    anchorStage: offer.anchorStage,
    anchorKey: offer.magnetKey,
  };
  if (missing.length || !offer.treatment) return { inputs: null, missing, ...base };

  const byStage = { 1: { count: 0, examples: [] }, 2: { count: 0, examples: [] }, 3: { count: 0, examples: [] }, 4: { count: 0, examples: [] }, 5: { count: 0, examples: [] } } as LadderInputs["keywordsByStage"];
  for (const r of [...approved].sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9))) {
    const s = r.awarenessStage;
    if (!s) continue;
    byStage[s].count += 1;
    if (byStage[s].examples.length < 4) byStage[s].examples.push(r.phrase);
  }

  let shortOffer: string | null = null;
  if (offer.audienceId && offer.id) {
    const doc = await currentDocument({ audienceId: offer.audienceId, offerId: offer.id, kind: "short_offer" });
    shortOffer = doc.ok ? (doc.doc?.content ?? null) : null;
  }

  return {
    inputs: {
      clientName: ((client.data?.dba_name as string | null) || (client.data?.legal_name as string | null)) ?? "this business",
      audienceLabel: story.audienceLabel,
      buyer: story.buyer,
      treatment: offer.treatment,
      terms: offer.terms,
      positioning: offer.positioning,
      outcome: offer.outcomePromise,
      price: offer.price,
      guarantee: offer.guarantee,
      beliefs: story.beliefs,
      avatarNotes: story.avatarNotes,
      objections: story.objections ?? [],
      shortOffer,
      keywordsByStage: byStage,
      catalogue: catalogue.map((c) => ({ key: c.magnetKey, title: c.title, promise: c.promise, deliverable: c.deliverable })),
    },
    missing,
    ...base,
  };
}

export async function ladderState(clientId: string): Promise<LadderState> {
  const got = await inputsFor(clientId);
  let ladder: Ladder | null = null;
  let docId: string | null = null;
  let approved = false;
  if (got.offerId && got.audienceId) {
    const { currentDocument } = await import("./audience-documents");
    const doc = await currentDocument({ audienceId: got.audienceId, offerId: got.offerId, kind: "awareness_ladder" });
    if (doc.ok && doc.doc) {
      const parsed = doc.doc.parsed as { ladder?: Ladder } | null;
      if (parsed?.ladder?.rungs?.length) {
        ladder = parsed.ladder;
        docId = doc.doc.id;
        approved = doc.doc.status === "approved";
      }
    }
  }
  return { inputs: got.inputs, missing: got.missing, ladder, docId, approved, offerId: got.offerId, audienceId: got.audienceId, anchorStage: got.anchorStage, anchorKey: got.anchorKey };
}

/** Draft and store the ladder. Returns the lines to post. */
export async function writeLadder(clientId: string, by: string): Promise<{ ok: true; lines: string[] } | { ok: false; error: string }> {
  const got = await inputsFor(clientId);
  if (!got.inputs) return { ok: false, error: `the ladder waits on: ${got.missing.join("; ")}` };
  if (!got.offerId || !got.audienceId) return { ok: false, error: "the offer has no row in client_offers yet, so there is nowhere to file a ladder." };

  const drafted = await draftLadder(got.inputs);
  if (!drafted.ok) return { ok: false, error: drafted.error };

  const { storeDocument } = await import("./audience-documents");
  const content = ladderLines(drafted.ladder, got.inputs.catalogue).join("\n");
  const stored = await storeDocument({
    clientId,
    audienceId: got.audienceId,
    offerId: got.offerId,
    kind: "awareness_ladder",
    content,
    parsed: { ladder: drafted.ladder, inputs: got.inputs, model: "claude-sonnet-4-6" },
    source: "drafted",
    by,
  });
  if (!stored.ok) return { ok: false, error: stored.error };

  return {
    ok: true,
    lines: [
      `:ladder: *Awareness ladder written for ${got.inputs.treatment}.* One claim and one anchor per stage, 5 furthest from buying, 1 closest.`,
      got.inputs.guarantee ? "" : "_No guarantee is on file, so no rung promises one. `guarantee: <what they will honour>` then `ladder` rewrites it._",
      "",
      ...ladderLines(drafted.ladder, got.inputs.catalogue),
      "",
      `:star: *Recommended: anchor at ${drafted.ladder.recommendedStage}.* ${drafted.ladder.why}`,
      "Press [Anchor at N] on the card, or `ladder pick N`.",
    ].filter((l, i, a) => !(l === "" && a[i - 1] === "")),
  };
}

/** Anchor the build at one rung: the anchor offer, the stage, and the ladder approved as picked. */
export async function pickRung(clientId: string, stage: number, by: string): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const state = await ladderState(clientId);
  if (!state.ladder || !state.docId) return { ok: false, error: "there is no ladder yet. `ladder` writes one." };
  const rung = state.ladder.rungs.find((r) => r.stage === stage);
  if (!rung) return { ok: false, error: `the ladder has no stage ${stage}.` };
  const entry = state.inputs?.catalogue.find((c) => c.key === rung.anchorKey);
  if (!entry?.deliverable) return { ok: false, error: `stage ${stage}'s anchor (${rung.anchorKey}) hands over nothing yet. Configure its asset, or pick another rung.` };

  const { setAnchorMagnet, setAnchorStage, loadOffer } = await import("./offers");
  const a = await setAnchorMagnet({ clientId, magnetKey: rung.anchorKey });
  if (!a.ok) return a;
  const s = await setAnchorStage({ clientId, stage: rung.stage });
  if (!s.ok) return s;

  const { approveDocument, offerFingerprint } = await import("./audience-documents");
  const offer = await loadOffer(clientId);
  await approveDocument({ id: state.docId, by, fingerprint: offerFingerprint(offer) });

  return {
    ok: true,
    message: [
      `:white_check_mark: *Anchored at stage ${rung.stage}.* Every page's magnet is a framing of *${entry.title}*, and the pages speak to: _${rung.readerState}_`,
      `Claim: *${rung.claim}*${rung.riskReversal ? `\nRisk reversal: ${rung.riskReversal}` : ""}`,
      "",
      "*Next: pick the keywords the pages are built around.*",
      ...(await keywordPickLines(clientId)),
    ].join("\n"),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The keyword pick
// ─────────────────────────────────────────────────────────────────────────────

interface PickState {
  pillar: StoredKeyword | null;
  supports: StoredKeyword[];
  pillarCandidates: StoredKeyword[];
  supportCandidates: StoredKeyword[];
  approved: StoredKeyword[];
  labels: (key: string) => string;
}

export async function pickState(clientId: string): Promise<PickState | { error: string }> {
  const { planKeywords } = await import("./client-keywords");
  const { categoryLabel, isRelevantKeyword } = await import("./keyword-expansion");
  const pk = await planKeywords(clientId);
  if ("error" in pk) return { error: pk.error };
  const naming = pk.ctx.categories.find((c) => c.naming)?.key ?? null;
  const focus = new Set(pk.ctx.categories.filter((c) => c.focus).map((c) => c.key));
  const rows = [...pk.rows].sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
  const relevant = rows.filter((r) => isRelevantKeyword(r, pk.vocab));
  const perCat = new Map<string, number>();
  const supportCandidates: StoredKeyword[] = [];
  for (const r of [...relevant.filter((x) => focus.has(x.category)), ...relevant.filter((x) => !focus.has(x.category))]) {
    if (r.category === naming) continue;
    const n = perCat.get(r.category) ?? 0;
    if (n >= 3) continue;
    perCat.set(r.category, n + 1);
    supportCandidates.push(r);
    if (supportCandidates.length >= 18) break;
  }
  return {
    pillar: rows.find((r) => r.role === "pillar") ?? null,
    supports: rows.filter((r) => r.role === "support"),
    pillarCandidates: relevant.filter((r) => r.category === naming).slice(0, 5),
    supportCandidates,
    approved: rows,
    labels: (key) => categoryLabel(pk.ctx.categories, key),
  };
}

export async function keywordPickLines(clientId: string): Promise<string[]> {
  const st = await pickState(clientId);
  if ("error" in st) return [`:warning: ${st.error}`];
  const named = (r: StoredKeyword) => (r.currentlyNamed === false ? " _(not named today)_" : r.currentlyNamed ? " _(named today)_" : "");
  const lines: string[] = [];
  if (st.pillar) {
    lines.push(`:white_check_mark: *Pillar:* ${st.pillar.rank}. ${st.pillar.phrase}`);
  } else {
    lines.push("*Pillar* (the offer page). Press one below, or `pillar: <number>`:");
    for (const r of st.pillarCandidates) lines.push(`  ${r.rank}. ${r.phrase}${named(r)}`);
    if (st.pillarCandidates.length === 0) lines.push("  _No approved naming variant is about the offer. `keywords more naming` at the keyword step, then approve._");
  }
  if (st.supports.length) {
    lines.push(`:white_check_mark: *Supports (${st.supports.length}):* ${st.supports.map((r) => `${r.rank}. ${r.phrase}`).join("; ")}`);
  } else {
    lines.push("*Supports* (six pages, the four buying questions first). `supports: 12, 18, 25, 31, 40, 44` or `supports auto`:");
    for (const r of st.supportCandidates) lines.push(`  ${r.rank}. ${r.phrase}  _${st.labels(r.category)}_${named(r)}`);
  }
  if (st.pillar && st.supports.length) lines.push("", "Both picked. `plan new` proposes the seven pages around them.");
  return lines;
}

async function setRole(clientId: string, ids: string[], role: "pillar" | "support", by: string, rows: StoredKeyword[]): Promise<string | null> {
  const now = new Date().toISOString();
  const { error: clearError } = await supabaseAdmin
    .from("client_keywords")
    .update({ role: null, picked_at: null, picked_by: null })
    .eq("client_id", clientId)
    .eq("role", role);
  if (clearError) return clearError.message;
  if (ids.length) {
    const { error } = await supabaseAdmin
      .from("client_keywords")
      .update({ role, picked_at: now, picked_by: by })
      .in("id", ids);
    if (error) return error.message;
  }
  await recordKeywordDecisions({
    clientId,
    action: role === "pillar" ? "pick_pillar" : "pick_support",
    actor: by,
    rows: rows.filter((r) => ids.includes(r.id)),
  });
  return null;
}

export async function pickPillar(clientId: string, arg: string, by: string): Promise<{ ok: boolean; message: string }> {
  const st = await pickState(clientId);
  if ("error" in st) return { ok: false, message: `:warning: ${st.error}` };
  const wanted = arg.trim().toLowerCase();
  const row =
    wanted === "auto"
      ? st.pillarCandidates[0]
      : st.approved.find((r) => r.id === arg.trim() || String(r.rank) === wanted.replace(/^#/, ""));
  if (!row) return { ok: false, message: `:warning: There is no approved query ${arg}. The numbers are the keyword CSV's rank column.` };
  if (row.role === "support") {
    await setRole(clientId, st.supports.filter((s) => s.id !== row.id).map((s) => s.id), "support", by, st.approved);
  }
  const err = await setRole(clientId, [row.id], "pillar", by, st.approved);
  if (err) return { ok: false, message: `:warning: Not picked: ${err}` };
  return { ok: true, message: `:white_check_mark: *Pillar picked:* ${row.rank}. ${row.phrase}\n${(await keywordPickLines(clientId)).join("\n")}` };
}

export async function pickSupports(clientId: string, arg: string, by: string): Promise<{ ok: boolean; message: string }> {
  const st = await pickState(clientId);
  if ("error" in st) return { ok: false, message: `:warning: ${st.error}` };
  let chosen: StoredKeyword[];
  if (arg.trim().toLowerCase() === "auto") {
    const { selectOfferPlan, PRE_CALL_SUPPORTS } = await import("./page-plan");
    void PRE_CALL_SUPPORTS;
    const { tierOf } = await import("./keyword-expansion");
    const sel = selectOfferPlan(
      st.supportCandidates.map((r) => ({
        question: r.phrase,
        score: r.score,
        category: r.category,
        categoryLabel: st.labels(r.category),
        tier: tierOf(r.origin),
        naming: false,
        focus: true,
        relevant: true,
        keywordId: r.id,
      })),
      { city: null, exclude: new Set(st.pillar ? [st.pillar.normalized] : []) }
    );
    chosen = sel.supports.map((s) => st.approved.find((r) => r.id === s.keywordId)).filter((r): r is StoredKeyword => Boolean(r));
  } else {
    const ranks = arg.split(/[,\s]+/).map((x) => x.replace(/^#/, "")).filter(Boolean);
    const missing = ranks.filter((n) => !st.approved.some((r) => String(r.rank) === n));
    if (missing.length) return { ok: false, message: `:warning: Nothing picked. No approved query numbered ${missing.join(", ")}.` };
    chosen = ranks.map((n) => st.approved.find((r) => String(r.rank) === n)!).filter((r) => r.id !== st.pillar?.id);
    if (chosen.length > 6) return { ok: false, message: `:warning: Nothing picked. That is ${chosen.length}; the plan has six supports.` };
  }
  const err = await setRole(clientId, chosen.map((r) => r.id), "support", by, st.approved);
  if (err) return { ok: false, message: `:warning: Not picked: ${err}` };
  return { ok: true, message: `:white_check_mark: *${chosen.length} supports picked.*\n${(await keywordPickLines(clientId)).join("\n")}` };
}

// ─────────────────────────────────────────────────────────────────────────────
// The card and the thread
// ─────────────────────────────────────────────────────────────────────────────

/** Step 21's card before a plan exists: what the ladder needs, the ladder, the picks. */
export async function step21SetupLines(clientId: string): Promise<string[]> {
  const st = await ladderState(clientId);
  const lines: string[] = [];
  if (st.missing.length) {
    return ["*Waiting on:*", ...st.missing.map((m) => `  • ${m}`)];
  }
  const inp = st.inputs!;
  lines.push("*1. The offer the ladder is written from*");
  lines.push(`  Offer: ${inp.treatment}`);
  lines.push(`  ${inp.outcome ? ":white_check_mark:" : ":grey_question:"} Outcome: ${inp.outcome ?? "not set. `outcome: more booked patients`"}`);
  lines.push(`  ${inp.price ? ":white_check_mark:" : ":grey_question:"} Price: ${inp.price ?? "not set. `price: $499/month`"}`);
  lines.push(`  ${inp.guarantee ? ":white_check_mark:" : ":grey_question:"} Guarantee: ${inp.guarantee ?? "not set, so no rung promises one. `guarantee: <what they will honour>`"}`);
  lines.push("");

  lines.push("*2. The awareness ladder*");
  if (!st.ladder) {
    lines.push(`  Not written yet. \`ladder\` writes it (about a minute). Most approved searches sit at stage ${recommendStage(inp.keywordsByStage)}.`);
  } else {
    lines.push(...ladderLines(st.ladder, inp.catalogue, { pickedStage: st.approved ? st.anchorStage : null }).map((l) => `  ${l}`));
    lines.push(
      st.approved && st.anchorStage
        ? `  :white_check_mark: Anchored at stage ${st.anchorStage}. \`ladder pick N\` changes it, \`ladder\` rewrites it.`
        : `  :star: Recommended: stage ${st.ladder.recommendedStage}. ${st.ladder.why} Press [Anchor at N] below.`
    );
  }
  lines.push("");
  lines.push("*3. The keywords the pages are built around*");
  if (!st.approved || !st.anchorStage) {
    lines.push("  After the anchor is picked.");
  } else {
    lines.push(...(await keywordPickLines(clientId)).map((l) => `  ${l}`));
  }
  return lines;
}

/** Buttons for step 21's card: one per rung until anchored, then one per pillar candidate. */
export async function step21Actions(clientId: string): Promise<Array<{ label: string; actionId: string; value: string }>> {
  const st = await ladderState(clientId);
  if (st.ladder && !(st.approved && st.anchorStage)) {
    return st.ladder.rungs.map((r) => ({
      label: `Anchor at ${r.stage}${st.ladder!.recommendedStage === r.stage ? " (recommended)" : ""}`,
      actionId: "ladder_pick",
      value: `${clientId}:${r.stage}`,
    }));
  }
  if (!st.ladder && st.inputs) return [{ label: "Write the ladder", actionId: "ladder_write", value: clientId }];
  if (st.approved && st.anchorStage) {
    const ps = await pickState(clientId);
    if ("error" in ps) return [];
    const out: Array<{ label: string; actionId: string; value: string }> = [];
    if (!ps.pillar) {
      for (const r of ps.pillarCandidates) {
        const label = `Pillar ${r.rank}: ${r.phrase}`;
        out.push({ label: label.length > 70 ? `${label.slice(0, 67)}...` : label, actionId: "kw_pillar", value: `${clientId}:${r.id}` });
      }
    }
    if (!ps.supports.length) out.push({ label: "Supports: pick for me", actionId: "kw_supports_auto", value: clientId });
    return out;
  }
  return [];
}

/**
 * Once the anchor, the pillar and the supports are all picked, propose the plan without waiting to be asked.
 * Returns the note to post, or null when something is still to pick.
 */
export async function proposeWhenPicked(clientId: string): Promise<string | null> {
  const st = await pickState(clientId);
  if ("error" in st || !st.pillar || st.supports.length === 0) return null;
  const { runPreCallPlan } = await import("./pre-call-pages");
  const res = await runPreCallPlan(clientId);
  return res.ok ? (res.note ?? null) : `:warning: ${res.error}`;
}

const LADDER = /^ladder(?:\s+pick\s+([1-5]))?$/i;
const PILLAR = /^pillar\s*:\s*(auto|#?\d{1,4})$/i;
const SUPPORTS = /^supports\s*:\s*(auto|[#\d,\s]+)$/i;

/** True when the text is one of this file's commands, for step-commands.ts's wrong-thread pointer. */
export function isLadderCommand(text: string): boolean {
  const t = text.trim().replace(/^[`*_]+|[`*_]+$/g, "").trim();
  return LADDER.test(t) || PILLAR.test(t) || SUPPORTS.test(t);
}

export async function handleLadderThreadReply(input: {
  clientId: string;
  stepKey: string | null;
  text: string;
  by: string;
}): Promise<{ message: string; after?: () => Promise<void> } | null> {
  if (input.stepKey !== "pre_call_pages") return null;
  const t = input.text.trim().replace(/^[`*_]+|[`*_]+$/g, "").trim();
  const refresh = async () => {
    const { postStep } = await import("./step-engine");
    await postStep(input.clientId, "pre_call_pages").catch(() => {});
  };
  const say = async (text: string) => {
    const { notifyStep } = await import("./step-board");
    await notifyStep(input.clientId, "pre_call_pages", text).catch(() => {});
  };

  const l = LADDER.exec(t);
  if (l && !l[1]) {
    return {
      message: ":hourglass_flowing_sand: Writing the awareness ladder from the offer, the avatar, the beliefs, the objections and the approved keywords. About a minute.",
      after: async () => {
        const res = await writeLadder(input.clientId, input.by);
        await say(res.ok ? res.lines.join("\n") : `:warning: No ladder: ${res.error}`);
        await refresh();
      },
    };
  }
  if (l && l[1]) {
    const res = await pickRung(input.clientId, Number(l[1]), input.by);
    return { message: res.ok ? res.message : `:warning: ${res.error}`, after: refresh };
  }
  const afterPick = async () => {
    const note = await proposeWhenPicked(input.clientId);
    if (note) await say(note);
    await refresh();
  };
  const p = PILLAR.exec(t);
  if (p) {
    const res = await pickPillar(input.clientId, p[1], input.by);
    return { message: res.message, after: res.ok ? afterPick : refresh };
  }
  const s = SUPPORTS.exec(t);
  if (s) {
    const res = await pickSupports(input.clientId, s[1], input.by);
    return { message: res.message, after: res.ok ? afterPick : refresh };
  }
  return null;
}
