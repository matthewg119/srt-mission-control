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
import { handleScraperEvent, handleScraperReaction, scraperChannel } from "@/lib/scraper/lane";
import {
  clientForThread,
  captureOnboardingFile,
  attributePresenceDoc,
} from "@/lib/clients/onboarding-docs";
import { isVoiceNote, handleClientVoiceNote } from "@/lib/clients/voice-notes";
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
  handleDropQuotes,
} from "@/lib/reel/drop-studio";
import {
  handleHookStudioStart,
  handleHookStudioReply,
  handleHookStudioReaction,
  handleHookStudioFileDrop,
} from "@/lib/reel/hook-studio";
import { startWebinarDeck } from "@/lib/deck/webinar-lane";
import { isWebinarTrigger } from "@/lib/deck/extract";
import {
  chatTrigger,
  handleBrainheartChatStart,
  handleBrainheartChatReply,
  handleBrainheartChatFileNote,
} from "@/lib/reel/brainheart-chat";
import { handleReferenceAskFileDrop, handleReferenceAskReply } from "@/lib/reel/reference-ask";
import { handleBrollVoiceoverReply } from "@/lib/reel/broll-voiceover";
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
import { resolveDropVertical, dropWorkflowLibraryId } from "@/config/verticals";
import { classifyByKeywords } from "@/config/content-workflows";
import { deliverPendingDraft } from "@/lib/imessage-send";
import { postManualSendConfirm } from "@/lib/imessage-suggestion";
import { handleAuditThreadReply } from "@/lib/audit-engine/thread-assistant";
import { handlePageStudioEvent, pageStudioChannel } from "@/lib/clients/page-studio";

