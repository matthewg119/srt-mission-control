export const dynamic = "force-dynamic";
// ‼️ 60, THE SAME CEILING /api/chat DOCUMENTS, and the reason the plan renders server side and the
// slow work runs behind /api/internal/ops-workflow. A chat turn here must not be where a workflow
// happens.
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAIConfigured, buildSystemPrompt, runConversationWithTools } from "@/lib/ai";
import { executeTool, type ToolExecutionResult } from "@/lib/ai-tools";
import { PLAN_TOOL_NAMES, TODAY_PREAMBLE, TODAY_TOOLS } from "@/lib/today/chat-tools";
import { businessDayKey } from "@/lib/business-time";
import { supabaseAdmin } from "@/lib/db";
import { DAY_ROLES, type DayRole } from "@/config/roles";

// The chat beside the day.
//
// ‼️ A SEPARATE ENDPOINT, NOT A FLAG ON /api/chat, because the DIFFERENCE IS THE TOOL SET. Four
// sending tools are absent here. A shared route with a mode parameter would put the safety of this
// surface behind a boolean somebody could forget to pass.

interface ToolInput {
  item_key?: unknown;
  role?: unknown;
  workflow_key?: unknown;
  note?: unknown;
}

/**
 * The four doorways this surface adds. Everything else falls through to the shared executor.
 *
 * ‼️ IT RETURNS ToolExecutionResult, THE SAME SHAPE executeTool DOES. `content` is the JSON the model
 * reads and `structuredData` is what the chat UI renders as a card. Returning a bare object here
 * would reach the loop as a value with no `.content`, which the API then refuses with a 400 that
 * names no tool.
 */
async function executeTodayTool(
  name: string,
  input: Record<string, unknown>,
  requestedBy: string
): Promise<ToolExecutionResult> {
  const args = (input ?? {}) as ToolInput;
  const out = (value: unknown): ToolExecutionResult => ({
    content: JSON.stringify(value),
    structuredData: value,
  });

  if (name === "get_today_plan") {
    const { buildDayPlan } = await import("@/lib/today/plan");
    const plan = await buildDayPlan();
    const want = DAY_ROLES.includes(args.role as DayRole) ? (args.role as DayRole) : null;
    const groups = want ? plan.groups.filter((g) => g.role === want) : plan.groups;
    return out({
      planDay: plan.planDay,
      estMinutes: plan.estMinutes,
      unreadable: plan.unreadable,
      groups: groups.map((g) => ({
        role: g.role,
        label: g.label,
        estMinutes: g.estMinutes,
        items: g.items.map((i) => ({
          key: i.key,
          title: i.title,
          why: i.reasons,
          estMinutes: i.effortMinutes,
          unblocks: i.unblocks,
          client: i.clientName,
          link: i.slackPermalink ?? i.href,
        })),
      })),
      later: plan.later.length,
    });
  }

  if (name === "reorder_today_item" || name === "defer_today_item") {
    const itemKey = typeof args.item_key === "string" ? args.item_key : "";
    if (!itemKey) return out({ error: "item_key is required" });

    const { itemKeyScope } = await import("@/lib/today/item");
    if (!itemKeyScope(itemKey).source) return out({ error: `"${itemKey}" is not a day item key` });

    // The role is read off the live plan rather than taken from the model: a lane it invented would
    // move the item somewhere the page does not render it.
    const { buildDayPlan } = await import("@/lib/today/plan");
    const plan = await buildDayPlan();
    const found = [...plan.groups.flatMap((g) => g.items), ...plan.later].find((i) => i.key === itemKey);
    if (!found) return out({ error: "that item is not on today's plan" });

    const defer = name === "defer_today_item";
    const { error } = await supabaseAdmin.from("day_plan_order").upsert(
      {
        plan_day: businessDayKey(new Date()),
        item_key: itemKey,
        role: found.role,
        // Top of the lane. Every other pin sits at zero or above, so a negative is unambiguously first.
        position: defer ? 0 : -1,
        deferred_until: defer ? new Date(Date.now() + 86_400_000).toISOString() : null,
        client_id: found.clientId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "plan_day,item_key" }
    );
    if (error) return out({ error: `nothing was changed: ${error.message}` });
    return out({ ok: true, item: found.title, action: defer ? "moved to Not today" : "moved to the top of its lane" });
  }

  if (name === "run_ops_workflow") {
    const { startOpsWorkflow, listOpsWorkflows } = await import("@/lib/ops/workflows");
    const key = typeof args.workflow_key === "string" ? args.workflow_key : "";
    if (!key) return out({ error: "workflow_key is required", available: listOpsWorkflows() });
    const res = await startOpsWorkflow({
      workflowKey: key,
      requestedBy: requestedBy,
      note: typeof args.note === "string" ? args.note : null,
    });
    if (!res.ok) return out({ error: res.error });
    return out({
      status: "running",
      label: res.label,
      note: "It has STARTED. Say so, and do not describe its output: it posts to #alerts-infra when it is done.",
    });
  }

  return out({ error: `no such tool: ${name}` });
}

export async function POST(request: NextRequest) {
  const session = await auth().catch(() => null);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isAIConfigured()) {
    return NextResponse.json(
      { error: "AI_NOT_CONFIGURED", message: "Anthropic API key not configured." },
      { status: 503 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    messages?: Array<{ role: string; content: string }>;
    conversationId?: string;
  };
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!messages.length) return NextResponse.json({ error: "Messages array is required" }, { status: 400 });

  const who = (session.user.name as string) || (session.user.email as string) || "Matthew";
  // Narrowed rather than cast wholesale: an unknown role reaching the loop is a message shape the
  // Anthropic API refuses, and the refusal arrives as a 400 with no clue which message caused it.
  const filtered = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: String(m.content ?? "") }));
  const systemPrompt = `${TODAY_PREAMBLE}\n\n${await buildSystemPrompt()}`;

  const { response, actions, toolResults, turnBlocks } = await runConversationWithTools(
    filtered,
    systemPrompt,
    undefined,
    {
      tools: TODAY_TOOLS,
      maxIterations: 8,
      executor: async (name: string, input: Record<string, unknown>) =>
        PLAN_TOOL_NAMES.has(name) ? executeTodayTool(name, input, who) : executeTool(name, input),
    }
  );

  if (body.conversationId) {
    const { conversationFor, saveTurn } = await import("@/lib/chat-memory");
    const last = messages[messages.length - 1];
    const resolved = await conversationFor({
      externalKey: body.conversationId,
      surface: "web",
      title: String(last?.content ?? "").slice(0, 80),
    });
    await saveTurn({
      conversationId: resolved,
      userText: String(last?.content ?? ""),
      assistantText: response,
      toolBlocks: turnBlocks,
    }).catch((e) => console.error("[api/today/chat] turn not saved:", (e as Error).message));
  }

  return NextResponse.json({ message: response, actions, toolResults });
}
