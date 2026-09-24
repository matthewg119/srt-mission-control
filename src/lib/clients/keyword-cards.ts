// One Slack card per keyword, decided with a reaction.
//
// ‼️ ONE MESSAGE PER KEYWORD, IN A REPO THAT ALREADY LEARNED THE OPPOSITE LESSON. The step board's
// header records it: eighteen replies under one thread in ninety seconds was "impossible to work
// on", and the fix was one message per STEP. That was volume nobody asked for, arriving at once,
// none of it a decision. This is the other case. These arrive one at a time, as each screenshot is
// pasted, and each one carries a decision only a person can make. A Slack reaction attaches to a
// MESSAGE, so per-keyword reactions require per-keyword messages. There is no other shape.
//
// ‼️ EDITED, NEVER RE-POSTED. Slack orders a thread by post time, so a delete-and-repost moves a
// keyword to the bottom of a twenty-five card thread permanently and the order stops meaning
// anything. client_keywords.card_ts is where each card's ts lives, the same rule
// keyword_clusters.card_ts and client_delivery_steps.slack_anchor_ts already carry.
//
// ‼️ EVERY SLACK CALL IS CHECKED ON res.ok AND NONE OF THEM THROW. slack-bot's helpers return
// `{ok:false}` for every failure including a total refusal of the blocks, so a try/catch around them
// catches nothing. A card that renders with no reactions, silently, is worse than no card: it looks
// like a decision was offered and nobody took it.
//
// ‼️ NO BUTTONS ON THIS CARD, ON PURPOSE. The decision surface is the three reactions, so this file
// mints zero action_ids and the "two buttons sharing an action_id makes Slack render none of them"
// hazard cannot arise here at all. Adding one later means the house `#<suffix>` convention and a
// matching case in src/app/api/slack/actions/route.ts.

import { slack, type SlackBlock } from "@/lib/slack-bot";
import { bodySections } from "@/lib/slack-sections";
import { blockLine, routeFrom, routeLine, type Finalist } from "./keyword-strategy-rules";

/**
 * The three reactions.
 *
 * ‼️ CONSTANTS BECAUSE THREE FILES HAVE TO AGREE ON THEM: this module seeds them onto the card,
 * keyword-decisions.ts switches on them, and the probe greps both. The same reason
 * serp-cards.ts keeps GATE_APPROVE_ACTION and friends as constants.
 */
export const PICK_EMOJI = "white_check_mark";
export const DROP_EMOJI = "x";
export const VARY_EMOJI = "arrows_counterclockwise";
export const CARD_EMOJI: readonly string[] = [PICK_EMOJI, DROP_EMOJI, VARY_EMOJI];

/**
 * Twenty keywords is the set the whole plan is built from.
 *
 * ‼️ A TARGET AND NOT A CAP. A twenty-first selection counts and the card reads "21 of 20". Refusing
 * somebody's judgement because a counter is full would be the tool telling the person they are wrong
 * about their own market, and the number is a guide, not a gate.
 */
export const SELECTION_TARGET = 20;

export interface KeywordCard {
  keywordId: string;
  /** The shortlist number, or null for a variation, which has none. See variationOf. */
  number: number | null;
  text: string;
  blocks: SlackBlock[];
}

/**
 * One keyword's card.
 *
 * `variationOf` is the phrase this is another way of saying. A variation gets no shortlist number
 * because shortlistOf() dedupes by subject and caps at 25, so variations deliberately do not grow
 * the shortlist: numbering them off client_keywords.rank instead would put two numbering systems in
 * one thread and break `keywords serp N`, which names a row by its printed number.
 */
