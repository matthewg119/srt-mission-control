import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import type { HookOption } from "@/lib/content-types";
import { slack } from "@/lib/slack-bot";
import { supabaseAdmin } from "@/lib/db";
import { runConversationWithTools, buildSystemPrompt, isAIConfigured, type ImageBlock } from "@/lib/ai";
import { resolvePendingAction } from "@/lib/ai-intel/slack-approval";
import { executePendingAction, postExecutionReceipt } from "@/lib/ai-intel/execute-action";
import { microsoft } from "@/lib/microsoft";
import { VEKTOR_CHANNELS } from "@/config/vektor";
import { parseLenderChoicesFromReply } from "@/lib/ai-intel/request-lender-routing";
import { getEmailSubmissionByThread, setPendingAdhocForward, clearPendingAdhocForward } from "@/lib/ai-intel/email-submissions";
import { forwardDealToFunders, forwardDealToAddresses } from "@/lib/ai-intel/forward-deal-to-funders";
import { isBuildCommand, handleBuildCommand, handleStatementDropThreadReply } from "@/lib/ai-intel/build-draft";
import type { PendingActionPayload } from "@/lib/ai-intel/types";
import {
  startSlideGenerationWithHook,
  generateAndPostImage,
  approveImageAndStartVideo,
  approveVideoAndAdvance,
  regenerateImage,
  regenerateVideo,
  getSceneByImageTs,
  getSceneByVideoTs,
  startStillsGeneration,
  animateAndStitch,
  regenerateAllStills,
} from "@/lib/content-scene-runner";
import { stripSilence, sofiaVoiceConvert } from "@/lib/elevenlabs-media";
import { handleReelImage, handleReelReaction } from "@/lib/reel/interactive";
import { handleStudioReply, handleStudioReaction } from "@/lib/reel/studio";
import {
  handlePovImagePost,
  handlePovMediaWithBrief,
  handlePovWorkflowReaction,
  handlePovDropPick,
  handlePovIdeasApproval,
  handleInstagramLink,
  INSTAGRAM_URL_RE,
} from "@/lib/reel/pov-studio";
import { handleBugRevealIdeasApproval, handleBugRevealPick, handleBugRevealReply, handleBugRevealFeedback } from "@/lib/reel/bug-reveal";
import { handlePipelineReaction, handlePipelineThreadReply } from "@/lib/reel/pipeline";
import { handleStyleRuleApproval, summarizeActiveRules } from "@/lib/reel/style-rules";
import {
  analyzeReferenceImage,
  postVideoDecisionCard,
  handleAnalyzerReaction,
  handleAnalyzerThreadReply,
} from "@/lib/reel/content-analyzer";
import {
  startAvatarSession,
  startGo,
  handleVektorMessage,
  handlePictureReaction,
  parseAvatarCommand,
  handleSongAttachment,
  handleWorkflowReferenceUpload,
} from "@/lib/reel/workflow-pipeline";
import {
  startGoV2,
  handleBuilderMessage,
  handleBuilderReaction,
  handleBuilderFileDrop,
} from "@/lib/reel/workflow-builder";
import {
  handleDropMessage,
  handleDropThreadReply,
  handleDropReaction,
  handleDropFileDrop,
  handleDropGo,
} from "@/lib/reel/drop-studio";
import {
  startAgentSession,
  handleAgentMessage,
  handleAgentFileDrop,
  handleAgentReaction,
} from "@/lib/reel/workflow-agent";
import { postWorkflowMap } from "@/lib/reel/workflow-map";
import { postSourcingCard } from "@/lib/reel/sourcing-worksheet";
import {
  startNewAvatar,
  parseNewAvatar,
  pendingNewAvatar,
  consumePendingNewAvatar,
} from "@/lib/reel/avatar-create";
import { handleGenerateIdeas, resolveVerticalId } from "@/lib/reel/format-generator";
import { classifyByKeywords } from "@/config/content-workflows";
import { deliverPendingDraft } from "@/lib/imessage-send";
import { postManualSendConfirm } from "@/lib/imessage-suggestion";

