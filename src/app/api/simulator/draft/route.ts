// Simulator draft — the sandbox brain. Takes a merchant message typed in a phone
// slot, runs the REAL draft logic (generateDraft), and stores both turns in
// sim_messages. It must NEVER write sms_messages / sms_conversations or call Slack,
// Zoho, LoopMessage, or any real transport. The only side effects are sim_* writes
// and the Anthropic call inside generateDraft.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { resolveTenantId } from "@/lib/persona";
import { generateDraft, DraftHistoryMessage } from "@/lib/sms-ai-engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const simConversationId = body?.simConversationId as string | undefined;
  const inbound = (body?.inbound as string | undefined)?.trim();
  if (!simConversationId || !inbound) {
    return NextResponse.json({ error: "simConversationId and inbound required" }, { status: 400 });
  }

  const tenantId = await resolveTenantId();
  if (!tenantId) return NextResponse.json({ error: "tenant not found" }, { status: 500 });

  // Load the slot (for stage + label).
  const { data: conv } = await supabaseAdmin
    .from("sim_conversations")
    .select("id, stage, label")
    .eq("id", simConversationId)
    .maybeSingle();
  if (!conv) return NextResponse.json({ error: "sim conversation not found" }, { status: 404 });

  // Store the inbound (you-as-merchant) turn.
  const { data: inboundRow, error: inErr } = await supabaseAdmin
    .from("sim_messages")
    .insert({ sim_conversation_id: simConversationId, direction: "inbound", body: inbound })
    .select("id, direction, body, is_golden, edited_from, created_at")
    .single();
  if (inErr) return NextResponse.json({ error: inErr.message }, { status: 500 });

  // Build history from prior sim messages (already includes the inbound above).
  const { data: priorMsgs } = await supabaseAdmin
    .from("sim_messages")
    .select("direction, body, created_at")
    .eq("sim_conversation_id", simConversationId)
    .order("created_at", { ascending: true })
    .limit(20);

  // History excludes the just-inserted latest inbound (it's passed separately).
  const history: DraftHistoryMessage[] = (priorMsgs ?? [])
    .slice(0, -1)
    .map((m) => ({ direction: m.direction as "inbound" | "outbound", body: m.body as string }));

  const { draft, voiceExamples, personaSource, suggestedFollowup } = await generateDraft({
    tenantId,
    stage: (conv.stage as number | null) ?? null,
    inboundMessage: inbound,
    history,
    // Simulator has no real contact; use the slot label as a friendly first name.
    contact: { firstName: (conv.label as string | null)?.replace(/^Phone\s*/i, "") || "there" },
  });

  let outboundRow = null;
  if (draft) {
    const { data, error: outErr } = await supabaseAdmin
      .from("sim_messages")
      .insert({ sim_conversation_id: simConversationId, direction: "outbound", body: draft })
      .select("id, direction, body, is_golden, edited_from, created_at")
      .single();
    if (outErr) return NextResponse.json({ error: outErr.message }, { status: 500 });
    outboundRow = data;
  }

  return NextResponse.json({
    inbound: inboundRow,
    outbound: outboundRow,
    draft,
    voiceExamples,
    personaSource,
    suggestedFollowup,
  });
}
