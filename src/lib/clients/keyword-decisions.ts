// The three reactions on a keyword's card, and what each one decides.
//
// ‼️ IT RETURNS false FOR ANYTHING THAT IS NOT OURS, AND THAT IS THE WHOLE CONTRACT. It sits in a
// chain of seventeen reaction handlers in src/app/api/slack/events/route.ts, every one of which
// shares ✅ with the others, so a handler that claimed a reaction it did not own would silently eat
// somebody else's approval. The ts is the key: a message whose ts is not in client_keywords.card_ts
// is not ours, full stop, and the check is one indexed lookup.
//
// ‼️ THE BOT SEEDS ALL THREE EMOJI ONTO ITS OWN CARD, so both self-reaction guards are load bearing.
// The userId check catches the seeding events themselves. The reaction-count check catches the case
// where userId is absent: a count of 1 is our own seed and nobody has pressed anything. A null count
// means reactions.get failed, most likely a missing reactions:read scope, and null must never read
// as zero or the lane goes dead the moment a scope changes. Both copied from hook-studio.ts, which
// learned them first.
//
// ‼️ THERE IS NO reaction_removed IN THIS REPO, so un-reacting cannot be the undo. ✖ is the undo:
// on a card that was kept it steps back to undecided, and only on an undecided card is it the drop.
// That gives a reversible decision without a Slack app scope nobody has granted, and the card
// re-renders saying which of the two just happened.

import { slack } from "@/lib/slack-bot";
import { supabaseAdmin } from "@/lib/db";
import { DROP_EMOJI, PICK_EMOJI, VARY_EMOJI } from "./keyword-cards";
import type { KeywordOrigin } from "./keyword-expansion";
import type { Finalist } from "./keyword-strategy-rules";

/** The row behind a card, as little of it as the decision needs. */
interface CardRow {
  id: string;
  clientId: string;
  phrase: string;
  selectedAt: string | null;
  droppedAt: string | null;
}

/**
 * A column or table this database has not got yet reads as "no card", not as an error.
 *
 * Same predicate keyword-strategy.ts keeps, repeated here rather than imported for the reason
 * serp-read.ts declares its own SERP_VISION_TYPES: a lane should not take a dependency on another
 * lane for four lines, and this one runs on EVERY reaction in the workspace. If it threw on a
 * database without the migration, every ✅ anywhere would 500.
 */
function missingColumn(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return (
    err.code === "42P01" ||
    err.code === "PGRST205" ||
    err.code === "42703" ||
    /does not exist|schema cache|column .* does not exist/i.test(err.message ?? "")
  );
}

async function keywordByCardTs(ts: string): Promise<CardRow | null> {
  const { data, error } = await supabaseAdmin
    .from("client_keywords")
    .select("id, client_id, phrase, selected_at, dropped_at")
    .eq("card_ts", ts)
    .maybeSingle();
  if (error) {
    if (!missingColumn(error)) console.error("[clients/keyword-decisions] card lookup:", error.message);
    return null;
  }
  if (!data) return null;
  return {
    id: data.id as string,
    clientId: data.client_id as string,
    phrase: data.phrase as string,
    selectedAt: (data.selected_at as string | null) ?? null,
    droppedAt: (data.dropped_at as string | null) ?? null,
  };
}

export async function handleKeywordCardReaction(args: {
  reaction: string;
  slackTs: string;
  channel: string;
  userId?: string;
}): Promise<boolean> {
  // Cheapest test first: three string compares before any database work at all, because this runs
  // on every reaction anybody adds anywhere in the workspace.
  if (args.reaction !== PICK_EMOJI && args.reaction !== DROP_EMOJI && args.reaction !== VARY_EMOJI) {
    return false;
  }

  const row = await keywordByCardTs(args.slackTs);
  if (!row) return false;

  // From here on the card IS ours, so every path returns true and nothing below in the chain sees it.
  if (args.userId && args.userId === (await slack.getBotUserId())) return true;

  const count = await slack.getReactionCount(args.channel, args.slackTs, args.reaction);
  if (count !== null && count < 2) return true;

  const by = args.userId ? `<@${args.userId}>` : "someone in Slack";

  try {
    if (args.reaction === PICK_EMOJI) await selectKeyword(row, by);
    else if (args.reaction === DROP_EMOJI) await unselectOrDrop(row, by);
    else await varyKeyword(row, by);
  } catch (e) {
    console.error("[clients/keyword-decisions] reaction failed:", (e as Error).message);
  }

  return true;
}