interface SlackEventFile {
  id: string;
  name?: string;
  mimetype?: string;
  url_private_download?: string;
  url_private?: string;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Some reactions kick off image generation in a waitUntil background task (POV + Bug-Reveal
// drops). Higgsfield polls up to ~2 min per image, so 60s killed those tasks mid-generation
// (the drop got stuck on "Generating…"). 300s lets the background generation finish; normal
// events still return in milliseconds.
export const maxDuration = 300;

// Dedup guard: prevent processing same event twice (Slack retries)
const processedEvents = new Set<string>();
const MAX_PROCESSED = 1000;

// Agent system prompts by channel
const AGENT_PROMPTS: Record<string, string> = {
  brainheart: `You are BrainHeart — the CEO's AI partner at SRT Agency. You have full context of all operations. You create tasks, monitor deals, send reports, and give strategic advice. Be direct, proactive, and action-oriented. When asked about status, always check real data with your tools.`,
  underwriting: `You are the Deal Processing AI for SRT Agency. You are PICKY and THOROUGH. When analyzing deals, you must understand: what does the business actually DO, how do they make money, what are the funds for, are there red flags. You MUST have complete information before moving a deal forward. If information is missing, say exactly what you need.`,
  submissions: `You are the Submissions AI for SRT Agency. You handle lender submissions, track submission status, follow up with lenders, and flag issues with files. You are organized and detail-oriented. When something is out of place in a deal file, you immediately flag it.

You also answer funder UNDERWRITING questions in this channel. Every funder has an \`underwriting_box\` (min deposits/revenue, time-in-business, max amount, positions, blocked industries, NSF/negative-day tolerance, factor range) and may have a full guideline PDF on file. Use the get_lenders tool to look funders up: pass a specific name (e.g. "Legend", "VOX") or a filter (e.g. "trucking", "3rd position") to find fits. When asked "what's the box for X" or "what does X require", recite the box/criteria. When asked to "pull up the guidelines" for a funder, return its guideline_pdf_url link. If a funder has no box on file, say so plainly — do not invent criteria. Keep answers short, direct, and factual: lead with the answer, no filler.`,
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
        console.log("[slack/events] reaction_added", {
          reaction: event.reaction,
          ts: event.item.ts,
          channel: event.item.channel,
          user: event.user,
        });
        // Code Guardian reactions — check first so ✅ on a guardian card doesn't trigger SMS approval
        const guardianHandled = await handleGuardianReaction({
          reaction: event.reaction as string,
          slackTs: event.item.ts as string,
          channel: event.item.channel as string,
          userId: event.user as string,
        });
        if (guardianHandled) return NextResponse.json({ ok: true });

        // Unified content pipeline (Content Engine v2): ✅/🚫 ideate gate + 1️⃣/2️⃣/3️⃣ shot pick
        // for ANY registry format (bug-reveal, attic B-roll, jumpscare, ...). Self-routes by the
        // content_jobs table; returns false for non-pipeline messages so legacy handlers still run.
        const pipelineHandled = await handlePipelineReaction({
          reaction: event.reaction as string,
          slackTs: event.item.ts as string,
          channel: event.item.channel as string,
        });
        if (pipelineHandled) return NextResponse.json({ ok: true });

        // Workflow Builder v2 (gov2): ✅ advances the current card / 🚫 cancels the session.
        // Self-routes by content_jobs (format_id workflow_build); falls through otherwise.
        const builderReactionHandled = await handleBuilderReaction({
          reaction: event.reaction as string,
          slackTs: event.item.ts as string,
          channel: event.item.channel as string,
        });
        if (builderReactionHandled) return NextResponse.json({ ok: true });

        // #ai-content-pest-control drop lane: ✅ / keycaps on fit + copy cards.
        const dropReactionHandled = await handleDropReaction({
          reaction: event.reaction as string,
          slackTs: event.item.ts as string,
          channel: event.item.channel as string,
          userId: event.user as string,
        });
        if (dropReactionHandled) return NextResponse.json({ ok: true });

        // #agent-wokrflow-creator: ✅ on the variations card = keep 1 / 🚫 cancels.
        const agentReactionHandled = await handleAgentReaction({
          reaction: event.reaction as string,
          slackTs: event.item.ts as string,
          channel: event.item.channel as string,
        });
        if (agentReactionHandled) return NextResponse.json({ ok: true });

        // Content Engine v3 scrub-or-reference: 📚 (save reference) / 🧪 (scrub into a workflow)
        // on a #content-analyzer decision card. Self-routes by content_jobs; falls through otherwise.
        const analyzerHandled = await handleAnalyzerReaction({
          reaction: event.reaction as string,
          slackTs: event.item.ts as string,
          channel: event.item.channel as string,
        });
        if (analyzerHandled) return NextResponse.json({ ok: true });

        // v3 picture card: ✅ generates the real scene images for the mapped picture.
        const pictureHandled = await handlePictureReaction({
          reaction: event.reaction as string,
          slackTs: event.item.ts as string,
          channel: event.item.channel as string,
        });
        if (pictureHandled) return NextResponse.json({ ok: true });

        // Reel drop: 1/2/3 reaction on a headline-options message (self-routes by DB)
        const reelHandled = await handleReelReaction({
          reaction: event.reaction as string,
          slackTs: event.item.ts as string,
          channel: event.item.channel as string,
        });
        if (reelHandled) return NextResponse.json({ ok: true });

        // Bug-Reveal ideas gate: ✅ generate / 🚫 skip on the before-shots message (self-routes by DB)
        const bugIdeasHandled = await handleBugRevealIdeasApproval({
          reaction: event.reaction as string,
          slackTs: event.item.ts as string,
          channel: event.item.channel as string,
        });
        if (bugIdeasHandled) return NextResponse.json({ ok: true });

        // Bug-Reveal pick: 1️⃣/2️⃣/3️⃣ to pick the "before", then add bugs + copy (self-routes by DB)
        const bugPickHandled = await handleBugRevealPick({
          reaction: event.reaction as string,
          slackTs: event.item.ts as string,
          channel: event.item.channel as string,
        });
        if (bugPickHandled) return NextResponse.json({ ok: true });

        // Style-rule proposal card: ✅ activates / 🚫 discards the pending rules (self-routes by DB)
        const styleRuleHandled = await handleStyleRuleApproval({
          reaction: event.reaction as string,
          slackTs: event.item.ts as string,
          channel: event.item.channel as string,
        });
        if (styleRuleHandled) return NextResponse.json({ ok: true });

        // POV ideas-first gate: ✅ generate / 🚫 skip on a scene-ideas message (self-routes by DB)
        const povIdeasHandled = await handlePovIdeasApproval({
          reaction: event.reaction as string,
          slackTs: event.item.ts as string,
          channel: event.item.channel as string,
        });
        if (povIdeasHandled) return NextResponse.json({ ok: true });

        // POV daily drop: 1️⃣/2️⃣/3️⃣ to pick the best of 3 image options (self-routes by DB)
        const povPickHandled = await handlePovDropPick({
          reaction: event.reaction as string,
          slackTs: event.item.ts as string,
          channel: event.item.channel as string,
        });
        if (povPickHandled) return NextResponse.json({ ok: true });

        // POV workflow picker: 1️⃣/2️⃣/3️⃣ reaction on a "what workflow?" message (self-routes by DB)
        const povWorkflowHandled = await handlePovWorkflowReaction({
          reaction: event.reaction as string,
          slackTs: event.item.ts as string,
          channel: event.item.channel as string,
        });
        if (povWorkflowHandled) return NextResponse.json({ ok: true });

        // Reel Studio: 1/2/3/4 reaction on a variations message (self-routes by DB)
        const studioHandled = await handleStudioReaction({
          reaction: event.reaction as string,
          slackTs: event.item.ts as string,
          channel: event.item.channel as string,
        });
        if (studioHandled) return NextResponse.json({ ok: true });

        // Try content reaction handler (self-routes by DB lookup)
        const contentHandled = await handleContentReaction({
          reaction: event.reaction as string,
          slackTs: event.item.ts as string,
          channel: event.item.channel as string,
          userId: event.user as string,
        });
        if (!contentHandled) {
          await handleReactionAdded({
            reaction: event.reaction as string,
            slackTs: event.item.ts as string,
            channel: event.item.channel as string,
            userId: event.user as string,
          });
        }
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

      const parentThreadTs = (event.thread_ts as string | undefined) || null;

      // ---- Dedicated lanes: these two channels ALWAYS return here, never falling
      // through to the legacy content / AI-manager handlers. ----

      // #ai-content-pest-control — drop-and-render + prompt drops + feedback (drop-studio.ts).
      if (Boolean(channel) && channel === VEKTOR_CHANNELS.aiContentPestControl) {
        const isThreadReply = Boolean(parentThreadTs) && parentThreadTs !== event.ts;
        if (attachedFiles.length > 0) {
          const messageTs = event.ts as string;
          waitUntil(
            (async () => {
              if (isThreadReply) {
                await handleDropFileDrop({ channel, threadTs: parentThreadTs!, files: attachedFiles, text: userText });
              } else {
                await handleDropMessage({ channel, threadTs: messageTs, files: attachedFiles, text: userText });
              }
            })().catch((e) => console.error("[slack/events] drop lane files error:", (e as Error).message))
          );
        } else if (isThreadReply && userText.trim()) {
          waitUntil(
            handleDropThreadReply({ channel, threadTs: parentThreadTs!, text: userText }).catch((e) =>
              console.error("[slack/events] drop lane reply error:", (e as Error).message)
            )
          );
        } else if (/^\s*go\s*$/i.test(userText)) {
          waitUntil(
            handleDropGo(channel).catch((e) =>
              console.error("[slack/events] drop go error:", (e as Error).message)
            )
          );
        } else if (/^\s*(workflows|library|map)\s*$/i.test(userText)) {
          await postWorkflowMap(channel, "pest_control");
        } else if (userText.trim()) {
          await slack.postMessage(
            channel,
            "Drop your media + copy together in ONE message to render. `go` gives you headlines + story material. `workflows` shows the library."
          );
        }
        return NextResponse.json({ ok: true });
      }

      // #agent-wokrflow-creator — the Workflow Creator agent (workflow-agent.ts).
      if (Boolean(channel) && channel === VEKTOR_CHANNELS.agentWorkflowCreator) {
        const threadArg = parentThreadTs && parentThreadTs !== event.ts ? parentThreadTs : undefined;
        if (attachedFiles.length === 0 && /^\s*go\s*$/i.test(userText)) {
          await startAgentSession({ channel });
        } else if (attachedFiles.length > 0) {
          waitUntil(
            (async () => {
              const handled = await handleAgentFileDrop({ channel, threadTs: threadArg, files: attachedFiles, text: userText });
              if (!handled) await slack.postMessage(channel, "Type `go` to start a Workflow Creator session first.");
            })().catch((e) => console.error("[slack/events] agent files error:", (e as Error).message))
          );
        } else if (userText.trim()) {
          waitUntil(
            (async () => {
              const handled = await handleAgentMessage({ channel, threadTs: threadArg, text: userText });
              if (!handled) await slack.postMessage(channel, "Type `go` to start a Workflow Creator session.");
            })().catch((e) => console.error("[slack/events] agent message error:", (e as Error).message))
          );
        }
        return NextResponse.json({ ok: true });
      }

      // #content-full thread reply on a drop. Three interpretations, in order:
      //   1. "rules"        -> list the active style rules.
      //   2. tuning feedback -> distill into ✅-gated style rules ("make the furnace older").
      //   3. "remix/more"    -> regenerate 3 fresh before options.
      // Text-only replies; falls through otherwise. Format group defaults to bug_reveal (the
      // active daily-drop mode); brand-scope rules apply everywhere regardless.
      if (
        isContentFullChannel &&
        parentThreadTs &&
        parentThreadTs !== event.ts &&
        attachedFiles.length === 0 &&
        userText.trim().length > 0
      ) {
        if (/^\s*rules?\s*$/i.test(userText)) {
          await slack.postThreadReply(channel, parentThreadTs, await summarizeActiveRules());
          return NextResponse.json({ ok: true });
        }
        // Workflow Builder v2 (gov2) session replies (DNA, timings paste, scene edits, name,
        // caption). Self-routes by content_jobs (workflow_build); falls through otherwise.
        const builderReply = await handleBuilderMessage({
          channel,
          threadTs: parentThreadTs,
          text: userText,
        });
        if (builderReply) return NextResponse.json({ ok: true });
        // v3 avatar session: `workflow N` -> hooks, `hook N` -> bodies, `body N` -> storyboard,
        // `song X`. Self-routes by the content_jobs workflow session in this thread.
        const vektorReply = await handleVektorMessage({
          channel,
          threadTs: parentThreadTs,
          text: userText,
        });
        if (vektorReply) return NextResponse.json({ ok: true });
        // Unified pipeline thread reply (tuning feedback -> ✅-gated rules, or remix -> fresh
        // options) for any registry format. Self-routes by content_jobs; falls through if the
        // thread is a legacy (bug_reveal_jobs) drop.
        const pipelineReply = await handlePipelineThreadReply({ channel, threadTs: parentThreadTs, text: userText });
        if (pipelineReply) return NextResponse.json({ ok: true });
        // Tuning feedback -> regenerate a live preview with the change, then ✅-gate the save.
        const tuned = await handleBugRevealFeedback({ channel, threadTs: parentThreadTs, text: userText });
        if (tuned) return NextResponse.json({ ok: true });
        const handled = await handleBugRevealReply({ channel, threadTs: parentThreadTs, text: userText });
        if (handled) return NextResponse.json({ ok: true });
      }

      // #content-full TOP-LEVEL avatar-first grammar: `map`/`library` shows the inventory,
      // `vektor <avatar>` / `avatar <avatar>` opens an avatar session.
      if (
        isContentFullChannel &&
        (!parentThreadTs || parentThreadTs === event.ts) &&
        attachedFiles.length === 0 &&
        userText.trim().length > 0
      ) {
        // Workflow Builder v2: `gov2` (optionally `gov2 pest_control`) starts the audio-first
        // builder. Checked before `go` so the two grammars never collide.
        const gov2Match = /^\s*gov2(?:\s+([a-z][a-z0-9_]*))?\s*$/i.exec(userText);
        if (gov2Match) {
          await startGoV2({ channel, verticalId: gov2Match[1]?.toLowerCase() });
          return NextResponse.json({ ok: true });
        }
        if (/^\s*go\s*$/i.test(userText)) {
          await startGo({ channel });
          return NextResponse.json({ ok: true });
        }
        // `map` / `library` (optionally scoped: `map pest_control`) -> the labeled library
        // flowchart rendered as an IMAGE (shots · seconds · text positions · production state).
        const mapMatch = /^\s*(?:map|library)(?:\s+([a-z][a-z0-9_]*))?\s*$/i.exec(userText);
        if (mapMatch) {
          await postWorkflowMap(channel, mapMatch[1]?.toLowerCase());
          return NextResponse.json({ ok: true });
        }
        // `worksheet` / `sources` [name|number] -> the content-sourcing card (what real
        // reference clips to find for a workflow + where). Must match BEFORE the channel
        // session fallback so an active session's stage guard can't swallow it.
        const wsMatch = /^\s*(?:worksheet|sources)(?:\s+(.+))?\s*$/i.exec(userText);
        if (wsMatch) {
          await postSourcingCard({ channel, arg: wsMatch[1]?.trim() });
          return NextResponse.json({ ok: true });
        }
        const newAvatar = parseNewAvatar(userText);
        if (newAvatar) {
          await startNewAvatar({ channel, id: newAvatar.id, name: newAvatar.name });
          return NextResponse.json({ ok: true });
        }
        const avatar = parseAvatarCommand(userText);
        if (avatar) {
          await startAvatarSession({ channel, verticalId: avatar });
          return NextResponse.json({ ok: true });
        }
        // Channel-scoped gov2 builder commands (avatar number, `song <url>`, timing paste, ...).
        const builderChannelReply = await handleBuilderMessage({ channel, text: userText });
        if (builderChannelReply) return NextResponse.json({ ok: true });
        // Channel-scoped session commands (number pick, headline N, title N, pick, redo, song...).
        const vektorChannelReply = await handleVektorMessage({ channel, text: userText });
        if (vektorChannelReply) return NextResponse.json({ ok: true });
      }

      // #content-analyzer TOP-LEVEL `new avatar <id> <Name>`: name a new avatar before dropping
      // its kit here (prevents a stray kit from overwriting an existing avatar).
      if (
        channel === VEKTOR_CHANNELS.contentAnalyzer &&
        (!parentThreadTs || parentThreadTs === event.ts) &&
        attachedFiles.length === 0 &&
        userText.trim().length > 0
      ) {
        const na = parseNewAvatar(userText);
        if (na) {
          await startNewAvatar({ channel, id: na.id, name: na.name });
          return NextResponse.json({ ok: true });
        }
      }

      // #content-analyzer thread reply on a scrub-or-ref card: set section (`pov/modern_house`)
      // or a 5-digit zip before reacting 📚/🧪.
      if (
        channel === VEKTOR_CHANNELS.contentAnalyzer &&
        parentThreadTs &&
        parentThreadTs !== event.ts &&
        attachedFiles.length === 0 &&
        userText.trim().length > 0
      ) {
        const analyzerReply = await handleAnalyzerThreadReply({
          channel,
          threadTs: parentThreadTs,
          text: userText,
        });
        if (analyzerReply) return NextResponse.json({ ok: true });
      }

      // Code Guardian channel — thread replies become conversational Q&A with Claude
      const guardianChannelEnv = process.env.SLACK_CODE_GUARDIAN_CHANNEL || "";
      if (guardianChannelEnv && channel === guardianChannelEnv && parentThreadTs && parentThreadTs !== event.ts && userText.trim().length > 0) {
        void handleGuardianThreadMessage({
          channel,
          threadTs: parentThreadTs,
          userId: event.user as string,
          text: userText,
        }).catch((e) => {
          console.error("[slack/events] guardian thread message error:", (e as Error).message);
        });
        return NextResponse.json({ ok: true });
      }

      // Thread reply in a #pipeline-new deal thread? Check for a pending
      // send_submission action and interpret the reply as lender names to
      // send the draft to.
      const pipelineChannelEnv = process.env.SLACK_PIPELINE_CHANNEL || "";
      if (
        parentThreadTs &&
        parentThreadTs !== event.ts &&
        pipelineChannelEnv &&
        channel === pipelineChannelEnv &&
        userText.trim().length > 0
      ) {
        const handled = await handleDealThreadReply({
          channel,
          threadTs: parentThreadTs,
          userId: event.user as string,
          replyText: userText,
        });
        if (handled) return NextResponse.json({ ok: true });
      }

      // Thread reply under a "New Deal" message in #srt-sub → funder names to
      // forward the verbatim package to. Must run BEFORE the submissions-AI
      // agent fallthrough (getAgentType maps #srt-sub → "submissions").
      const subChannelEnv = process.env.SLACK_SUB_CHANNEL || "";

      // #srt-sub statement/app drop → analyze + build report + the two Outlook drafts.
      // Fire a non-blocking POST to the dedicated endpoint (its own 300s timeout) so the
      // slow work doesn't run in this short-lived events function.
      if (
        subChannelEnv &&
        channel === subChannelEnv &&
        attachedFiles.some((f) => f.mimetype === "application/pdf" || /\.pdf$/i.test(f.name ?? ""))
      ) {
        const dropThread = parentThreadTs && parentThreadTs !== event.ts ? parentThreadTs : (event.ts as string);
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
        await supabaseAdmin.from("system_logs").insert({
          event_type: "build_drafts_dispatch",
          description: "[slack/events] #srt-sub PDF drop → dispatch build-drafts",
          metadata: { files: attachedFiles.length, channel },
        }).then(() => {}, () => {});
        // build-drafts responds immediately (work continues there via waitUntil), so awaiting
        // this is fast and guarantees the request is actually sent before this function returns.
        try {
          await fetch(`${appUrl}/api/agent/build-drafts`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              channel,
              threadTs: dropThread,
              userId: event.user as string,
              text: userText,
              files: attachedFiles.map((f) => ({ name: f.name, mimetype: f.mimetype, url_private_download: f.url_private_download })),
            }),
          });
        } catch (e) {
          console.error("[slack/events] build-drafts dispatch error:", (e as Error).message);
        }
        return NextResponse.json({ ok: true });
      }

      // #srt-sub "build" command (no files) → resolve the lead only.
      // Must run before the funder-name reply handler so "build …" isn't parsed as lenders.
      if (
        subChannelEnv &&
        channel === subChannelEnv &&
        isBuildCommand(userText)
      ) {
        const handled = await handleBuildCommand({
          channel,
          threadTs: parentThreadTs && parentThreadTs !== event.ts ? parentThreadTs : (event.ts as string),
          userId: event.user as string,
          text: userText,
        });
        if (handled) return NextResponse.json({ ok: true });
      }

      // Thread reply under a #srt-sub bank-statement drop → Vektor controls
      // (N-months trim, name override, rebuild, or a conversational answer).
      // Runs BEFORE the email-submissions funder-forward handler below.
      if (
        parentThreadTs &&
        parentThreadTs !== event.ts &&
        subChannelEnv &&
        channel === subChannelEnv &&
        userText.trim().length > 0
      ) {
        const handled = await handleStatementDropThreadReply({
          channel,
          threadTs: parentThreadTs,
          userId: event.user as string,
          replyText: userText,
        });
        if (handled) return NextResponse.json({ ok: true });
      }

      if (
        parentThreadTs &&
        parentThreadTs !== event.ts &&
        subChannelEnv &&
        channel === subChannelEnv &&
        userText.trim().length > 0
      ) {
        const handled = await handleSubDealThreadReply({
          channel,
          threadTs: parentThreadTs,
          userId: event.user as string,
          replyText: userText,
        });
        if (handled) return NextResponse.json({ ok: true });
      }

      // Thread reply under a suggestion card → send the stored draft. A send-command
      // ("send", "send now", "send it", "go", "yes", 👍) delivers the live draft via
      // the shared send path. This runs through the Events API, so it works even when
      // the app's interactivity (button) URL isn't configured. Any other reply is left
      // alone (falls through to the swallow below) so stray notes typed into the thread
      // never reach the customer.
      if (
        parentThreadTs &&
        parentThreadTs !== event.ts &&
        /^(?:✅\s*)?(?:send(?:\s+(?:it|now))?|go|yes|y|👍)$/i.test(userText.trim())
      ) {
        const { data: pendingDraft } = await supabaseAdmin
          .from("sms_pending_drafts")
          .select("slack_ts")
          .eq("slack_ts", parentThreadTs)
          .maybeSingle();
        if (pendingDraft) {
          await deliverPendingDraft({
            channel,
            slackTs: parentThreadTs,
            userId: event.user as string,
          });
          return NextResponse.json({ ok: true });
        }
      }

      // Matthew typed his OWN reply into a lead conversation channel. A top-level,
      // text-only message becomes a one-tap "Send this?" confirm card (verbatim) so he
      // can reply straight from Slack. Notes (prefixed // or note:), thread replies, and
      // file uploads are still swallowed — they never reach the customer, and never fall
      // through to the AI office manager.
      const smsConv = await lookupSmsConversation(channel);
      if (smsConv && userText.trim().length > 0) {
        const text = userText.trim();
        const isNote = /^(\/\/|note:)/i.test(text);
        const isThreadReply = Boolean(parentThreadTs) && parentThreadTs !== event.ts;
        if (!isNote && !isThreadReply && attachedFiles.length === 0) {
          await postManualSendConfirm({
            channelId: channel,
            conversationId: smsConv.id,
            draft: text,
            leadName: smsConv.leadName,
          });
        }
        return NextResponse.json({ ok: true });
      }

      // Matthew typed in #personal-texts or #lead-texts thread → queue outbound reply
      const personalTextsChannel = process.env.SLACK_PERSONAL_TEXTS_CHANNEL;
      if (personalTextsChannel && channel === personalTextsChannel && parentThreadTs && parentThreadTs !== event.ts && userText.trim().length > 0) {
        await handleMessageReply({
          threadTs: parentThreadTs,
          userId: event.user as string,
          text: userText.trim(),
        });
        return NextResponse.json({ ok: true });
      }

      // #content-full file drops for the workflow session: an AUDIO file becomes the session's
      // song (beat-sync source); images/videos in a workflow session thread become that
      // workflow's REFERENCE creatives (3 refs -> produce the 4th -> in production). Both
      // self-route by content_jobs and fall through when no session claims them.
      if (isContentFullChannel && attachedFiles.length > 0) {
        // Workflow Builder v2 first: a gov2 session claims its song + scene-image drops
        // (v1's song handler rejects builder jobs, so order matters here).
        const builderDropHandled = await handleBuilderFileDrop({
          channel,
          threadTs: parentThreadTs && parentThreadTs !== event.ts ? parentThreadTs : undefined,
          files: attachedFiles,
          text: userText,
        });
        if (builderDropHandled) return NextResponse.json({ ok: true });
        const songHandled = await handleSongAttachment({
          channel,
          threadTs: parentThreadTs && parentThreadTs !== event.ts ? parentThreadTs : undefined,
          files: attachedFiles,
        });
        if (songHandled) return NextResponse.json({ ok: true });
        if (parentThreadTs && parentThreadTs !== event.ts) {
          const refHandled = await handleWorkflowReferenceUpload({
            channel,
            threadTs: parentThreadTs,
            files: attachedFiles,
            text: userText,
          });
          if (refHandled) return NextResponse.json({ ok: true });
        }
      }

      // Reel drop: an image uploaded into a known reel-drop thread takes over the
      // headline flow (scoped by reel_drops lookup) before the content decoder runs.
      if (parentThreadTs && attachedFiles.length > 0) {
        const reelImg = await handleReelImage({ channel, threadTs: parentThreadTs, files: attachedFiles });
        if (reelImg) return NextResponse.json({ ok: true });
      }

      // #content / #content-full: fork to the Viral Video Decoder. Accepts any
      // mix of images + text brief; one call per Slack message (not per file).
      if (isContentChannel || isContentFullChannel) {
        const isThreadReply = Boolean(event.thread_ts) && event.thread_ts !== event.ts;
        const contentThreadTs = (event.thread_ts as string) || (event.ts as string);

        // Instagram reel link (top-level, #content-full) → download, sample frames, Recreate.
        const igMatch = isContentFullChannel && !isThreadReply ? userText.match(INSTAGRAM_URL_RE) : null;
        if (igMatch) {
          waitUntil(
            handleInstagramLink({ channel, threadTs: contentThreadTs, url: igMatch[0] }).catch((e) => {
              console.error("[slack/events] instagram link error:", (e as Error).message);
            })
          );
          return NextResponse.json({ ok: true });
        }

        // "generate POV Pest Control 5 ideas" → rotation-aware numbered format options.
        const ideasMatch = userText.match(/generate\s+pov\s+(.+?)\s+(\d+)\s+ideas?/i);
        if (ideasMatch) {
          const verticalName = ideasMatch[1].trim();
          const count = Math.min(9, Math.max(1, parseInt(ideasMatch[2], 10)));
          waitUntil(
            (async () => {
              const verticalId = await resolveVerticalId(verticalName);
              await handleGenerateIdeas({ channel, threadTs: contentThreadTs, verticalId, count });
            })().catch((e) => console.error("[slack/events] generate ideas error:", (e as Error).message))
          );
          return NextResponse.json({ ok: true });
        }

        // "generate this / generate images / generate only images" → Stage 1 stills
        const genThisMatch = userText.match(/generate\s+(this|images?|only\s+images?)/i);
        if (genThisMatch && isThreadReply) {
          void handleGenerateStills({ channel, threadTs: contentThreadTs }).catch((e) => {
            console.error("[slack/events] generate stills error:", (e as Error).message);
          });
          return NextResponse.json({ ok: true });
        }

        const genMatch = userText.match(/generate\s+(\d+)\s+images?/i);
        if (genMatch && isThreadReply) {
          const count = Math.min(9, Math.max(1, parseInt(genMatch[1], 10)));
          void handleGenerateImages({ channel, threadTs: contentThreadTs, count }).catch((e) => {
            console.error("[slack/events] generate images error:", (e as Error).message);
          });
          return NextResponse.json({ ok: true });
        }

        // "animate" in an existing thread → Stage 2: Seedance + stitch
        if (/^animate$/i.test(userText.trim()) && isThreadReply) {
          void handleAnimateThread({ channel, threadTs: contentThreadTs }).catch((e) => {
            console.error("[slack/events] animate thread error:", (e as Error).message);
          });
          return NextResponse.json({ ok: true });
        }

        // SRT Reel Studio (#content-full): a fresh image post → 4 reel-copy variations;
        // a thread reply → the operator's final 4 boxes → render the branded MP4.
        // Falls back to the Viral Video Decoder when the copy names it (decoder/viral/package).
        // Single front door: the registry keyword router decides intent for ALL
        // #content-full media. Auto-render (decoder image gen) fires ONLY when the
        // operator explicitly asks for a full reel render; everything else either
        // routes to pov-studio (animate/caption/recreate) or builds a package that
        // waits for 👍. This stops a stray reply (e.g. "2") triggering an MCA render.
        const frontDoorIntent = classifyByKeywords(userText);
        const decoderKeyword = /\b(decoder|viral|package)\b/i.test(userText);
        const hasImageFiles = attachedFiles.some((f) => (f.mimetype ?? "").startsWith("image/"));
        const hasVideoFiles = attachedFiles.some((f) => (f.mimetype ?? "").startsWith("video/"));
        if (isContentFullChannel && !decoderKeyword) {
          // A top-level media post (image OR video) in #content-full. With NO caption we
          // ask via the workflow picker; WITH a caption we route to the named workflow
          // (or back to the picker if the caption is ambiguous). waitUntil so Vercel
          // keeps the function alive until the reply posts.
          if (!isThreadReply && (hasImageFiles || hasVideoFiles)) {
            const brief = userText.trim();
            waitUntil(
              (brief.length === 0
                ? handlePovImagePost({ channel, threadTs: contentThreadTs, files: attachedFiles })
                : handlePovMediaWithBrief({ channel, threadTs: contentThreadTs, files: attachedFiles, brief })
              ).catch((e) => {
                console.error("[slack/events] pov media error:", (e as Error).message);
              })
            );
            return NextResponse.json({ ok: true });
          }
          if (isThreadReply && !hasImageFiles && userText.trim().length > 0) {
            const studioReplyHandled = await handleStudioReply({
              channel,
              threadTs: contentThreadTs,
              text: userText,
            });
            if (studioReplyHandled) return NextResponse.json({ ok: true });
          }
        }

        void handleContentDrop({
          channel,
          threadTs: contentThreadTs,
          userId: event.user as string,
          brief: userText,
          files: attachedFiles,
          fullVideo: isContentFullChannel && frontDoorIntent === "render",
          isThreadReply,
        }).catch((e) => {
          console.error("[slack/events] content drop handler error:", (e as Error).message);
        });
        return NextResponse.json({ ok: true });
      }

      // Skip if no text AND no image files (pure file drops without text go to handleFileShared)
      const hasImages = attachedFiles.some((f) => (f.mimetype ?? "").startsWith("image/"));
      if ((!userText || userText.trim().length === 0) && !hasImages) {
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

      // Download any image files attached to the message so Claude can see them
      const imageFiles = attachedFiles.filter((f) => (f.mimetype ?? "").startsWith("image/"));
      let imageBlocks: ImageBlock[] = [];
      if (imageFiles.length > 0) {
        const botToken = process.env.SLACK_BOT_TOKEN || "";
        imageBlocks = (
          await Promise.all(
            imageFiles.map(async (f) => {
              try {
                const url = f.url_private ?? f.url_private_download;
                if (!url) return null;
                const res = await fetch(url, { headers: { Authorization: `Bearer ${botToken}` } });
                if (!res.ok) return null;
                const buf = Buffer.from(await res.arrayBuffer());
                const mediaType = (f.mimetype ?? "image/jpeg").split(";")[0];
                return {
                  type: "image" as const,
                  source: { type: "base64" as const, media_type: mediaType, data: buf.toString("base64") },
                } satisfies ImageBlock;
              } catch {
                return null;
              }
            })
          )
        ).filter((b): b is ImageBlock => b !== null);
      }

      // Run AI — pass images as extra content on the last user message
      const messages = [...history, { role: "user" as const, content: userText || (imageBlocks.length > 0 ? "What do you see in this image?" : "") }];
      const { response, actions } = await runConversationWithTools(messages, systemPrompt, imageBlocks.length > 0 ? imageBlocks : undefined);

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

  if (args.reaction === "+1" || args.reaction === "thumbsup") {
    const { action, error } = await resolvePendingAction({
      slackTs: args.slackTs,
      status: "approved",
      approvedBy: args.userId,
    });
    if (error || !action) {
      console.warn("[slack/events] 👍 approve could not resolve pending action", {
        slackTs: args.slackTs,
        channel: args.channel,
        error,
      });
      await slack.postThreadReply(
        args.channel,
        args.slackTs,
        `⚠️ Could not approve via 👍: ${error ?? "no pending action found"}`
      );
      return;
    }

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
  const isApprove = args.reaction === "white_check_mark";
  const isRegen = args.reaction === "arrows_counterclockwise";
  const isThumbsUp = args.reaction === "+1" || args.reaction === "thumbsup";
  const isKill = args.reaction === "no_entry" || args.reaction === "x";
  const isEdit = args.reaction === "pencil2" || args.reaction === "memo" || args.reaction === "writing_hand";
  const hookIndex = args.reaction === "one" ? 0 : args.reaction === "two" ? 1 : args.reaction === "three" ? 2 : -1;

  console.log(`[events] handleContentReaction reaction=${args.reaction} ts=${args.slackTs} channel=${args.channel}`);

  // --- Hook selection (1️⃣/2️⃣/3️⃣ on the hooks message) ---
  if (hookIndex >= 0) {
    const { data: pkg } = await supabaseAdmin
      .from("content_packages")
      .select("id, slack_thread_ts, package_json, hook_options_json")
      .eq("hooks_message_ts", args.slackTs)
      .maybeSingle();

    if (pkg) {
      const threadTs = pkg.slack_thread_ts as string;
      console.log(`[events] hook selected=${hookIndex} pkg=${pkg.id}`);

      await supabaseAdmin
        .from("content_packages")
        .update({ selected_hook_index: hookIndex })
        .eq("id", pkg.id);

      const hookOptions = pkg.hook_options_json as HookOption[] | null;
      const selectedHook = hookOptions?.[hookIndex] ?? null;

      await slack.postThreadReply(
        args.channel,
        threadTs,
        `✅ Hook ${hookIndex + 1} selected${selectedHook ? ` — *${selectedHook.name}*` : ""}. Generating Slides 1, 2 & 3 now…`
      );

      void startSlideGenerationWithHook(
        pkg.id as string,
        pkg.package_json as Parameters<typeof startSlideGenerationWithHook>[1],
        selectedHook,
        args.channel,
        threadTs
      ).catch((e) => console.error("[events] startSlideGenerationWithHook error:", (e as Error).message));

      return true;
    }
  }

  // --- Stills gate reactions (✅/🔄 on the "stills_pending" approval card) ---
  // hooks_message_ts is reused as the gate message ts in the stills-only flow.
  if (isApprove || isRegen) {
    const { data: stillsPkg } = await supabaseAdmin
      .from("content_packages")
      .select("id, slack_thread_ts, status")
      .eq("hooks_message_ts", args.slackTs)
      .eq("status", "stills_pending")
      .maybeSingle();

    if (stillsPkg) {
      const threadTs = stillsPkg.slack_thread_ts as string;
      console.log(`[events] stills gate reaction=${args.reaction} pkg=${stillsPkg.id}`);
      if (isApprove) {
        void animateAndStitch(stillsPkg.id as string, args.channel, threadTs)
          .catch((e) => console.error("[events] animateAndStitch error:", (e as Error).message));
      } else {
        void regenerateAllStills(stillsPkg.id as string, args.channel, threadTs)
          .catch((e) => console.error("[events] regenerateAllStills error:", (e as Error).message));
      }
      return true;
    }
  }

  // --- Scene-level reactions (✅/🔄 on image or video posts) ---
  if (isApprove || isRegen) {
    const imageScene = await getSceneByImageTs(args.slackTs);
    if (imageScene) {
      const threadTs = await getPackageThreadTs(imageScene.content_package_id as string);
      if (!threadTs) return true;
      console.log(`[events] image reaction=${args.reaction} scene=${imageScene.id} slide=${imageScene.slide_number}`);
      if (isApprove) {
        void approveImageAndStartVideo(imageScene.id as string, args.channel, threadTs)
          .catch((e) => console.error("[events] approveImageAndStartVideo error:", (e as Error).message));
      } else {
        void regenerateImage(imageScene.id as string, args.channel, threadTs)
          .catch((e) => console.error("[events] regenerateImage error:", (e as Error).message));
      }
      return true;
    }

    const videoScene = await getSceneByVideoTs(args.slackTs);
    if (videoScene) {
      const threadTs = await getPackageThreadTs(videoScene.content_package_id as string);
      if (!threadTs) return true;
      console.log(`[events] video reaction=${args.reaction} scene=${videoScene.id} slide=${videoScene.slide_number}`);
      if (isApprove) {
        void approveVideoAndAdvance(
          videoScene.id as string,
          videoScene.content_package_id as string,
          args.channel,
          threadTs
        ).catch((e) => console.error("[events] approveVideoAndAdvance error:", (e as Error).message));
      } else {
        void regenerateVideo(videoScene.id as string, args.channel, threadTs)
          .catch((e) => console.error("[events] regenerateVideo error:", (e as Error).message));
      }
      return true;
    }
  }

  // --- Package-level reactions (👍 kill ✏️ on the package card) ---
  const { data: pkg } = await supabaseAdmin
    .from("content_packages")
    .select("id, status, slack_channel, slack_thread_ts, package_json")
    .eq("slack_package_ts", args.slackTs)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!pkg) return false;

  if (!isThumbsUp && !isKill && !isEdit) return false;

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
    await supabaseAdmin.from("content_packages").update({ status: "regenerating" }).eq("id", pkg.id);
    await slack.postThreadReply(
      args.channel,
      pkg.slack_thread_ts as string,
      `✏️ Reply in this thread with what to change and I'll rebuild.`
    );
    return true;
  }

  // 👍 on package — mark approved and generate 3 hook options before any images
  await supabaseAdmin
    .from("content_packages")
    .update({ status: "approved", resolved_at: new Date().toISOString() })
    .eq("id", pkg.id);

  await slack.postThreadReply(
    args.channel,
    pkg.slack_thread_ts as string,
    `👍 Approved — generating 3 hook options…`
  );

  void generateAndPostHooks(
    pkg.id as string,
    pkg.package_json as Parameters<typeof generateAndPostHooks>[1],
    args.channel,
    pkg.slack_thread_ts as string
  ).catch((e) => console.error("[events] generateAndPostHooks error:", (e as Error).message));

  return true;
}

