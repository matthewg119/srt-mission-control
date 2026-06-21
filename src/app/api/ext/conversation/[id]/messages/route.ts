export const dynamic = "force-dynamic";
// Thread for the bubble — same query as the dashboard's conversations/[id]/messages,
// gated by the extension bearer token + CORS.
import { NextRequest } from "next/server";
import { requireExtTenant, jsonCors, preflight } from "@/lib/ext-auth";
import { supabaseAdmin } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 30;

export function OPTIONS(req: NextRequest) {
  return preflight(req);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const tenant = await requireExtTenant(req);
  if (!tenant) return jsonCors(req, { ok: false, error: "unauthorized" }, 401);

  const { id } = await params;
  const { data: messages } = await supabaseAdmin
    .from("sms_messages")
    .select("id, direction, body, created_at")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true })
    .limit(500);

  return jsonCors(req, { ok: true, messages: messages ?? [] });
}