/**
 * Keep these, by id. The TYPED door into the same decision the ✅ reaction takes.
 *
 * ‼️ UNTIL 2026-09-28 THERE WAS NO TYPED DOOR AT ALL, AND THAT WAS THE WHOLE COMPLAINT. `selected_at`
 * could only be reached by reacting to a per-keyword card, and a card only exists once somebody has
 * pasted that keyword's Google screenshot. So `keywords pick:` said "15 selected" and selected
 * nothing, and step 21 went on planning seven pages from every approved row. Measured on SRT Agency
 * 2026-09-28: 355 approved, 149 of them a model's own proposals, 0 selected.
 *
 * ‼️ IT APPROVES IN THE SAME STATEMENT, AND THAT IS NOT A CONVENIENCE. selectedKeywords() computes
 * planKeywords() FIRST, which is approved-only, and then intersects it with the selected ids. A row
 * that is selected but NOT approved is in neither list: the intersection comes back empty, `curated`
 * goes false, and the fallback quietly hands step 21 the whole approved set again. That is the bug
 * wearing the fix's clothes. Select and approve travel together or the selection is invisible.
 *
 * It is also what lets a variation be kept at all: loadFinalists filters on `approved = true` and
 * variations arrive unapproved on purpose, because a model's proposal is not a pick. A person
 * keeping it IS the approval.
 *
 * ‼️ THE ONLY UPDATE OF selected_at IN THE REPO, AND IT STAYS IN THIS FILE. step-needs.ts declares
 * `writtenIn: "src/lib/clients/keyword-decisions.ts"` and _probe-dead-wires.ts §8 greps this file
 * for the column name before it will believe the declaration. A second writer in client-keywords.ts
 * would make that declaration a half-truth and the generated docs wrong.
 */
export async function selectKeywordIds(args: {
  clientId: string;
  ids: readonly string[];
  by: string;
}): Promise<{ ok: true; selected: number } | { ok: false; error: string }> {
  // Nothing asked for is not a failure. `keywords pick:` on a list that was all hooks lands here.
  if (!args.ids.length) return { ok: true, selected: 0 };

  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("client_keywords")
    .update({
      selected_at: now,
      selected_by: args.by,
      approved: true,
      approved_at: now,
      approved_by: args.by,
      // Keeping a keyword un-drops it. Somebody who dropped it and changed their mind has said so.
      dropped_at: null,
      updated_at: now,
    })
    .eq("client_id", args.clientId)
    .in("id", args.ids)
    .select("id, phrase, category, rank, score, origin, use");

  if (error) {
    if (!missingColumn(error)) console.error("[clients/keyword-decisions] select failed:", error.message);
    return { ok: false, error: error.message };
  }

  const rows = data ?? [];
  const { recordKeywordDecisions } = await import("./keyword-dataset");
  await recordKeywordDecisions({
    clientId: args.clientId,
    action: "select",
    actor: args.by,
    rows: rows.map((r) => ({
      id: (r.id as string) ?? "",
      phrase: (r.phrase as string) ?? "",
      category: (r.category as string) ?? "general",
      use: ((r.use as string) ?? "query") as "query" | "hook",
      origin: ((r.origin as string) ?? "manual") as KeywordOrigin,
      rank: (r.rank as number | null) ?? null,
      score: (r.score as number) ?? 0,
    })),
    context: { via: "typed" },
  }).catch(() => {});

  return { ok: true, selected: rows.length };
}