export type { HookOption } from "@/lib/content-types";

async function generateAndPostHooks(
  pkgId: string,
  packageJson: { concept_summary?: string; target_persona?: string; slides?: Array<{ n: number; image_prompt: string }> },
  channel: string,
  threadTs: string
): Promise<void> {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const slide2Prompt = packageJson.slides?.find((s) => s.n === 2)?.image_prompt ?? "";

  const msg = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `You are a viral short-form video strategist for SRT Agency, a business funding broker.

Generate 3 distinct hook options for this video. Each hook is a combination of:
1. Slide 1 (wide compelling visual — NO faces, extreme close-up of the avatar's world, stops the scroll)
2. Slide 2 (the specific avatar in their environment — full shot, authentic setting)

Concept: ${packageJson.concept_summary ?? "business funding story"}
Avatar: ${packageJson.target_persona ?? "small business owner"}

Return ONLY valid JSON, no preamble:
{
  "hooks": [
    {
      "name": "short hook name (3-5 words)",
      "slide1_image_prompt": "Extreme close-up photorealistic 9:16 vertical. [specific object from avatar's world that signals the problem — no people]. Ultra-detailed, cinematic lighting.",
      "slide1_text_overlay": "Bold 6-10 word hook text that creates a curiosity gap",
      "slide2_image_prompt": "Full shot photorealistic 9:16 vertical. [avatar — specific age/appearance/setting]. Natural light, authentic, not staged."
    }
  ]
}`,
      },
    ],
  });

  let hooks: HookOption[] = [];
  try {
    const raw = ((msg.content[0] as { type: string; text: string }).text ?? "").trim();
    const json = raw.startsWith("{") ? raw : raw.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1]?.trim() ?? raw;
    hooks = (JSON.parse(json) as { hooks: HookOption[] }).hooks.slice(0, 3);
  } catch (e) {
    console.error("[events] hook generation parse failed:", (e as Error).message);
    await slack.postThreadReply(channel, threadTs, "⚠️ Hook generation failed — react 👍 again to retry.");
    return;
  }

  const lines = hooks.map((h, i) => {
    const num = i === 0 ? "1️⃣" : i === 1 ? "2️⃣" : "3️⃣";
    return `${num} *${h.name}*\n> Slide 1: ${h.slide1_text_overlay}\n> Visual: ${h.slide1_image_prompt.slice(0, 120)}…`;
  });

  const hooksText = `🎣 *3 Hook Options — react 1️⃣ 2️⃣ or 3️⃣ to choose:*\n\n${lines.join("\n\n")}`;
  const hooksRes = await slack.postThreadReply(channel, threadTs, hooksText);
  const hooksTs = hooksRes.ts as string | undefined;

  await supabaseAdmin
    .from("content_packages")
    .update({ hook_options_json: hooks, hooks_message_ts: hooksTs ?? null })
    .eq("id", pkgId);

  console.log(`[events] hooks posted pkg=${pkgId} ts=${hooksTs}`);
}

