import { NextRequest, NextResponse } from "next/server";
import { slack } from "@/lib/slack-bot";
import { supabaseAdmin } from "@/lib/db";
import { runConversationWithTools, buildSystemPrompt, isAIConfigured } from "@/lib/ai";
import { resolvePendingAction } from "@/lib/ai-intel/slack-approval";
import { executePendingAction, postExecutionReceipt } from "@/lib/ai-intel/execute-action";
import { microsoft } from "@/lib/microsoft";
import { VEKTOR_CHANNELS } from "@/config/vektor";

interface SlackEventFile {
  id: string;
  name?: string;
  mimetype?: string;
  url_private_download?: string;
  url_private?: string;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

      // Reaction shortcut for AI approval workflow — handled before bot-message filter.
      if (event.type === "reaction_added" && event.item?.type === "message") {
        await handleReactionAdded({
          reaction: event.reaction as string,
          slackTs: event.item.ts as string,
          channel: event.item.channel as string,
          userId: event.user as string,
        });
        return NextResponse.json({ ok: true });
      }

      // File drop in a deal thread → save to OneDrive + trigger bank-statement analysis.
      // Content-channel file drops are ignored here; the message-event branch
      // below gathers all files attached to one message and fires the decoder
      // in a single call so we don't run the decoder N times per drop.
      if (event.type === "file_shared") {
        const fileId = (event.file_id ?? event.file?.id) as string | undefined;
        if (fileId) {
          void handleFileShared(fileId).catch((e) => {
            console.error("[slack/events] file_shared handler error:", (e as Error).message);
          });
        }
        return NextResponse.json({ ok: true });
      }

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
      const userText = (event.text as string) || "";
      const attachedFiles = (event.files as SlackEventFile[] | undefined) ?? [];
      const isContentChannel = Boolean(channel) && channel === VEKTOR_CHANNELS.content;
      const isContentFullChannel = Boolean(channel) && channel === VEKTOR_CHANNELS.contentFull;

      // #content / #content-full: fork to the Viral Video Decoder. Accepts any
      // mix of images + text brief; one call per Slack message (not per file).
      if (isContentChannel || isContentFullChannel) {
        const isThreadReply = Boolean(event.thread_ts) && event.thread_ts !== event.ts;
        void handleContentDrop({
          channel,
          threadTs: (event.thread_ts as string) || (event.ts as string),
          userId: event.user as string,
          brief: userText,
          files: attachedFiles,
          fullVideo: isContentFullChannel,
          isThreadReply,
        }).catch((e) => {
          console.error("[slack/events] content drop handler error:", (e as Error).message);
        });
        return NextResponse.json({ ok: true });
      }

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

async function handleReactionAdded(args: { reaction: string; slackTs: string; channel: string; userId: string }) {
  const matthewId = process.env.MATTHEW_SLACK_USER_ID ?? "";

  // Content-package reactions take priority: the package rows have their own
  // table and their own downstream action (kick off the full video pipeline
  // on 👍 in #content-full). Fall through to the deal-approval path only if
  // no content package matches this message ts.
  if (args.channel === VEKTOR_CHANNELS.content || args.channel === VEKTOR_CHANNELS.contentFull) {
    const handled = await handleContentReaction(args);
    if (handled) return;
  }

  if (args.reaction === "+1" || args.reaction === "thumbsup") {
    const { action, error } = await resolvePendingAction({
      slackTs: args.slackTs,
      status: "approved",
      approvedBy: args.userId,
    });
    if (error || !action) return;

    if (action.payload.requires_matthew && !(matthewId && args.userId === matthewId)) {
      await supabaseAdmin
        .from("pending_slack_actions")
        .update({ status: "pending", approved_by: null, resolved_at: null })
        .eq("id", action.id);
      await slack.postThreadReply(args.channel, args.slackTs, `🔒 This requires Matthew's approval (>$50k or submission). Reverted.`);
      return;
    }

    const result = await executePendingAction({
      actionId: action.id,
      actionType: action.action_type,
      payload: action.payload,
      approvedBy: args.userId,
    });

    await supabaseAdmin.from("fine_tune_examples").insert({
      trigger_type: action.action_type === "submit_deal" ? "deal_submission" : "merchant_state",
      input_context: { slack_ts: args.slackTs, channel: args.channel, reaction: args.reaction },
      ai_draft: action.payload.body ?? JSON.stringify(action.payload).slice(0, 1000),
      human_correction: null,
      rep_id: args.userId,
      was_approved_as_is: true,
    });

    await postExecutionReceipt({
      channel: args.channel,
      threadTs: args.slackTs,
      summary: result.ok
        ? `Approved via :+1: by <@${args.userId}>.`
        : `Execution failed: ${result.error}`,
      success: result.ok,
    });
    return;
  }

  if (args.reaction === "no_entry" || args.reaction === "x") {
    const { error } = await resolvePendingAction({
      slackTs: args.slackTs,
      status: "cancelled",
      approvedBy: args.userId,
    });
    if (!error) {
      await slack.postThreadReply(args.channel, args.slackTs, `🚫 Cancelled via reaction by <@${args.userId}>.`);
    }
    return;
  }
}

async function handleContentReaction(args: {
  reaction: string;
  slackTs: string;
  channel: string;
  userId: string;
}): Promise<boolean> {
  const { data: pkg } = await supabaseAdmin
    .from("content_packages")
    .select("id, status, slack_channel, slack_thread_ts")
    .eq("slack_package_ts", args.slackTs)
    .maybeSingle();

  if (!pkg) return false;

  const isApprove = args.reaction === "+1" || args.reaction === "thumbsup";
  const isKill = args.reaction === "no_entry" || args.reaction === "x";
  const isEdit = args.reaction === "pencil2" || args.reaction === "memo" || args.reaction === "writing_hand";

  if (!isApprove && !isKill && !isEdit) return false;

  if (pkg.status !== "awaiting_approval" && pkg.status !== "regenerating") {
    await slack.postThreadReply(
      args.channel,
      pkg.slack_thread_ts as string,
      `_(package already ${pkg.status} — reaction ignored)_`
    );
    return true;
  }

  if (isKill) {
    await supabaseAdmin
      .from("content_packages")
      .update({ status: "killed", resolved_at: new Date().toISOString() })
      .eq("id", pkg.id);
    await slack.postThreadReply(args.channel, pkg.slack_thread_ts as string, `🚫 Killed by <@${args.userId}>.`);
    return true;
  }

  if (isEdit) {
    await supabaseAdmin
      .from("content_packages")
      .update({ status: "regenerating" })
      .eq("id", pkg.id);
    await slack.postThreadReply(
      args.channel,
      pkg.slack_thread_ts as string,
      `✏️ Reply in this thread with what to change and I'll rebuild.`
    );
    return true;
  }

  // Approve
  await supabaseAdmin
    .from("content_packages")
    .update({ status: "approved", resolved_at: new Date().toISOString() })
    .eq("id", pkg.id);

  if (args.channel === VEKTOR_CHANNELS.contentFull) {
    // Kick off the full video pipeline — fire-and-forget so Slack gets 200 fast.
    const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    void fetch(`${siteUrl}/api/agent/video-pipeline`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ package_id: pkg.id, approved_by: args.userId }),
    }).catch((e) => console.error("[content] pipeline kickoff failed:", (e as Error).message));
    await slack.postThreadReply(
      args.channel,
      pkg.slack_thread_ts as string,
      `👍 Approved by <@${args.userId}> — firing video pipeline now.`
    );
  } else {
    await slack.postThreadReply(
      args.channel,
      pkg.slack_thread_ts as string,
      `👍 Approved by <@${args.userId}>. Ready to build in CapCut.`
    );
  }
  return true;
}