/**
 * Keep it: one card, one reaction.
 *
 * The bulk writer above does the work, so a reaction and a typed pick are the same decision written
 * the same way. Only the redraw is particular to the card.
 */
async function selectKeyword(row: CardRow, by: string): Promise<void> {
  const res = await selectKeywordIds({ clientId: row.clientId, ids: [row.id], by });
  if (!res.ok) return;
  await redraw(row.clientId, row.id);
}

/**
 * Step back one.
 *
 * A kept keyword becomes undecided; an undecided one is dropped. That ordering is what makes ✖ an
 * undo as well as a decision, in a repo that receives no reaction_removed event.
 */
async function unselectOrDrop(row: CardRow, by: string): Promise<void> {
  const now = new Date().toISOString();

  if (row.selectedAt) {
    const { error } = await supabaseAdmin
      .from("client_keywords")
      .update({ selected_at: null, selected_by: null, updated_at: now })
      .eq("id", row.id);
    if (error) {
      console.error("[clients/keyword-decisions] unselect failed:", error.message);
      return;
    }
    await record(row, "unselect", by);
    await redraw(row.clientId, row.id);
    return;
  }

  // ‼️ dropped_at, NOT A DELETE, which is the rule client_keywords has carried since its first
  // migration: a dropped row is remembered as unwanted so a re-expansion cannot propose it back.
  // The same soft drop dropKeywordAction performs behind the [Drop] button on the gate card.
  const { error } = await supabaseAdmin
    .from("client_keywords")
    .update({ dropped_at: now, selected_at: null, selected_by: null, updated_at: now })
    .eq("id", row.id);
  if (error) {
    console.error("[clients/keyword-decisions] drop failed:", error.message);
    return;
  }
  await record(row, "drop", by);
  await redraw(row.clientId, row.id);
}

/**
 * More ways to say this one.
 *
 * ‼️ EVERY VARIATION GETS ITS OWN CARD, so the same three reactions work on it. And every one of
 * them needs its OWN screenshot before it can be selected: the gate resolves on `normalized`, so
 * letting a variation inherit its parent's picture would clear the gate for a search nobody looked
 * at, which is the one thing the gate exists to prevent.
 */
async function varyKeyword(row: CardRow, by: string): Promise<void> {
  const { notifyStep } = await import("./step-board");
  const { variationsFor } = await import("./keyword-variations");
  const { keywordContext, writeVariationsOf } = await import("./client-keywords");

  const c = await keywordContext(row.clientId);
  if (!c.ok) {
    await notifyStep(row.clientId, "keyword_set", `:warning: No variations: missing ${c.missing.join("; ")}.`).catch(() => {});
    return;
  }

  const res = await variationsFor({ ctx: c.ctx, picked: [row.phrase] });
  if (!res.ok) {
    await notifyStep(row.clientId, "keyword_set", `:warning: No variations for *${row.phrase}*: ${res.error}`).catch(() => {});
    return;
  }

  const phrases = res.rows.map((v) => v.phrase);
  if (!phrases.length) {
    await notifyStep(
      row.clientId,
      "keyword_set",
      `No other ways to say *${row.phrase}* came back. It is already how people type it.`
    ).catch(() => {});
    return;
  }

  const written = await writeVariationsOf({ clientId: row.clientId, parent: row, phrases });
  if (!written.ok) {
    await notifyStep(row.clientId, "keyword_set", `:warning: Variations not written: ${written.error}`).catch(() => {});
    return;
  }

  await record(row, "variation", by, { wrote: written.rows.length });
  await postVariationCards(row, written.rows);
}

/**
 * One card per new variation.
 *
 * They carry no shortlist number: shortlistOf() dedupes by subject and caps at 25, so variations
 * deliberately do not grow the shortlist. The card names its parent instead, which is the thing
 * somebody needs to know when deciding it.
 */