async function getPackageThreadTs(pkgId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("content_packages")
    .select("slack_thread_ts")
    .eq("id", pkgId)
    .maybeSingle();
  return (data?.slack_thread_ts as string | null) ?? null;
}

// Stage 1: Generate 3 OpenAI stills for the decoded package in this thread.
async function handleGenerateStills(args: { channel: string; threadTs: string }): Promise<void> {
  const { data: pkg } = await supabaseAdmin
    .from("content_packages")
    .select("id")
    .eq("slack_thread_ts", args.threadTs)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!pkg) {
    await slack.postThreadReply(
      args.channel,
      args.threadTs,
      "No script found in this thread — drop images + brief first to decode it."
    );
    return;
  }

  await startStillsGeneration(pkg.id as string, args.channel, args.threadTs);
}

// Stage 2: Animate all stills in this thread's package with Seedance + stitch.
async function handleAnimateThread(args: { channel: string; threadTs: string }): Promise<void> {
  const { data: pkg } = await supabaseAdmin
    .from("content_packages")
    .select("id, status")
    .eq("slack_thread_ts", args.threadTs)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!pkg) {
    await slack.postThreadReply(
      args.channel,
      args.threadTs,
      "⚠️ No package found in this thread."
    );
    return;
  }

  if (pkg.status !== "stills_pending") {
    await slack.postThreadReply(
      args.channel,
      args.threadTs,
      `_(animate ignored — package status is \`${pkg.status}\`, not \`stills_pending\`)_`
    );
    return;
  }

  await animateAndStitch(pkg.id as string, args.channel, args.threadTs);
}

