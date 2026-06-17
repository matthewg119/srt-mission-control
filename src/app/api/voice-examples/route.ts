// Voice examples — browse/curate the real (incoming -> reply) corpus that powers
// the bot's voice. Used by the simulator's train mode.
//
//   GET  ?search=&limit=&golden=1  → list examples (ILIKE search over incoming/reply)
//   PATCH { id, action }            → "golden" toggle, "edit" reply, "deactivate"
//   POST  { incoming, reply }       → add a new golden example by hand

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { resolveTenantId } from "@/lib/persona";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const tenantId = await resolveTenantId();
  if (!tenantId) return NextResponse.json({ error: "tenant not found" }, { status: 500 });

  const url = new URL(req.url);
  const search = url.searchParams.get("search")?.trim();
  const goldenOnly = url.searchParams.get("golden") === "1";
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "50"), 200);

  let query = supabaseAdmin
    .from("voice_examples")
    .select("id, source, incoming, reply, char_len, ts, is_golden, is_active, created_at")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("is_golden", { ascending: false })
    .order("ts", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (goldenOnly) query = query.eq("is_golden", true);
  if (search) query = query.or(`incoming.ilike.%${search}%,reply.ilike.%${search}%`);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Total active count for the header.
  const { count } = await supabaseAdmin
    .from("voice_examples")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("is_active", true);

  return NextResponse.json({ examples: data ?? [], total: count ?? 0 });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const id = body?.id as string | undefined;
  const action = body?.action as string | undefined;
  if (!id || !action) return NextResponse.json({ error: "id and action required" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (action === "golden") patch.is_golden = Boolean(body.value);
  else if (action === "deactivate") patch.is_active = false;
  else if (action === "edit") {
    const reply = (body.reply as string | undefined)?.trim();
    if (!reply) return NextResponse.json({ error: "reply required" }, { status: 400 });
    patch.reply = reply;
    patch.char_len = reply.length;
  } else {
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("voice_examples")
    .update(patch)
    .eq("id", id)
    .select("id, source, incoming, reply, char_len, ts, is_golden, is_active, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ example: data });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const incoming = (body?.incoming as string | undefined)?.trim();
  const reply = (body?.reply as string | undefined)?.trim();
  if (!incoming || !reply) return NextResponse.json({ error: "incoming and reply required" }, { status: 400 });

  const tenantId = await resolveTenantId();
  if (!tenantId) return NextResponse.json({ error: "tenant not found" }, { status: 500 });

  const { data, error } = await supabaseAdmin
    .from("voice_examples")
    .insert({
      tenant_id: tenantId,
      source: "sms_messages",
      incoming,
      reply,
      char_len: reply.length,
      is_golden: true,
      metadata: { origin: "manual" },
    })
    .select("id, source, incoming, reply, char_len, ts, is_golden, is_active, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ example: data });
}
