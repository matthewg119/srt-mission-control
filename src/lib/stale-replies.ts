// Stale-reply detector. Finds conversations where the LAST message is inbound (the
// lead texted) and Matthew has NOT replied within ~24h — the "guy looking for 75k I
// never answered" case. Posts a short Vektor nudge + a drafted reply with a ✅ Send
// button (suggestion-only, never auto-sends) into the lead's Slack channel.
//
// Deduped via sms_conversations.last_stale_nudge_at so the same thread isn't nagged
// more than once every ~48h. Driven by /api/cron/stale-replies.

import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import { draftSmsReply } from "@/lib/sms-ai-engine";
import { postImessageSuggestion } from "@/lib/imessage-suggestion";

const STALE_HOURS = 24; // no reply for this long → stale
const RENUDGE_HOURS = 48; // don't re-nudge the same convo more often than this
const MESSAGE_SCAN = 1500; // recent messages to scan for "latest per conversation"
const MAX_NUDGES = 25; // cap drafts/run (LLM cost)

interface LatestMsg {
  conversation_id: string;
  direction: string;
  body: string;
  sent_at: string;
}

export async function runStaleReplyNudges(): Promise<{ nudged: number; candidates: number }> {
  const now = Date.now();

  // 1. Pull recent messages newest-first; first row seen per conversation = its latest.
  const { data: msgs, error } = await supabaseAdmin
    .from("sms_messages")
    .select("conversation_id, direction, body, sent_at")
    .order("sent_at", { ascending: false })
    .limit(MESSAGE_SCAN);

  if (error) {
    console.error("[stale-replies] message scan failed:", error.message);
    return { nudged: 0, candidates: 0 };
  }

  const latestByConv = new Map<string, LatestMsg>();
  for (const m of (msgs ?? []) as LatestMsg[]) {
    if (!m.conversation_id) continue;
    if (!latestByConv.has(m.conversation_id)) latestByConv.set(m.conversation_id, m);
  }

  // 2. Keep conversations whose latest message is inbound and older than STALE_HOURS.
  const staleConvIds: string[] = [];
  const lastInbound = new Map<string, LatestMsg>();
  for (const [convId, m] of latestByConv) {
    if (m.direction !== "inbound") continue;
    const ageHours = (now - new Date(m.sent_at).getTime()) / 3_600_000;
    if (ageHours >= STALE_HOURS) {
      staleConvIds.push(convId);
      lastInbound.set(convId, m);
    }
  }
  if (staleConvIds.length === 0) return { nudged: 0, candidates: 0 };

  // 3. Load conversation metadata + skip those already nudged recently / no channel.
  const { data: convs } = await supabaseAdmin
    .from("sms_conversations")
    .select("id, slack_channel_id, contact_id, last_stale_nudge_at")
    .in("id", staleConvIds);

  // 4. Pending drafts already on these convos → skip (a suggestion is already live).
  const { data: pending } = await supabaseAdmin
    .from("sms_pending_drafts")
    .select("conversation_id")
    .in("conversation_id", staleConvIds);
  const hasPending = new Set((pending ?? []).map((p) => p.conversation_id as string));

  let nudged = 0;
  let candidates = 0;

  for (const conv of (convs ?? []) as {
    id: string;
    slack_channel_id: string | null;
    contact_id: string | null;
    last_stale_nudge_at: string | null;
  }[]) {
    if (!conv.slack_channel_id) continue;
    if (hasPending.has(conv.id)) continue;
    if (conv.last_stale_nudge_at) {
      const sinceH = (now - new Date(conv.last_stale_nudge_at).getTime()) / 3_600_000;
      if (sinceH < RENUDGE_HOURS) continue;
    }

    // Respect do-not-contact.
    if (conv.contact_id) {
      const { data: contact } = await supabaseAdmin
        .from("contacts")
        .select("do_not_contact, first_name")
        .eq("id", conv.contact_id)
        .maybeSingle();
      if (contact?.do_not_contact) continue;
    }

    candidates++;
    if (nudged >= MAX_NUDGES) break;

    try {
      const inbound = lastInbound.get(conv.id)!;
      const ageHours = Math.round((now - new Date(inbound.sent_at).getTime()) / 3_600_000);
      const preview = inbound.body.slice(0, 140);

      // Short, direct Vektor nudge (no emotion, fact + action).
      await slack.postMessage(
        conv.slack_channel_id,
        `⏳ No reply in ${ageHours}h. Last inbound: "${preview}". Draft below.`
      );

      const { draft, suggestedFollowup } = await draftSmsReply(conv.id, inbound.body);
      if (draft) {
        await postImessageSuggestion({
          channelId: conv.slack_channel_id,
          conversationId: conv.id,
          draft,
          suggestedFollowup,
          armAutoSend: false, // never auto-fire a reply that's already 24h+ overdue
        });
      }

      await supabaseAdmin
        .from("sms_conversations")
        .update({ last_stale_nudge_at: new Date().toISOString() })
        .eq("id", conv.id);
      nudged++;
    } catch (e) {
      console.error("[stale-replies] convo failed:", (e as Error).message);
    }
  }

  return { nudged, candidates };
}