// Fires image generation for the first N slides of an existing decoded package
// in the current thread. Seeds content_scenes if not already done.
async function handleGenerateImages(args: {
  channel: string;
  threadTs: string;
  count: number;
}): Promise<void> {
  const { data: pkg } = await supabaseAdmin
    .from("content_packages")
    .select("id, package_json")
    .eq("slack_thread_ts", args.threadTs)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!pkg) {
    await slack.postThreadReply(
      args.channel,
      args.threadTs,
      "No script found in this thread — drop images + brief first to decode it."
    );
    return;
  }

  const pkgId = pkg.id as string;
  const packageJson = pkg.package_json as {
    slides: Array<{ n: number; image_prompt: string; animation_prompt?: string; duration_seconds?: number }>;
  };

  // Seed content_scenes if they don't exist yet (hook selection was skipped)
  const { count: existing } = await supabaseAdmin
    .from("content_scenes")
    .select("id", { count: "exact", head: true })
    .eq("content_package_id", pkgId);

  if (!existing || existing === 0) {
    const rows = (packageJson.slides ?? []).map((slide) => ({
      content_package_id: pkgId,
      slide_number: slide.n,
      image_prompt: slide.image_prompt,
      animation_prompt: slide.animation_prompt ?? "",
      duration_seconds: slide.duration_seconds ?? 2,
    }));
    await supabaseAdmin
      .from("content_scenes")
      .upsert(rows, { onConflict: "content_package_id,slide_number" });
  }

  const n = Math.min(args.count, packageJson.slides?.length ?? args.count);
  await slack.postThreadReply(
    args.channel,
    args.threadTs,
    `🎨 Generating ${n} image${n !== 1 ? "s" : ""}…`
  );

  await Promise.all(
    Array.from({ length: n }, (_, i) =>
      generateAndPostImage(pkgId, i + 1, args.channel, args.threadTs)
    )
  );
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
      "👋 Just drop the image or video you want to work from. I'll read it and suggest the formats and workflows that fit, no brief needed. Add a note only if you want to steer it."
    );
    return;
  }

  await slack.postThreadReply(
    args.channel,
    args.threadTs,
    parentPackageId
      ? `✏️ Rebuilding with your feedback…`
      : args.fullVideo
      ? `🎬 Got it. Decoding the script and auto-generating the full reel now (~20-30s).`
      : `📝 Got it. Writing the production package (caption, VO, 9 image/animation prompts, timeline, music) (~20s).`
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
        auto_render: args.fullVideo,
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

// Thread-reply handler for deal threads with a pending send_submission card.
// Parses lender names, edits the pending payload with lender_ids, resolves
// the action as approved, and fires submit-to-lenders via executePendingAction.
// Returns true if the reply was consumed as a lender list (even on parse
// failure) so the outer AI-agent branch doesn't also respond.
async function handleDealThreadReply(args: {
  channel: string;
  threadTs: string;
  userId: string;
  replyText: string;
}): Promise<boolean> {
  const { data: deal } = await supabaseAdmin
    .from("deals")
    .select("id")
    .eq("slack_thread_ts", args.threadTs)
    .maybeSingle();
  if (!deal) return false;

  const { data: pending } = await supabaseAdmin
    .from("pending_slack_actions")
    .select("id, slack_ts, slack_channel, payload")
    .eq("action_type", "send_submission")
    .eq("status", "pending")
    .eq("payload->>deal_id", deal.id as string)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!pending) return false;

  const choice = await parseLenderChoicesFromReply(args.replyText);
  if (choice.lender_ids.length === 0) {
    await slack.postEphemeral(
      args.channel,
      args.userId,
      `Couldn't match any lender from "${args.replyText.slice(0, 120)}". Try: \`Forward Financing, Credibly\` or \`Tier 1 only\` — optionally add \`/ note: client note here\`.`,
    );
    return true;
  }

  const currentPayload = (pending.payload as PendingActionPayload) ?? {};
  const editedPayload: PendingActionPayload = {
    ...currentPayload,
    lender_ids: choice.lender_ids,
    ...(choice.note ? { client_note: choice.note } : {}),
  } as PendingActionPayload & { client_note?: string };

  const { action, error } = await resolvePendingAction({
    slackTs: pending.slack_ts as string,
    status: "approved",
    approvedBy: args.userId,
    editedPayload,
  });
  if (error || !action) {
    await slack.postEphemeral(args.channel, args.userId, `Couldn't resolve send: ${error ?? "unknown"}`);
    return true;
  }

  await slack.postThreadReply(
    args.channel,
    args.threadTs,
    `📤 Sending to: ${choice.matched_names.join(", ")}${choice.unmatched.length ? ` _(unmatched: ${choice.unmatched.join(", ")})_` : ""}`,
  );

  const result = await executePendingAction({
    actionId: action.id,
    actionType: action.action_type,
    payload: action.payload,
    approvedBy: args.userId,
  });

  const channelId = result.details?.channel_id as string | undefined;
  const summary = result.ok
    ? `Sent to ${(result.details?.sent as string[] | undefined)?.length ?? 0} lender(s)${
        channelId ? ` — channel: <#${channelId}>` : ""
      }`
    : `Send failed: ${result.error ?? "unknown"}`;

  await postExecutionReceipt({
    channel: args.channel,
    threadTs: pending.slack_ts as string,
    summary,
    success: result.ok,
  });
  return true;
}

// Reply under a "New Deal" parent message in #srt-sub: parse funder names and
// forward the verbatim package to each. Returns true if this thread is a tracked
// email_submissions deal (so the caller stops before the AI agent answers).
/**
 * Pull raw email addresses out of a thread reply, splitting To vs CC: everything after a
 * `cc` marker (e.g. "… and cc jane@lender.com") goes to CC. Used for the ad-hoc "email this
 * to X" flow so Matthew can forward a deal to addresses that aren't seeded lenders.
 */
function parseAddressesFromText(text: string): { to: string[]; cc: string[] } {
  // Slack auto-linkifies emails to <mailto:addr|display>. Unwrap those first so we capture the
  // bare address, not the whole "mailto:addr|display" blob (which Graph rejects as invalid).
  const unwrapped = text.replace(/<mailto:([^|>]+)(?:\|[^>]*)?>/gi, "$1");
  // Exclude : and | too, so any stray "mailto:" prefix or "|display" suffix can't bleed in.
  const emailRe = /[^\s,;<>()"|:]+@[^\s,;<>()"|:]+\.[^\s,;<>()"|:]+/g;
  const norm = (arr: string[]) =>
    Array.from(new Set(arr.map((e) => e.replace(/^mailto:/i, "").replace(/[.,;:]+$/, "").toLowerCase()).filter(Boolean)));
  const ccIdx = unwrapped.search(/\bcc\b[:\s]/i);
  const toPart = ccIdx >= 0 ? unwrapped.slice(0, ccIdx) : unwrapped;
  const ccPart = ccIdx >= 0 ? unwrapped.slice(ccIdx) : "";
  const to = norm(toPart.match(emailRe) ?? []);
  const cc = norm(ccPart.match(emailRe) ?? []).filter((e) => !to.includes(e));
  return { to, cc };
}

async function handleSubDealThreadReply(args: {
  channel: string;
  threadTs: string;
  userId: string;
  replyText: string;
}): Promise<boolean> {
  const submission = await getEmailSubmissionByThread(args.threadTs);
  if (!submission) return false;

  const affirmative = /^\s*(go|yes|all|send(\s+(it|them))?(\s+all)?|ship\s+it)\s*$/i.test(args.replyText.trim());

  // Ad-hoc "email this to bob@lender.com and cc jane@lender.com" → stage + confirm, don't send yet.
  const { to: adhocTo, cc: adhocCc } = parseAddressesFromText(args.replyText);
  if (adhocTo.length > 0) {
    await setPendingAdhocForward(submission.id, adhocTo, adhocCc);
    const ccNote = adhocCc.length ? ` · CC ${adhocCc.join(", ")}` : "";
    await slack.postThreadReply(
      args.channel,
      args.threadTs,
      `📧 Send *${submission.business_name}* to: ${adhocTo.join(", ")}${ccNote}?\nReply \`go\` to send.`,
    );
    return true;
  }

  // `go` with a staged ad-hoc target → forward to those raw addresses (takes precedence over suggested funders).
  if (affirmative && (submission.pending_adhoc_to?.length ?? 0) > 0) {
    const to = submission.pending_adhoc_to!;
    const cc = submission.pending_adhoc_cc ?? [];
    const ccNote = cc.length ? ` · CC ${cc.join(", ")}` : "";
    await slack.postThreadReply(args.channel, args.threadTs, `📤 Forwarding *${submission.business_name}* to: ${to.join(", ")}${ccNote}`);
    const result = await forwardDealToAddresses({ emailSubmissionId: submission.id, to, cc });
    await clearPendingAdhocForward(submission.id);
    if (!result.ok) {
      await slack.postThreadReply(args.channel, args.threadTs, `⚠️ Forward failed: ${result.error ?? "unknown"}`);
    }
    return true;
  }

  const choice = await parseLenderChoicesFromReply(args.replyText);
  let lenderIds = choice.lender_ids;
  let forwardLabel = `${choice.matched_names.join(", ")}${
    choice.unmatched.length ? ` _(unmatched: ${choice.unmatched.join(", ")})_` : ""
  }`;

  // `go` / `all` / `yes` with no explicit funders → forward to the funders the bot suggested.
  if (lenderIds.length === 0 && affirmative && (submission.suggested_lender_ids?.length ?? 0) > 0) {
    lenderIds = submission.suggested_lender_ids!;
    forwardLabel = `${lenderIds.length} suggested funder(s)`;
  }

  if (lenderIds.length === 0) {
    await slack.postEphemeral(
      args.channel,
      args.userId,
      `Couldn't match any funder from "${args.replyText.slice(0, 120)}". Reply \`go\` to send all suggested, name funders like \`Legend, Fundbox\` / \`Tier 1 only\`, or email a raw address like \`email this to bob@lender.com and cc jane@lender.com\`.`,
    );
    return true;
  }

  await slack.postThreadReply(
    args.channel,
    args.threadTs,
    `📤 Forwarding *${submission.business_name}* to: ${forwardLabel}`,
  );

  const result = await forwardDealToFunders({
    emailSubmissionId: submission.id,
    lenderIds,
  });

  if (!result.ok && result.sent.length === 0) {
    await slack.postThreadReply(args.channel, args.threadTs, `⚠️ Forward failed: ${result.error ?? "unknown"}`);
  }
  return true;
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

  const allShareChannels = Object.keys({
    ...(file.shares?.public ?? {}),
    ...(file.shares?.private ?? {}),
  });
  // Files in the two dedicated lanes are handled entirely by the message event
  // (drop-studio / workflow-agent); nothing in this handler may claim them.
  if (
    allShareChannels.some(
      (ch) => ch === VEKTOR_CHANNELS.aiContentPestControl || ch === VEKTOR_CHANNELS.agentWorkflowCreator
    )
  ) {
    return;
  }
  const isInContentChannel = allShareChannels.some(
    (ch) => ch === VEKTOR_CHANNELS.content || ch === VEKTOR_CHANNELS.contentFull
  );
  const mimeType = file.mimetype ?? "";
  const isAudio =
    mimeType.startsWith("audio/") ||
    file.filetype === "mp4a" ||
    file.filetype === "voice-message" ||
    mimeType === "video/mp4a-latm";

  // Voice note in a content channel → strip silence + convert to Sofia's voice
  if (isAudio && isInContentChannel) {
    void handleSofiaVoiceConversion(file).catch((e) =>
      console.error("[slack/events] sofia voice conversion error:", (e as Error).message)
    );
    return;
  }

  // Video dropped in #content-analyzer → read it shot-by-shot (storyboard + pest remake).
  const analyzerChannel = VEKTOR_CHANNELS.contentAnalyzer;
  const isVideo =
    mimeType.startsWith("video/") || file.filetype === "mp4" || file.filetype === "mov";
  if (analyzerChannel && isVideo) {
    const shares: Record<string, Array<{ thread_ts?: string; ts?: string }>> = {
      ...(file.shares?.public ?? {}),
      ...(file.shares?.private ?? {}),
    };
    const share = (shares[analyzerChannel] ?? [])[0];
    if (share) {
      // A top-level video post has no thread_ts; reply under the post itself (ts).
      const threadTs = share.thread_ts ?? share.ts;
      if (threadTs && file.url_private_download) {
        // v3: ask scrub-or-reference first (📚 save reference / 🧪 scrub into a workflow).
        void postVideoDecisionCard({ channel: analyzerChannel, threadTs, file }).catch((e) =>
          console.error("[slack/events] content-analyzer decision card error:", (e as Error).message)
        );
      }
      return;
    }
  }

  // Still image dropped in #content-analyzer → save it as a realism reference in the library.
  const isImage = mimeType.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "gif"].includes(file.filetype ?? "");
  if (analyzerChannel && isImage) {
    const shares: Record<string, Array<{ thread_ts?: string; ts?: string }>> = {
      ...(file.shares?.public ?? {}),
      ...(file.shares?.private ?? {}),
    };
    const share = (shares[analyzerChannel] ?? [])[0];
    if (share) {
      const threadTs = share.thread_ts ?? share.ts;
      if (threadTs && file.url_private_download) {
        void analyzeReferenceImage({ channel: analyzerChannel, threadTs, file }).catch((e) =>
          console.error("[slack/events] content-analyzer image error:", (e as Error).message)
        );
      }
      return;
    }
  }

  // Avatar kit (PDF or .docx) dropped in #content-analyzer → distill it into a vertical and
  // build its content calendar. Fire a non-blocking POST to the ingest endpoint (its own 300s
  // timeout) so the slow distill/generate work doesn't run in this short-lived function.
  const isDocx =
    mimeType.includes("wordprocessingml") || file.filetype === "docx" || /\.docx$/i.test(file.name ?? "");
  if (analyzerChannel && (mimeType === "application/pdf" || isDocx)) {
    const shares: Record<string, Array<{ thread_ts?: string; ts?: string }>> = {
      ...(file.shares?.public ?? {}),
      ...(file.shares?.private ?? {}),
    };
    const share = (shares[analyzerChannel] ?? [])[0];
    if (share && file.url_private_download) {
      const threadTs = share.thread_ts ?? share.ts;
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
      // v3: a kit only ingests when a NEW avatar has been named first, so a stray PDF never
      // overwrites an existing avatar (ingest defaults to pest_control otherwise).
      const pending = await pendingNewAvatar(analyzerChannel);
      if (!pending) {
        if (threadTs) {
          await slack
            .postThreadReply(
              analyzerChannel,
              threadTs,
              "Type `new avatar <id> <Name>` here first so I know which avatar this kit builds. I will not overwrite an existing avatar."
            )
            .catch(() => {});
        }
        return;
      }
      try {
        await fetch(`${appUrl}/api/content/ingest-avatar`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            vertical: { id: pending.id, name: pending.name },
            slack_file: {
              url_private_download: file.url_private_download,
              name: file.name,
              mimetype: file.mimetype,
              channel: analyzerChannel,
              thread_ts: threadTs,
            },
          }),
        });
        await consumePendingNewAvatar(pending.jobId);
      } catch (e) {
        console.error("[slack/events] ingest-avatar dispatch error:", (e as Error).message);
      }
      return;
    }
  }

  if (mimeType !== "application/pdf") {
    console.log("[slack/events] skipping non-PDF file:", mimeType, file.name);
    return;
  }

  // If a PDF landed in a content channel, the message-event branch already fired the decoder.
  if (isInContentChannel) {
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

  // Allow PDFs dropped outside a known deal thread — the bank-statements route
  // will try to match by merchant name extracted from the analysis, and will
  // post back into this same thread if no deal is found.
  const dealId = deal ? (deal.id as string) : null;
  const merchantName = deal
    ? (
        (deal as { contacts?: { business_name?: string } | null }).contacts?.business_name ?? "Merchant"
      ).trim()
    : null;

  if (!file.url_private_download) {
    console.error("[slack/events] no url_private_download on file", file.id);
    return;
  }
  const buffer = await slack.downloadFile(file.url_private_download);
  const fileName = file.name ?? `document-${Date.now()}.pdf`;

  // Application PDFs are routed to a separate extractor — they contain merchant form data,
  // not bank transaction history. Detect by filename keywords.
  const isApplicationPDF = /\b(application|merchant[\s_-]?app|mca[\s_-]?app)\b/i.test(fileName);
  if (isApplicationPDF) {
    await extractApplicationPDF(buffer, fileName, channelId, threadTs, dealId, merchantName);
    return;
  }

  // Use known merchant folder if we have a deal, otherwise temp staging folder
  const folderBase = merchantName ? `Deals/${merchantName}/Bank Statements` : "Deals/_Inbox/Bank Statements";
  let driveItemId: string | null = null;
  let driveWebUrl: string | null = null;
  try {
    const parentFolder = merchantName ? `Deals/${merchantName}` : "Deals/_Inbox";
    await microsoft.createDriveFolder("Bank Statements", parentFolder).catch(() => {});
    const uploaded = await microsoft.uploadDriveFile(folderBase, fileName, buffer, "application/pdf");
    driveItemId = uploaded.id;
    driveWebUrl = uploaded.webUrl;
    await slack.postThreadReply(channelId, threadTs, `📥 Saved \`${fileName}\` to OneDrive — analyzing…`);
  } catch (e) {
    console.error("[slack/events] OneDrive upload failed:", (e as Error).message);
    await slack.postThreadReply(channelId, threadTs, `⚠️ OneDrive upload failed: ${(e as Error).message}. Analyzing from Slack only.`);
  }

  const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const analyzeBody: Record<string, unknown> = {
    source: "slack_drop",
    onedrive_folder_url: driveWebUrl,
    slack_channel: channelId,
    slack_thread_ts: threadTs,
  };
  if (dealId) analyzeBody.deal_id = dealId;
  else if (merchantName) analyzeBody.merchant_name = merchantName;
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

// Application PDF dropped into a deal thread → extract merchant form fields → post structured card.
async function extractApplicationPDF(
  buffer: Buffer,
  fileName: string,
  channelId: string,
  threadTs: string,
  dealId: string | null,
  merchantName: string | null
): Promise<void> {
  await slack.postThreadReply(channelId, threadTs, `📋 Application PDF detected — extracting fields from \`${fileName}\`…`);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    await slack.postThreadReply(channelId, threadTs, "⚠️ ANTHROPIC_API_KEY not set — cannot extract application data.");
    return;
  }

  interface AppData {
    business_name: string | null;
    owner_name: string | null;
    ein: string | null;
    ssn_last4: string | null;
    monthly_revenue: string | null;
    credit_score: string | null;
    time_in_business: string | null;
    funding_requested: string | null;
    existing_advances: string | null;
    industry: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
  }

  try {
    const base64 = buffer.toString("base64");

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system: `You are extracting data from an MCA (merchant cash advance) application PDF. Return ONLY valid JSON matching this exact schema — null for any field you cannot find:
{
  "business_name": string | null,
  "owner_name": string | null,
  "ein": string | null,
  "ssn_last4": string | null,
  "monthly_revenue": string | null,
  "credit_score": string | null,
  "time_in_business": string | null,
  "funding_requested": string | null,
  "existing_advances": string | null,
  "industry": string | null,
  "address": string | null,
  "phone": string | null,
  "email": string | null
}
For SSN: extract ONLY the last 4 digits for privacy. No preamble, no markdown.`,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: { type: "base64", media_type: "application/pdf", data: base64 },
              },
              { type: "text", text: "Extract all merchant application fields from this PDF." },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      await slack.postThreadReply(channelId, threadTs, `⚠️ Claude extraction failed (${res.status}): ${errText.slice(0, 200)}`);
      return;
    }

    const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const raw = json.content?.find((b) => b.type === "text")?.text ?? "{}";
    let data: AppData;
    try {
      data = JSON.parse(raw) as AppData;
    } catch {
      await slack.postThreadReply(channelId, threadTs, `⚠️ Could not parse extraction result:\n\`\`\`\n${raw.slice(0, 400)}\n\`\`\``);
      return;
    }

    const lines = [
      `📋 *Application Data — \`${fileName}\`*`,
      data.business_name ? `*Business:* ${data.business_name}` : null,
      data.owner_name ? `*Owner:* ${data.owner_name}` : null,
      data.ein ? `*EIN:* ${data.ein}` : null,
      data.ssn_last4 ? `*SSN (last 4):* ****${data.ssn_last4}` : null,
      data.phone ? `*Phone:* ${data.phone}` : null,
      data.email ? `*Email:* ${data.email}` : null,
      data.industry ? `*Industry:* ${data.industry}` : null,
      data.address ? `*Address:* ${data.address}` : null,
      data.time_in_business ? `*Time in Business:* ${data.time_in_business}` : null,
      data.monthly_revenue ? `*Monthly Revenue:* ${data.monthly_revenue}` : null,
      data.credit_score ? `*Credit Score:* ${data.credit_score}` : null,
      data.funding_requested ? `*Funding Requested:* ${data.funding_requested}` : null,
      data.existing_advances ? `*Existing Advances:* ${data.existing_advances}` : null,
      dealId ? `\n_Deal ID: ${dealId}_` : (merchantName ? `\n_Merchant: ${merchantName}_` : null),
      `\n_Review and confirm before updating the CRM._`,
    ].filter(Boolean);

    await slack.postThreadReply(channelId, threadTs, lines.join("\n"));
  } catch (err) {
    await slack.postThreadReply(channelId, threadTs, `⚠️ Application extraction error: ${(err as Error).message}`);
  }
}

