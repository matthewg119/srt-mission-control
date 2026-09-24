// The contact sheet: one card per cluster, the pictures beside the scores, and the buttons.
//
// ‼️ ONE CARD PER CLUSTER AND NOT ONE PER KEYWORD. Fifty cards is a queue nobody clears. The cluster
// is also where the question actually lives: a pillar with five no-magnet children is a pillar that
// should not be built at all, and you cannot see that one keyword at a time.
//
// ‼️ NOTHING AUTO-APPROVES. The buttons are Matthew's. The entire reason the pictures are in the
// thread rather than the scores being in a table is so the call is made by a person looking at what
// the model looked at.
//
// ‼️ THE IMAGES ARE THE FILES HE ALREADY PASTED, BY SLACK FILE ID, AND NOT SIGNED URLS. signedDocUrl
// mints a link that lives 600 seconds (onboarding-docs.ts) and Slack re-fetches an image when it
// renders a message, so a sheet built from signed URLs would be broken pictures ten minutes after
// posting and would have looked perfect when it went up. It has also never been fed to Slack
// anywhere in this repo, so there is no precedent claiming otherwise. The bytes are already in
// Slack. Pointing at them is free, permanent, and touches no bucket.
//
// ‼️ EVERY BUTTON NEEDS ITS OWN action_id OR SLACK RENDERS NONE OF THEM. Not "that button is
// missing": the whole message comes back invalid_blocks and the card posts with no buttons at all.
// Step 21's ladder card shipped like that and said "Press [Anchor at N]" next to no such button.
// The convention is a `#n` suffix, stripped by the dispatcher.

import { slack, type SlackBlock } from "@/lib/slack-bot";
import { bodySections, buttonLabel } from "@/lib/slack-sections";
import {
  blockLine,
  routeLine,
  stageName,
  type ClusterGate,
  type Finalist,
} from "./keyword-strategy-rules";

/**
 * The three action ids, as constants.
 *
 * ‼️ CONSTANTS BECAUSE THREE FILES HAVE TO AGREE ON EACH ONE: this module mints them, the actions
 * route switches on them, and the probe greps them back out of both. A literal in each place is
 * three chances to typo one string, and the symptom of that typo is a button that does nothing.
 */
export const GATE_APPROVE_ACTION = "kwgate_approve";
export const GATE_REJECT_ACTION = "kwgate_reject";
export const GATE_DROP_ACTION = "kwgate_drop";

/** At most this many child rows get their own picture. The rest are listed without one. */
const MAX_PICTURED_CHILDREN = 6;

export interface ClusterCard {
  clusterId: string | null;
  blocks: SlackBlock[];
  text: string;
}

/**
 * One cluster, as blocks.
 *
 * `position` is the cluster's number on the card, and `index` is what makes the action_ids unique
 * inside one message. They are the same number today and they are not the same thing, so they are
 * separate arguments rather than one reused twice.
 */
export function clusterCard(args: {
  clientId: string;
  clusterId: string | null;
  gate: ClusterGate;
  byId: ReadonlyMap<string, Finalist>;
  position: number;
  index: number;
}): ClusterCard {
  const { clientId, clusterId, gate, byId, position, index } = args;
  const c = gate.cluster;
  const pillar = byId.get(c.pillarId);

  const kind = c.pageKind === "service_page" ? "Service page" : "Post";
  const header = [
    `*P${position}. ${c.label}*  _(${kind})_`,
    c.awarenessEntry && c.awarenessTarget
      ? `Reader: ${stageName(c.awarenessEntry)} (${c.awarenessEntry}), leaves ${stageName(c.awarenessTarget)} (${c.awarenessTarget})`
      : "",
    gate.pillarBlocked
      ? ":no_entry: *The pillar has no picture, so this cluster cannot be built at all.*"
      : "",
  ].filter(Boolean);

  const blocks: SlackBlock[] = [...bodySections(header)];

  // The pillar's own SERP, full width. The cluster's whole case rests on this one.
  if (pillar?.slackFileId) {
    blocks.push(imageBlock(pillar.slackFileId, `Google results for ${pillar.phrase}`));
  }

  const children = c.memberIds
    .map((id) => byId.get(id))
    .filter((r): r is Finalist => Boolean(r));

  const rows: Array<{ row: Finalist; showPicture: boolean }> = [];
  if (pillar) rows.push({ row: pillar, showPicture: false });
  let pictures = 0;
  for (const child of children) {
    const showPicture = Boolean(child.slackFileId) && pictures < MAX_PICTURED_CHILDREN;
    if (showPicture) pictures += 1;
    rows.push({ row: child, showPicture });
  }

  for (const [rowIndex, { row, showPicture }] of rows.entries()) {
    blocks.push(scoreRow(clientId, row, index, rowIndex));
    if (showPicture && row.slackFileId) {
      blocks.push(imageBlock(row.slackFileId, `Google results for ${row.phrase}`));
    }
  }

  // ── THE LANGUAGE MIRROR ───────────────────────────────────────────────────
  //
  // ‼️ THIS IS WHY THE READER IS ALLOWED TO BRING ANY TEXT BACK AT ALL, so it had better be on
  // screen. serp-read.ts refuses headlines, snippets and prices; the two things it may take are
  // Google's own questions and the words the results use, on the rule that a query is not a claim
  // and a term is not a sentence. Both exist so the page gets written in the language already on the
  // results page. Collected across the cluster, because one subject is what the cluster IS.
  const mirror = mirrorOf(rows.map((r) => r.row));
  if (mirror.length) blocks.push(...bodySections(mirror));

  // Blocked rows last, so the list of what to go and shoot is in one place at the bottom.
  if (gate.blocked.length) {
    blocks.push(
      ...bodySections([
        "*Still owed a picture:*",
        ...gate.blocked.map((b) => `  :black_small_square: ${b.phrase}  _(${blockLine(b.reason)})_`),
        "_Google one, then paste the screenshot here with `keywords serp N` in the same message._",
      ])
    );
  }

  blocks.push(actionsBlock(clientId, clusterId, gate, index));

  return {
    clusterId,
    blocks,
    text: `P${position}. ${c.label}`,
  };
}

