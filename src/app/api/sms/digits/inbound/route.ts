// Inbound DIGITS webhook — called by the Mac-side Playwright worker that
// scrapes digits.t-mobile.com. Mirrors the message into Slack #personal-texts
// and persists it to digits_messages. Idempotent on external_id (message_id).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { normalizePhone } from "@/lib/loopmessage";
import { slack } from "@/lib/slack-bot";

export const runtime = "nodejs";
export const maxDuration = 30;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return (req.headers.get("authorization") ?? "") === `Bearer ${secret}`;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: { sender?: string; text?: string; message_id?: string };
  try {
    payload = (await req.json()) as { sender?: string; text?: string; message_id?: string };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const sender = (payload.sender ?? "").trim();
  const text = (payload.text ?? "").toString();
  const messageId = (payload.message_id ?? "").trim();

  if (!sender || !text || !messageId) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const normalized = normalizePhone(sender) ?? sender;

  const { error: insertErr } = await supabaseAdmin
    .from("digits_messages")
    .insert({
      external_id: messageId,
      sender,
      normalized,
      body: text,
    });

  if (insertErr) {
    // 23505 = unique_violation on external_id → already mirrored, skip Slack.
    if (insertErr.code === "23505") {
      return NextResponse.json({ ok: true, duplicate: true });
    }
    console.error("[digits/inbound] insert error:", insertErr.message);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  const { data: contact } = await supabaseAdmin
    .from("contacts")
    .select("id, first_name, last_name, business_name")
    .eq("phone", normalized)
    .maybeSingle();

  const fullName = `${contact?.first_name ?? ""} ${contact?.last_name ?? ""}`.trim();
  const displayName = fullName || (contact?.business_name as string | undefined) || normalized;

  const channel = process.env.SLACK_PERSONAL_TEXTS_CHANNEL || "";
  if (channel) {
    const result = (await slack.postMessage(
      channel,
      `[${displayName}] (${normalized}): ${text}`
    )) as { ok?: boolean; ts?: string };

    if (result.ok && result.ts) {
      await supabaseAdmin
        .from("digits_messages")
        .update({
          slack_channel: channel,
          slack_ts: result.ts,
          contact_id: contact?.id ?? null,
        })
        .eq("external_id", messageId);
    } else if (contact?.id) {
      await supabaseAdmin
        .from("digits_messages")
        .update({ contact_id: contact.id })
        .eq("external_id", messageId);
    }
  }

  return NextResponse.json({ ok: true });
}