// Voice note dropped in a content thread → strip silence → convert to Sofia's voice → post back.
async function handleSofiaVoiceConversion(file: SlackFileInfo): Promise<void> {
  const allShares: Record<string, Array<{ thread_ts?: string; ts?: string }>> = {
    ...(file.shares?.public ?? {}),
    ...(file.shares?.private ?? {}),
  };

  // Find which content channel + thread this was dropped into
  let channelId: string | null = null;
  let threadTs: string | null = null;
  for (const [ch, arr] of Object.entries(allShares)) {
    if (ch !== VEKTOR_CHANNELS.content && ch !== VEKTOR_CHANNELS.contentFull) continue;
    for (const share of arr ?? []) {
      if (share.thread_ts) {
        channelId = ch;
        threadTs = share.thread_ts;
        break;
      }
    }
    if (channelId) break;
  }

  if (!channelId || !threadTs) {
    console.log("[slack/events] sofia voice: no content thread context found");
    return;
  }

  if (!file.url_private_download) {
    console.error("[slack/events] sofia voice: no url_private_download on file", file.id);
    return;
  }

  console.log(`[slack/events] sofia voice: processing voice note in channel=${channelId} thread=${threadTs}`);
  await slack.postThreadReply(
    channelId,
    threadTs,
    "🎙️ Voice note received — stripping silence and applying Sofia's voice…"
  );

  try {
    const rawBuffer = await slack.downloadFile(file.url_private_download);
    const trimmedBuffer = await stripSilence(rawBuffer);
    const sofiaBuffer = await sofiaVoiceConvert(trimmedBuffer);

    await slack.uploadFile(channelId, "sofia-voiceover.mp3", sofiaBuffer, "audio/mpeg", threadTs);
    await slack.postThreadReply(
      channelId,
      threadTs,
      "🎙️ Sofia voiceover ready — silence stripped and voice converted."
    );

    // Best-effort: mark sofia_voiceover_url on the package for this thread
    await supabaseAdmin
      .from("content_packages")
      .update({ sofia_voiceover_url: "slack_uploaded" })
      .eq("slack_channel", channelId)
      .eq("slack_thread_ts", threadTs)
      .eq("status", "rendered");
  } catch (err) {
    const errMsg = (err as Error).message;
    console.error("[slack/events] sofia voice conversion failed:", errMsg);
    await slack.postThreadReply(
      channelId,
      threadTs,
      `⚠️ Voice conversion failed: ${errMsg.slice(0, 200)}`
    );
  }
}

