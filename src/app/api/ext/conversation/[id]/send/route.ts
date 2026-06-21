export const dynamic = "force-dynamic";
// Send a reply from the bubble. Clone of the dashboard send path
// (sms/conversations/[id]/send) — same dispatchOutbound(source:'manual_send'),
// same outcome==='dead' guard and normalizePhone fallback — but authenticated
// with the extension bearer token instead of auth(), and CORS-enabled.
//
// When the Train toggle is on the extension passes { train:true } plus the AI
// suggestion that was shown. We record the result as a voice example: approve
// (sent === suggestion) or edit (sent !== suggestion). See ext-feedback.ts.

import { NextRequest } from "next/server";
import { requireExtTenant, jsonCors, preflight } from "@/lib/ext-auth";
import { supabaseAdmin } from "@/lib/db";
import { dispatchOutbound } from "@/lib/imessage-transport";
import { normalizePhone } from "@/lib/phone";
import { recordExtFeedback } from "@/lib/ext-feedback";

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
  const parsed = await req.json().catch(() => null);
  const body = (parsed?.body as string | undefined)?.trim();
  if (!body) return jsonCors(req, { ok: false, error: "body required" }, 400);

  const train = parsed?.train === true;
  const aiSuggestion = (parsed?.aiSuggestion as string | undefined)?.trim() ?? null;
  const inbound = (parsed?.inbound as string | undefined)?.trim() ?? null;

  const { data: conv } = await supabaseAdmin
    .from("sms_conversations")
    .select("id, phone, contact_id, outcome")
    .eq("id", id)
    .maybeSingle();

  if (!conv) return jsonCors(req, { ok: false, error: "not_found" }, 404);
  if (!conv.phone) return jsonCors(req, { ok: false, error: "no phone on this conversation" }, 400);
  if (conv.outcome === "dead") {
    return jsonCors(req, { ok: false, error: "Conversation is marked dead. Not sending." }, 400);
  }

  const phone = normalizePhone(conv.phone as string) ?? (conv.phone as string);
  const result = await dispatchOutbound({
    conversationId: id,
    contactId: (conv.contact_id as string | null) ?? null,
    phone,
    body,
    source: "manual_send",
  });

  if (!result.ok) {
    return jsonCors(req, { ok: false, error: result.error ?? "send failed" }, 500);
  }

  if (train) {
    const kind = !aiSuggestion || aiSuggestion === body ? "approve" : "edit";
    // Best-effort; never block the send response on the learning write.
    await recordExtFeedback({
      tenantId: tenant.tenantId,
      conversationId: id,
      kind,
      finalBody: body,
      aiSuggestion,
      inbound,
    });
  }

  return jsonCors(req, {
    ok: true,
    queued: result.queued ?? false,
    messageId: result.messageId ?? null,
  });
}
