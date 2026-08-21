import { supabaseAdmin } from "./db";
import { AI_TOOLS, executeTool, type ToolExecutionResult } from "./ai-tools";
// One source of truth for the stage list. The prompt used to hardcode five and
// insist there were no others, while the tool schemas advertised all seven off
// this same config — so the model was told Untouched and Take Off List did not
// exist and then handed tools that accepted them.
import { ALL_STAGES } from "@/config/stage-display";

export interface ToolResult {
  tool: string;
  data: unknown;
  input: Record<string, unknown>;
}

/**
 * The raw Anthropic content blocks a single assistant turn produced: its
 * `tool_use` calls and the `tool_result` blocks we fed back.
 *
 * These used to live only inside the loop's local array and were dropped on
 * return, so a follow-up question arrived with the schema, the SQL and the rows
 * all gone — and the model had to rediscover every one of them before it could
 * answer, which is what exhausted the iteration budget. Persisting them is what
 * makes "give me 50 more" cheaper than the question before it instead of
 * dearer.
 */
export type TurnBlocks = AnthropicMessage[];

/**
 * A tool_result carrying 200 rows of JSON is a large thing to replay on every
 * subsequent turn, and the model needs the QUERY it ran far more than it needs
 * every row back. Past this many characters the payload is summarised.
 */
const MAX_STORED_TOOL_RESULT = 8000;
const KEPT_ROWS = 10;

/**
 * Shrink a tool_result for storage. Keeps whatever scalar fields the tool
 * returned (sql, purpose, rowCount, truncated…) and trims only the row array,
 * marking the elision so the model knows the list is partial rather than
 * believing it saw everything.
 */
export function summariseToolResult(content: string): string {
  if (content.length <= MAX_STORED_TOOL_RESULT) return content;

  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    for (const key of ["rows", "leads", "results", "data", "items"]) {
      const value = parsed[key];
      if (Array.isArray(value) && value.length > KEPT_ROWS) {
        return JSON.stringify({
          ...parsed,
          [key]: value.slice(0, KEPT_ROWS),
          _elided: `Showing ${KEPT_ROWS} of ${value.length} rows. The full set was returned to the user earlier in this conversation; re-run the query with an offset rather than assuming these are all of them.`,
        });
      }
    }
  } catch {
    // Not JSON, or not a shape we recognise — fall through to a blunt trim.
  }

  return `${content.slice(0, MAX_STORED_TOOL_RESULT)}\n…[truncated for storage]`;
}

const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

export const isAIConfigured = (): boolean => {
  return !!anthropicApiKey && anthropicApiKey.trim().length > 0;
};