// ── SMS Channel Helpers ───────────────────────────────────────────────────

// Resolve an #sms-* channel to its conversation id + lead display name, or null if
// the channel isn't a lead SMS conversation. Name resolution mirrors the inbound
// handler: "First Last" → business name → fallback.
async function lookupSmsConversation(
  channelId: string
): Promise<{ id: string; leadName: string } | null> {
  const { data: conv } = await supabaseAdmin
    .from("sms_conversations")
    .select("id, contact_id")
    .eq("slack_channel_id", channelId)
    .maybeSingle();
  if (!conv?.id) return null;

  let leadName = "this lead";
  if (conv.contact_id) {
    const { data: contact } = await supabaseAdmin
      .from("contacts")
      .select("first_name, last_name, business_name")
      .eq("id", conv.contact_id as string)
      .maybeSingle();
    if (contact) {
      leadName =
        [contact.first_name, contact.last_name].filter(Boolean).join(" ") ||
        (contact.business_name as string | null) ||
        leadName;
    }
  }
  return { id: conv.id as string, leadName };
}

// Matthew replied in a message thread → look up the originating channel
// (imessage or ringcentral) from the unified messages table and enqueue an outbound reply.
async function handleMessageReply(args: {
  threadTs: string;
  userId: string;
  text: string;
}): Promise<void> {
  const matthewId = process.env.MATTHEW_SLACK_USER_ID ?? "";
  if (matthewId && args.userId !== matthewId) return;

  // Find the originating inbound message by its Slack thread timestamp
  const { data: originalMsg } = await supabaseAdmin
    .from("messages")
    .select("from_address, channel")
    .eq("slack_ts", args.threadTs)
    .eq("direction", "inbound")
    .maybeSingle();

  if (!originalMsg?.from_address) {
    console.warn("[message-reply] no matching messages row for thread_ts", args.threadTs);
    return;
  }

  // Enqueue in the unified outbound_queue; channel determines which transport fires
  await supabaseAdmin.from("outbound_queue").insert({
    channel: originalMsg.channel,
    to_address: originalMsg.from_address as string,
    body: args.text,
    status: "pending",
    slack_thread_ts: args.threadTs,
  });
}