interface SlackEventFile {
  id: string;
  name?: string;
  mimetype?: string;
  filetype?: string;
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

// Agent system prompts by channel.
//
// The `underwriting` and `submissions` agents went with the funding business.
// #srt-sub and #uw now fall through to brainheart like any other channel, which
// is deliberate: an agent that still knows how to talk about lenders is exactly
// the cross-wiring the AEO pivot is removing.
const AGENT_PROMPTS: Record<string, string> = {
  brainheart: `You are BrainHeart — the CEO's AI partner at SRT Agency, an AEO agency. You have full context of all operations. You create tasks, work the call board, send reports, and give strategic advice. Be direct, proactive, and action-oriented. When asked about status, always check real data with your tools. SRT does not do business funding; never pitch or discuss financing.`,
};

function getAgentType(channel: string): string {
  const ceoChannel = process.env.SLACK_CEO_CHANNEL || "";
  if (channel === ceoChannel) return "brainheart";
  return "brainheart"; // default for DMs
}

export async function POST(request: NextRequest) {
  try {
    // ── Slack timeout retries are DROPPED, before anything else runs ──────────────
    //
    // Slack retries any event it does not get a 200 for within THREE SECONDS, up to three times.
    // Almost every interesting command in this router blows through that: `call` and `close` are
    // a Sonnet generation plus, on a cold niche, a second one for the avatars; `loom`, `brief` and
    // `delivery` are the same shape. They are awaited inline (the handler's boolean return decides
    // routing), so the socket stays open for 30 to 90 seconds while Slack has already given up.
    //
    // Every retry re-entered the handler and re-ran the whole generation. That is three cards
    // posted into the thread, three times the token spend, and three racing writes to
    // pending_drafts on one reply. maxDuration is 300 so the FIRST invocation is still running and
    // will still post: the retry has nothing to add and can only duplicate it.
    //
    // Scoped to `http_timeout` deliberately. A retry for any other reason means Slack got an error
    // rather than silence, and re-delivering that is the recovery path working as intended.
    const retryNum = request.headers.get("x-slack-retry-num");
    const retryReason = request.headers.get("x-slack-retry-reason");
    if (retryNum && retryReason === "http_timeout") {
      console.log(`[slack/events] Dropping timeout retry #${retryNum}; the original invocation is still running.`);
      return NextResponse.json({ ok: true, skipped: "timeout_retry" });
    }

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
        // for ANY registry format (attic B-roll, jumpscare, ...). Self-routes by the
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

        // Hook-first studio lane: ✅ / keycaps on the workflow menu, copy options, motion
        // prompts, and review cards. Self-routes by content_jobs (format_id hook_studio).
        const hookReactionHandled = await handleHookStudioReaction({
          reaction: event.reaction as string,
          slackTs: event.item.ts as string,
          channel: event.item.channel as string,
          userId: event.user as string,
        });
        if (hookReactionHandled) return NextResponse.json({ ok: true });

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

        // #srt-scraper: ✅ on an over-cap card releases the MillionVerifier upload. Checked here
        // because it is the only reaction in this app that SPENDS MONEY when it fires, so it must
        // not be reachable by falling through into a handler that was looking for something else.
        const scraperReactionHandled = await handleScraperReaction({
          reaction: event.reaction as string,
          slackTs: event.item.ts as string,
          channel: event.item.channel as string,
        });
        if (scraperReactionHandled) return NextResponse.json({ ok: true });

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

      // Audit Engine v2: a reply inside an audit-report thread ("email 2", or the
      // prospect's actual reply pasted in) → draft the next email in the belief
      // sequence. Gated by channel first (cheap) before the DB lookup inside the
      // handler, so this never adds load to any other channel's events.
      const auditChannelId = process.env.AUDIT_CHANNEL_ID || "";
      if (
        auditChannelId &&
        channel === auditChannelId &&
        parentThreadTs &&
        parentThreadTs !== event.ts &&
        userText.trim().length > 0
      ) {
        // Files go through too. This branch RETURNS on handled, so it short-circuits the
        // image-capable path further down: passing only the text meant a pasted contact card was
        // discarded without a word, which is how an intake reply lost the recipient's email.
        const handled = await handleAuditThreadReply({
          channel,
          threadTs: parentThreadTs,
          text: userText,
          files: attachedFiles,
          // An @mention is Matthew talking TO the bot rather than feeding the state machine, so it
          // always goes to the agent even at a stage whose free text normally means something
          // specific. "@BrainHeart give me bullet points" is not an intake answer.
          isMention: event.type === "app_mention" || /<@[A-Z0-9]+>/.test(userText),
          messageTs: (event.ts as string | undefined) ?? null,
        });
        if (handled) return NextResponse.json({ ok: true });
      }

      // ---- Dedicated lanes: these two channels ALWAYS return here, never falling
      // through to the legacy content / AI-manager handlers. ----

      // Drop lanes — drop-and-render + prompt drops + feedback (drop-studio.ts). Any
      // channel wired via verticals.slack_drop_channel_id (plus the env pest channel).
      const dropVertical = channel ? await resolveDropVertical(channel) : null;
      if (dropVertical) {
        const isThreadReply = Boolean(parentThreadTs) && parentThreadTs !== event.ts;
        if (attachedFiles.length > 0) {
          const messageTs = event.ts as string;
          waitUntil(
            (async () => {
              if (isThreadReply) {
                // The daily reference ask claims its own thread FIRST (photos dropped there are
                // library material, not a drop session); then hook-studio threads; drop threads
                // fall through; chat threads get an explicit "no files here" note.
                const filed = await handleReferenceAskFileDrop({ channel, threadTs: parentThreadTs!, files: attachedFiles, text: userText });
                if (filed) return;
                const hooked = await handleHookStudioFileDrop({ channel, threadTs: parentThreadTs!, files: attachedFiles, text: userText });
                if (!hooked) {
                  const dropped = await handleDropFileDrop({ channel, threadTs: parentThreadTs!, files: attachedFiles, text: userText });
                  if (!dropped) await handleBrainheartChatFileNote({ threadTs: parentThreadTs! });
                }
              } else {
                await handleDropMessage({ channel, threadTs: messageTs, files: attachedFiles, text: userText, verticalId: dropVertical.id });
              }
            })().catch((e) => console.error("[slack/events] drop lane files error:", (e as Error).message))
          );
        } else if (isThreadReply && userText.trim()) {
          waitUntil(
            (async () => {
              // The reference ask claims its thread first (corrections there become style
              // rules), then chat threads (format self-routing keeps the strict lanes'
              // threads untouched), then hook studio, then drop studio.
              const vo = await handleBrollVoiceoverReply({ channel, threadTs: parentThreadTs!, text: userText });
              if (vo) return;
              const filed = await handleReferenceAskReply({ channel, threadTs: parentThreadTs!, text: userText });
              if (filed) return;
              const chatted = await handleBrainheartChatReply({ channel, threadTs: parentThreadTs!, text: userText });
              if (chatted) return;
              const hooked = await handleHookStudioReply({ channel, threadTs: parentThreadTs!, text: userText });
              if (!hooked) await handleDropThreadReply({ channel, threadTs: parentThreadTs!, text: userText });
            })().catch((e) => console.error("[slack/events] drop lane reply error:", (e as Error).message))
          );
        } else if (/^\s*go\s*$/i.test(userText)) {
          waitUntil(
            handleDropGo(channel, dropVertical.id).catch((e) =>
              console.error("[slack/events] drop go error:", (e as Error).message)
            )
          );
        } else if (/^\s*quotes\b/i.test(userText)) {
          // `quotes` + a pasted block appends raw customer language to this avatar's bank,
          // which is what `go` writes its direct-response headlines from. Sits ABOVE the
          // free-text branch below, or a paste would open a Hook Studio session instead.
          waitUntil(
            handleDropQuotes(channel, dropVertical.id, userText).catch((e) =>
              console.error("[slack/events] drop quotes error:", (e as Error).message)
            )
          );
        } else if (/^\s*(workflows|library|map)\s*$/i.test(userText)) {
          await postWorkflowMap(channel, dropWorkflowLibraryId(dropVertical));
        } else if (userText.trim()) {
          // BrainHeart chat: @mention or a leading `chat` opens a free-form creative
          // thread instead of a hook session. Checked BEFORE Hook Studio so plain text
          // keeps starting hooks unchanged.
          const chatBotId = botUserId || (await slack.getBotUserId());
          const trig = chatTrigger(userText, chatBotId);
          if (trig.hit) {
            waitUntil(
              handleBrainheartChatStart({
                channel,
                threadTs: event.ts as string,
                text: trig.cleaned,
                verticalId: dropVertical.id,
              }).catch((e) => console.error("[slack/events] brainheart chat start error:", (e as Error).message))
            );
          } else {
            // Hook-first studio: a text-only top-level message IS the hook. The bot answers with
            // 6 hook-image prompts + 5 complete-copy options and walks the video from there.
            waitUntil(
              handleHookStudioStart({
                channel,
                threadTs: event.ts as string,
                text: userText,
                verticalId: dropVertical.id,
              }).catch((e) => console.error("[slack/events] hook studio start error:", (e as Error).message))
            );
          }
        }
        return NextResponse.json({ ok: true });
      }

      // #srt-scraper (was #srt-sub) - the Apollo cold-list pre-filter. Drop a CSV, get clean.csv
      // and junk.csv back in the thread and the survivors sent to MillionVerifier.
      //
      // It handles its own files rather than leaning on the file_shared path, same reason the page
      // studio does: that event carries no message text and resolves through clientForThread, which
      // knows nothing about this channel. `handleScraperEvent` returns false for anything that is
      // not a CSV drop or `status`, so ordinary chat here still falls through to the assistant.
      if (Boolean(channel) && channel === scraperChannel()) {
        const handled = await handleScraperEvent({
          channel,
          text: userText,
          messageTs: event.ts as string,
          threadTs: parentThreadTs,
          files: attachedFiles,
        }).catch((e) => {
          console.error("[slack/events] scraper error:", (e as Error).message);
          return false;
        });
        if (handled) return NextResponse.json({ ok: true });
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

      // The page studio (lane 4). One channel, one call, and the logic lives in page-studio.ts:
      // this file gets a call, not an implementation.
      //
      // Placed immediately ABOVE the #content-full block below because it is a dedicated
      // channel and must never fall through to a handler that would read a dictated page as
      // content to render a reel from. It handles its own files rather than leaning on the
      // file_shared path: that event carries no message text and resolves through
      // clientForThread, which knows nothing about this channel.
      if (Boolean(channel) && channel === pageStudioChannel()) {
        waitUntil(
          handlePageStudioEvent({
            text: userText,
            messageTs: event.ts as string,
            threadTs: parentThreadTs,
            files: attachedFiles,
          }).catch((e) => console.error("[slack/events] page studio error:", (e as Error).message))
        );
        return NextResponse.json({ ok: true });
      }

      // #content-full `webinar` — paste a webinar/VSL script (or attach it as .pdf/.docx/.txt)
      // and get back a Hormozi-style teleprompter deck.pptx + slide-plan.md in the thread.
      //
      // Checked BEFORE every other #content-full branch, and it is the only one of them that
      // accepts files: the top-level grammar below is gated on `attachedFiles.length === 0`, so
      // a script attached as a document would otherwise fall through to the media handlers and
      // be read as content to render a reel from. Slack also turns a long paste into a .txt
      // snippet on its own, which makes "webinar" + attachment the COMMON case, not the edge one.
      if (
        isContentFullChannel &&
        (!parentThreadTs || parentThreadTs === event.ts) &&
        isWebinarTrigger(userText)
      ) {
        const messageTs = event.ts as string;
        waitUntil(
          startWebinarDeck({
            channel,
            threadTs: messageTs,
            text: userText,
            files: attachedFiles,
          }).catch((e) => console.error("[slack/events] webinar deck error:", (e as Error).message))
        );
        return NextResponse.json({ ok: true });
      }

      // #content-full thread reply on a drop. Three interpretations, in order:
      //   1. "rules"        -> list the active style rules.
      //   2. tuning feedback -> distill into ✅-gated style rules ("make the furnace older").
      //   3. "remix/more"    -> regenerate fresh options.
      // Text-only replies; falls through otherwise. Brand-scope rules apply everywhere.
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
        // options) for any registry format. Self-routes by content_jobs; falls through otherwise.
        const pipelineReply = await handlePipelineThreadReply({ channel, threadTs: parentThreadTs, text: userText });
        if (pipelineReply) return NextResponse.json({ ok: true });
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

      // ── #onboarding-srt-aeo owns everything in it, and it ALWAYS returns ─────────────
      //
      // ‼️ NOTHING FROM THIS CHANNEL MAY REACH THE GENERIC ASSISTANT TAIL. That tail ends in
      // `slack.postMessage(channel, reply)` with no thread_ts, in raw model markdown, and on
      // the first real run it put a long "## What I See / **bold**" answer at CHANNEL TOP LEVEL
      // while the screenshots it was about sat correctly filed in a step thread. A top-level
      // post in this channel that is not a step anchor or the pinned header is the wall the
      // step board replaced, coming back one message at a time.
      //
      // The old gate here fired only for a research paste and let everything else fall through,
      // which is precisely how that happened. This one owns the channel: every branch returns.
      const onboardingChannel = process.env.SLACK_CLIENT_ONBOARDING_CHANNEL;
      if (onboardingChannel && channel === onboardingChannel) {
        const client = parentThreadTs ? await clientForThread(channel, parentThreadTs) : null;

        // 1. A deep-research dump pasted into a client's thread. Explicit prefix only: see
        //    research-intake.ts for why sniffing is not acceptable here. This is the second
        //    half of the avatar harvest step — the brief went out, this is the answer back.
        if (client && parentThreadTs && userText.trim().length > 0) {
          const { isResearchPaste } = await import("@/lib/clients/research-intake");
          if (isResearchPaste(userText)) {
            const { ingestResearch, formatIntakeReply } = await import("@/lib/clients/research-intake");
            const { extractPhrases, mergePhrases } = await import("@/lib/clients/harvest");

            const result = await ingestResearch({ clientId: client.id, text: userText });
            const top = result.ok
              ? mergePhrases(extractPhrases(userText, "deep_research")).slice(0, 6)
              : [];

            const posted = await slack.postThreadReply(
              channel,
              parentThreadTs,
              formatIntakeReply(result, top)
            );
            if (!slackOk(posted)) {
              console.error("[slack/events] research reply failed in", parentThreadTs);
            }
            return NextResponse.json({ ok: true });
          }
        }

        // 1a. `prompt` in step 10's thread — hand back the deep-research prompt.
        //
        // The step posts this by itself now (2026-08-28), so this is no longer an escape hatch,
        // it is the same message again on demand. Same builder, so the two are byte-identical.
        //
        // Above the avatar branch and the assistant tail for the same reason 1b is: bare `prompt`
        // is free text, and free text in a step thread gets answered by a model otherwise.
        if (
          client &&
          parentThreadTs &&
          client.stepKey === "avatar_harvest" &&
          /^\s*prompt\s*$/i.test(userText)
        ) {
          const { buildContext, buildCompactPrompt } = await import(
            "@/lib/clients/artifacts/deep-research-run"
          );
          const built = await buildContext(client.id);
          const reply = built.ok
            ? `Here is the prompt for this step. Paste it whole into claude.com deep research.\n\n\`\`\`\n${buildCompactPrompt(built.ctx)}\n\`\`\``
            : `:warning: Cannot build the prompt: ${built.error}`;

          const posted = await slack.postThreadReply(channel, parentThreadTs, reply);
          if (!slackOk(posted)) console.error("[slack/events] prompt reply failed");
          return NextResponse.json({ ok: true });
        }

        // 1a-bis. `run` in step 10's thread — do the research here instead, on Haiku.
        //
        // This is the whole automatic researcher, demoted from the default to a keyword on
        // 2026-08-28 because it cost around $0.60 to $1.00 a client and came back thinner than
        // Matthew's own claude.com run. Still worth having on a day when nobody wants to paste
        // anything, so it says what it is about to spend and then does it.
        //
        // ‼️ THE ACK GOES OUT BEFORE THE WORK STARTS, AND THAT IS NOT POLITENESS. runDeepResearch
        // takes about two minutes. Slack re-delivers an event it has not heard back from within
        // three seconds, so awaiting it here would fire the eight-section fan-out two or three
        // times over on one typed word, and the retries look identical to the first delivery.
        // waitUntil keeps the function alive past the response; maxDuration on this route is 300.
        if (
          client &&
          parentThreadTs &&
          client.stepKey === "avatar_harvest" &&
          /^\s*run\s*$/i.test(userText)
        ) {
          const clientId = client.id;
          const said = await slack.postThreadReply(
            channel,
            parentThreadTs,
            ":hourglass_flowing_sand: Running the eight sections here instead, on Haiku with web " +
              "search. About two minutes, and it costs roughly a dollar. The PDF lands in this " +
              "thread when it is done."
          );
          if (!slackOk(said)) console.error("[slack/events] run ack failed");

          waitUntil(
            (async () => {
              const { runDeepResearch } = await import(
                "@/lib/clients/artifacts/deep-research-run"
              );
              const res = await runDeepResearch(clientId);
              if (!res.ok) {
                await slack.postThreadReply(
                  channel,
                  parentThreadTs,
                  `:warning: The Haiku pass failed: ${res.error}. The prompt above still works.`
                );
              }
            })().catch((e) =>
              console.error("[slack/events] deep research run threw:", (e as Error).message)
            )
          );
          return NextResponse.json({ ok: true });
        }

        // 1a-ter. `template clinic` / `skin` / `skin reset` in step 15's or 16's thread.
        //
        // ‼️ ABOVE THE ASSISTANT BRANCH FOR THE SAME REASON THE AVATAR BRANCH BELOW IS.
        // Free text in a step thread is answered by a model, so without this a typed template
        // name gets a paragraph about templates instead of a page that changed.
        //
        // The prefixes are EXACT and the step is checked (isSkinStep), so "the editorial team"
        // typed anywhere else in this channel is a sentence and stays one. handleSkinThreadReply
        // returns null when it does not recognise the message, and the fall-through is the point.
        if (client && parentThreadTs && userText.trim().length > 0) {
          const { handleSkinThreadReply } = await import("@/lib/clients/hub-skin");
          const said = await handleSkinThreadReply({
            clientId: client.id,
            stepKey: client.stepKey,
            text: userText,
            by: event.user ? `<@${event.user as string}>` : "someone in Slack",
          });
          if (said) {
            const posted = await slack.postThreadReply(channel, parentThreadTs, said.message);
            if (!slackOk(posted)) console.error("[slack/events] skin reply failed");
            return NextResponse.json({ ok: true });
          }
        }

        // 1b. `avatar: laser hair removal` in step 8's thread, or in step 23's on the call.
        //
        // ‼️ IT SITS ABOVE THE ASSISTANT BRANCH, WHICH IS THE BRANCH IT WOULD OTHERWISE BE EATEN
        // BY. Free text in a step thread falls through to the general assistant, so without this
        // a typed avatar would be answered by a model instead of written to the column, which is
        // the exact shape of the bug that left clients.primary_avatar with no writer.
        //
        // The real logic is in clients/avatars.ts. This is a call, not an implementation: the
        // prefix test, the Day-0 refusal and the question-set regeneration all live there.
        if (client && parentThreadTs && userText.trim().length > 0) {
          const { handleAvatarThreadReply } = await import("@/lib/clients/avatars");
          const said = await handleAvatarThreadReply({
            clientId: client.id,
            stepKey: client.stepKey,
            text: userText,
            by: event.user ? `<@${event.user as string}>` : "someone in Slack",
          });
          if (said) {
            const posted = await slack.postThreadReply(channel, parentThreadTs, said.message);
            if (!slackOk(posted)) console.error("[slack/events] avatar reply failed");
            return NextResponse.json({ ok: true });
          }
        }

        // 1c. A design reference dropped in step 15's or 16's thread.
        //
        // ‼️ IT MUST SIT ABOVE captureOnboardingUploads, WHICH OWNS EVERY OTHER FILE IN THIS
        // CHANNEL. A screenshot in a design thread is a reference to read a skin off, not a
        // presence-sweep artifact to file against the client — and the capture below would take
        // it, attribute it to a platform and tick nothing, with no sign anything was missed.
        //
        // Gated on the STEP, not on the picture, so a sweep screenshot in a sweep thread is
        // untouched. handleSkinScreenshot returns null when the step is wrong or the files are
        // not images, and the fall-through goes exactly where it used to.
        //
        // ‼️ THE ACK GOES OUT BEFORE THE VISION CALL. Slack re-delivers an event it has not
        // heard back from within three seconds and a vision read is slower than that, so the
        // work runs in waitUntil — the same shape step 10's `run` uses, and for the same reason:
        // the retries look identical to the first delivery and would spend the call twice.
        if (client && parentThreadTs && attachedFiles.length > 0) {
          const { isSkinStep, hasSkinReference } = await import("@/lib/clients/hub-skin");
          // ‼️ BOTH CONDITIONS, AND THE SECOND IS NOT BELT AND BRACES. Gating on the step
          // alone would acknowledge a PDF dropped in step 15's thread with "reading the design
          // out of that" and then post nothing, because the handler correctly declines it.
          if (isSkinStep(client.stepKey) && hasSkinReference(attachedFiles)) {
            const clientId = client.id;
            const stepKey = client.stepKey;
            const by = event.user ? `<@${event.user as string}>` : "someone in Slack";
            const said = await slack.postThreadReply(
              channel,
              parentThreadTs,
              ":hourglass_flowing_sand: Reading the design out of that. A few seconds."
            );
            if (!slackOk(said)) console.error("[slack/events] skin ack failed");

            waitUntil(
              (async () => {
                const { handleSkinScreenshot } = await import("@/lib/clients/hub-skin");
                const res = await handleSkinScreenshot({
                  clientId,
                  stepKey,
                  files: attachedFiles,
                  text: userText,
                  by,
                });
                if (res) {
                  await slack.postThreadReply(channel, parentThreadTs!, res.message);
                }
              })().catch((e) =>
                console.error("[slack/events] skin screenshot threw:", (e as Error).message)
              )
            );
            return NextResponse.json({ ok: true });
          }
        }

        // 2. Screenshots with a platform named in the message. handleFileShared files the same
        //    upload from the files.info side, which carries no message text, so whichever event
        //    wins the race the attribution ends up here, the only place that can see the words.
        if (client && parentThreadTs && attachedFiles.length > 0) {
          await captureOnboardingUploads({
            channel,
            threadTs: parentThreadTs,
            client,
            files: attachedFiles,
            text: userText,
          });
          return NextResponse.json({ ok: true });
        }

        // 3. A question in a STEP's thread. The answer goes in that step's thread, through
        //    notifyStep, which is the only door. No fallback to postMessage: a message in the
        //    wrong place is harder to notice than a message that is missing, and a fallback is
        //    exactly how the wall comes back.
        if (client && userText.trim().length > 0 && isAIConfigured()) {
          const { toSlackMrkdwn } = await import("@/lib/slack-bot");
          // Scoped to the THREAD, not the channel. `slack-${channel}` gave one client's step
          // thread the last twenty messages from a different client's.
          const { reply } = await askAssistant({
            conversationId: `slack-${channel}-${parentThreadTs}`,
            agentType: getAgentType(channel),
            userText,
            files: attachedFiles,
          });

          if (client.stepKey) {
            const { notifyStep } = await import("@/lib/clients/step-board");
            const res = await notifyStep(client.id, client.stepKey, toSlackMrkdwn(reply));
            if (!res.ok) {
              console.error(
                `[slack/events] assistant reply failed on ${client.stepKey}: ${res.error}`
              );
            }
          } else {
            // The pinned header thread. Not a step, so notifyStep has nothing to route to, and
            // notifyThread is the door for messages that belong to the CLIENT rather than to
            // any one step.
            const { notifyThread } = await import("@/lib/clients/delivery-checklist");
            await notifyThread(client.id, toSlackMrkdwn(reply));
          }
          return NextResponse.json({ ok: true });
        }

        // 4. Top level, or a thread that belongs to no client. There is nothing to answer INTO:
        //    this channel holds many clients and thirty-three anchors each, so there is no
        //    honest "the" thread to pick, and a channel message is the wall. An ephemeral is
        //    visible only to the person who typed, cannot be replied to, and disappears.
        if (userText.trim().length > 0 && event.user) {
          const said = await slack.postEphemeral(
            channel,
            event.user as string,
            "This channel is one message per delivery step. Ask inside a step's thread and I " +
              "will answer there. Nothing gets posted at the top level here, because a " +
              "top-level message is what the step board replaced."
          );
          if (!slackOk(said)) {
            // Log and post nothing. Never fall back to a channel message.
            console.error("[slack/events] onboarding ephemeral failed in", channel);
          }
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
        // waits for 👍. This stops a stray reply (e.g. "2") triggering a render.
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

      const agentType = getAgentType(channel);
      const conversationId = `slack-${channel}`;
      const { reply, response } = await askAssistant({
        conversationId,
        agentType,
        userText,
        files: attachedFiles,
      });

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
        content: `You are a viral short-form video strategist for SRT Agency, an AEO agency that makes local businesses findable and citable by AI assistants.

Generate 3 distinct hook options for this video. Each hook is a combination of:
1. Slide 1 (wide compelling visual — NO faces, extreme close-up of the avatar's world, stops the scroll)
2. Slide 2 (the specific avatar in their environment — full shot, authentic setting)

Concept: ${packageJson.concept_summary ?? "AI visibility story"}
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

/**
 * Did that Slack call actually work?
 *
 * ‼️ slackFetch NEVER THROWS. Slack answers HTTP 200 for everything and puts real failures in
 * `ok: false`, so every `.catch(() => {})` around a Slack call catches nothing whatsoever: a
 * `message_not_found`, a bot that is not in the channel or a missing scope all resolve as
 * success and the caller carries on as though the message had landed. Check the body, never the
 * promise. Same helper as the one in src/app/api/slack/actions/route.ts, which is where this
 * was fixed the first time.
 */
function slackOk(res: Record<string, unknown> | null | undefined): boolean {
  return Boolean(res && res.ok === true);
}

/**
 * File the screenshots on a message, and attribute them to a platform when the message named
 * exactly one.
 *
 * ‼️ ONE REPLY PER MESSAGE, NOT ONE PER FILE. Matthew pastes several screenshots at a time, and
 * four identical "which platform is this" replies under one upload is noise nobody reads to the
 * end. Errors keep their own per-file reply, because a file that failed to save is a different
 * problem from one that saved unattributed and the two must not merge into one confusing line.
 */
async function captureOnboardingUploads(args: {
  channel: string;
  threadTs: string;
  client: { id: string; legalName: string; stepKey: string | null };
  files: SlackEventFile[];
  text: string;
}): Promise<void> {
  const { resolvePlatformsFromText, platformByKey } = await import("@/config/presence-platforms");

  const isSweep = args.client.stepKey === "presence_sweep_manual";
  const named = isSweep ? resolvePlatformsFromText(args.text) : [];
  const platform = named.length === 1 ? named[0] : null;

  let filed = 0;

  for (const file of args.files) {
    const result = await captureOnboardingFile({
      clientId: args.client.id,
      file: file as Parameters<typeof captureOnboardingFile>[0]["file"],
      threadTs: args.threadTs,
      stepKey: args.client.stepKey,
      messageText: args.text,
    });

    if (!result.ok && !result.skipped) {
      console.error("[slack/events] onboarding capture failed:", result.error);
      const said = await slack.postThreadReply(
        args.channel,
        args.threadTs,
        `:warning: Could not file *${file.name ?? "that file"}*: ${result.error}. It is not saved — please try again.`
      );
      if (!slackOk(said)) console.error("[slack/events] capture failure notice failed");
      continue;
    }

    filed += 1;

    // handleFileShared won the race and inserted the row before this handler saw the text.
    // The .is(null) predicate inside makes this a backfill rather than a relabel.
    if (result.skipped === "duplicate" && platform) {
      await attributePresenceDoc(file.id, platform);
    }
  }

  if (filed === 0) return;

  // ── Step 10: the research PDF coming back ──────────────────────────────────
  //
  // The deep research tool hands back a document, and asking somebody to select all of it and
  // paste it into Slack behind a prefix is asking them to do the export by hand. Dropping the
  // file into the step's own thread is the same explicit act the `research:` prefix is, scoped to
  // the step it belongs to. No model reads the PDF: research-intake.ts says why.
  if (args.client.stepKey === "avatar_harvest") {
    const { ingestResearchPdf, formatIntakeReply } = await import("@/lib/clients/research-intake");

    const pdfs = args.files.filter(
      (f) => /pdf/i.test(f.mimetype ?? "") || /\.pdf$/i.test(f.name ?? "")
    );
    if (pdfs.length === 0) return;

    for (const file of pdfs) {
      const result = await ingestResearchPdf({ clientId: args.client.id, slackFileId: file.id });
      // No sample of the phrases here: the text was never held in this scope and re-reading the
      // PDF to print six lines is a second extraction for decoration. The counts are the answer.
      const top: never[] = [];
      const said = await slack.postThreadReply(
        args.channel,
        args.threadTs,
        `*${result.filename ?? file.name ?? "That file"}*\n${formatIntakeReply(result, top)}`
      );
      if (!slackOk(said)) console.error("[slack/events] research PDF reply failed");
    }
    return;
  }

  // ── Step 8: the review grid. Screenshots in, one grouped card out ──────────
  //
  // Matthew asked for exactly this: "it will be better if we can just send screenshots inside of
  // slack and it groups them all automatically." The reading, the matching and the card are all
  // in review-audit.ts; this branch is a call, not an implementation.
  if (args.client.stepKey === "review_audit") {
    const { ingestReviewScreenshots, loadReviewAudit, formatReviewGrid } = await import(
      "@/lib/clients/review-audit"
    );
    const results = await ingestReviewScreenshots({
      clientId: args.client.id,
      threadTs: args.threadTs,
    });
    const rows = await loadReviewAudit(args.client.id);
    const proposed = results.filter((r) => r.outcome.kind === "proposed").length;

    const card = formatReviewGrid({ rows, results });
    const posted = await slack.postThreadReply(args.channel, args.threadTs, card, [
      { type: "section", text: { type: "mrkdwn", text: card.slice(0, 2900) } },
      ...(proposed > 0
        ? [
            {
              type: "actions",
              elements: [
                {
                  type: "button",
                  text: { type: "plain_text", text: "Confirm these readings" },
                  style: "primary",
                  action_id: "review_confirm_readings",
                  value: args.client.id,
                },
              ],
            },
          ]
        : []),
    ]);
    if (!slackOk(posted)) console.error("[slack/events] review grid post failed");
    return;
  }

  if (!isSweep) return;

  // ── Step 5: the address bar in the picture ─────────────────────────────────
  //
  // ‼️ TEXT FIRST AND THIS SECOND, ALWAYS. attributeUnreadScreenshots only looks at rows whose
  // presence_platform is still null, so a message that named a platform is never second-guessed
  // by a model and the common case costs no model call at all.
  const { attributeUnreadScreenshots, formatAttributionNote } = await import(
    "@/lib/clients/onboarding-docs"
  );
  const read = await attributeUnreadScreenshots({
    clientId: args.client.id,
    threadTs: args.threadTs,
  });
  const readNote = formatAttributionNote(read);
  const stillUnattributed = read.filter(
    (r) =>
      r.outcome.kind === "unreadable" ||
      r.outcome.kind === "no_match" ||
      r.outcome.kind === "ambiguous"
  ).length;

  const notes: string[] = [];

  if (named.length > 1) {
    const labels = named.map((k) => platformByKey(k)?.label ?? k).join(" and ");
    notes.push(
      `:warning: That message names ${labels}, so there is no way to tell which one these ` +
        `${filed} screenshot${filed === 1 ? "" : "s"} show. One platform per message.`
    );
  }

  if (readNote) notes.push(readNote);

  // ‼️ THE "NAME IT" NUDGE ONLY FIRES ON WHAT IS STILL UNATTRIBUTED. It used to fire whenever
  // the message named nothing, which is now the NORMAL and preferred case: the address bar in
  // the picture answers it. Telling somebody to type a platform name onto a screenshot that has
  // just been filed correctly is how a fixed feature keeps reading as a broken one.
  if (stillUnattributed > 0) {
    notes.push(
      `Those ${stillUnattributed === 1 ? "one" : stillUnattributed} are filed and kept but not counted. ` +
        "Reply with the platform name, one platform per message, and they count."
    );
  }

  if (!notes.length) return;

  const said = await slack.postThreadReply(args.channel, args.threadTs, notes.join("\n"));
  if (!slackOk(said)) console.error("[slack/events] attribution note failed");
}


/**
 * The general BrainHeart assistant: history, system prompt, images, one tool loop.
 *
 * Hoisted out of the request handler because two callers need it now. The onboarding channel
 * answers inside a step's thread and everything else answers in the channel, and duplicating
 * fifty lines to change one `postMessage` is how the two drift.
 *
 * ‼️ IT DOES NOT POST. The caller decides where the answer goes, which is the entire point of
 * the split: in #onboarding-srt-aeo a top-level channel message is the wall the step board
 * replaced, so that caller has to route through notifyStep instead.
 */
async function askAssistant(args: {
  conversationId: string;
  agentType: string;
  userText: string;
  files: SlackEventFile[];
}): Promise<{ reply: string; response: string }> {
  const { conversationId, agentType, userText, files } = args;

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
  const imageFiles = files.filter((f) => (f.mimetype ?? "").startsWith("image/"));
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

  const messages = [
    ...history,
    {
      role: "user" as const,
      content: userText || (imageBlocks.length > 0 ? "What do you see in this image?" : ""),
    },
  ];
  const { response, actions } = await runConversationWithTools(
    messages,
    systemPrompt,
    imageBlocks.length > 0 ? imageBlocks : undefined
  );

  let reply = response;
  if (actions.length > 0) {
    const toolSummary = actions
      .map((a) => a.split("(")[0])
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .join(", ");
    reply = `_[${toolSummary}]_\n\n${response}`;
  }

  return { reply, response };
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
  // Files in the dedicated lanes are handled entirely by the message event
  // (drop-studio / workflow-agent); nothing in this handler may claim them. Drop lanes
  // are any channel wired via verticals.slack_drop_channel_id (cached lookup).
  for (const ch of allShareChannels) {
    if (
      ch === VEKTOR_CHANNELS.agentWorkflowCreator ||
      // #srt-scraper: a CSV drop fires BOTH this and a `message` with subtype file_share. The
      // message path is the one that owns it, and claiming the file here too would start a second
      // batch on the same upload, which is a second MillionVerifier bill for one file.
      (Boolean(scraperChannel()) && ch === scraperChannel()) ||
      (await resolveDropVertical(ch))
    ) {
      return;
    }
  }
  // ── Onboarding evidence, Runner v3 §3 ──────────────────────────────────────
  // A screenshot replying in a client's thread IS the filing. Checked before the content
  // lanes because it is keyed on an exact (channel, thread_ts) pair rather than on a
  // mimetype: nothing else can match it, and it must not fall through to the image
  // analyser and get treated as a content reference.
  for (const [channelId, shares] of Object.entries({
    ...(file.shares?.public ?? {}),
    ...(file.shares?.private ?? {}),
  })) {
    for (const share of shares ?? []) {
      const threadTs = share.thread_ts ?? share.ts;
      const client = await clientForThread(channelId, threadTs);
      if (!client || !threadTs) continue;

      // ‼️ A DESIGN REFERENCE IS NOT EVIDENCE, AND THIS IS THE OTHER HALF OF THAT GUARD.
      // An upload fires BOTH this event and a `message` with subtype file_share, in no
      // guaranteed order — the trap this same function already documents for #srt-scraper. The
      // message path owns a design step's files and reads a skin off them; filing the same
      // picture here would put somebody else's homepage in this client's document record,
      // attributed to no platform, where it would later be counted as a sweep artifact.
      const { isSkinStep, hasSkinReference } = await import("@/lib/clients/hub-skin");
      // ‼️ IT SKIPS THE IMAGE, NOT THE THREAD. Gating on the step alone would silently drop a
      // PDF uploaded into step 15 with no comment: the message path declines it (not an image)
      // and this path would have declined it too, so nothing would file it anywhere. The same
      // predicate the message path uses, so exactly one of the two claims each file.
      if (isSkinStep(client.stepKey) && hasSkinReference([file])) continue;

      const result = await captureOnboardingFile({
        clientId: client.id,
        file,
        threadTs,
        // Which step this is evidence for, taken from WHICH THREAD it was dropped in rather
        // than guessed. Null when it landed under the pinned header instead of a step.
        stepKey: client.stepKey,
        // ‼️ NULL, AND EXPLICITLY SO. files.info returns the file and its shares and no message
        // text at all, so this path can never attribute a presence screenshot to a platform.
        // The `message` event handler (captureOnboardingUploads, above) is the one that can,
        // and it backfills through attributePresenceDoc when this path wins the race. This is
        // left in place rather than skipped for onboarding files, because it is the path that
        // works today for an upload posted with no comment at all.
        messageText: null,
      });
      // Errors are said out loud in the thread. A screenshot somebody believes was filed
      // and was not is worse than one that visibly failed, because the gap only surfaces
      // when the findings doc is being assembled and the evidence is not there.
      if (!result.ok && !result.skipped) {
        console.error("[slack/events] onboarding capture failed:", result.error);
        await slack
          .postThreadReply(
            channelId,
            threadTs,
            `:warning: Could not file *${file.name ?? "that file"}*: ${result.error}. It is not saved — please try again.`
          )
          .catch(() => {});
      }

      // A voice note is the client answering this week's content ask, so it is filed like
      // any other evidence and then turned into text. Fired after the capture, never
      // instead of it: the audio is the record and the transcript is a convenience.
      // Deliberately not awaited into the capture result, because a transcription failure
      // must not read as a filing failure.
      if (result.ok && isVoiceNote(file)) {
        void handleClientVoiceNote({
          clientId: client.id,
          channelId,
          threadTs,
          file,
        }).catch((e) =>
          console.error("[slack/events] voice note transcription failed:", (e as Error).message)
        );
      }
      return;
    }
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

  // Everything past this point used to be the funding path: match the thread to
  // a `deals` row, file the PDF into OneDrive under Deals/{merchant}/Bank
  // Statements, and run Claude over it as an MCA application. All three went
  // with the funding business, so a PDF that reaches here has no handler left.
  console.log("[slack/events] no handler for this file:", mimeType, file.name);
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
    void fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? "https://mission.srtagency.com"}/api/code-guardian/apply-fix`, {
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
