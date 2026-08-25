// The avatar: which customer this whole build is aimed at — delivery step 8.
//
// ‼️ clients.primary_avatar HAD A COLUMN, A CHECK CONSTRAINT AND A VERIFIER, AND NO WRITER
// ANYWHERE. `grep -rn "primary_avatar" src/` returned two readers and zero writes. Step 11's card
// said "The proposal is on the board" and there was no such panel, so on the first real client
// that step came out `skipped` because no human being could have ticked it. This file is the
// writer that never existed.
//
// ‼️ THE SLOT AND THE LABEL ARE DIFFERENT THINGS AND THAT IS WHY NO MIGRATION IS NEEDED FOR IT.
//
// The CHECK constraint allows a1 / a2 / a3 and it stays. The SLOT is a1/a2/a3; the LABEL is free
// text. "Type a new one" means it occupies a slot under his own label, which is a write to two
// existing columns rather than a schema change. Matthew: "always give me the 3 default options
// and if I want a new option allow me to type it in there to create a new one."
//
// ‼️ THE SLUG IS WHAT TRAVELS BETWEEN CLIENTS, NOT THE SLOT.
// question_bank has no client_id and avatar_briefs is keyed on the vertical, so "a1" would mean
// whatever that client's niche brief had in position one on the day they confirmed. Two clients
// would file two different buyers under one tag. The slug is the same string in every client's
// mouth, which is the entire mechanism behind reusing one avatar's research on the next client.

import { supabaseAdmin } from "@/lib/db";
import { verticalFor } from "./harvest";

/** a1 / a2 / a3. The CHECK constraint on clients.primary_avatar allows these and nothing else. */
export const AVATAR_SLOTS = ["a1", "a2", "a3"] as const;
export type AvatarSlot = (typeof AVATAR_SLOTS)[number];

export function isAvatarSlot(v: string): v is AvatarSlot {
  return (AVATAR_SLOTS as readonly string[]).includes(v);
}

/**
 * A label to a stable key.
 *
 * ‼️ IT HAS TO SATISFY question_bank_avatar_check, WHICH IS `^[a-z0-9][a-z0-9-]{0,59}$`. A slug
 * that fails it does not fail loudly at the panel, it fails at the next harvest write, which is
 * the wrong place to find out. Anything that reduces to nothing returns "" and the caller refuses.
 */