async function postVariationCards(
  parent: CardRow,
  rows: ReadonlyArray<{ id: string; phrase: string }>
): Promise<void> {
  const { finalistsFor } = await import("./keyword-strategy");
  const { keywordCard, postKeywordCard, selectedCount } = await import("./keyword-cards");
  const { channelFor, anchorTsFor, notifyStep } = await import("./step-board");

  const channel = (await channelFor(parent.clientId)) ?? undefined;
  const thread = (await anchorTsFor(parent.clientId, "keyword_set")) ?? undefined;
  const count = await selectedCount(parent.clientId);

  // A variation is not approved, so it is not on the shortlist and finalistsFor cannot supply it.
  // The card is drawn from the little we know, which is honest: it has no reading yet, and the card
  // says exactly that until somebody pastes its screenshot.
  const listed = await finalistsFor(parent.clientId);
  const known = new Map(listed.ok ? listed.list.map((r) => [r.id, r] as const) : []);

  for (const v of rows) {
    const finalist = known.get(v.id) ?? blankFinalist(v.id, v.phrase);
    const card = keywordCard({ row: finalist, number: null, variationOf: parent.phrase, selectedCount: count });
    const res = await postKeywordCard({ clientId: parent.clientId, card, channel, thread });
    if (!res.ok) {
      await notifyStep(parent.clientId, "keyword_set", `:warning: A variation card did not post: ${res.error}`).catch(() => {});
    }
  }
}

/**
 * A keyword nobody has read yet, in Finalist shape.
 *
 * Every reading field is null, which the card prints as "no screenshot on file yet". That is what is
 * true about a phrase written thirty seconds ago, and inventing anything else here would be the card
 * asserting a reading that never happened.
 */
function blankFinalist(id: string, phrase: string): Finalist {
  return {
    id,
    phrase,
    normalized: phrase.toLowerCase(),
    category: "general",
    score: 0,
    rank: 0,
    awarenessStage: null,
    verdict: null,
    intent: null,
    mergedInto: null,
    pictured: false,
    route: null,
    clickValue: null,
    citationValue: null,
    magnetSpace: null,
    magnetIdea: null,
    magnetBy: null,
    recommendedAsset: null,
    rewrittenTarget: null,
    paaQuestions: [],
    vocabulary: [],
    competitors: [],
    readEvidence: null,
    docId: null,
    slackFileId: null,
    answerShape: null,
    assetFit: null,
    assetIdeas: [],
    assetIdeasBy: null,
    queryOnScreen: null,
    deliverables: { script: false, steps: false, checklist: false, videos: false },
    cardTs: null,
    selectedAt: null,
    selectedBy: null,
    variationOf: null,
  };
}

/** Redraw one keyword's card so it shows the decision that was just taken on it. */
async function redraw(clientId: string, keywordId: string): Promise<void> {
  const { finalistsFor } = await import("./keyword-strategy");
  const { keywordCard, postKeywordCard, selectedCount } = await import("./keyword-cards");

  const listed = await finalistsFor(clientId);
  if (!listed.ok) return;

  const index = listed.list.findIndex((r) => r.id === keywordId);
  const row = index >= 0 ? listed.list[index] : null;
  if (!row) return;

  const count = await selectedCount(clientId);
  const card = keywordCard({ row, number: index + 1, selectedCount: count });
  await postKeywordCard({ clientId, card });
}

/** The decision, in the history. Never fails its caller: recordKeywordDecisions swallows its own. */
async function record(
  row: CardRow,
  action: "select" | "unselect" | "drop" | "variation",
  by: string,
  context: Record<string, unknown> = {}
): Promise<void> {
  const { recordKeywordDecisions } = await import("./keyword-dataset");
  await recordKeywordDecisions({
    clientId: row.clientId,
    action,
    actor: by,
    rows: [
      {
        id: row.id,
        phrase: row.phrase,
        category: "general",
        use: "query" as const,
        origin: "manual" as const,
        rank: null,
        score: 0,
      },
    ],
    context: { ...context, via: "card reaction" },
  }).catch(() => {});
}
