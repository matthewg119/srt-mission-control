export const dynamic = "force-dynamic";
// TextWin extension — approve / edit / reject a SUGGESTED email follow-up.
//   • approve → flip email_outbox row to 'pending'; the drain cron sends it (with
//     the "S" signature) and trains the email model.
//   • reject  → 'cancelled'.
// Either way the twin Slack approval card (shared draft_key) is resolved so the
// same email can't double-send. Mirrors textwin.ai's /api/email/suggestions/[id].

import { NextRequest } from "next/server";
import { requireExtTenant, jsonCors, preflight } from "@/lib/ext-auth";
import { supabaseAdmin } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 30;

export function OPTIONS(req: NextRequest) {
  return preflight(req);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenant = await requireExtTenant(req);
  if (!tenant) return jsonCors(req, { ok: false, error: "unauthorized" }, 401);

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    action?: "approve" | "reject";
    body?: string;
    subject?: string;
  };
  const action = body.action ?? "approve";

  const { data: row } = await supabaseAdmin
    .from("email_outbox")
    .select("id, status, draft_key")
    .eq("id", id)
    .maybeSingle();
  if (!row) return jsonCors(req, { ok: false, error: "not_found" }, 404);

  const update: Record<string, unknown> =
    action === "reject"
      ? { status: "cancelled" }
      : {
          status: "pending",
          ...(body.body ? { body: body.body } : {}),
          ...(body.subject ? { subject: body.subject } : {}),
        };

  const { error } = await supabaseAdmin.from("email_outbox").update(update).eq("id", id);
  if (error) return jsonCors(req, { ok: false, error: error.message }, 500);

  // Resolve the twin Slack card so it can't double-send.
  const draftKey = row.draft_key as string | null;
  if (draftKey) {
    await supabaseAdmin
      .from("pending_slack_actions")
      .update({ status: "cancelled", resolved_at: new Date().toISOString(), approved_by: "textwin-ext" })
      .eq("payload->>draft_key", draftKey)
      .eq("status", "pending")
      .then(undefined, () => {});
  }

  return jsonCors(req, { ok: true, status: action === "reject" ? "cancelled" : "pending" });
}
