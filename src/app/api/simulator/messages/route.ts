// Simulator messages — train-mode actions on a single sim message.
//
//   PATCH { id, action: "golden", value }   → toggle is_golden on the sim message
//   PATCH { id, action: "edit", body }       → edit a bot draft in place (keeps edited_from)
//   PATCH { id, action: "promote" }          → copy this outbound (paired with its
//                                               preceding inbound) into voice_examples
//                                               as a GOLDEN example. This is the core
//                                               "teach the bot" loop.
//
// Writes only to sim_messages and voice_examples.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { resolveTenantId } from "@/lib/persona";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const id = body?.id as string | undefined;
  const action = body?.action as string | undefined;
  if (!id || !action) return NextResponse.json({ error: "id and action required" }, { status: 400 });

  const { data: msg } = await supabaseAdmin
    .from("sim_messages")
    .select("id, sim_conversation_id, direction, body, edited_from, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!msg) return NextResponse.json({ error: "message not found" }, { status: 404 });

  if (action === "golden") {
    const { data, error } = await supabaseAdmin
      .from("sim_messages")
      .update({ is_golden: Boolean(body.value) })
      .eq("id", id)
      .select("id, direction, body, is_golden, edited_from, created_at")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ message: data });
  }

  if (action === "edit") {
    const newBody = (body.body as string | undefined)?.trim();
    if (!newBody) return NextResponse.json({ error: "body required" }, { status: 400 });
    // Keep the original draft once, so we can show "edited from ...".
    const editedFrom = (msg.edited_from as string | null) ?? (msg.body as string);
    const { data, error } = await supabaseAdmin
      .from("sim_messages")
      .update({ body: newBody, edited_from: editedFrom })
      .eq("id", id)
      .select("id, direction, body, is_golden, edited_from, created_at")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ message: data });
  }

  if (action === "promote") {
    if (msg.direction !== "outbound") {
      return NextResponse.json({ error: "only outbound messages can be promoted" }, { status: 400 });
    }
    // Find the inbound that immediately preceded this outbound in the thread.
    const { data: prevInbound } = await supabaseAdmin
      .from("sim_messages")
      .select("body, created_at")
      .eq("sim_conversation_id", msg.sim_conversation_id)
      .eq("direction", "inbound")
      .lt("created_at", msg.created_at as string)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!prevInbound) {
      return NextResponse.json({ error: "no preceding inbound to pair with" }, { status: 400 });
    }
    const tenantId = await resolveTenantId();
    if (!tenantId) return NextResponse.json({ error: "tenant not found" }, { status: 500 });

    const reply = (msg.body as string).trim();
    const { error } = await supabaseAdmin.from("voice_examples").insert({
      tenant_id: tenantId,
      source: "sms_messages",
      incoming: (prevInbound.body as string).trim(),
      reply,
      char_len: reply.length,
      is_golden: true,
      metadata: { origin: "simulator_promote" },
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Mark the sim message golden too, for visual confirmation.
    await supabaseAdmin.from("sim_messages").update({ is_golden: true }).eq("id", id);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