export async function buildSystemPrompt(): Promise<string> {
  const { data: entries } = await supabaseAdmin
    .from("knowledge_entries")
    .select("title, content, category");

  const knowledgeBlock = entries?.length
    ? entries.map((e) => `### ${e.title} (${e.category})\n${e.content}`).join("\n\n")
    : "No knowledge base entries yet.";

  // Fetch AI config from integrations table
  const { data: aiConfig } = await supabaseAdmin
    .from("integrations")
    .select("config")
    .eq("name", "AI Configuration")
    .single();

  const priorities =
    (aiConfig?.config as Record<string, string>)?.priorities || "No specific priorities set.";
  const additionalContext =
    (aiConfig?.config as Record<string, string>)?.additionalContext || "";

  return `You are the AI Office Manager for SRT Agency ("Search Retrieval Tactics"), an AEO agency: we make a business findable and citable by AI assistants.

You are NOT just a chatbot — you are an active team member who can TAKE ACTIONS. You can work the call board, log calls, move leads, send messages, and manage operations.

COMPANY: SRT builds the part of a business's own website that AI can actually read, so that when someone asks ChatGPT or a similar assistant for a business like theirs, they get named and sent customers.
Website: srtagency.com | CRM: Mission Control (mission.srtagency.com)

WHAT WE SELL:
- The free first step, which is what we lead with: we build one section of their own site that AI can read and cite. No charge, no card, they just have to say yes.
- Paid AEO engagements follow from that: ongoing coverage, monitoring and expansion across their site.
The free build is the offer, not a teaser. It is how the conversation starts.

SRT DOES NOT DO BUSINESS FUNDING. We used to broker merchant cash advances and lines of credit. That business is over. Never pitch financing, never mention lenders, funders, bank statements, factor rates, advances or approvals, and never treat a lead's old funding history as a reason to call them. Many leads in this CRM were originally funding leads. They are AEO prospects now and nothing else.

TEAM: Matthew (CEO/Founder), Benjamin (Sales)

PIPELINE (contacts.application_stage — these ${ALL_STAGES.length}, nothing else):
${ALL_STAGES.map((s) => s.name).join(" → ")}

LEAD SOURCE: contacts.source is free text carrying where the lead came from. Live values include "DB 1.0" (the bulk import, the bulk of the book), "Meta Ads", "Newsletter Signup", "Website - Contact Form", "facebook_lead", "scan" and "Manual". Match it case-insensitively — the casing is not consistent.

YOUR CAPABILITIES (use your tools!):
1. WORK THE CALL BOARD: who to call, why, and what was said last — use get_worklist
2. MOVE LEADS: change a lead's stage when instructed (always confirm first)
3. SEND MESSAGES: Send SMS or Email to contacts — custom or from templates
4. USE TEMPLATES: pre-built SMS/Email templates for every stage
5. VIEW ACTIVITY: Check recent system activity and automation logs
6. ADVISE: Answer operations questions, plan strategies, draft content in English or Spanish
7. CHALLENGE: Push back on weak logic, be direct and action-oriented

CRM — MISSION CONTROL IS THE SYSTEM OF RECORD:
Zoho is being retired. Everything about a lead lives here now:
- \`contacts\` = the lead. Its status is one of the five stages listed above.
- \`lead_activities\` = the timeline. Every note, call, text, email and status change.
- \`lead_tasks\` = follow-ups. An OPEN task is a commitment to a next date.

THE ONE RULE THAT MATTERS: every logged call must leave a follow-up date behind.
The call board's top bucket is "working lead with NO follow-up scheduled" — a call
logged without a next date drops that lead straight into the neglected pile. So:
- log_call REQUIRES next_follow_up_date. If the user describes a call without
  saying when to follow up, ASK them. Never invent a date, never skip the tool.
- When completing a task on a lead that is still live, set the next follow-up in
  the same step.

CRM TOOLS:
- "Who do we need to call today?" / "who should I follow up with?" → get_worklist.
  It returns leads ranked with a plain reason each. Read the reasons back — don't
  just list names.
- Looking someone up → get_lead. Their history → get_lead_timeline.
- Filtering the book → search_leads_db. Counts → get_lead_stats.
- Recording work → log_call, add_lead_note, set_lead_status, create_lead_task,
  complete_lead_task, snooze_lead.
- Anything the tools above don't cover → describe_schema FIRST, then
  query_database. Only read-only crm_read.* views are reachable; sensitive
  fields are not exposed. Prefer a typed tool whenever one fits.

LINK EVERY LEAD YOU NAME:
Whenever you print a lead's name or business in an answer, write it as a markdown
link to its page: [BelleCutis](/dashboard/leads/6f1c…). The id is the \`id\` field on
every lead your tools return — it is there for exactly this. This applies to lists,
tables and single mentions alike, so a name on screen is always one click from the
record. Never invent an id, and never link a lead whose id you were not given: link
only the leads a tool actually returned, and print the rest as plain text.

IMPORTANT RULES:
- When asked about leads or pipeline status, ALWAYS use your tools to get real data. Never guess.
- When asked to move a lead or send a message, use the appropriate tool. Confirm destructive actions first.
- When asked "what's going on" or for a status update, use get_lead_stats and get_worklist.
- Be concise and direct. Use bullet points for data. Bold key numbers.
- If you take an action, clearly state what you did.
- Never use an em dash in anything you draft for sending. Commas, periods and hyphens only.
- If anything below mentions business funding, lenders, MCA or bank statements, it is stale. Ignore it.

KNOWLEDGE BASE:
${knowledgeBlock}

CURRENT PRIORITIES:
${priorities}

${additionalContext ? `ADDITIONAL CONTEXT:\n${additionalContext}` : ""}`;
}

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | Array<{
    type: string;
    tool_use_id?: string;
    content?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
    text?: string;
  }>;
}

interface AnthropicResponse {
  id: string;
  content: Array<{
    type: "text" | "tool_use";
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
  }>;
  stop_reason: "end_turn" | "tool_use" | "max_tokens";
}

/**
 * Run a full conversation with tool use support.
 * Handles the tool loop: AI calls tool → we execute → send results → AI continues.
 * Returns the final text response.
 */
export interface ImageBlock {
  type: "image";
  source: { type: "base64"; media_type: string; data: string };
}

/**
 * Swap the tool set without forking the loop.
 *
 * The loop itself (tool_use -> execute -> feed results back) is domain-agnostic; only the tools and
 * the executor are not. The audit thread needs a completely different set from the Office Manager's
 * pipeline tools, and copying 100 lines of message-shuttling to get it is how the two copies drift.
 *
 * Every field is optional and defaults to today's behaviour, so the Office Manager, the dashboard
 * chat and the Telegram bot are untouched by this.
 */
export interface ToolLoopOptions {
  tools?: unknown[];
  /** Must return a JSON-serialisable string for Claude plus anything the caller wants for its UI. */
  executor?: (name: string, input: Record<string, unknown>) => Promise<ToolExecutionResult>;
  model?: string;
  maxTokens?: number;
  /** More iterations = more reasoning, more tokens. 5 is the Office Manager's number. */
  maxIterations?: number;
}

