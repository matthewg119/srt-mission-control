// BrainHeart, reasoning, in the audit thread.
//
// The thread used to be a command menu with a fall-through, and the fall-through was "revise email
// 1 in place". That one branch produced every failure in the 2026-08-10 Grey Seal thread:
//
//   "run image"                              -> the email drafter refused in prose, JSON parse error
//   "give me some good bulletpoints"         -> same
//   "call and close"                         -> matched neither regex, revised email 1
//   "notes"                                  -> revised email 1
//   "what are the best avatars"              -> revised email 1
//   "I already sent the loom, new follow up" -> revised email 1, permission close still appended
//
// The last one is the expensive one: it would have asked a prospect who already had the video
// "want me to send it over?", one paragraph under "I sent over a short video last week".
//
// A bigger regex table does not fix that, because the failure is not matching, it is that nothing
// in the thread could THINK. Exact commands keep their fast path; everything else comes here and
// gets a real tool loop that can look things up before it answers.
//
// ‼️ The agent has no send tool. See audit-tools.ts.

import { runConversationWithTools } from "@/lib/ai";
import { slack } from "@/lib/slack-bot";
import { AUDIT_THREAD_TOOLS, makeAuditExecutor, type AuditToolContext } from "./audit-tools";
import { readThreadTruth, formatThreadTruth } from "./thread-truth";
import { noDashes } from "./email-assistant";
import type { AuditReportRow } from "./types";

// NOTE: this module deliberately does NOT import from thread-assistant.ts. That file imports this
// one, and a cycle between the router and the agent it routes to is the kind of thing that works
// in dev and fails at build time on a cold module graph.

/** How many Slack messages of history the agent sees. Enough to follow a conversation, short
 *  enough that a 200-reply thread does not blow the context window on old drafts. */
const HISTORY_LIMIT = 24;

/** Tool iterations. Each one is a full model round trip, so this is the main cost lever. */
const MAX_ITERATIONS = 6;

interface SlackThreadMessage {
  user?: string;
  bot_id?: string;
  text?: string;
  ts?: string;
  subtype?: string;
}

/**
 * The thread, as a conversation.
 *
 * This is the "understands what I ask when I tag him" half. Until now every reply was evaluated
 * alone, so "give me a new follow up email" carried none of the three messages before it that
 * explained which prospect, what had been sent, and what he had already rejected.
 *
 * Bot messages become assistant turns and Matthew's become user turns. Anthropic requires
 * alternating roles, so consecutive same-role messages are merged rather than dropped: dropping
 * them would silently lose exactly the run of drafts he is reacting to.
 */
async function loadHistory(
  channel: string,
  threadTs: string,
  currentTs: string | null
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  let raw: SlackThreadMessage[] = [];
  try {
    const res = await slack.conversationsReplies(channel, threadTs, HISTORY_LIMIT);
    raw = res ?? [];
  } catch (e) {
    console.error("[thread-agent] could not read thread history:", (e as Error).message);
    return [];
  }

  const turns: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const m of raw) {
    // Skip the message we are answering; it is appended as the final user turn by the caller.
    if (currentTs && m.ts === currentTs) continue;
    if (m.subtype === "channel_join" || m.subtype === "bot_add") continue;
    const text = (m.text ?? "").trim();
    if (!text) continue;

    const role: "user" | "assistant" = m.bot_id ? "assistant" : "user";
    // Cards run to thousands of characters and the agent only needs to know WHAT was posted, not
    // to re-read every bullet of a script from an hour ago.
    const clipped = role === "assistant" && text.length > 1200 ? `${text.slice(0, 1200)}\n[...card truncated]` : text;

    const last = turns[turns.length - 1];
    if (last && last.role === role) last.content += `\n\n${clipped}`;
    else turns.push({ role, content: clipped });
  }

  // Anthropic requires the first turn to be `user`.
  while (turns.length && turns[0].role === "assistant") turns.shift();
  return turns;
}