export function slugifyAvatar(label: string): string {
  return (label ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

export interface AvatarCandidate {
  slot: AvatarSlot;
  label: string;
  slug: string;
  /** Why this one earns its place, in the niche brief's own words. Printed, never rewritten. */
  why: string | null;
  /** What one is worth. Straight off the brief. */
  ticket: string | null;
  /** The question this buyer types into an engine. */
  aiQuestion: string | null;
}

export interface AvatarCandidates {
  ok: boolean;
  error?: string;
  vertical: string;
  /** Which niche brief these came from, so the card can say it out loud. */
  nicheKey: string | null;
  /** How that brief was found. `vertical` is the clean case; the rest are the fallback ladder. */
  matchedBy: "vertical" | "business_type" | "niche_key_is_business_type" | "none";
  candidates: AvatarCandidate[];
}

/**
 * The three candidates, from `niche_briefs.avatars`.
 *
 * ‼️ THE LOOKUP LADDER IS THE THING THAT MAKES THIS WORK ON A REAL CLIENT, AND THE OBVIOUS
 * VERSION RETURNS NOTHING.
 *
 * `niche_briefs` is keyed on `niche_key` and NOTHING keys it on `vertical_slug`. Measured against
 * production on 2026-08-25: the live client's `vertical_slug` is `aeo-agency` and there is no such
 * row; the matching brief is keyed `aeo-marketing-agency`, and what identifies it is that its
 * `business_type` is character-for-character the client's own. A lookup written as
 * `niche_key = vertical_slug` would have rendered three empty slots on the one client this lane
 * has to work for, and it would have looked like the briefs were missing rather than mis-keyed.
 *
 * Same ladder `niche_briefs` already documents for the pitch pipeline: vertical_slug first,
 * business_type as the fallback.
 *
 * ‼️ A MISS RETURNS AN EMPTY LIST AND SAYS SO. It never invents a candidate. Matthew types his
 * own in that case, which is a supported answer rather than a workaround.
 */
export async function avatarCandidatesFor(clientId: string): Promise<AvatarCandidates> {
  const resolved = await verticalFor(clientId);
  if (!resolved.ok) {
    return { ok: false, error: resolved.error, vertical: "", nicheKey: null, matchedBy: "none", candidates: [] };
  }
  const vertical = resolved.vertical;

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("business_type")
    .eq("id", clientId)
    .maybeSingle();

  const businessType = ((client?.business_type as string | null) ?? "").trim();

  const pick = async (
    column: "niche_key" | "business_type",
    value: string,
    matchedBy: AvatarCandidates["matchedBy"]
  ): Promise<{ row: { niche_key: string; avatars: unknown } | null; matchedBy: AvatarCandidates["matchedBy"] }> => {
    if (!value) return { row: null, matchedBy };
    const { data } = await supabaseAdmin
      .from("niche_briefs")
      .select("niche_key, avatars")
      .eq(column, value)
      .maybeSingle();
    return { row: (data as { niche_key: string; avatars: unknown } | null) ?? null, matchedBy };
  };

  let found = await pick("niche_key", vertical, "vertical");
  if (!found.row) found = await pick("business_type", businessType, "business_type");
  if (!found.row) found = await pick("niche_key", businessType, "niche_key_is_business_type");

  if (!found.row) {
    return { ok: true, vertical, nicheKey: null, matchedBy: "none", candidates: [] };
  }

  const bag = (found.row.avatars ?? {}) as { best?: unknown };
  const best = Array.isArray(bag.best) ? bag.best : [];

  const str = (v: unknown): string | null => {
    const t = typeof v === "string" ? v.trim() : "";
    return t.length > 0 ? t : null;
  };

  const candidates: AvatarCandidate[] = best.slice(0, 3).map((raw, i) => {
    const a = (raw ?? {}) as Record<string, unknown>;
    const label = str(a.label) ?? `Candidate ${i + 1}`;
    return {
      slot: AVATAR_SLOTS[i],
      label,
      slug: slugifyAvatar(label),
      why: str(a.whyHighRoi) ?? str(a.why),
      ticket: str(a.ticket),
      aiQuestion: str(a.aiQuestion),
    };
  });

  return { ok: true, vertical, nicheKey: found.row.niche_key, matchedBy: found.matchedBy, candidates };
}

export interface ConfirmedAvatar {
  slot: AvatarSlot;
  label: string;
  slug: string;
  confirmedAt: string | null;
  confirmedBy: string | null;
}

export async function confirmedAvatarFor(clientId: string): Promise<ConfirmedAvatar | null> {
  const columns =
    "primary_avatar, primary_avatar_label, primary_avatar_slug, primary_avatar_confirmed_at, primary_avatar_confirmed_by";

  let { data, error } = await supabaseAdmin
    .from("clients")
    .select(columns)
    .eq("id", clientId)
    .maybeSingle();

  // ‼️ POSTGREST FAILS THE WHOLE SELECT ON ONE UNKNOWN COLUMN, so before the lane 2 migration is
  // applied this read returns nothing at all and every card that prints the avatar goes blank.
  // The slug is derivable from the label, so a READ degrades rather than disappearing. The WRITE
  // does not degrade: confirmAvatar fails loudly naming the column, because a confirmation that
  // silently skipped the join key is the thing that made this lane necessary.
  if (error && /primary_avatar_slug/.test(error.message)) {
    ({ data, error } = await supabaseAdmin
      .from("clients")
      .select("primary_avatar, primary_avatar_label, primary_avatar_confirmed_at, primary_avatar_confirmed_by")
      .eq("id", clientId)
      .maybeSingle());
  }
  if (error) {
    console.error("[clients/avatars] confirmed avatar read failed:", error.message);
    return null;
  }

  const row = data as Record<string, unknown> | null;
  const slot = (row?.primary_avatar as string | null) ?? null;
  if (!slot || !isAvatarSlot(slot)) return null;

  const label = ((row?.primary_avatar_label as string | null) ?? slot).trim();
  return {
    slot,
    label,
    // Rows written before primary_avatar_slug existed derive it rather than reporting nothing.
    slug: ((row?.primary_avatar_slug as string | null) ?? "") || slugifyAvatar(label),
    confirmedAt: (row?.primary_avatar_confirmed_at as string | null) ?? null,
    confirmedBy: (row?.primary_avatar_confirmed_by as string | null) ?? null,
  };
}

export interface ConfirmResult {
  ok: boolean;
  error?: string;
  avatar?: ConfirmedAvatar;
  /** True when this replaced a different avatar rather than being the first one. */
  changed?: boolean;
  previous?: { slot: string; label: string } | null;
}

/**
 * Confirm one avatar. The write that never existed.
 *
 * ‼️ IT IS THE ONLY WRITER OF clients.primary_avatar AND IT IS ALWAYS A PERSON'S ACT. The panel
 * and the Slack picker both land here, and neither is reachable by a runner. Doctrine:
 * confirmed_status, review_count and primary_avatar are written by a human action and by nothing
 * else.
 *
 * ‼️ A CHANGE IS AN APPEND, NOT AN OVERWRITE. client_avatar_runs keeps every avatar this client
 * has been aimed at and supersedes the old row rather than editing it, because the question set
 * frozen at Day 0 was built against whichever avatar was live then and the case study has to be
 * able to say which. day_zero_archive refuses a change after the stamp; that gate lives with the
 * caller, not here, so this function stays usable by the board.
 */
export async function confirmAvatar(args: {
  clientId: string;
  slot: string;
  label: string;
  by: string;
}): Promise<ConfirmResult> {
  const slot = args.slot.trim();
  if (!isAvatarSlot(slot)) {
    return { ok: false, error: `"${args.slot}" is not a slot. It has to be one of a1, a2 or a3.` };
  }

  const label = (args.label ?? "").trim();
  if (label.length < 3) {
    return { ok: false, error: "An avatar needs a label somebody can read. Three characters is not one." };
  }

  const slug = slugifyAvatar(label);
  if (!slug) {
    return {
      ok: false,
      error: `"${label}" does not reduce to anything a key can be made of. Use letters and numbers.`,
    };
  }

  const previous = await confirmedAvatarFor(args.clientId);
  const stamp = new Date().toISOString();

  const { error } = await supabaseAdmin
    .from("clients")
    .update({
      primary_avatar: slot,
      primary_avatar_label: label,
      primary_avatar_slug: slug,
      primary_avatar_confirmed_at: stamp,
      primary_avatar_confirmed_by: args.by,
    })
    .eq("id", args.clientId);

  if (error) return { ok: false, error: error.message };

  // Supersede whatever was live, then record the new one. In that order: a failure between the
  // two leaves a superseded row and no replacement, which reads as "nothing is confirmed" and is
  // recoverable, where the reverse would leave two live rows and no way to tell which is current.
  if (previous) {
    await supabaseAdmin
      .from("client_avatar_runs")
      .update({ superseded_at: stamp })
      .eq("client_id", args.clientId)
      .is("superseded_at", null);
  }

  const { error: runError } = await supabaseAdmin.from("client_avatar_runs").insert({
    client_id: args.clientId,
    slot,
    avatar_slug: slug,
    avatar_label: label,
    confirmed_at: stamp,
    confirmed_by: args.by,
  });

  if (runError) {
    // The client row IS updated, which is what every verifier reads, so this is not a failure of
    // the confirmation. It is a gap in the history, and saying so beats reporting a success that
    // lost something.
    console.error("[clients/avatars] avatar run history not written:", runError.message);
  }

  return {
    ok: true,
    avatar: { slot, label, slug, confirmedAt: stamp, confirmedBy: args.by },
    changed: Boolean(previous && previous.slug !== slug),
    previous: previous ? { slot: previous.slot, label: previous.label } : null,
  };
}

/**
 * `avatar: laser hair removal` typed in a step thread.
 *
 * ‼️ THE PREFIX IS REQUIRED AND SNIFFING IS NOT ACCEPTABLE, the same rule research-intake.ts
 * carries for `research:`. A confirmed avatar decides what step 10 researches and what the Day-0
 * question set is built from, so a sentence somebody typed while thinking out loud must not be
 * able to become one.
 */
export const AVATAR_PREFIX = /^\s*avatar\s*:/i;

export function isAvatarReply(text: string): boolean {
  return AVATAR_PREFIX.test(text ?? "");
}

export function avatarLabelFromReply(text: string): string {
  return (text ?? "").replace(AVATAR_PREFIX, "").trim();
}

/**
 * Which slot a typed avatar occupies.
 *
 * It takes the slot of a candidate whose label it matches, so re-typing one of the three does not
 * create a fourth. Otherwise it takes the first slot no candidate is using, and failing that a1 —
 * the slot is a storage location, not a ranking, and the label is what anybody reads.
 */
export function slotForTypedAvatar(label: string, candidates: AvatarCandidate[]): AvatarSlot {
  const slug = slugifyAvatar(label);
  const match = candidates.find((c) => c.slug === slug);
  if (match) return match.slot;
  const used = new Set(candidates.map((c) => c.slot));
  return AVATAR_SLOTS.find((s) => !used.has(s)) ?? "a1";
}

// ─────────────────────────────────────────────────────────────────────────────
// avatar_briefs — the same research, reused by the next client in the vertical
// ─────────────────────────────────────────────────────────────────────────────

export interface AvatarBrief {
  vertical: string;
  avatarSlug: string;
  avatarLabel: string;
  promptText: string | null;
  researchText: string | null;
  researchDocId: string | null;
  firstClientId: string | null;
  timesReused: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * ‼️ KEYED ON (vertical, avatar_slug) AND NOT ON THE CLIENT. That is the whole feature.
 *
 * Matthew: "this way if another client has the same LHR client, we can use the same prompt saved
 * in the databse and make it optional to run deep research again." Two med spas both aiming at
 * laser hair removal are researching the same buyer.
 */
export async function avatarBriefFor(vertical: string, avatarSlug: string): Promise<AvatarBrief | null> {
  const { data, error } = await supabaseAdmin
    .from("avatar_briefs")
    .select("*")
    .eq("vertical", vertical)
    .eq("avatar_slug", avatarSlug)
    .maybeSingle();

  if (error) {
    // Missing table means the lane 2 migration has not run. Reported, never treated as "no brief
    // exists": those are opposite answers and one of them would spend a research run again.
    console.error("[clients/avatars] avatar_briefs read failed:", error.message);
    return null;
  }
  if (!data) return null;

  return {
    vertical: data.vertical as string,
    avatarSlug: data.avatar_slug as string,
    avatarLabel: (data.avatar_label as string) ?? avatarSlug,
    promptText: (data.prompt_text as string | null) ?? null,
    researchText: (data.research_text as string | null) ?? null,
    researchDocId: (data.research_doc_id as string | null) ?? null,
    firstClientId: (data.first_client_id as string | null) ?? null,
    timesReused: (data.times_reused as number | null) ?? 0,
    createdAt: data.created_at as string,
    updatedAt: data.updated_at as string,
  };
}

/**
 * File the rendered prompt so the next client gets it back.
 *
 * ‼️ IT NEVER OVERWRITES research_text, AND ONLY FILLS prompt_text WHEN IT IS EMPTY. A second
 * client confirming the same avatar re-renders the same deterministic prompt, so writing it again
 * is harmless; the research is a human's work product and a regenerated prompt must not clear it.
 */
export async function recordAvatarPrompt(args: {
  vertical: string;
  avatarSlug: string;
  avatarLabel: string;
  promptText: string;
  clientId: string;
}): Promise<void> {
  const existing = await avatarBriefFor(args.vertical, args.avatarSlug);

  if (!existing) {
    const { error } = await supabaseAdmin.from("avatar_briefs").insert({
      vertical: args.vertical,
      avatar_slug: args.avatarSlug,
      avatar_label: args.avatarLabel,
      prompt_text: args.promptText,
      first_client_id: args.clientId,
    });
    if (error) console.error("[clients/avatars] avatar brief insert failed:", error.message);
    return;
  }

  if (existing.promptText) return;

  const { error } = await supabaseAdmin
    .from("avatar_briefs")
    .update({ prompt_text: args.promptText, updated_at: new Date().toISOString() })
    .eq("vertical", args.vertical)
    .eq("avatar_slug", args.avatarSlug);
  if (error) console.error("[clients/avatars] avatar brief prompt write failed:", error.message);
}

/** What came back from the research tool, kept so the next client does not run it again. */
export async function storeAvatarResearch(args: {
  vertical: string;
  avatarSlug: string;
  avatarLabel: string;
  researchText: string;
  researchDocId?: string | null;
  clientId: string;
}): Promise<void> {
  const existing = await avatarBriefFor(args.vertical, args.avatarSlug);
  const now = new Date().toISOString();

  if (!existing) {
    const { error } = await supabaseAdmin.from("avatar_briefs").insert({
      vertical: args.vertical,
      avatar_slug: args.avatarSlug,
      avatar_label: args.avatarLabel,
      research_text: args.researchText,
      research_doc_id: args.researchDocId ?? null,
      first_client_id: args.clientId,
    });
    if (error) console.error("[clients/avatars] avatar research insert failed:", error.message);
    return;
  }

  const { error } = await supabaseAdmin
    .from("avatar_briefs")
    .update({
      research_text: args.researchText,
      research_doc_id: args.researchDocId ?? existing.researchDocId,
      updated_at: now,
    })
    .eq("vertical", args.vertical)
    .eq("avatar_slug", args.avatarSlug);
  if (error) console.error("[clients/avatars] avatar research write failed:", error.message);
}

export interface ReuseResult {
  ok: boolean;
  error?: string;
  /** Phrases now filed under this (vertical, avatar). */
  stored?: number;
  seen?: number;
  timesReused?: number;
}

/**
 * Take the research this avatar already has rather than running it again.
 *
 * ‼️ IT RE-INGESTS RATHER THAN COPYING ROWS, AND THAT IS NOT A DETOUR. ingestResearch is the one
 * extractor: the same question-shape test and the same commercial-intent ladder that the
 * automated harvest uses. A second path that moved rows directly would eventually score the same
 * sentence differently depending on which door it came through, which is exactly what
 * research-intake.ts's header refuses.
 *
 * Idempotent by construction: question_bank's key is (vertical, avatar, normalized), so a phrase
 * this vertical already has under this avatar raises its frequency instead of duplicating.
 */
export async function reuseAvatarResearch(args: {
  clientId: string;
  vertical: string;
  avatarSlug: string;
}): Promise<ReuseResult> {
  const brief = await avatarBriefFor(args.vertical, args.avatarSlug);
  if (!brief) {
    return { ok: false, error: "there is no stored research for that avatar in this vertical" };
  }
  if (!brief.researchText) {
    return {
      ok: false,
      error:
        "that avatar has a prompt on file but no research yet. Somebody has to run it once before " +
        "it can be reused, which is what [Run it again] is for.",
    };
  }

  const { ingestResearch } = await import("./research-intake");
  const result = await ingestResearch({
    clientId: args.clientId,
    text: `research: ${brief.researchText}`,
  });

  if (!result.ok) return { ok: false, error: result.error };

  const timesReused = brief.timesReused + 1;
  const { error } = await supabaseAdmin
    .from("avatar_briefs")
    .update({ times_reused: timesReused, updated_at: new Date().toISOString() })
    .eq("vertical", args.vertical)
    .eq("avatar_slug", args.avatarSlug);
  if (error) console.error("[clients/avatars] reuse count not incremented:", error.message);

  return { ok: true, stored: result.stored, seen: result.seen, timesReused };
}

// ─────────────────────────────────────────────────────────────────────────────
// `avatar: laser hair removal`, typed in a step thread
// ─────────────────────────────────────────────────────────────────────────────

export interface ThreadReplyResult {
  ok: boolean;
  /** What to say back, in the thread it was typed in. Always present. */
  message: string;
}

/**
 * The two threads an avatar can be set from, and nowhere else.
 *
 * Step 8 is where it is decided. Step 23 is the call itself, and Matthew asked for it there by
 * name: "So avatar can be changed in the call so make sure we ask follow up question regarding
 * the avatar and the questions we want to run in the AI for day 0 scan ... and allow us to do
 * this in the thread from step 23."
 */
export const AVATAR_THREAD_STEPS = new Set(["avatar_confirmed", "day_zero_archive"]);

/**
 * ‼️ AFTER THE DAY-0 STAMP IT REFUSES, AND THAT IS THE ONE HARD RAIL IN THIS REPO.
 *
 * The tracked question set frozen at Day 0 was built against whichever avatar was live then, and
 * it is the baseline the day 30, 60 and 90 reports are measured against. Changing the target
 * afterwards does not improve the measurement, it destroys the thing being measured. Everything
 * else on this checklist flags and gets out of the way; this refuses, here and in the route, for
 * the same reason day-zero.ts refuses a publish.
 *
 * ‼️ IT READS clients.day_0_archived_at DIRECTLY RATHER THAN IMPORTING day-zero.ts, and that is
 * deliberate: the dependency there runs one way (config -> day-zero, delivery-checklist ->
 * day-zero) and a cycle leaves one module half-initialised. This needs one column, not a module.
 */
export async function handleAvatarThreadReply(args: {
  clientId: string;
  stepKey: string | null;
  text: string;
  by: string;
}): Promise<ThreadReplyResult | null> {
  if (!args.stepKey || !AVATAR_THREAD_STEPS.has(args.stepKey)) return null;
  if (!isAvatarReply(args.text)) return null;

  const label = avatarLabelFromReply(args.text);
  if (label.length < 3) {
    return {
      ok: false,
      message:
        ":warning: That is not an avatar. Reply `avatar: laser hair removal`, or whichever " +
        "customer this build is aimed at.",
    };
  }

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("day_0_archived_at")
    .eq("id", args.clientId)
    .maybeSingle();

  const existing = await confirmedAvatarFor(args.clientId);

  if (client?.day_0_archived_at && existing) {
    return {
      ok: false,
      message:
        `:lock: Day 0 is archived, so the avatar is frozen at *${existing.label}*. The tracked ` +
        "question set was built against it and it is what the day 30, 60 and 90 reports are " +
        "measured against, so changing it now would leave the case study comparing two " +
        "different questions.",
    };
  }

  const found = await avatarCandidatesFor(args.clientId);
  const slot = slotForTypedAvatar(label, found.candidates);
  const result = await confirmAvatar({ clientId: args.clientId, slot, label, by: args.by });

  if (!result.ok) {
    return { ok: false, message: `:warning: Not confirmed: ${result.error}` };
  }

  const lines = [
    `:white_check_mark: Avatar confirmed: *${label}* (${slot}), by ${args.by}.`,
    result.changed && result.previous
      ? `It replaces *${result.previous.label}*, which is kept in this client's avatar history.`
      : "",
  ].filter(Boolean);

  // ‼️ A CHANGE ON THE CALL REGENERATES THE QUESTION SET AS A NEW VERSION. The set is scored
  // against the avatar, so leaving the old one in place would tick a step whose contents are
  // about somebody else. It is only worth doing when the avatar actually CHANGED: re-confirming
  // the same one would spend a generation to produce the same set.
  if (result.changed && args.stepKey === "day_zero_archive") {
    const { generateCustomQuestionSet } = await import("./artifacts/custom-question-set");
    const regenerated = await generateCustomQuestionSet(args.clientId);
    lines.push(
      regenerated.ok
        ? "The custom question set has been regenerated against the new avatar, as a new version. The universal twenty are untouched underneath it."
        : `:warning: The question set could NOT be regenerated: ${regenerated.error}. The old one is still the one on file, and it was built for a different customer.`
    );
  }

  return { ok: true, message: lines.join("\n") };
}