export function keywordCard(args: {
  row: Finalist;
  number: number | null;
  variationOf?: string | null;
  selectedCount: number;
}): KeywordCard {
  const { row, number, selectedCount } = args;
  const variationOf = args.variationOf ?? null;

  const head = number !== null ? `\`${String(number).padStart(2, " ")}\`  *${row.phrase}*` : `*${row.phrase}*`;

  const decided =
    row.selectedAt !== null ? `   :${PICK_EMOJI}: *kept*${row.selectedBy ? ` by ${row.selectedBy}` : ""}` : "";

  const lines: string[] = [head + decided];

  if (variationOf) lines.push(`_another way of saying_  *${variationOf}*`);

  // The scores, in the vocabulary serp-cards.ts already uses, plus the fit.
  if (row.clickValue === null && row.citationValue === null) {
    lines.push(
      row.pictured
        ? "_read, not scored_"
        : `_${blockLine(row.docId ? "unreadable" : row.verdict ? "typed_only" : "no_reading")}_`
    );
  } else {
    const parts = [`click *${row.clickValue ?? 0}*`, `cite *${row.citationValue ?? 0}*`];
    if (row.magnetSpace !== null) parts.push(`magnet *${row.magnetSpace}*`);
    if (row.assetFit !== null) parts.push(`fit *${row.assetFit}*`);
    // routeFrom is re-derived rather than stored on the card, so a rule change re-applies to every
    // card the next time it is drawn. It is pure, which is what makes that safe.
    const decision = routeFrom({
      verdict: row.verdict ?? "unclear",
      clickValue: row.clickValue,
      citationValue: row.citationValue,
      magnetSpace: row.magnetSpace,
      magnetIdea: row.magnetIdea,
      magnetBy: row.magnetBy,
    });
    lines.push(`${parts.join("  ·  ")}   ->  *${routeLine(decision.route, decision.asset)}*`);
    if (decision.why) lines.push(decision.why);
  }

  // ‼️ THE SHAPE IS PRINTED WITH WHAT IT WAS DERIVED FROM. answerShape and assetFit are computed,
  // and a computed verdict nobody can see the inputs to is one nobody can argue with. Naming the
  // thing that is actually on the screen is what lets somebody say "no, that is not a script".
  if (row.answerShape) {
    const saw = [
      row.deliverables.script ? "a script" : "",
      row.deliverables.steps ? "steps" : "",
      row.deliverables.checklist ? "a checklist" : "",
      row.deliverables.videos ? "videos ranking" : "",
    ].filter(Boolean);
    lines.push(
      saw.length
        ? `_The answer is a ${row.answerShape}: the page already shows ${saw.join(", ")}._`
        : `_The answer is a ${row.answerShape}: nothing on the page is a thing you could open._`
    );
  }

  // ‼️ WHAT THE SEARCH BOX SAID, PRINTED. This is the only place anybody would ever notice that a
  // screenshot was filed against the wrong keyword, which before this column was undetectable.
  if (row.queryOnScreen) lines.push(`_read off the search box:_ "${row.queryOnScreen}"`);

  if (row.assetIdeas.length) {
    lines.push("", "*Build one of these:*");
    for (const idea of row.assetIdeas) {
      lines.push(`  •  \`${idea.kind}\`  ${idea.title}${idea.why ? `  _${idea.why}_` : ""}`);
    }
  } else if (row.assetIdeasBy === "model") {
    // ‼️ AN EMPTY LIST FROM A CALL THAT ANSWERED IS A FINDING, and it reads differently from a call
    // that never ran. Saying so is what stops anybody re-running it expecting a different answer.
    lines.push("_Nothing here is worth building on its own._");
  }

  lines.push(
    "",
    `_${selectedCount} of ${SELECTION_TARGET} selected._   :${PICK_EMOJI}: keep  ·  :${DROP_EMOJI}: drop  ·  :${VARY_EMOJI}: more ways to say it`
  );

  const text = lines.join("\n");
  return { keywordId: row.id, number, text, blocks: bodySections(lines) };
}

/**
 * Post one card, or edit the one already on file.
 *
 * The caller needs to know WHICH happened: a fresh post is the only time the three reactions are
 * seeded, and re-seeding on every edit would be a wasted pair of API calls per re-read.
 */
