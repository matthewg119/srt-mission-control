// BrainHeart Chat — the FREE-FORM creative lane of the drop channels. Hook Studio and
// Drop Studio are strict state machines; this lane is a plain conversation with Claude
// (Haiku by default) that knows the channel's avatar, sales letters, and workflow library.
//
// Entry (top-level in a drop channel, checked BEFORE handleHookStudioStart):
//   @BrainHeart <anything>   or   chat <anything>
// The bot answers in the message's thread; every reply in that thread continues the
// conversation. `done` / `cancel` closes it. Inside hook/drop threads nothing changes:
// this module claims a thread only when its latest content_jobs row is format
// "brainheart_chat", so the strict lanes keep their threads.
//
// What it is for (prompt protocols, no state machine):
//   - paste a phrase/hook -> 5 divergent direct-response scripts fit to a real workflow
//   - "storyboard it" -> 10 numbered image ideas consistent with the copy -> pick one ->
//     3 full gpt-image-2 prompt options in the house style
// Prompt-first stays law: this module never generates images and never renders.

import { waitUntil } from "@vercel/functions";
import { slack } from "@/lib/slack-bot";
import { callClaudeChat, type ClaudeChatMessage, type ClaudeModel } from "@/lib/claude-calls";
import { insertJob, getLatestJobByThread, updateJob, type ContentJob } from "@/lib/reel/jobs";
import { avatarBlock } from "@/lib/reel/creative-director";
import { stripEmDashes } from "@/lib/reel/text";
import { activeWorkflows, shotCount, boxCount, songNote, splitForSlack } from "@/lib/reel/drop-studio";
import { loadVertical, dropOwnerVerticalId, dropWorkflowLibraryId } from "@/config/verticals";
import { POV_GLASSES_TOKEN } from "@/config/pov-style";

const CHAT_FORMAT = "brainheart_chat";
const HISTORY_MAX_MSGS = 30;
const HISTORY_MAX_CHARS = 24_000;

function chatModel(): ClaudeModel {
  return (process.env.BRAINHEART_CHAT_MODEL as ClaudeModel) || "claude-haiku-4-5-20251001";
}

async function post(channel: string, threadTs: string, text: string): Promise<string | null> {
  const res = await slack.postThreadReply(channel, threadTs, text).catch(() => null);
  return ((res as { ts?: string } | null)?.ts as string) ?? null;
}

function isChatJob(job: ContentJob | null): job is ContentJob {
  return Boolean(job && job.format_id === CHAT_FORMAT);
}

/** Does a top-level drop-channel message open a chat? Mention of the bot OR a leading
 *  `chat` keyword. Returns the message with the trigger stripped. */
export function chatTrigger(text: string, botUserId: string): { hit: boolean; cleaned: string } {
  const t = text ?? "";
  const mention = Boolean(botUserId) && t.includes(`<@${botUserId}>`);
  const kw = /^\s*chat\b[:,]?\s*/i.test(t);
  if (!mention && !kw) return { hit: false, cleaned: t };
  let cleaned = t;
  if (botUserId) cleaned = cleaned.split(`<@${botUserId}>`).join(" ");
  cleaned = cleaned.replace(/^\s*chat\b[:,]?\s*/i, " ").trim();
  return { hit: true, cleaned };
}

/** Cap the transcript: newest HISTORY_MAX_MSGS messages, trimmed in oldest-first PAIRS
 *  until under the char budget, always starting on a user turn (API role alternation). */
function capHistory(history: ClaudeChatMessage[]): ClaudeChatMessage[] {
  let out = history.slice(-HISTORY_MAX_MSGS);
  while (out.length && out[0].role !== "user") out = out.slice(1);
  let total = out.reduce((n, m) => n + m.content.length, 0);
  while (out.length > 2 && total > HISTORY_MAX_CHARS) {
    total -= out[0].content.length + (out[1]?.content.length ?? 0);
    out = out.slice(2);
  }
  return out;
}