async function handleContentDrop(args: {
  channel: string;
  threadTs: string;
  userId: string;
  brief: string;
  files: SlackEventFile[];
  fullVideo: boolean;
  isThreadReply: boolean;
}): Promise<void> {
  const imageFiles = args.files.filter((f) => (f.mimetype ?? "").startsWith("image/"));

  // Thread reply in an existing content thread: if a package is awaiting
  // regeneration (user hit ✏️), treat this reply as the feedback.
  let parentPackageId: string | null = null;
  let regenFeedback: string | null = null;
  if (args.isThreadReply) {
    const { data: existing } = await supabaseAdmin
      .from("content_packages")
      .select("id, status, brief")
      .eq("slack_thread_ts", args.threadTs)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing && existing.status === "regenerating") {
      parentPackageId = existing.id as string;
      regenFeedback = args.brief;
    } else if (existing && (existing.status === "approved" || existing.status === "killed")) {
      // Package already resolved — stay quiet so normal thread chat isn't hijacked.
      return;
    }
  }

  if (!parentPackageId && imageFiles.length === 0 && args.brief.trim().length < 10) {
    await slack.postThreadReply(
      args.channel,
      args.threadTs,
      "👋 Drop reference screenshots + a one-line brief (e.g. `MCA denial → SRT approval, dental vertical, $150K in 24hr`) and I'll build the full package."
    );
    return;
  }

  await slack.postThreadReply(
    args.channel,
    args.threadTs,
    parentPackageId
      ? `✏️ Rebuilding with your feedback…`
      : args.fullVideo
      ? `🎬 Got it — writing the decoder package first, then firing the FAL.ai + ElevenLabs + ffmpeg pipeline on 👍.`
      : `📝 Got it — writing the production package (caption, VO, 9 image/animation prompts, timeline, music). ~20s.`
  );

  const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  try {
    const res = await fetch(`${siteUrl}/api/agent/viral-decoder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: args.channel,
        thread_ts: args.threadTs,
        user_id: args.userId,
        brief: args.brief,
        files: imageFiles.map((f) => ({
          id: f.id,
          name: f.name,
          mimetype: f.mimetype,
          url_private: f.url_private ?? f.url_private_download,
        })),
        parent_package_id: parentPackageId,
        regenerate_feedback: regenFeedback,
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      await slack.postThreadReply(
        args.channel,
        args.threadTs,
        `⚠️ Decoder failed: ${errText.slice(0, 300)}`
      );
    }
  } catch (e) {
    await slack.postThreadReply(
      args.channel,
      args.threadTs,
      `⚠️ Decoder error: ${(e as Error).message}`
    );
  }
}

interface SlackFileInfo {
  id: string;
  name?: string;
  mimetype?: string;
  filetype?: string;
  url_private_download?: string;
  user?: string;
  shares?: {
    public?: Record<string, Array<{ thread_ts?: string; ts?: string }>>;
    private?: Record<string, Array<{ thread_ts?: string; ts?: string }>>;
  };
}

async function handleFileShared(fileId: string): Promise<void> {
  const info = (await slack.filesInfo(fileId)) as { ok: boolean; file?: SlackFileInfo; error?: string };
  if (!info.ok || !info.file) {
    console.warn("[slack/events] files.info failed:", info.error);
    return;
  }
  const file = info.file;

  if (file.mimetype !== "application/pdf") {
    console.log("[slack/events] skipping non-PDF file:", file.mimetype, file.name);
    return;
  }

  // If the file landed in a content channel, the message-event branch already
  // fired the decoder — don't also try to treat it as a bank statement.
  const allShareChannels = Object.keys({
    ...(file.shares?.public ?? {}),
    ...(file.shares?.private ?? {}),
  });
  if (
    allShareChannels.some((ch) => ch === VEKTOR_CHANNELS.content || ch === VEKTOR_CHANNELS.contentFull)
  ) {
    return;
  }

  const pipelineChannel = process.env.SLACK_PIPELINE_CHANNEL || "";
  const allShares: Record<string, Array<{ thread_ts?: string; ts?: string }>> = {
    ...(file.shares?.public ?? {}),
    ...(file.shares?.private ?? {}),
  };

  let channelId: string | null = null;
  let threadTs: string | null = null;
  for (const [ch, arr] of Object.entries(allShares)) {
    for (const share of arr ?? []) {
      if (share.thread_ts) {
        channelId = ch;
        threadTs = share.thread_ts;
        if (pipelineChannel && ch === pipelineChannel) break;
      }
    }
    if (pipelineChannel && channelId === pipelineChannel) break;
  }

  if (!channelId || !threadTs) {
    console.log("[slack/events] file not shared inside a thread — skipping", { file_id: file.id });
    return;
  }
  if (pipelineChannel && channelId !== pipelineChannel) {
    console.log("[slack/events] file not in pipeline channel — skipping", { channelId });
    return;
  }

  const { data: deal } = await supabaseAdmin
    .from("deals")
    .select("id, contact_id, zoho_lead_id, contacts:contact_id(business_name)")
    .eq("slack_thread_ts", threadTs)
    .maybeSingle();

  if (!deal) {
    await slack.postThreadReply(channelId, threadTs, "⚠️ VeKtor couldn't match this thread to a deal. Drop the PDF in a thread VeKtor started.");
    return;
  }

  const dealId = deal.id as string;
  const merchantName = (
    (deal as { contacts?: { business_name?: string } | null }).contacts?.business_name ?? "Merchant"
  ).trim();

  if (!file.url_private_download) {
    console.error("[slack/events] no url_private_download on file", file.id);
    return;
  }
  const buffer = await slack.downloadFile(file.url_private_download);

  const folderPath = `Deals/${merchantName}/Bank Statements`;
  const fileName = file.name ?? `statement-${Date.now()}.pdf`;
  let driveItemId: string | null = null;
  let driveWebUrl: string | null = null;
  try {
    await microsoft.createDriveFolder("Bank Statements", `Deals/${merchantName}`).catch(() => {});
    const uploaded = await microsoft.uploadDriveFile(folderPath, fileName, buffer, "application/pdf");
    driveItemId = uploaded.id;
    driveWebUrl = uploaded.webUrl;
    await slack.postThreadReply(channelId, threadTs, `📥 Saved \`${fileName}\` to OneDrive — analyzing…`);
  } catch (e) {
    console.error("[slack/events] OneDrive upload failed:", (e as Error).message);
    await slack.postThreadReply(channelId, threadTs, `⚠️ OneDrive upload failed: ${(e as Error).message}. Analyzing from Slack only.`);
  }

  const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const analyzeBody: Record<string, unknown> = {
    deal_id: dealId,
    source: "slack_drop",
    onedrive_folder_url: driveWebUrl,
  };
  if (driveItemId) {
    analyzeBody.drive_item_ids = [driveItemId];
  } else {
    analyzeBody.pdf_urls = [file.url_private_download];
  }

  const res = await fetch(`${siteUrl}/api/agent/bank-statements`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(analyzeBody),
  });

  if (!res.ok) {
    const errText = await res.text();
    await slack.postThreadReply(channelId, threadTs, `⚠️ Analysis failed: ${errText.slice(0, 200)}`);
  }
}
