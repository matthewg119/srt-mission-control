// Routing for a message typed inside a campaign prospect's thread in #vektor-email-director.
//
// ‼️ THE ROUTER IS outreach_prospects.slack_thread_ts, WHICH IS UNIQUE-INDEXED. That is what makes
// this safe to run in a channel that also carries the daily campaign digest card: a thread under
// anything other than a prospect resolves nothing, this returns false, and the message falls
// through to the generic assistant exactly as it did before.

import { slack } from "@/lib/slack-bot";
import { getProspectByThread } from "@/lib/followup-operator/prospects";
import { runDraftForProspect, runLoomForProspect } from "./actions";
import { runCampaignThreadAgent } from "./thread-agent";

/**
 * Typed shortcuts for the two things the buttons do.
 *
 * They call the SAME functions the buttons call. A typed `loom` here means "start the chain for
 * this prospect" and cannot collide with `loom` typed in an audit thread, which means "open the
 * wizard": different channels, different tables, different handlers.
 */
const DRAFT_RE = /^(draft|reply)\b/i;
const LOOM_RE = /^loom$/i;
const PASTE_RE = /^paste\b/i;

export async function handleCampaignThreadReply(args: {
  channel: string;
  threadTs: string;
  text: string;
  messageTs: string | null;
  userId: string;
}): Promise<boolean> {
  const p = await getProspectByThread(args.threadTs);
  if (!p) return false;

  const text = args.text.trim();
  const reply = (s: string) => slack.postThreadReply(args.channel, args.threadTs, s);

  if (PASTE_RE.test(text)) {
    await reply(
      "Press *Paste their reply* on the card above. I need the modal to take a long paste without Slack mangling the line breaks."
    );
    return true;
  }

  if (DRAFT_RE.test(text)) {
    await runDraftForProspect(p);
    return true;
  }

  if (LOOM_RE.test(text)) {
    await runLoomForProspect(p);
    return true;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    await reply("AI is not configured, so I cannot answer. ANTHROPIC_API_KEY is unset.");
    return true;
  }

  try {
    const answer = await runCampaignThreadAgent({
      prospect: p,
      channel: args.channel,
      threadTs: args.threadTs,
      messageTs: args.messageTs,
      text,
    });
    // In the thread, never at the top of the channel. That distinction is the whole point of this
    // lane: one prospect per thread, and the answer belongs with the person it is about.
    await reply(answer || "I do not have an answer for that.");
  } catch (err) {
    console.error("[reachinbox] thread agent failed:", err);
    await reply(`:warning: That failed: ${(err as Error).message}`);
  }
  return true;
}
