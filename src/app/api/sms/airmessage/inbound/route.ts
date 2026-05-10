// Inbound iMessage from the Mac-side AirMessage poller.
// Mirrors the message into Slack #personal-texts and persists a row.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { normalizePhone } from "@/lib/loopmessage";
import { slack } from "@/lib/slack-bot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return (req.headers.get("authorization") ?? "") === `Bearer ${secret}`;
}

interface InboundBody {
  sender?: string;
  text?: string;
  rowid?: number;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as InboundBody;
  const sender = (body.sender ?? "").trim();
  const text = (body.text ?? "").toString();
  const rowid = typeof body.rowid === "number" ? body.rowid : null;

  if (!sender || !text) {
    return NextResponse.json({ error: "missing sender or text" }, { status: 400 });
  }

  const normalized = normalizePhone(sender) ?? sender;

  const { data: contact } = await supabaseAdmin
    .from("contacts")
    .select("first_name,last_name,business_name")
    .eq("phone", normalized)
    .maybeSingle();

  const fullName = `${contact?.first_name ?? ""} ${contact?.last_name ?? ""}`.trim();
  const displayName = fullName || contact?.business_name || normalized;

  const channel = process.env.SLACK_PERSONAL_TEXTS_CHANNEL;
  if (channel) {
    await slack.postMessage(channel, `[${displayName}] (${normalized}): ${text}`);
  }

  await supabaseAdmin.from("imessage_messages").insert({
    direction: "inbound",
    sender_phone: normalized,
    body: text,
    rowid,
  });

  return NextResponse.json({ ok: true });
}
