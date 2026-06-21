export const dynamic = "force-dynamic";
// Due follow-ups for the bubble's "stars" glow. Reuses the sms_followups table
// (status='scheduled', due_at<=now) that runDueFollowups() drives. Pass
// ?conversationId= to check a single thread, or omit for the tenant's full list.

import { NextRequest } from "next/server";
import { requireExtTenant, jsonCors, preflight } from "@/lib/ext-auth";
import { supabaseAdmin } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 30;

export function OPTIONS(req: NextRequest) {
  return preflight(req);
}

export async function GET(req: NextRequest) {
  const tenant = await requireExtTenant(req);
  if (!tenant) return jsonCors(req, { ok: false, error: "unauthorized" }, 401);

  const conversationId = new URL(req.url).searchParams.get("conversationId");
  const nowIso = new Date().toISOString();

  let query = supabaseAdmin
    .from("sms_followups")
    .select("conversation_id, reason, due_at")
    .eq("status", "scheduled")
    .lte("due_at", nowIso)
    .order("due_at", { ascending: true })
    .limit(100);

  if (conversationId) query = query.eq("conversation_id", conversationId);

  const { data } = await query;
  const due = (data ?? []).map((r) => ({
    conversationId: r.conversation_id,
    reason: r.reason,
    due_at: r.due_at,
  }));

  return jsonCors(req, { ok: true, due });
}
