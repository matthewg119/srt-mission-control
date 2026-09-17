// Put a ReachInbox webhook reply in front of Matthew, in #vektor-email-director.
//
// WHY THIS EXISTS, GIVEN THE ROUTE HEADER SAYS NOTHING IS POSTED TO SLACK
// That rule was written for `All Events`. Sent and Opened arrive in the thousands and would bury a
// channel whose whole invariant is that nothing appears there unless a real prospect did
// something. A `replied` event IS that invariant, so it is the one event type allowed through, and
// the gate lives in `shouldAnnounceReply` rather than in the caller so no future caller can widen
// it by accident. Everything else still lands in the table silently.
//
// ‼️ THIS IS THE FAST HALF, NOT THE COMPLETE HALF. The webhook knows who replied, to which
// campaign, and when. It does NOT reliably carry what they said, and it carries no CRM lead. The
// forwarding mailbox (campaign-replies.ts) is what brings the body, the classification and the
// RingOut. The two compose on purpose:
//
//   webhook  -> mints the prospect, opens ITS thread, posts "reply received" within seconds
//   mailbox  -> finds that same prospect and that same thread, posts the body into it
//
// ensureProspectThread returns early when a thread already exists, so the mailbox lane cannot open
// a second top-level card for a reply this module already announced. Do not "simplify" that by
// having either side post a fresh top-level message.

import { slack, type SlackBlock } from "@/lib/slack-bot";
import { supabaseAdmin } from "@/lib/db";
import {
  campaignChannel,
  campaignReplyMailbox,
  createCampaignProspect,
  ensureProspectContact,
} from "@/lib/followup-operator/campaign-replies";
import { logTouch } from "@/lib/followup-operator/prospects";
import { ensureProspectThread } from "@/lib/followup-operator/digest";
import { buildProspectCardLines, buildReplyActions, refreshProspectCard } from "./card";
import type { ParsedReachInboxEvent } from "./parse";

/**
 * The one event type that may reach Slack, and the one field that makes it actionable.
 *
 * A reply with no address is not nothing -- it still counts in the funnel -- but there is no
 * person to open a thread for, so it stays in the table and out of the channel.
 */
export function shouldAnnounceReply(parsed: ParsedReachInboxEvent): boolean {
  return parsed.eventType === "replied" && Boolean(parsed.leadEmail);
}

/** New York, because every other time in this channel is stated in Matthew's own day. */
export function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown time";
  return d.toLocaleString("en-US", { timeZone: "America/New_York" });
}

export interface ReplyNoteInput {
  email: string;
  campaignName: string | null;
  replyText: string | null;
  occurredAt: string;
  /** True when REACHINBOX_REPLY_MAILBOX is unset, i.e. no body is coming later either. */
  mailboxLaneOff: boolean;
}

/**
 * The thread note itself. Pure, so the probe can assert the one thing that matters about it: that
 * a missing body says so instead of rendering as an empty quote.
 */
export function buildReplyNote(input: ReplyNoteInput): { text: string; blocks: SlackBlock[] } {
  const { email, campaignName, replyText, occurredAt, mailboxLaneOff } = input;

  const lines: string[] = [
    `:incoming_envelope: *Reply received*  ·  _${formatWhen(occurredAt)} ET_`,
    campaignName ? `Campaign: *${campaignName}*` : "_No campaign name on the event._",
  ];

  if (replyText) {
    lines.push(`>${replyText}`);
  } else {
    // ‼️ SAID OUT LOUD. A silently missing body reads as "they sent an empty email", which is a
    // different and much worse fact than "the webhook did not include the text".
    lines.push("_ReachInbox sent no reply text with this event. The full payload is stored._");
    lines.push(
      mailboxLaneOff
        ? "_No body is coming: `REACHINBOX_REPLY_MAILBOX` is unset, so read it in the ReachInbox inbox._"
        : "_The body follows from the forwarding mailbox within ~5 minutes._"
    );
  }

  return {
    text: `Reply received - ${email}`,
    blocks: [{ type: "section", text: { type: "mrkdwn", text: lines.join("\n") } } as SlackBlock],
  };
}

/**
 * Take the right to announce this event, exactly once.
 *
 * ‼️ THE CLAIM IS A CONDITIONAL UPDATE, NOT A READ THEN A WRITE. ReachInbox retries a webhook it
 * did not get a 200 from, and a retry arriving while the first is still posting would put the same
 * reply in the thread twice. `.is("announced_at", null)` makes the database pick a winner.
 *
 * ‼️ A MISSING COLUMN ANNOUNCES ANYWAY. The migration is one nullable column, and this file has to
 * work on the deploy that lands before the SQL is run, so an undefined-column error (42703)
 * degrades to at-least-once delivery. A lost notification is the worse failure; a duplicate is
 * legible.
 */
async function claimAnnouncement(eventId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("reachinbox_events")
    .update({ announced_at: new Date().toISOString() })
    .eq("id", eventId)
    .is("announced_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    if (error.code === "42703") {
      console.error("[reachinbox] announced_at column missing; announcing without dedupe");
      return true;
    }
    console.error("[reachinbox] claimAnnouncement:", error.message);
    return false;
  }
  return Boolean(data);
}

