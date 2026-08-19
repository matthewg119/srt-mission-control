// Post-conversation notes. When an SMS conversation goes idle (~10 min since the
// last message), summarize the thread into bullet points and post them to the
// lead's Slack channel + write a Zoho note, with suggested next touch points.
// Idempotent via sms_conversations.notes_posted_at (only re-summarize when there
// is newer activity than the last notes post).
//
// Wired by /api/cron/sms-conversation-notes. Requires the activation migration
// (adds sms_conversations.notes_posted_at).

import { supabaseAdmin } from "@/lib/db";
import { callClaudeText } from "@/lib/claude-calls";
import { slack } from "@/lib/slack-bot";
import { addNote } from "@/lib/crm";

const IDLE_MINUTES = 10;
const MAX_PER_RUN = 25;

function lastActivity(c: { last_inbound_at: string | null; last_outbound_at: string | null }): number {
  const a = c.last_inbound_at ? new Date(c.last_inbound_at).getTime() : 0;
  const b = c.last_outbound_at ? new Date(c.last_outbound_at).getTime() : 0;
  return Math.max(a, b);
}

export async function summarizeIdleConversations(): Promise<{ processed: number; skipped: number }> {
  const now = Date.now();
  const cutoffIso = new Date(now - IDLE_MINUTES * 60 * 1000).toISOString();

  // Candidates: open conversations whose last inbound is older than the idle
  // window. We refine with last_outbound_at + notes_posted_at in JS below.
  const { data: convos } = await supabaseAdmin
    .from("sms_conversations")
    .select("id, contact_id, phone, slack_channel_id, last_inbound_at, last_outbound_at, notes_posted_at, outcome")
    .lte("last_inbound_at", cutoffIso)
    .order("last_inbound_at", { ascending: true })
    .limit(MAX_PER_RUN * 3);

  if (!convos || convos.length === 0) return { processed: 0, skipped: 0 };

  let processed = 0;
  let skipped = 0;

  for (const c of convos) {
    if (processed >= MAX_PER_RUN) break;
    if (c.outcome && c.outcome !== "open") { skipped++; continue; }

    const activity = lastActivity(c);
    if (!activity || activity > now - IDLE_MINUTES * 60 * 1000) { skipped++; continue; }
    if (c.notes_posted_at && new Date(c.notes_posted_at).getTime() >= activity) { skipped++; continue; }

    // Pull the thread
    const { data: msgs } = await supabaseAdmin
      .from("sms_messages")
      .select("direction, body, created_at")
      .eq("conversation_id", c.id)
      .order("created_at", { ascending: true })
      .limit(100);

    if (!msgs || msgs.length < 2) { skipped++; continue; }

    const transcript = msgs
      .map((m) => `${m.direction === "inbound" ? "Lead" : "Matthew"}: ${m.body}`)
      .join("\n");

    let summary: string;
    try {
      const { text } = await callClaudeText({
        model: "claude-sonnet-4-6",
        system:
          "You summarize a sales SMS conversation for a business-funding broker (Matthew at SRT Agency). " +
          "Output concise bullet points only, no preamble, under 140 words. Use these sections with • bullets:\n" +
          "*Discussed:* what the lead said (funding amount, use of funds, urgency, monthly revenue, personal details).\n" +
          "*Funnel stage:* where they are.\n" +
          "*Gaps:* what's still missing to move forward.\n" +
          "*Next touch points:* 1-3 specific ideas for the next message or call.\n" +
          "Never use em dashes, use commas.",
        user: `Conversation:\n${transcript}`,
        maxTokens: 400,
        temperature: 0.3,
      });
      summary = text.trim();
    } catch (err) {
      console.error("[conversation-notes] summary failed:", err instanceof Error ? err.message : err);
      skipped++;
      continue;
    }

    // Post to the lead's Slack channel
    if (c.slack_channel_id) {
      await slack
        .postMessage(c.slack_channel_id, `📝 *Conversation notes* (idle ${IDLE_MINUTES}m)\n${summary}`)
        .catch((err: unknown) => console.error("[conversation-notes] slack post failed:", err instanceof Error ? err.message : err));
    }

    // The note needs a contact to hang off. A conversation with no contact_id is
    // an unrecognized number, which still gets the Slack post above.
    if (c.contact_id) {
      await addNote({
        contactId: c.contact_id as string,
        title: "SMS conversation notes",
        content: summary,
        origin: "ai",
        actor: "conversation_notes",
      }).catch((err: unknown) => console.error("[conversation-notes] note failed:", err instanceof Error ? err.message : err));
    }

    await supabaseAdmin
      .from("sms_conversations")
      .update({ notes_posted_at: new Date().toISOString() })
      .eq("id", c.id);

    processed++;
  }

  return { processed, skipped };
}