function systemPrompt(report: AuditReportRow, truthBlock: string): string {
  return [
    "You are BrainHeart, running inside the #ai-visibility-audits Slack thread for ONE prospect.",
    "Matthew is a founder selling AI search visibility to local businesses. He talks to you the way he would talk to a colleague who already knows the account. He is not going to remember command names, and he should not have to.",
    "",
    "YOUR JOB: work out what he actually wants, gather what you need, then do it or answer it. If he wants an email, you decide WHICH email based on where the conversation really is, and you write it with the right tool. If he asks a question, answer the question, do not produce an artifact he did not ask for.",
    "",
    "THE ACCOUNT:",
    `Business: ${report.client_name ?? report.website}${report.city ? `, ${report.city}` : ""}${report.business_type ? ` (${report.business_type})` : ""}`,
    `Website: ${report.website}`,
    report.prospect_name ? `Contact: ${report.prospect_name}` : "Contact name: not known.",
    report.prospect_email ?? report.requester_email ? `Email: ${report.prospect_email ?? report.requester_email}` : "Email: none on file.",
    `Stored stage: ${report.outreach_stage ?? "none"} (frequently stale, see below)`,
    "",
    truthBlock,
    "",
    "HOW TO DECIDE THINGS:",
    "- Before anything about where this stands, or any draft, call get_email_history. The stored stage only moves when someone types a command, so it drifts. The mailbox does not.",
    "- Before any number, call get_report. The only figures that exist are the ones it returns. Never round them, never derive new ones, never invent a competitor.",
    "- A recorded video proves it was MADE, not watched. Never treat a stored loom_url as evidence they have seen it. Only what get_email_history shows counts.",
    "- When he tells you something happened outside the system (he sent something, they replied, they said yes), record it with set_stage or save_asset FIRST, then act. Otherwise the next draft writes as if it never happened.",
    "- If two things are asked in one message, do both.",
    "- Reacting to a draft that is already on screen ('tighter', 'drop that line', 'warmer') is edit_draft, not draft_email. draft_email rewrites from scratch and throws away every fix he already made.",
    "- If what he typed is the PROSPECT talking rather than an instruction to you (a pasted reply, an objection), that is draft_email with kind=objection.",
    "",
    "HARD LINES, no exceptions:",
    "- There is NO guarantee on this offer. Never say guaranteed, risk-free, money-back, or anything that implies one.",
    "- Never promise customers, jobs, leads or revenue. This measures VISIBILITY and nothing else.",
    "- Never claim reach: no 'in front of X more people'. Nothing measures that. The honest number is how many buyer questions they are absent from.",
    "- No em dashes, no en dashes, never ' - ' as a connector.",
    "- You cannot send anything. Every email you write is a draft for Matthew to approve. Never say or imply that something has been sent.",
    "",
    "HOW TO WRITE BACK: short, plain, no preamble, no restating his question. If you posted a card to the thread, say in one line what it is and what is worth noticing about it, because the card is already on screen. If you could not do something, say exactly that and why. Never pad an answer to look thorough.",
  ]
    .filter(Boolean)
    .join("\n");
}

export interface AgentRunResult {
  reply: string;
  actions: string[];
}

/**
 * Run the agent against one thread message.
 *
 * The caller owns the placeholder message: agent runs take 20 to 60 seconds, and a thread that
 * shows nothing for a minute reads as broken. Slack's own 3s retry is already handled by the
 * `x-slack-retry-reason` drop at the top of the events route.
 */
export async function runThreadAgent(args: {
  report: AuditReportRow;
  channel: string;
  threadTs: string;
  /** ts of the message being answered, so it is not duplicated into the history. */
  messageTs: string | null;
  text: string;
}): Promise<AgentRunResult> {
  const ctx: AuditToolContext = {
    report: args.report,
    channel: args.channel,
    threadTs: args.threadTs,
    cache: {},
  };

  // Read the mailbox once, up front, and put it in the system prompt.
  //
  // It is the single most load-bearing fact in the thread and the one the old system got wrong, so
  // it is not left to the agent to remember to ask for. The tool stays available for a forced
  // re-read; this is the floor, not the ceiling.
  let truthBlock = "EMAIL HISTORY: not read yet, call get_email_history.";
  try {
    const t = await readThreadTruth(args.report);
    ctx.cache.truth = t;
    truthBlock = formatThreadTruth(t);
  } catch (e) {
    console.error("[thread-agent] thread truth failed:", (e as Error).message);
  }

  const history = await loadHistory(args.channel, args.threadTs, args.messageTs);
  const messages = [...history, { role: "user" as const, content: args.text }];

  const { response, actions } = await runConversationWithTools(
    messages,
    systemPrompt(args.report, truthBlock),
    undefined,
    {
      tools: AUDIT_THREAD_TOOLS,
      executor: makeAuditExecutor(ctx),
      model: "claude-sonnet-4-6",
      maxTokens: 2000,
      maxIterations: MAX_ITERATIONS,
    }
  );

  return { reply: noDashes(response.trim()), actions };
}
