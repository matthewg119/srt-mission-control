// The Slack surface of a campaign reply: the top-level card that IS the prospect's file, and the
// button row that hangs under each individual reply.
//
// WHY THE CARD LINES LIVE HERE AND NOT IN EITHER LANE
// Two lanes announce a reply -- the webhook (fast, no body) and the forwarding mailbox (slow, full
// body) -- and until now each built its own near-identical header. Two copies of a card is how a
// card and its refresh drift: the webhook's said "Not in the CRM yet" forever because only the
// mailbox lane knew how to mint a contact. One builder, read by both, plus refreshProspectCard to
// rewrite it in place when a fact changes.
//
// WHY THE BUTTONS ARE NOT IN buildReplyNote
// The probe asserts that a reply with no body renders no ">" anywhere in buildReplyNote's blocks,
// which is what proves a missing body is never dressed up as an empty quote. A Slack <url|label>
// link contains ">". Keeping the link on the card and the buttons in their own block lets that
// assertion keep meaning exactly what it says, and keeps buildReplyNote pure.

import { slack, type SlackBlock } from "@/lib/slack-bot";
import { displayName } from "@/lib/followup-operator/digest";
import type { OutreachProspectRow } from "@/lib/followup-operator/types";

/** Action ids for the reply-card buttons. Exported so the actions route and the probe agree. */
export const RI_DRAFT = "ri_draft";
export const RI_LOOM = "ri_loom";
export const RI_PASTE = "ri_paste";

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";
}

/**
 * The body of the top-level card: who replied, how to reach them, and the way into the CRM.
 *
 * ‼️ NO BUTTONS HERE, DELIBERATELY. ensureProspectThread early-returns once a thread exists, so
 * this card is written once, at the first reply, and never again for that person. A button on it
 * would stay bound to that first reply's state -- including its reply text, which on the paste
 * path does not arrive until minutes later -- and a second reply would have no buttons of its own.
 * Buttons belong to a reply, so they hang under the reply.
 */
export function buildProspectCardLines(p: OutreachProspectRow): string[] {
  const contactId = p.contact_id;
  return [
    `*${displayName(p)}* replied to the campaign`,
    `:e-mail: ${p.email}${p.website ? ` · ${p.website}` : ""}`,
    p.campaign ? `Campaign: *${p.campaign}*` : null,
    contactId
      ? `<${appUrl()}/dashboard/leads/${contactId}|Open in CRM>`
      : "_Not in the CRM yet. The lead could not be created, so check the logs._",
  ].filter(Boolean) as string[];
}

/**
 * The button row under one reply.
 *
 * Two buttons is the standing shape. The third appears only when we have no idea what they said:
 * drafting a reply to words nobody has read is the one thing this lane must not do, so the fix is
 * offered right where the problem is visible.
 */
export function buildReplyActions(input: {
  prospectId: string;
  hasReplyText: boolean;
}): SlackBlock {
  const elements: Array<Record<string, unknown>> = [];

  if (!input.hasReplyText) {
    elements.push({
      type: "button",
      text: { type: "plain_text", text: ":clipboard: Paste their reply", emoji: true },
      action_id: RI_PASTE,
      value: input.prospectId,
    });
  }

  elements.push(
    {
      type: "button",
      text: { type: "plain_text", text: ":memo: Draft a reply", emoji: true },
      style: "primary",
      action_id: RI_DRAFT,
      value: input.prospectId,
    },
    {
      type: "button",
      text: { type: "plain_text", text: ":movie_camera: Loom", emoji: true },
      action_id: RI_LOOM,
      value: input.prospectId,
    }
  );

  return { type: "actions", elements } as SlackBlock;
}

/**
 * Rewrite the existing top-level card from the current row.
 *
 * ‼️ NEVER POSTS. ensureProspectThread stays the one place a prospect's thread is opened; this only
 * updates a card that already exists. Best-effort: a card that failed to refresh is cosmetic, and
 * throwing here would cost the caller work that actually mattered.
 */
export async function refreshProspectCard(p: OutreachProspectRow): Promise<void> {
  if (!p.slack_channel_id || !p.slack_thread_ts) return;
  try {
    await slack.updateMessage(
      p.slack_channel_id,
      p.slack_thread_ts,
      `Follow-up file: ${displayName(p)}`,
      [
        {
          type: "section",
          text: { type: "mrkdwn", text: buildProspectCardLines(p).join("\n") },
        } as SlackBlock,
      ]
    );
  } catch (err) {
    console.error("[reachinbox] refreshProspectCard:", (err as Error).message);
  }
}
