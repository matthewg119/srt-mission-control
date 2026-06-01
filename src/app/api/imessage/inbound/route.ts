export const dynamic = "force-dynamic";
// Inbound iMessage webhook — fed by the Mac bridge (mac-bridge/imessage-bridge.mjs),
// which reads ~/Library/Messages/chat.db and POSTs new rows here.
//
// CRM-contacts-only: every message's sender is normalized and looked up in
// `contacts` (phone OR mobile_phone). No match → discarded (no DB write, no Slack).
// Matched → mirrored into the lead's per-lead Slack channel (same model as the old
// SMS path), with a Vektor-drafted suggestion card for inbound merchant messages.
//
// chat.db has BOTH directions, so the bridge sends is_from_me too:
//   is_from_me=0 → merchant message → post + suggest
//   is_from_me=1 → Matthew's own reply → log as outbound, mirror, cancel suggestion
//
// Auth: X-Imessage-Secret header must equal IMESSAGE_WEBHOOK_SECRET.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { normalizePhone } from "@/lib/phone";
import { ensureSmsChannel, postInboundMessage } from "@/lib/sms-channel";
import { draftSmsReply } from "@/lib/sms-ai-engine";
import { postImessageSuggestion, cancelPendingSuggestion } from "@/lib/imessage-suggestion";
import { markZohoHotLead } from "@/lib/zoho";
import { slack } from "@/lib/slack-bot";

export const runtime = "nodejs";
export const maxDuration = 60;

interface InboundMessage {
  guid: string;
  handle: string; // phone or Apple ID email
  text: string;
  is_from_me: boolean;
  date?: string; // ISO; informational
}

interface InboundPayload {
  backfill?: boolean;
  finalizeBackfill?: boolean;
  messages?: InboundMessage[];
}

export async function POST(req: NextRequest) {
  const provided = req.headers.get("x-imessage-secret");
  const expected = process.env.IMESSAGE_WEBHOOK_SECRET;
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: InboundPayload;
  try {
    payload = (await req.json()) as InboundPayload;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // One-time backfill finalizer — posts a single summary to #srt-sub.
  if (payload.finalizeBackfill) {
    return finalizeBackfill();
  }

  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const backfill = payload.backfill === true;

  let imported = 0;
  let discarded = 0;
  let duplicates = 0;

  for (const msg of messages) {
    if (!msg?.guid || !msg.handle) { discarded++; continue; }
    const body = (msg.text ?? "").trim();
    if (!body) { discarded++; continue; } // attachment-only / empty rows

    // CRM filter — phone match only. Email/Apple-ID handles are discarded.
    const phone = normalizePhone(msg.handle);
    if (!phone) { discarded++; continue; }

    const contact = await findContactByPhone(phone);
    if (!contact) { discarded++; continue; } // unknown number → drop entirely

    const isOutbound = msg.is_from_me === true;

    // Upsert the conversation (reuse the proven sms_conversations model).
    const { data: conv, error: convErr } = await supabaseAdmin
      .from("sms_conversations")
      .upsert(
        {
          phone,
          contact_id: contact.id,
          ...(isOutbound ? {} : { last_inbound_at: msg.date ?? new Date().toISOString() }),
        },
        { onConflict: "phone", ignoreDuplicates: false }
      )
      .select("id, close_stage")
      .single();

    if (convErr || !conv) {
      console.error("[imessage/inbound] conversation upsert failed:", convErr?.message);
      continue;
    }

    // Idempotency — skip if we've already stored this chat.db row.
    const { data: dupe } = await supabaseAdmin
      .from("sms_messages")
      .select("id")
      .eq("imessage_guid", msg.guid)
      .maybeSingle();
    if (dupe) { duplicates++; continue; }

    await supabaseAdmin.from("sms_messages").insert({
      conversation_id: conv.id,
      direction: isOutbound ? "outbound" : "inbound",
      body,
      close_stage: conv.close_stage,
      imessage_guid: msg.guid,
      metadata: { source: isOutbound ? "imessage_self" : "imessage" },
    });
    imported++;

    // Ensure the per-lead Slack channel exists (also stores slack_channel_id).
    const displayName =
      [contact.first_name, contact.last_name].filter(Boolean).join(" ") ||
      contact.business_name ||
      phone;

    const { channelId } = await ensureSmsChannel({
      conversationId: conv.id as string,
      phone,
      displayName,
      contactId: contact.id,
      zohoLeadId: contact.zoho_lead_id,
      businessName: contact.business_name,
    });

    // Backfill = history only: no Slack posts, no suggestions.
    if (backfill || !channelId) continue;

    if (isOutbound) {
      // Matthew's own reply (sent from the Mac) → mirror + retire the suggestion.
      const preview = body.length > 200 ? body.slice(0, 200) + "…" : body;
      await slack.postMessage(channelId, `✅ You replied: "${preview}"`);
      await cancelPendingSuggestion(conv.id as string);
      continue;
    }

    // Inbound merchant message → mirror, flag hot lead, draft a suggestion.
    await postInboundMessage(channelId, displayName, body, conv.id as string);

    if (contact.zoho_lead_id) {
      markZohoHotLead(contact.zoho_lead_id, body, channelId).catch((e) =>
        console.error("[imessage/inbound] hot lead failed:", e)
      );
    }

    draftSmsReply(conv.id as string, body)
      .then((draft) => {
        if (draft) return postImessageSuggestion({ channelId, conversationId: conv.id as string, draft });
      })
      .catch((err) => console.error("[imessage/inbound] suggestion failed:", err));
  }

  return NextResponse.json({ ok: true, imported, duplicates, discarded });
}

// Match a normalized E.164 number against contacts.phone OR contacts.mobile_phone.
// Both columns are normalized on capture (leads/capture calls normalizePhone), so an
// exact E.164 compare catches the common case.
async function findContactByPhone(phone: string): Promise<{
  id: string;
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
  zoho_lead_id: string | null;
} | null> {
  const { data } = await supabaseAdmin
    .from("contacts")
    .select("id, first_name, last_name, business_name, zoho_lead_id")
    .or(`phone.eq.${phone},mobile_phone.eq.${phone}`)
    .limit(1)
    .maybeSingle();
  return (data as {
    id: string;
    first_name: string | null;
    last_name: string | null;
    business_name: string | null;
    zoho_lead_id: string | null;
  } | null) ?? null;
}

async function finalizeBackfill(): Promise<NextResponse> {
  // Count imported iMessage messages + distinct conversations they touched.
  const { count: msgCount } = await supabaseAdmin
    .from("sms_messages")
    .select("id", { count: "exact", head: true })
    .not("imessage_guid", "is", null);

  const { data: convRows } = await supabaseAdmin
    .from("sms_messages")
    .select("conversation_id")
    .not("imessage_guid", "is", null)
    .limit(100000);
  const threads = new Set((convRows ?? []).map((r) => r.conversation_id as string)).size;

  const channel = process.env.SLACK_SUB_CHANNEL || "C0AJXH7PTBM"; // #srt-sub
  await slack.postMessage(
    channel,
    `📥 *iMessage backfill complete* — imported ${msgCount ?? 0} messages across ${threads} CRM contact thread${threads === 1 ? "" : "s"}. Unknown numbers were discarded.`
  );

  return NextResponse.json({ ok: true, messages: msgCount ?? 0, threads });
}
