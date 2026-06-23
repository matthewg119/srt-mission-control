export const dynamic = "force-dynamic";
// TextWin extension "📞 call my cell". RingCentral RingOut: rings the agent's
// cellphone (RC_AGENT_NUMBER) first, then dials the lead and bridges — same
// pattern as Speed to Lead (src/lib/speed-to-lead.ts). The browser never places
// the call; RingCentral does, so it works from any device.
//
// POST { phone, conversationId? } — Bearer ext token.

import { NextRequest } from "next/server";
import { requireExtTenant, jsonCors, preflight } from "@/lib/ext-auth";
import { initiateRingOut, formatPhone } from "@/lib/ringcentral";
import { supabaseAdmin } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 30;

export function OPTIONS(req: NextRequest) {
  return preflight(req);
}

export async function POST(req: NextRequest) {
  const tenant = await requireExtTenant(req);
  if (!tenant) return jsonCors(req, { ok: false, error: "unauthorized" }, 401);

  const body = (await req.json().catch(() => ({}))) as {
    phone?: string;
    conversationId?: string;
  };

  // Resolve the lead's number: explicit phone wins, else the conversation's.
  let leadPhone = (body.phone ?? "").trim();
  if (!leadPhone && body.conversationId) {
    const { data: conv } = await supabaseAdmin
      .from("sms_conversations")
      .select("phone")
      .eq("id", body.conversationId)
      .maybeSingle();
    leadPhone = (conv?.phone as string) ?? "";
  }
  const formattedLead = formatPhone(leadPhone);
  if (!formattedLead) {
    return jsonCors(req, { ok: false, error: `invalid_lead_phone: ${leadPhone}` }, 422);
  }

  const agentPhone = process.env.RC_AGENT_NUMBER || "";
  const agentExtension = process.env.RC_AGENT_EXTENSION || "";
  if (!agentPhone) {
    return jsonCors(req, { ok: false, error: "RC_AGENT_NUMBER not configured" }, 500);
  }

  const ringout = await initiateRingOut(agentPhone, formattedLead, agentExtension || undefined);
  if (!ringout.success) {
    return jsonCors(req, { ok: false, error: ringout.error || "ringout_failed" }, 502);
  }
  return jsonCors(req, { ok: true, ringout_id: ringout.data?.id ?? null, to: formattedLead });
}
