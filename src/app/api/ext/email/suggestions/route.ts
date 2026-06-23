export const dynamic = "force-dynamic";
// TextWin extension — list SUGGESTED email follow-up drafts awaiting approval
// (the ✉️ top-bar button). Each row carries the editable subject/body so the
// operator can approve or tweak from the bubble. sf_ draft_key = dialer Smart
// Follow-up.

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

  const { searchParams } = new URL(req.url);
  const contactId = searchParams.get("contactId");

  let query = supabaseAdmin
    .from("email_outbox")
    .select("id, contact_id, conversation_id, to_address, subject, body, ai_reason, draft_key, created_at")
    .eq("status", "suggested")
    .order("created_at", { ascending: false })
    .limit(50);
  if (contactId) query = query.eq("contact_id", contactId);

  const { data: rows } = await query;
  const suggestions = await Promise.all(
    (rows ?? []).map(async (r) => {
      let displayName = (r.to_address as string) ?? "Lead";
      if (r.contact_id) {
        const { data: c } = await supabaseAdmin
          .from("contacts")
          .select("first_name, last_name, business_name")
          .eq("id", r.contact_id)
          .maybeSingle();
        if (c) {
          displayName =
            (c.business_name as string) ||
            [c.first_name, c.last_name].filter(Boolean).join(" ") ||
            displayName;
        }
      }
      return {
        id: r.id,
        contact_id: r.contact_id,
        conversation_id: r.conversation_id,
        to_address: r.to_address,
        subject: r.subject,
        body: r.body,
        reason: r.ai_reason,
        is_followup: (r.draft_key as string | null)?.startsWith("sf_") ?? false,
        display_name: displayName,
        created_at: r.created_at,
      };
    })
  );

  return jsonCors(req, { ok: true, suggestions });
}
