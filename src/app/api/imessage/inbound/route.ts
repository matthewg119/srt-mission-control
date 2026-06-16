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
import { appendApprovedReplyToVoice } from "@/lib/voice-ingest";
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

interface DoctorCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

interface InboundPayload {
  backfill?: boolean;
  finalizeBackfill?: boolean;
  diagnostics?: { checks?: DoctorCheck[]; host?: string };
  probe?: "db";
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

  // Bridge --doctor report — relay PASS/FAIL to #srt-sub so the user sees it
  // without reading the Mac terminal.
  if (payload.diagnostics) {
    return relayDiagnostics(payload.diagnostics);
  }

  // Bridge --doctor schema probe — answers "will contact matching work?" so the
  // doctor card flags an un-migrated DB BEFORE a backfill silently imports 0.
  // Returns 200 even when not ready, so the doctor renders a clean FAIL line.
  if (payload.probe === "db") {
    const ready = await assertSchemaReady();
    return NextResponse.json(ready);
  }

  // One-time backfill finalizer — posts a single summary to #srt-sub.
  if (payload.finalizeBackfill) {
    const ready = await assertSchemaReady();
    if (!ready.ok) {
      return NextResponse.json(
        { error: "schema_not_migrated", detail: ready.detail },
        { status: 503 }
      );
    }
    return finalizeBackfill();
  }

  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const backfill = payload.backfill === true;

  // Fail LOUD on an un-migrated schema. Without phone_last10/mobile_last10 every
  // contact lookup misses and without imessage_guid every insert/dedupe breaks —
  // either way a backfill would silently import 0 (the exact failure we hit).
  // A 503 here turns that into an actionable error the bridge surfaces verbatim.
  if (messages.length > 0) {
    const ready = await assertSchemaReady();
    if (!ready.ok) {
      return NextResponse.json(
        { error: "schema_not_migrated", detail: ready.detail },
        { status: 503 }
      );
    }
  }

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

    const { data: insertedMsg } = await supabaseAdmin
      .from("sms_messages")
      .insert({
        conversation_id: conv.id,
        direction: isOutbound ? "outbound" : "inbound",
        body,
        close_stage: conv.close_stage,
        imessage_guid: msg.guid,
        metadata: { source: isOutbound ? "imessage_self" : "imessage" },
      })
      .select("id")
      .single();
    imported++;

    // Learn from Matthew's real sent replies — pair with the inbound it answered.
    if (isOutbound && insertedMsg?.id) {
      appendApprovedReplyToVoice({
        conversationId: conv.id as string,
        outboundMessageId: insertedMsg.id as string,
        reply: body,
        stage: conv.close_stage,
      }).catch((e) => console.error("[imessage/inbound] voice append failed:", e));
    }

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
      .then(({ draft, suggestedFollowup }) => {
        if (draft) return postImessageSuggestion({ channelId, conversationId: conv.id as string, draft, suggestedFollowup });
      })
      .catch((err) => console.error("[imessage/inbound] suggestion failed:", err));
  }

  return NextResponse.json({ ok: true, imported, duplicates, discarded });
}

// Schema readiness — the two iMessage migrations are applied manually in the
// Supabase SQL editor, so a fresh/forgotten environment can be missing them.
// Probe the columns the inbound path depends on and report exactly what's
// missing, so the bridge --doctor and --backfill surface it instead of a silent
// 0-count import. Migrations: docs/2026-05-30-imessage-transport.sql (imessage_guid)
// and docs/2026-06-04-contacts-phone-last10.sql (phone_last10 / mobile_last10).
async function assertSchemaReady(): Promise<{ ok: boolean; missing: string[]; detail: string }> {
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
    ? { ok: true, missing, detail: "contact-matching columns present" }
    : {
        ok: false,
        missing,
        detail: `Apply in the Supabase SQL editor: ${missing.join("; ")}`,
      };
}

// Match by the last 10 digits, format-agnostic. Contacts store phones in mixed
// formats ("7865909616", "(684) 984-6516", "+1…") — an exact compare misses most.
// `phone_last10` / `mobile_last10` are STORED generated columns (see
// docs/2026-06-04-contacts-phone-last10.sql) holding the last 10 digits.
async function findContactByPhone(phone: string): Promise<{
  id: string;
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
  zoho_lead_id: string | null;
} | null> {
  const last10 = phone.replace(/\D/g, "").slice(-10);
  if (last10.length < 10) return null;
  const { data, error } = await supabaseAdmin
    .from("contacts")
    .select("id, first_name, last_name, business_name, zoho_lead_id")
    .or(`phone_last10.eq.${last10},mobile_last10.eq.${last10}`)
    .limit(1)
    .maybeSingle();
  // Never fail silently: a query error here (e.g. the phone_last10 columns were
  // never migrated) would otherwise look identical to "no such contact" and
  // discard every message. assertSchemaReady() gates the batch, but log anyway.
  if (error) console.error("[imessage/inbound] contact lookup failed:", error.message);
  return (data as {
    id: string;
    first_name: string | null;
    last_name: string | null;
    business_name: string | null;
    zoho_lead_id: string | null;
  } | null) ?? null;
}

async function relayDiagnostics(diag: { checks?: DoctorCheck[]; host?: string }): Promise<NextResponse> {
  const checks = diag.checks ?? [];
  const allOk = checks.length > 0 && checks.every((c) => c.ok);
  const lines = checks.map((c) => `${c.ok ? "✅" : "❌"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
  const channel = process.env.SLACK_SUB_CHANNEL || "C0AJXH7PTBM"; // #srt-sub
  await slack.postMessage(
    channel,
    [
      `${allOk ? "🩺 *iMessage bridge doctor — ALL PASS*" : "🩺 *iMessage bridge doctor — ISSUES FOUND*"}` +
        (diag.host ? ` _(host: ${diag.host})_` : ""),
      ...lines,
    ].join("\n")
  );
  return NextResponse.json({ ok: true, allOk });
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
