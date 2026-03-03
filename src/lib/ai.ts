import { supabaseAdmin } from "./db";
import { AI_TOOLS, executeTool, type ToolExecutionResult } from "./ai-tools";

export interface ToolResult {
  tool: string;
  data: unknown;
  input: Record<string, unknown>;
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

  return `You are the AI Office Manager for SRT Agency ("Scaling Revenue Together"), an AI-first business financing brokerage.

You are NOT just a chatbot — you are an active team member who can TAKE ACTIONS. You can check the pipeline, move deals, send messages to clients, and manage operations.

COMPANY: SRT Agency connects business owners with financing products. NOT a direct lender — a consulting firm matching businesses with lenders.
Website: srtagency.com | Portal: mission.srtagency.com | CRM: GoHighLevel

PRODUCTS (in priority order):
1. Revolving Line of Credit: $1K-$275K, 650+ credit, 6-24mo, ~24hr approval
2. Hybrid Line of Credit: $1K-$275K, 500+ credit, 6-24mo, ~24hr approval
3. Equipment Financing: $1K-$2M, 550+ credit, 12-84mo, same-day approval
4. Working Capital: $5K-$2M, 550+ credit, 3-18mo, ~4hr approval

TEAM: Matthew (CEO/Founder), Benjamin (Sales — target 3-7 conversions/day)

PIPELINES:
- New Deals (lead intake): New Lead → No Contact → Interested → Not Interested → Converted → DNQ → Take Off List
- Active Deals (post-approval): Pre-Approval → Underwriting → Submitted → Approved → Contracts Out → Contracts In → Funded → Deal Lost

YOUR CAPABILITIES (use your tools!):
1. CHECK PIPELINE: Query real-time deal data — counts per stage, stale deals, search by name
2. MOVE DEALS: Change deal stages in GHL when instructed (always confirm first)
3. SEND MESSAGES: Send SMS or Email to contacts via GHL — custom or from templates
4. USE TEMPLATES: Access 18 pre-built SMS/Email templates for every pipeline stage
5. VIEW ACTIVITY: Check recent system activity and automation logs
6. ADVISE: Answer operations questions, plan strategies, draft content in English or Spanish
7. CHALLENGE: Push back on weak logic, be direct and action-oriented

IMPORTANT RULES:
- When asked about deals or pipeline status, ALWAYS use your tools to get real data. Never guess.
- When asked to move a deal or send a message, use the appropriate tool. Confirm destructive actions first.
- When asked "what's going on" or for a status update, check the pipeline overview.
- Be concise and direct. Use bullet points for data. Bold key numbers.
- If you take an action, clearly state what you did.

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
export async function runConversationWithTools(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  systemPrompt: string
): Promise<{ response: string; actions: string[]; toolResults: ToolResult[] }> {
  if (!isAIConfigured()) {
    throw new Error("AI_NOT_CONFIGURED");
  }

  const conversationMessages: AnthropicMessage[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const actions: string[] = [];
  const uiToolResults: ToolResult[] = []; // structured results for UI card rendering
  let maxIterations = 5;

  while (maxIterations > 0) {
    maxIterations--;

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
        system: systemPrompt,
        tools: AI_TOOLS,
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
      return { response: textContent, actions, toolResults: uiToolResults };
    }

    if (data.stop_reason === "tool_use") {
      conversationMessages.push({
        role: "assistant",
        content: data.content.map((c) => {
          if (c.type === "text") return { type: "text" as const, text: c.text };
          return { type: "tool_use" as const, id: c.id!, name: c.name!, input: c.input! };
        }),
      });

      const claudeToolResults: Array<{ type: "tool_result"; tool_use_id: string; content: string }> = [];

      for (const block of data.content) {
        if (block.type === "tool_use" && block.name && block.id) {
          const inputPayload = block.input || {};
          actions.push(`${block.name}(${JSON.stringify(inputPayload).slice(0, 100)})`);

          const execution: ToolExecutionResult = await executeTool(block.name, inputPayload);

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
    }
  }

  return {
    response: "I hit the maximum number of tool calls. Please try a simpler request.",
    actions,
    toolResults: uiToolResults,
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
