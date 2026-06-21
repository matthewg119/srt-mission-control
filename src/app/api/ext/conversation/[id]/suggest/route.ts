export const dynamic = "force-dynamic";
// AI reply suggestion for the bubble. Reuses the live draft engine
// (draftSmsReply -> generateDraft) so the suggestion uses the same persona +
// voice corpus as everything else. No Anthropic key ever reaches the extension.
//
// Body (all optional):
//   { inbound?: string }         -> draft a reply to this message
//   { followupReason?: string }  -> draft a proactive check-in (mirrors runDueFollowups)
// If neither is given, the conversation's most recent inbound is used.

import { NextRequest } from "next/server";
import { requireExtTenant, jsonCors, preflight } from "@/lib/ext-auth";
import { supabaseAdmin } from "@/lib/db";
import { draftSmsReply } from "@/lib/sms-ai-engine";

export const runtime = "nodejs";
export const maxDuration = 30;

export function OPTIONS(req: NextRequest) {
  return preflight(req);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const tenant = await requireExtTenant(req);
  if (!tenant) return jsonCors(req, { ok: false, error: "unauthorized" }, 401);

  const { id } = await params;
  const parsed = await req.json().catch(() => ({}));

  let inbound: string | null = (parsed?.inbound as string | undefined)?.trim() ?? null;
  const followupReason = (parsed?.followupReason as string | undefined)?.trim() ?? null;

  if (!inbound && followupReason) {
    inbound = `<follow-up: ${followupReason}>`;
  }
  if (!inbound) {
    const { data: last } = await supabaseAdmin
      .from("sms_messages")
      .select("body")
      .eq("conversation_id", id)
      .eq("direction", "inbound")
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    inbound = (last?.body as string | undefined)?.trim() ?? null;
  }
  if (!inbound) {
    return jsonCors(req, { ok: false, error: "no_inbound_to_reply_to" }, 400);
  }

  const { draft, suggestedFollowup } = await draftSmsReply(id, inbound);
  if (!draft) return jsonCors(req, { ok: false, error: "draft_failed" }, 502);

  return jsonCors(req, { ok: true, draft, inbound, suggestedFollowup });
}