// ─── Code Guardian ───────────────────────────────────────────────────────────

async function handleGuardianReaction(args: {
  reaction: string;
  slackTs: string;
  channel: string;
  userId: string;
}): Promise<boolean> {
  const { reaction, slackTs, channel, userId } = args;
  if (reaction !== "white_check_mark" && reaction !== "pencil" && reaction !== "x" && reaction !== "no_entry") {
    return false;
  }

  const { data: fix } = await supabaseAdmin
    .from("code_guardian_fixes")
    .select("id, status, fix_payload, workflow_name")
    .eq("slack_ts", slackTs)
    .maybeSingle();

  if (!fix) return false;

  if (reaction === "white_check_mark") {
    if (fix.status !== "pending") {
      await slack.postThreadReply(channel, slackTs, `⚠️ Fix already ${fix.status as string}.`);
      return true;
    }
    // Delegate to apply-fix endpoint (runs async, keeps event handler fast)
    void fetch(`${process.env.NEXT_PUBLIC_BASE_URL ?? "https://mission.srtagency.com"}/api/code-guardian/apply-fix`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.CRON_SECRET ?? ""}`,
      },
      body: JSON.stringify({ slack_ts: slackTs, applied_by: userId }),
    }).catch((e) => console.error("[guardian] apply-fix fetch error:", (e as Error).message));

    await slack.postThreadReply(channel, slackTs, `⏳ Applying fix, opening PR…`);
    return true;
  }

  if (reaction === "pencil") {
    await supabaseAdmin
      .from("code_guardian_fixes")
      .update({ status: "pending", updated_at: new Date().toISOString() })
      .eq("slack_ts", slackTs);
    await slack.postThreadReply(
      channel,
      slackTs,
      `✏️ Revision requested. Reply in this thread describing what to change and I'll re-analyze.`
    );
    return true;
  }

  if (reaction === "x" || reaction === "no_entry") {
    await supabaseAdmin
      .from("code_guardian_fixes")
      .update({ status: "skipped", updated_at: new Date().toISOString() })
      .eq("slack_ts", slackTs);
    await slack.postThreadReply(channel, slackTs, `🚫 Skipped by <@${userId}>.`);
    return true;
  }

  return false;
}

async function handleGuardianThreadMessage(args: {
  channel: string;
  threadTs: string;
  userId: string;
  text: string;
}): Promise<void> {
  const { channel, threadTs, userId, text } = args;

  const { data: fix } = await supabaseAdmin
    .from("code_guardian_fixes")
    .select("fix_payload, workflow_name")
    .eq("slack_ts", threadTs)
    .maybeSingle();

  let replyText: string;

  if (fix?.fix_payload) {
    const { answerGuardianQuestion } = await import("@/lib/code-guardian/analyzer");
    const payload = fix.fix_payload as { analysis: import("@/lib/code-guardian/analyzer").GuardianAnalysis };
    replyText = await answerGuardianQuestion({
      question: text,
      originalAnalysis: payload.analysis,
      workflowName: (fix.workflow_name as string) ?? "Unknown",
    });
  } else {
    replyText = `No fix record found for this thread. Please re-trigger the guardian or ask in <#${channel}>.`;
  }

  await slack.postThreadReply(channel, threadTs, `🛡️ ${replyText}`);
}