/** Hand the claim back, so a provider retry can deliver what this attempt failed to deliver. */
async function releaseAnnouncement(eventId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("reachinbox_events")
    .update({ announced_at: null })
    .eq("id", eventId);
  if (error && error.code !== "42703") {
    console.error("[reachinbox] releaseAnnouncement:", error.message);
  }
}

export type AnnounceOutcome =
  | "announced"
  | "not_a_reply"
  | "no_channel"
  | "already_announced"
  | "no_prospect"
  | "no_thread";

/**
 * Announce one reply. Safe to call on every event; it decides for itself whether to act.
 *
 * Awaited by the route rather than backgrounded: a serverless function can be frozen the moment it
 * responds, and a notification that races the response is one that sometimes does not arrive.
 * Slack is a single call and the route's maxDuration is 30s.
 */
export async function announceWebhookReply(input: {
  eventId: string;
  parsed: ParsedReachInboxEvent;
}): Promise<AnnounceOutcome> {
  const { eventId, parsed } = input;
  if (!shouldAnnounceReply(parsed)) return "not_a_reply";

  const channel = campaignChannel();
  if (!channel) {
    console.error("[reachinbox] SLACK_VEKTOR_EMAIL_DIRECTOR_CHANNEL unset; reply not announced");
    return "no_channel";
  }

  if (!(await claimAnnouncement(eventId))) return "already_announced";

  try {
    const email = parsed.leadEmail as string;
    const when = new Date(parsed.occurredAt);
    const receivedAt = Number.isNaN(when.getTime()) ? new Date() : when;

    // The same call the mailbox lane makes, so both paths mint one prospect under one set of
    // rules. It reads the campaign back off the event we have just stored, which is why the
    // insert happens before this runs.
    const prospect = await createCampaignProspect({
      email,
      displayName: parsed.leadName,
      receivedAt,
    });
    if (!prospect) {
      console.error(`[reachinbox] no prospect for ${email}; reply not announced`);
      await releaseAnnouncement(eventId);
      return "no_prospect";
    }

    // ‼️ THE LEAD IS MINTED HERE, BEFORE THE CARD IS WRITTEN, AND THAT ORDER IS THE FEATURE.
    // ensureProspectThread early-returns once a thread exists, so the card's text is composed
    // exactly once, at the first reply. Minting after it would leave "Not in the CRM yet" on the
    // card forever, which is what this lane did until now: it never called ingestLead at all.
    //
    // speedToLead is false and must stay false. This lane has no classification -- the webhook
    // often carries no body at all -- so it cannot tell "what does it cost?" from "take me off
    // your list", and an instant callback fired at the second is worse than none.
    const withContact = await ensureProspectContact({
      prospect,
      headline: `Replied to the ReachInbox campaign${prospect.campaign ? ` (${prospect.campaign})` : ""}`,
      noteTitle: "ReachInbox campaign reply",
      detailLines: [
        `Campaign: ${prospect.campaign ?? parsed.campaignName ?? "(not on the event)"}`,
        parsed.replyText
          ? `Reply: ${parsed.replyText}`
          : "Reply: ReachInbox sent no reply text with this event. The full payload is stored.",
        `Received: ${parsed.occurredAt}`,
      ],
      speedToLead: false,
    });

    const threaded = await ensureProspectThread(
      withContact,
      channel,
      buildProspectCardLines(withContact)
    );
    if (!threaded.slack_thread_ts || !threaded.slack_channel_id) {
      console.error(`[reachinbox] no thread for ${email}; reply not announced`);
      await releaseAnnouncement(eventId);
      return "no_thread";
    }

    // The card was written on an EARLIER reply, before this person had a contact. Rewrite it so
    // the link works now. A no-op when the card was just created with the id already in it.
    if (withContact.contact_id && threaded.slack_thread_ts) {
      await refreshProspectCard({ ...withContact, ...threaded });
    }

    // Their own words go in the touch log, which is the one place anything asks "what did they
    // say" -- the draft button, the thread agent, and the Outlook sweep all read the same row.
    // Skipped when the webhook carried nothing, because a touch with a null body answers nothing.
    if (parsed.replyText) {
      await logTouch({
        prospect_id: withContact.id,
        direction: "inbound",
        channel: "email",
        body: parsed.replyText,
        outcome: "replied",
        occurred_at: parsed.occurredAt,
        metadata: { source: "reachinbox_webhook", event_id: eventId },
      });
    }

    const note = buildReplyNote({
      email,
      campaignName: withContact.campaign ?? parsed.campaignName,
      replyText: parsed.replyText,
      occurredAt: parsed.occurredAt,
      mailboxLaneOff: !campaignReplyMailbox(),
    });
    // The buttons are a SEPARATE block appended by the caller. See card.ts: keeping them out of
    // buildReplyNote is what lets the probe keep asserting that a missing body renders no quote.
    const actions = buildReplyActions({
      prospectId: withContact.id,
      hasReplyText: Boolean(parsed.replyText),
    });
    await slack.postThreadReply(
      threaded.slack_channel_id,
      threaded.slack_thread_ts,
      note.text,
      [...note.blocks, actions]
    );

    return "announced";
  } catch (err) {
    console.error("[reachinbox] announceWebhookReply:", err);
    await releaseAnnouncement(eventId);
    throw err;
  }
}
