// Simulator conversations — sandbox only. Manages the 6 phone slots and their
// messages. NEVER touches sms_conversations / sms_messages or any real transport.
//
//   GET            → ensure 6 slots exist, return them with their messages
//   PUT  {id,...}  → update a slot's stage / label / mode
//   POST {action}  → "reset" (one slot via id, or all slots) clears sim_messages

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { resolveTenantId } from "@/lib/persona";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SLOTS = [1, 2, 3, 4, 5, 6];

interface SimMessage {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  is_golden: boolean;
  edited_from: string | null;
  created_at: string;
}

async function ensureSlots(tenantId: string) {
  const { data: existing } = await supabaseAdmin
    .from("sim_conversations")
    .select("id, phone_slot")
    .eq("tenant_id", tenantId);

  const have = new Set((existing ?? []).map((r) => r.phone_slot as number));
  const missing = SLOTS.filter((s) => !have.has(s));
  if (missing.length) {
    await supabaseAdmin.from("sim_conversations").insert(
      missing.map((slot) => ({
        tenant_id: tenantId,
        phone_slot: slot,
        label: `Phone ${slot}`,
        stage: null,
        mode: "test",
      }))
    );
  }
}

export async function GET() {
  const tenantId = await resolveTenantId();
  if (!tenantId) return NextResponse.json({ error: "tenant not found" }, { status: 500 });

  await ensureSlots(tenantId);

  const { data: convs, error } = await supabaseAdmin
    .from("sim_conversations")
    .select("id, phone_slot, label, stage, mode")
    .eq("tenant_id", tenantId)
    .order("phone_slot", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (convs ?? []).map((c) => c.id);
  const { data: msgs } = await supabaseAdmin
    .from("sim_messages")
    .select("id, sim_conversation_id, direction, body, is_golden, edited_from, created_at")
    .in("sim_conversation_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"])
    .order("created_at", { ascending: true });

  const byConv: Record<string, SimMessage[]> = {};
  for (const m of msgs ?? []) {
    (byConv[m.sim_conversation_id as string] ||= []).push({
      id: m.id as string,
      direction: m.direction as "inbound" | "outbound",
      body: m.body as string,
      is_golden: m.is_golden as boolean,
      edited_from: (m.edited_from as string | null) ?? null,
      created_at: m.created_at as string,
    });
  }

  const phones = (convs ?? []).map((c) => ({
    id: c.id,
    phone_slot: c.phone_slot,
    label: c.label,
    stage: c.stage,
    mode: c.mode,
    messages: byConv[c.id as string] ?? [],
  }));

  return NextResponse.json({ phones });
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if ("label" in body) patch.label = String(body.label ?? "").slice(0, 80);
  if ("stage" in body) {
    const s = body.stage;
    patch.stage = s === null || s === "" ? null : Math.max(1, Math.min(4, Number(s)));
  }
  if ("mode" in body) patch.mode = body.mode === "train" ? "train" : "test";
  if (!Object.keys(patch).length) return NextResponse.json({ error: "nothing to update" }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from("sim_conversations")
    .update(patch)
    .eq("id", body.id)
    .select("id, phone_slot, label, stage, mode")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ phone: data });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (body?.action !== "reset") return NextResponse.json({ error: "unknown action" }, { status: 400 });

  if (body.id) {
    const { error } = await supabaseAdmin.from("sim_messages").delete().eq("sim_conversation_id", body.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // Reset the whole board for the tenant.
  const tenantId = await resolveTenantId();
  if (!tenantId) return NextResponse.json({ error: "tenant not found" }, { status: 500 });
  const { data: convs } = await supabaseAdmin
    .from("sim_conversations")
    .select("id")
    .eq("tenant_id", tenantId);
  const ids = (convs ?? []).map((c) => c.id);
  if (ids.length) {
    const { error } = await supabaseAdmin.from("sim_messages").delete().in("sim_conversation_id", ids);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
