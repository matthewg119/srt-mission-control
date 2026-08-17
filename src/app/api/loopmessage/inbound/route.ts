export const dynamic = "force-dynamic";
// Inbound LoopMessage webhook — the 24/7 cloud iMessage transport.
//
// LoopMessage (https://loopmessage.com) sends/receives real iMessages from our
// provisioned sender (336-833-2303) with no Mac running. When a lead texts that
// number, LoopMessage POSTs a webhook here. This route reuses EXACTLY the same
// pipeline as the Mac chat.db bridge (/api/imessage/inbound), which stays intact
// as a fallback: normalize → CRM contact lookup → ensureSmsChannel →
// dedup-insert into sms_messages → postInboundMessage → draftSmsReply →
// postImessageSuggestion. Outbound is logged + mirrored by the SEND path (the
// AI tool / Slack Send button), not here, so there is NO is_from_me mirroring.
//
// LoopMessage webhooks carry an `alert_type`. We only ingest "message_inbound"
// (a lead replied). Delivery/status alerts (message_sent, message_failed,
// message_reaction, message_scheduled, etc.) are acked 200 without ingest so
// LoopMessage does not retry.
//
// Auth: LOOPMESSAGE_WEBHOOK_SECRET via verifyInboundSecret (header or body).
//
// ⚠️ VERIFY-AGAINST-DOCS: for an inbound message LoopMessage sends `recipient`
// (the lead's phone/Apple ID), `text`, and `message_id`. Confirm these field
// names for your account tier; the parsing below tolerates a few aliases.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { normalizePhone } from "@/lib/phone";
import { ensureSmsChannel, postInboundMessage } from "@/lib/sms-channel";
import { draftSmsReply } from "@/lib/sms-ai-engine";
import { postImessageSuggestion } from "@/lib/imessage-suggestion";
import { resolveLead } from "@/lib/crm";
import { markHotLead } from "@/lib/hot-lead";
import { verifyInboundSecret } from "@/lib/loopmessage";

export const runtime = "nodejs";
export const maxDuration = 60;

interface LoopMessageWebhook {
  alert_type?: string;
  // Inbound message fields (⚠️ VERIFY names). `recipient` is the lead for inbound;
  // some payloads also expose `from`/`sender`. `message_id` is the idempotency key.
  recipient?: string;
  from?: string;
  sender?: string;
  text?: string;
  message_id?: string;
  // Auth fallbacks read by verifyInboundSecret.
  secret_key?: string;
  webhook_key?: string;
  secret?: string;
}