export async function runConversationWithTools(
  messages: Array<{
    role: "user" | "assistant";
    content: string;
    /** Blocks this assistant turn produced on a previous request — see TurnBlocks. */
    toolBlocks?: TurnBlocks | null;
  }>,
  systemPrompt: string,
  lastMessageImages?: ImageBlock[],
  opts: ToolLoopOptions = {}
): Promise<{
  response: string;
  actions: string[];
  toolResults: ToolResult[];
  turnBlocks: TurnBlocks;
}> {
  if (!isAIConfigured()) {
    throw new Error("AI_NOT_CONFIGURED");
  }

  const tools = opts.tools ?? AI_TOOLS;
  const runTool = opts.executor ?? executeTool;
  const model = opts.model ?? "claude-sonnet-4-6";
  const maxTokens = opts.maxTokens ?? 4096;

  const conversationMessages: AnthropicMessage[] = [];

  messages.forEach((m, i) => {
    // Last user message: prepend images if provided
    if (lastMessageImages && lastMessageImages.length > 0 && i === messages.length - 1 && m.role === "user") {
      conversationMessages.push({
        role: m.role,
        content: [
          ...lastMessageImages,
          { type: "text", text: m.content },
        ],
      });
      return;
    }

    // Replay the tool calls this assistant turn made, in the order the API
    // requires: the assistant message carrying the tool_use blocks, then the
    // user message carrying their tool_result blocks. The stored blocks already
    // include the assistant's own text, so the plain-text row is skipped in
    // favour of them rather than added alongside — sending both would repeat
    // the answer and orphan the tool_use ids.
    if (m.role === "assistant" && m.toolBlocks && m.toolBlocks.length > 0) {
      conversationMessages.push(...m.toolBlocks);
      if (m.content) conversationMessages.push({ role: "assistant", content: m.content });
      return;
    }

    conversationMessages.push({ role: m.role, content: m.content });
  });

  const actions: string[] = [];
  const uiToolResults: ToolResult[] = []; // structured results for UI card rendering
  const turnBlocks: TurnBlocks = []; // this turn's tool traffic, for the next turn to replay
  let maxIterations = opts.maxIterations ?? 5;

  while (maxIterations > 0) {
    maxIterations--;

    // On the last permitted round-trip, take the tools away so the model has to
    // answer from what it already has. Without this the budget can be spent
    // entirely on tool calls and the user gets an error instead of the work
    // those calls actually did.
    const finalRound = maxIterations === 0;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicApiKey!,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        tools,
        ...(finalRound ? { tool_choice: { type: "none" } } : {}),
        messages: conversationMessages,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic API error: ${errorText}`);
    }

    const data: AnthropicResponse = await response.json();

    if (data.stop_reason === "end_turn" || data.stop_reason === "max_tokens") {
      const textContent = data.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("");
      return { response: textContent, actions, toolResults: uiToolResults, turnBlocks };
    }

    if (data.stop_reason === "tool_use") {
      const assistantTurn: AnthropicMessage = {
        role: "assistant",
        content: data.content.map((c) => {
          if (c.type === "text") return { type: "text" as const, text: c.text };
          return { type: "tool_use" as const, id: c.id!, name: c.name!, input: c.input! };
        }),
      };
      conversationMessages.push(assistantTurn);
      turnBlocks.push(assistantTurn);

      const claudeToolResults: Array<{ type: "tool_result"; tool_use_id: string; content: string }> = [];

      for (const block of data.content) {
        if (block.type === "tool_use" && block.name && block.id) {
          const inputPayload = block.input || {};
          actions.push(`${block.name}(${JSON.stringify(inputPayload).slice(0, 100)})`);

          const execution: ToolExecutionResult = await runTool(block.name, inputPayload);

          claudeToolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: execution.content, // JSON string goes to Claude
          });

          // Collect structured data for UI rendering
          uiToolResults.push({
            tool: block.name,
            data: execution.structuredData,
            input: inputPayload,
          });
        }
      }

      conversationMessages.push({ role: "user", content: claudeToolResults });

      // The stored copy is summarised; the live one above is not. The model
      // gets every row on the turn that asked for them, and a trimmed version
      // on every turn after.
      turnBlocks.push({
        role: "user",
        content: claudeToolResults.map((r) => ({
          ...r,
          content: summariseToolResult(r.content),
        })),
      });
    }
  }

  // Reachable only if the final round still came back as tool_use, which
  // tool_choice: "none" forbids. Kept as a backstop rather than a promise.
  return {
    response: "I hit the maximum number of tool calls. Please try a simpler request.",
    actions,
    toolResults: uiToolResults,
    turnBlocks,
  };
}

// Keep the streaming function for backwards compat (non-tool-use mode)
export async function streamChatResponse(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  systemPrompt: string
): Promise<Response> {
  if (!isAIConfigured()) {
    throw new Error("AI_NOT_CONFIGURED");
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicApiKey!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      stream: true,
      system: systemPrompt,
      messages,
    }),
  });

  return response;
}
