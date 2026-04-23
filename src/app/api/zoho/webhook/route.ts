// Zoho CRM Webhook receiver — pipeline source-of-truth.
//
// Zoho CRM → Setup → Automation → Workflow Rules → "Lead stage changed"
// → Instant Action → Webhook → POSTs to this endpoint.
//
// The workflow is configured to send:
//   - id           (Zoho Lead record id)
//   - Stage        (new stage name)
//   - Modified_Time
//   - A shared secret (?secret=... in the URL or `secret` field in body)
//
// We look up contact by zoho_lead_id, find the most recent open deal,
// and dispatch to stage-handler. All failures are logged, never thrown —
// Zoho retries 3x on non-2xx, so we always return 200 unless the secret
// is wrong (then 401, Zoho marks it failed + we get an email).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { handleStageChange } from "@/lib/ai-intel/stage-handler";
import { ZOHO_TERMINAL_STAGES } from "@/config/stage-display";

export const dynamic = "force-dynamic";

interface ZohoWebhookPayload {
  id?: string;
  Stage?: string;
  stage?: string;
  Modified_Time?: string;
  secret?: string;
  [key: string]: unknown;
}

function unauthorized(reason: string) {
  console.warn("[zoho-webhook] unauthorized:", reason);
  return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

function ok(body: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: true, ...body });
}

export async function POST(request: NextRequest) {
  const secret = process.env.ZOHO_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[zoho-webhook] ZOHO_WEBHOOK_SECRET not set — refusing all traffic");
    return unauthorized("no_secret_configured");
  }

  // Accept secret via ?secret=... query param (Zoho's easiest mechanism)
  // or via `secret` field in the JSON body.
  const querySecret = request.nextUrl.searchParams.get("secret");
  let body: ZohoWebhookPayload = {};
  try {
    body = (await request.json()) as ZohoWebhookPayload;
  } catch {
    // Zoho sometimes sends form-urlencoded; fall through with {}.
  }
  const bodySecret = typeof body.secret === "string" ? body.secret : null;

  if (querySecret !== secret && bodySecret !== secret) {
    return unauthorized("bad_secret");
  }

  const zohoLeadId = typeof body.id === "string" ? body.id.trim() : "";
  const newStage = (typeof body.Stage === "string" && body.Stage.trim())
    || (typeof body.stage === "string" && body.stage.trim())
    || "";

  if (!zohoLeadId) {
    console.warn("[zoho-webhook] payload missing id:", JSON.stringify(body));
    return ok({ skipped: "no_zoho_id" });
  }
  if (!newStage) {
    console.warn("[zoho-webhook] payload missing Stage:", JSON.stringify(body));
    return ok({ skipped: "no_stage" });
  }

  // Find the contact by zoho_lead_id.
  const { data: contact, error: contactErr } = await supabaseAdmin
    .from("contacts")
    .select("id")
    .eq("zoho_lead_id", zohoLeadId)
    .maybeSingle();

  if (contactErr) {
    console.error("[zoho-webhook] contact lookup failed:", contactErr.message);
    return ok({ error: "contact_lookup_failed" });
  }
  if (!contact) {
    console.warn(`[zoho-webhook] no contact for zoho_lead_id=${zohoLeadId}`);
    return ok({ skipped: "no_contact" });
  }

  // Find the most recent non-terminal deal for this contact. If none exists,
  // create one — a Zoho stage change on an unknown deal is still real.
  const { data: deals } = await supabaseAdmin
    .from("deals")
    .select("id, zoho_stage")
    .eq("contact_id", contact.id)
    .order("updated_at", { ascending: false })
    .limit(5);

  let deal = (deals || []).find((d) => {
    const s = d.zoho_stage || "";
    return !ZOHO_TERMINAL_STAGES.includes(s);
  });

  if (!deal) {
    const { data: newDeal, error: insErr } = await supabaseAdmin
      .from("deals")
      .insert({
        contact_id: contact.id,
        pipeline: "Active Deals",
        stage: "Underwriting",
        zoho_stage: newStage,
        zoho_stage_updated_at: new Date().toISOString(),
        source: "Zoho",
      })
      .select("id, zoho_stage")
      .single();
    if (insErr || !newDeal) {
      console.error("[zoho-webhook] deal insert failed:", insErr?.message);
      return ok({ error: "deal_insert_failed" });
    }
    deal = newDeal;
  }

  const oldStage = deal.zoho_stage || null;
  if (oldStage === newStage) {
    // Stage unchanged — still post the deal thread parent if missing,
    // but no transition event.
    return ok({ skipped: "no_transition", deal_id: deal.id });
  }

  await handleStageChange({
    dealId: deal.id,
    oldStage,
    newStage,
    source: "zoho_webhook",
  });

  return ok({ deal_id: deal.id, old_stage: oldStage, new_stage: newStage });
}

// Zoho's webhook config lets you send a GET as a test ping. Return 200.
export async function GET() {
  return NextResponse.json({ ok: true, hint: "POST with ?secret= and JSON body { id, Stage }" });
}