/**
 * One keyword's line: the scores and where it is headed.
 *
 * The `[Drop]` accessory carries the KEYWORD id, not the cluster's, because dropping is per keyword.
 * `value` is `<clientUuid>:<keywordId>` and the client id must come first: the actions route's
 * automatic button log matches a UUID prefix to attribute the press, and anything else in front of
 * it makes the press unattributable.
 */
function scoreRow(clientId: string, row: Finalist, cardIndex: number, rowIndex: number): SlackBlock {
  const scores =
    row.clickValue === null && row.citationValue === null
      ? row.pictured
        ? "_read, not scored_"
        : `_${blockLine(row.docId ? "unreadable" : row.verdict ? "typed_only" : "no_reading")}_`
      : `click *${row.clickValue ?? 0}*  ·  cite *${row.citationValue ?? 0}*` +
        (row.magnetSpace !== null ? `  ·  magnet *${row.magnetSpace}*` : "");

  const arrow = row.route && row.recommendedAsset ? `  ->  *${routeLine(row.route, row.recommendedAsset)}*` : "";
  const give = row.magnetIdea ? `\n      _Give away: ${row.magnetIdea}_` : "";

  return {
    type: "section",
    text: { type: "mrkdwn", text: `${row.phrase}\n      ${scores}${arrow}${give}` },
    accessory: {
      type: "button",
      text: { type: "plain_text", text: "Drop" },
      // Unique across the whole message: the card's index and the row's, because two clusters in one
      // post would otherwise both emit `kwgate_drop#0`.
      action_id: `${GATE_DROP_ACTION}#${cardIndex}_${rowIndex}`,
      value: `${clientId}:${row.id}`,
    },
  };
}

/**
 * What the results page calls this subject, and who is on it, across the whole cluster.
 *
 * ‼️ DEDUPED ACROSS THE ROWS AND CAPPED, because a cluster is one subject said several ways and its
 * members return overlapping question sets. Printing all of them would push the card past the
 * section limit and fail the whole message, which is the failure mode this file is most careful
 * about.
 */
function mirrorOf(rows: readonly Finalist[]): string[] {
  const questions = unique(rows.flatMap((r) => r.paaQuestions)).slice(0, 8);
  const terms = unique(rows.flatMap((r) => r.vocabulary)).slice(0, 12);
  const who = unique(rows.flatMap((r) => r.competitors)).slice(0, 6);
  const target = rows.find((r) => r.rewrittenTarget)?.rewrittenTarget ?? null;

  const out: string[] = [];
  if (target) out.push(`*Aim it at:* ${target}`);
  if (questions.length) out.push(`*They also ask:* ${questions.join(" · ")}`);
  if (terms.length) out.push(`*Their words:* ${terms.join(", ")}`);
  if (who.length) out.push(`*Ranking now:* ${who.join(", ")}`);
  return out;
}

function unique(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const key = v.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(v.trim());
  }
  return out;
}