export async function POST(req: NextRequest) {
  let payload: LoopMessageWebhook;
  try {
    payload = (await req.json()) as LoopMessageWebhook;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // Auth — header (LoopMessage echoes the configured Authorization value) or body.
  if (!verifyInboundSecret(req.headers, payload as Record<string, unknown>)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const alertType = payload.alert_type ?? "message_inbound";

  // Only a real inbound merchant message is ingested. Everything else (delivery /
  // status / reaction / scheduled) is acked fast so LoopMessage does not retry.
  if (alertType !== "message_inbound") {
    console.log(`[loopmessage/inbound] ack non-inbound alert_type=${alertType}`);
    return NextResponse.json({ ok: true, ignored: alertType });
  }

  const handle = payload.recipient ?? payload.from ?? payload.sender ?? "";
  const body = (payload.text ?? "").trim();
  const messageId = payload.message_id ?? "";

  if (!handle || !body || !messageId) {
    console.log("[loopmessage/inbound] missing handle/text/message_id — discarding");
    return NextResponse.json({ ok: true, discarded: true });
  }

  // Schema readiness — same guard the imessage route uses. Without
  // phone_last10/mobile_last10 every contact lookup misses, and without
  // imessage_guid every dedup/insert breaks. 503 surfaces the migration hint
  // instead of silently importing 0. Always 200 the LoopMessage status alerts
  // above (they returned earlier); only the ingest path can 503.
  const ready = await assertSchemaReady();
  if (!ready.ok) {
    return NextResponse.json(
      { error: "schema_not_migrated", detail: ready.detail },
      { status: 503 }
    );
  }

  // CRM filter — phone match only. Apple-ID/email handles normalize to null → drop.
  const phone = normalizePhone(handle);
  if (!phone) {
    console.log("[loopmessage/inbound] non-phone handle — discarding");
    return NextResponse.json({ ok: true, discarded: true });
  }

  const contact = await resolveLead({ phone });
  if (!contact) {
    console.log("[loopmessage/inbound] unknown number — discarding");
    return NextResponse.json({ ok: true, discarded: true });
  }

  // Upsert the conversation (reuse the proven sms_conversations model).
  const { data: conv, error: convErr } = await supabaseAdmin
    .from("sms_conversations")
    .upsert(
      {
        phone,
        contact_id: contact.id,
        last_inbound_at: new Date().toISOString(),
      },
      { onConflict: "phone", ignoreDuplicates: false }
    )
    .select("id, close_stage")
    .single();

  if (convErr || !conv) {
    console.error("[loopmessage/inbound] conversation upsert failed:", convErr?.message);
    return NextResponse.json({ ok: false, error: "conversation_upsert_failed" }, { status: 200 });
  }

  // Idempotency — dedup on the LoopMessage message_id, stored in the existing
  // imessage_guid column (globally unique, same index, no migration needed).
  const { data: dupe } = await supabaseAdmin
    .from("sms_messages")
    .select("id")
    .eq("imessage_guid", messageId)
    .maybeSingle();
  if (dupe) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  await supabaseAdmin.from("sms_messages").insert({
    conversation_id: conv.id,
    direction: "inbound",
    body,
    close_stage: conv.close_stage,
    imessage_guid: messageId,
    metadata: { source: "loopmessage" },
  });

  // Ensure the per-lead Slack channel exists (also stores slack_channel_id).
  const displayName =
    [contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
    contact.businessName ||
    phone;

  const { channelId } = await ensureSmsChannel({
    conversationId: conv.id as string,
    phone,
    displayName,
    contactId: contact.id,
    zohoLeadId: contact.zohoLeadId,
    businessName: contact.businessName,
  });

  if (!channelId) {
    return NextResponse.json({ ok: true, imported: true, channel: null });
  }

  // Inbound merchant message → mirror, flag hot lead, draft a suggestion.
  await postInboundMessage(channelId, displayName, body, conv.id as string);

  markHotLead({ contactId: contact.id, replyText: body, slackChannelId: channelId }).catch((e) =>
    console.error("[loopmessage/inbound] hot lead failed:", e)
  );

  // Suggestion drafting can be slow — fire it but await so the function (and the
  // serverless runtime) does not get torn down mid-draft. Always 200 after.
  try {
    const { draft, suggestedFollowup } = await draftSmsReply(conv.id as string, body);
    if (draft) {
      await postImessageSuggestion({ channelId, conversationId: conv.id as string, draft, suggestedFollowup });
    }
  } catch (err) {
    console.error("[loopmessage/inbound] suggestion failed:", err);
  }

  return NextResponse.json({ ok: true, imported: true });
}

// Schema readiness — mirrors /api/imessage/inbound. The two iMessage migrations
// are applied manually in the Supabase SQL editor, so a fresh/forgotten env can
// be missing them. Probe the columns the inbound path depends on and report
// exactly what's missing. Migrations: docs/2026-05-30-imessage-transport.sql
// (imessage_guid) and docs/2026-06-04-contacts-phone-last10.sql (phone_last10 /
// mobile_last10).
async function assertSchemaReady(): Promise<{ ok: boolean; detail: string }> {
  const missing: string[] = [];

  const { error: contactsErr } = await supabaseAdmin
    .from("contacts")
    .select("phone_last10, mobile_last10")
    .limit(1);
  if (contactsErr) missing.push("contacts.phone_last10/mobile_last10 (docs/2026-06-04-contacts-phone-last10.sql)");

  const { error: smsErr } = await supabaseAdmin
    .from("sms_messages")
    .select("imessage_guid")
    .limit(1);
  if (smsErr) missing.push("sms_messages.imessage_guid (docs/2026-05-30-imessage-transport.sql)");

  return missing.length === 0
    ? { ok: true, detail: "contact-matching columns present" }
    : { ok: false, detail: `Apply in the Supabase SQL editor: ${missing.join("; ")}` };
}