export async function postKeywordCard(args: {
  clientId: string;
  card: KeywordCard;
  /** Passed in by the batch so twenty-five cards do not do twenty-five channel lookups. */
  channel?: string;
  thread?: string;
}): Promise<{ ok: true; ts: string; action: "posted" | "edited" } | { ok: false; error: string }> {
  const { channelFor, anchorTsFor } = await import("./step-board");
  const { supabaseAdmin } = await import("@/lib/db");

  const channel = args.channel ?? (await channelFor(args.clientId));
  if (!channel) return { ok: false, error: "this client has no ops channel" };
  const thread = args.thread ?? (await anchorTsFor(args.clientId, "keyword_set"));
  if (!thread) return { ok: false, error: "step 12 has no anchor to reply under" };

  const existing = await cardTsOf(args.card.keywordId);

  if (existing) {
    const edit = (await slack.updateMessage(channel, existing, args.card.text, args.card.blocks)) as {
      ok?: boolean;
      error?: string;
    };
    if (edit?.ok === true) return { ok: true, ts: existing, action: "edited" };
    // ‼️ AN EDIT THAT FAILED IS NOT RE-POSTED AS A NEW CARD. `message_not_found` means somebody
    // deleted it and a fresh post is right; anything else (invalid_blocks, most importantly) would
    // post a SECOND card carrying the same fault, and now there are two of them to react to.
    if (edit?.error !== "message_not_found") {
      return { ok: false, error: edit?.error ?? "the edit was refused" };
    }
  }

  const res = (await slack.postThreadReply(channel, thread, args.card.text, args.card.blocks)) as {
    ok?: boolean;
    ts?: string;
    error?: string;
  };
  if (res?.ok !== true || !res.ts) return { ok: false, error: res?.error ?? "no reason given" };

  const stored = await supabaseAdmin
    .from("client_keywords")
    .update({ card_ts: res.ts, updated_at: new Date().toISOString() })
    .eq("id", args.card.keywordId);
  if (stored.error) {
    // ‼️ THE CARD IS UP AND ITS ts IS NOT ON FILE, WHICH MEANS NO REACTION ON IT WILL EVER BE HEARD.
    // That is worth saying out loud rather than returning ok: the card looks fine and is inert.
    console.error("[clients/keyword-cards] card_ts not stored:", stored.error.message);
    return { ok: false, error: `the card posted but its id could not be stored: ${stored.error.message}` };
  }

  // Seeded so the three are one tap rather than a search through the emoji picker. Best effort:
  // a seed that fails costs a tap, and handleKeywordCardReaction reads a count of 1 as our own.
  for (const emoji of CARD_EMOJI) {
    await slack.addReaction(channel, res.ts, emoji).catch(() => {});
  }

  return { ok: true, ts: res.ts, action: "posted" };
}

/**
 * The ts of this keyword's card, or null.
 *
 * ‼️ TOLERANT OF THE COLUMN NOT EXISTING, unlike serp-cards.ts's equivalent, because card_ts is new
 * and this repo deploys code before migrations. A database without
 * docs/2026-09-27-keyword-decision-cards.sql answers "no card yet", which is true.
 */
async function cardTsOf(keywordId: string): Promise<string | null> {
  const { supabaseAdmin } = await import("@/lib/db");
  const { data, error } = await supabaseAdmin
    .from("client_keywords")
    .select("card_ts")
    .eq("id", keywordId)
    .maybeSingle();
  if (error || !data) return null;
  return (data.card_ts as string | null) ?? null;
}

/** How many of this client's keywords have survived their screenshot. */
export async function selectedCount(clientId: string): Promise<number> {
  const { supabaseAdmin } = await import("@/lib/db");
  const { count, error } = await supabaseAdmin
    .from("client_keywords")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .not("selected_at", "is", null)
    .is("dropped_at", null);
  if (error) return 0;
  return count ?? 0;
}