async function buildChatSystem(verticalId: string): Promise<string> {
  const drop = await loadVertical(verticalId);
  const owner = await loadVertical(dropOwnerVerticalId(drop));
  const workflows = await activeWorkflows(dropWorkflowLibraryId(drop));

  const library = workflows.length
    ? workflows.map((w, i) => {
        const boxes = (w.copy_structure ?? []).map((r) => r.label).join(", ");
        return `${i + 1}. ${w.name}: ${shotCount(w)} shot(s), ${boxCount(w)} copy box(es)${boxes ? ` (${boxes})` : ""}, ${songNote(w)}`;
      })
    : ["(no active workflows in this channel's library)"];

  const letters = (owner.sales_letter_examples ?? "").trim();
  const swipe = (owner.sales_letter_swipe ?? "").trim();

  return [
    "You are BrainHeart, the direct-response creative partner in this Slack channel. You help",
    "the operator develop hooks, scripts, storyboards, and image prompts for short vertical",
    "videos. This is Slack: keep replies short and direct, plain text with light *bold*, no",
    "markdown headers, no fluff.",
    "",
    avatarBlock(owner),
    swipe ? `\nVoice rules from the avatar's swipe file:\n${swipe.slice(0, 1200)}` : "",
    letters ? `\nExcerpt from the avatar's real sales letters (voice anchor):\n${letters.slice(0, 2000)}` : "",
    "",
    "WORKFLOW LIBRARY (each video is built through one of these; boxes are the on-screen text slots):",
    ...library,
    "",
    "PROTOCOLS:",
    "1. When given a phrase, hook, or half-finished idea: return 5 DIVERGENT direct-response",
    "   scripts, numbered *Script 1* to *Script 5*. Name which workflow each fits and write one",
    "   line per copy box (10 words or fewer per line). Make them differ in angle (pain, proof,",
    "   dream outcome, status, curiosity), not wording. End by inviting a pick or a mix by number.",
    "2. Storyboard protocol: when asked to storyboard a script, FIRST return exactly 10 numbered",
    "   one-line image ideas that stay visually consistent with the chosen copy so the shots read",
    "   as one continuous story (same location arc, lighting, wardrobe, time of day). Wait for a",
    "   pick. THEN return 3 full image-generation prompt options for the picked direction, each a",
    "   complete standalone prompt in this shape: style/POV sentence, then subject + action +",
    `   setting sentence, ending with "No text, captions, logos, or watermarks in the image.`,
    `   9:16 vertical." For first-person looks use this style base: ${POV_GLASSES_TOKEN}`,
    "3. You only write copy and prompts. You never generate images and never render. If asked to",
    "   render, say: pick the copy, then start a normal drop top-level (images + copy in one",
    "   message) or post the hook text alone for Hook Studio.",
    "",
    "HARD RULES: never invent guarantees, numbers, rates, or terms; never use em dashes; write",
    "in the customer's language, not marketing jargon.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** One conversation turn: append the user message, call Claude, post + persist the reply. */
async function chatTurn(job: ContentJob, userText: string): Promise<void> {
  const { slack_channel: channel, slack_thread_ts: threadTs } = job;
  const history = capHistory([...(job.data.chat_history ?? []), { role: "user" as const, content: userText }]);
  try {
    const system = await buildChatSystem(job.vertical_id);
    const { text } = await callClaudeChat({
      model: chatModel(),
      system,
      messages: history,
      maxTokens: 1800,
      temperature: 0.8,
    });
    const out = stripEmDashes(text).trim() || "I got nothing back. Say that again?";
    for (const chunk of splitForSlack(out)) await post(channel, threadTs, chunk);
    const fresh = (await getLatestJobByThread(threadTs)) ?? job;
    await updateJob(fresh, {
      data: { ...fresh.data, chat_history: capHistory([...history, { role: "assistant" as const, content: out }]) },
    });
  } catch (e) {
    // History is NOT persisted on failure, so "say that again" really does retry the turn.
    console.error("[brainheart-chat] turn failed:", (e as Error).message);
    await post(channel, threadTs, `BrainHeart hiccuped (${(e as Error).message.slice(0, 120)}). Say that again?`);
  }
}

/** Top-level trigger hit: open the chat thread on the triggering message. */
export async function handleBrainheartChatStart(args: {
  channel: string;
  threadTs: string; // the triggering message's ts — the chat lives in its thread
  text: string; // trigger already stripped (chatTrigger.cleaned)
  verticalId: string;
}): Promise<void> {
  await insertJob({
    formatId: CHAT_FORMAT,
    verticalId: args.verticalId,
    channel: args.channel,
    threadTs: args.threadTs,
    pickerTs: null,
    stage: "bh_chat",
    sourceKind: "chat",
    data: { chat_history: [] },
  });
  const job = await getLatestJobByThread(args.threadTs);
  if (!isChatJob(job)) {
    await post(args.channel, args.threadTs, "Could not open the chat (job insert failed). Try again.");
    return;
  }
  const opener = args.text.trim();
  if (!opener) {
    await post(
      args.channel,
      args.threadTs,
      "What are we making? Drop a phrase, a hook, or a half idea in this thread and I'll build on it. `done` closes the chat."
    );
    return;
  }
  await chatTurn(job, opener);
}

/** Thread reply router. Returns false when the thread is not a chat (strict lanes proceed). */
export async function handleBrainheartChatReply(args: {
  channel: string;
  threadTs: string;
  text: string;
}): Promise<boolean> {
  const job = await getLatestJobByThread(args.threadTs);
  if (!isChatJob(job)) return false;
  const text = args.text.trim();

  if (/^\s*(done|cancel)\s*$/i.test(text)) {
    if (job.status === "active") {
      await updateJob(job, { status: "done", stage: "done" });
      await post(job.slack_channel, job.slack_thread_ts, "Chat closed. Mention me or start a message with `chat` to open a new one.");
    }
    return true;
  }
  if (job.status !== "active") {
    await post(job.slack_channel, job.slack_thread_ts, "This chat is closed. Mention me top-level or start a message with `chat` to open a new one.");
    return true;
  }
  if (!text) return true;
  waitUntil(chatTurn(job, text));
  return true;
}

/** Files dropped into a chat thread (after the strict lanes declined): say so instead of silence. */
export async function handleBrainheartChatFileNote(args: { threadTs: string }): Promise<boolean> {
  const job = await getLatestJobByThread(args.threadTs);
  if (!isChatJob(job)) return false;
  await post(
    job.slack_channel,
    job.slack_thread_ts,
    "This chat can't take files yet. Describe what you want here, or start a drop top-level with the images + copy."
  );
  return true;
}
