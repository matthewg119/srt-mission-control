import { NextRequest, NextResponse } from "next/server";
import { slack } from "@/lib/slack-bot";
import { supabaseAdmin } from "@/lib/db";
import { runConversationWithTools, buildSystemPrompt, isAIConfigured } from "@/lib/ai";

export const dynamic = "force-dynamic";

// Dedup guard: prevent processing same event twice (Slack retries)
const processedEvents = new Set<string>();
const MAX_PROCESSED = 1000;

// Agent system prompts by channel
const AGENT_PROMPTS: Record<string, string> = {
  brainheart: `You are BrainHeart — the CEO's AI partner at SRT Agency. You have full context of all operations. You create tasks, monitor deals, send reports, and give strategic advice. Be direct, proactive, and action-oriented. When asked about status, always check real data with your tools.`,
  underwriting: `You are the Deal Processing AI for SRT Agency. You are PICKY and THOROUGH. When analyzing deals, you must understand: what does the business actually DO, how do they make money, what are the funds for, are there red flags. You MUST have complete information before moving a deal forward. If information is missing, say exactly what you need.`,
  submissions: `You are the Submissions AI for SRT Agency. You handle lender submissions, track submission status, follow up with lenders, and flag issues with files. You are organized and detail-oriented. When something is out of place in a deal file, you immediately flag it.`,
};

function getAgentType(channel: string): string {
  const ceoChannel = process.env.SLACK_CEO_CHANNEL || "";
  const uwChannel = process.env.SLACK_UW_CHANNEL || "";
  const subChannel = process.env.SLACK_SUB_CHANNEL || "";

  if (channel === uwChannel) return "underwriting";
  if (channel === subChannel) return "submissions";
  if (channel === ceoChannel) return "brainheart";
  return "brainheart"; // default for DMs
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();

    // Verify signature
    const signingSecret = process.env.SLACK_SIGNING_SECRET || "";
    const timestamp = request.headers.get("x-slack-request-timestamp") || "";
    const signature = request.headers.get("x-slack-signature") || "";

    if (signingSecret && timestamp && signature) {
      // Check timestamp freshness (5 min window)
      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - parseInt(timestamp)) > 300) {
        return NextResponse.json({ error: "Request too old" }, { status: 403 });
      }

      if (!slack.verifySignature(signingSecret, timestamp, rawBody, signature)) {
        return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
      }
    }

    const payload = JSON.parse(rawBody);

    // Handle URL verification challenge
    if (payload.type === "url_verification") {
      return NextResponse.json({ challenge: payload.challenge });
    }

    // Handle events
    if (payload.type === "event_callback") {
      const event = payload.event;

      // Ignore bot messages to prevent loops (multiple checks for safety)
      if (event.bot_id || event.subtype === "bot_message" || event.subtype === "message_changed" || event.subtype === "message_deleted") {
        return NextResponse.json({ ok: true });
      }

      // Ignore messages from our own bot user
      const botUserId = process.env.SLACK_BOT_USER_ID || "";
      if (botUserId && event.user === botUserId) {
        return NextResponse.json({ ok: true });
      }

      // Only handle message events
      if (event.type !== "message" && event.type !== "app_mention") {
        return NextResponse.json({ ok: true });
      }

      // Dedup: skip if we already processed this event
      const eventId = event.client_msg_id || event.ts || "";
      if (eventId && processedEvents.has(eventId)) {
        return NextResponse.json({ ok: true });
      }
      if (eventId) {
        processedEvents.add(eventId);
        if (processedEvents.size > MAX_PROCESSED) processedEvents.clear();
      }

      const channel = event.channel as string;
      const userText = event.text as string;

      if (!userText || userText.trim().length === 0) {
        return NextResponse.json({ ok: true });
      }

      // Check AI configured
      if (!isAIConfigured()) {
        await slack.postMessage(channel, "AI is not configured. Please set ANTHROPIC_API_KEY.");
        return NextResponse.json({ ok: true });
      }

      // Determine which agent to use
      const agentType = getAgentType(channel);
      const conversationId = `slack-${channel}`;

      // Load conversation history
      let history: Array<{ role: "user" | "assistant"; content: string }> = [];
      try {
        const { data } = await supabaseAdmin
          .from("chat_messages")
          .select("role, content")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: true })
          .limit(20);
        history = (data || []).map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content as string,
        }));
      } catch {
        // Continue without history
      }

      // Build system prompt with agent personality
      const basePrompt = await buildSystemPrompt();
      const agentPrompt = AGENT_PROMPTS[agentType] || AGENT_PROMPTS.brainheart;
      const systemPrompt = `${agentPrompt}\n\n${basePrompt}`;

      // Run AI
      const messages = [...history, { role: "user" as const, content: userText }];
      const { response, actions } = await runConversationWithTools(messages, systemPrompt);

      // Format response with tool summary
      let reply = response;
      if (actions.length > 0) {
        const toolSummary = actions
          .map((a) => a.split("(")[0])
          .filter((v, i, arr) => arr.indexOf(v) === i)
          .join(", ");
        reply = `_[${toolSummary}]_\n\n${response}`;
      }

      // Send reply directly in channel
      await slack.postMessage(channel, reply);

      // Save conversation (best-effort)
      try {
        await supabaseAdmin.from("chat_conversations").upsert(
          {
            id: conversationId,
            title: `Slack ${agentType}: ${userText.slice(0, 60)}`,
            agent_id: agentType,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "id" }
        );
        await supabaseAdmin.from("chat_messages").insert([
          { conversation_id: conversationId, role: "user", content: userText },
          { conversation_id: conversationId, role: "assistant", content: response },
        ]);
      } catch {
        // Non-critical
      }
    }

    // Always return 200 to Slack
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Slack events error:", error);
    return NextResponse.json({ ok: true });
  }
}