function actionsBlock(clientId: string, clusterId: string | null, gate: ClusterGate, index: number): SlackBlock {
  const elements: Array<Record<string, unknown>> = [];

  // ‼️ NO APPROVE BUTTON WHEN THE CLUSTER CANNOT BE APPROVED. A button that exists and always
  // refuses teaches people the card is broken. The blocked list above says what to do instead.
  if (clusterId && !gate.pillarBlocked && !gate.blocked.length) {
    elements.push({
      type: "button",
      text: { type: "plain_text", text: buttonLabel("Approve cluster") },
      style: "primary",
      action_id: `${GATE_APPROVE_ACTION}#${index}`,
      value: `${clientId}:${clusterId}`,
    });
  }

  if (clusterId) {
    elements.push({
      type: "button",
      text: { type: "plain_text", text: buttonLabel("Reject") },
      action_id: `${GATE_REJECT_ACTION}#${index}`,
      value: `${clientId}:${clusterId}`,
    });
  }

  // Slack refuses an actions block with no elements, and an empty one would fail the whole message
  // exactly like an oversized section does.
  if (!elements.length) {
    return {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "_Nothing to approve yet: this cluster is waiting on a picture._",
        },
      ],
    };
  }

  return { type: "actions", elements };
}

/**
 * Post or refresh every cluster's contact sheet in the step 12 thread.
 *
 * ‼️ EDITED, NEVER RE-POSTED. Slack orders a thread by post time, so deleting and re-posting a card
 * moves that cluster to the bottom permanently and the order stops meaning anything.
 * keyword_clusters.card_ts is where each card's ts lives, and the same rule
 * client_delivery_steps.slack_anchor_ts carries.
 *
 * ‼️ EVERY SLACK CALL IS CHECKED ON res.ok AND NONE OF THEM THROW. slack-bot's helpers return
 * `{ok:false}` for every failure including a total refusal of the blocks, so a try/catch around them
 * catches nothing: content-scene-runner.ts wraps uploadFile in one and its fallback can never fire.
 * A gate card that renders with no pictures and no buttons, silently, is worse than no gate at all,
 * because it looks like a decision was offered and declined.
 */
export async function postClusterCards(args: {
  clientId: string;
  cards: ClusterCard[];
}): Promise<{ posted: number; failed: Array<{ label: string; error: string }> }> {
  const { channelFor, anchorTsFor } = await import("./step-board");
  const { supabaseAdmin } = await import("@/lib/db");

  const failed: Array<{ label: string; error: string }> = [];
  const channel = await channelFor(args.clientId);
  if (!channel) return { posted: 0, failed: [{ label: "the channel", error: "this client has no ops channel" }] };

  const thread = await anchorTsFor(args.clientId, "keyword_set");
  if (!thread) return { posted: 0, failed: [{ label: "the thread", error: "step 12 has no anchor to reply under" }] };

  let posted = 0;
  for (const card of args.cards) {
    const existing = card.clusterId ? await cardTsOf(card.clusterId) : null;

    if (existing) {
      const edit = (await slack.updateMessage(channel, existing, card.text, card.blocks)) as {
        ok?: boolean;
        error?: string;
      };
      if (edit?.ok === true) {
        posted += 1;
        continue;
      }
      // ‼️ AN EDIT THAT FAILED IS NOT RE-POSTED AS A NEW CARD. `message_not_found` means somebody
      // deleted it and a fresh post is right; anything else (invalid_blocks, most importantly) would
      // post a SECOND card carrying the same fault, and now there are two.
      if (edit?.error !== "message_not_found") {
        failed.push({ label: card.text, error: edit?.error ?? "the edit was refused" });
        continue;
      }
    }

    const res = (await slack.postThreadReply(channel, thread, card.text, card.blocks)) as {
      ok?: boolean;
      ts?: string;
      error?: string;
    };
    if (res?.ok !== true) {
      failed.push({ label: card.text, error: res?.error ?? "no reason given" });
      continue;
    }
    posted += 1;
    if (card.clusterId && res.ts) {
      await supabaseAdmin
        .from("keyword_clusters")
        .update({ card_ts: res.ts, updated_at: new Date().toISOString() })
        .eq("id", card.clusterId);
    }
  }

  return { posted, failed };
}

async function cardTsOf(clusterId: string): Promise<string | null> {
  const { supabaseAdmin } = await import("@/lib/db");
  const { data, error } = await supabaseAdmin
    .from("keyword_clusters")
    .select("card_ts")
    .eq("id", clusterId)
    .maybeSingle();
  if (error || !data) return null;
  return (data.card_ts as string | null) ?? null;
}

/**
 * An image block pointing at a file already in Slack.
 *
 * ‼️ `slack_file` RATHER THAN `image_url`, AND IT IS THE ONLY WAY THIS WORKS WITHOUT A PUBLIC HOST.
 * The screenshots live in a private Supabase bucket and in Slack, and only one of those two can be
 * rendered by Slack without a link that expires. If Slack refuses this shape the whole message comes
 * back invalid_blocks, which postCards checks for and reports rather than leaving a silent gap.
 *
 * SlackBlock does not model image blocks, the same reason content-scene-runner.ts casts its own.
 */
function imageBlock(slackFileId: string, alt: string): SlackBlock {
  return {
    type: "image",
    slack_file: { id: slackFileId },
    alt_text: alt.slice(0, 1800),
  } as unknown as SlackBlock;
}
