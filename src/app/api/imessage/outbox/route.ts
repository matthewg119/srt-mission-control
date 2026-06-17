export const dynamic = "force-dynamic";
// Outbound iMessage outbox — drained by the Mac bridge (mac-bridge/imessage-bridge.mjs).
//
// With IMESSAGE_TRANSPORT='mac', every outbound reply (✅ Send, send_sms AI tool,
// 2-minute auto-send, follow-up runner) is INSERTed into sms_outbox as a pending
// row. The Mac bridge polls GET here every ~10s, sends each via AppleScript to
// Messages, then POSTs an ack. We never mark a row 'sent' on GET — the Mac acks
// success/failure via POST. The bridge's normal is_from_me read loop mirrors the
// sent message into Slack + logs sms_messages.
//
// Auth: X-Imessage-Secret header must equal IMESSAGE_WEBHOOK_SECRET (mirrors the
// inbound route's check).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { sweepAutoSends } from "@/lib/imessage-autosend";
import { runDueFollowups } from "@/lib/imessage-followups";
import { runDueIncomeVerificationFollowups } from "@/lib/income-verification-followup";

export const runtime = "nodejs";

function authorized(req: NextRequest): boolean {
  const provided = req.headers.get("x-imessage-secret");
  const expected = process.env.IMESSAGE_WEBHOOK_SECRET;
  return Boolean(expected) && provided === expected;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Run the 2-minute auto-send sweep first so any elapsed drafts are enqueued
  // into sms_outbox and returned in this same poll (no Vercel cron needed when
  // the Mac is polling every ~10s).
  try {
    await sweepAutoSends();
  } catch (e) {
    console.error("[imessage/outbox] auto-send sweep failed:", (e as Error).message);
  }

  // Also post any due follow-up cards here. The Vercel account is on Hobby (crons
  // are daily-only), so the Mac's ~10s outbox poll is the real-time trigger for
  // due follow-ups; the once-daily /api/cron/sms-followups is just a backup.
  try {
    await runDueFollowups();
  } catch (e) {
    console.error("[imessage/outbox] due-followups run failed:", (e as Error).message);
  }

  // Same Hobby-cron limitation applies to the 7-minute income-verification email
  // follow-up — drive it from this ~10s poll so the window stays tight. The email
  // sends via Microsoft Graph (independent of the Mac), and /api/cron/income-verification-followup
  // is the daily backup / external-pinger entry point.
  try {
    await runDueIncomeVerificationFollowups();
  } catch (e) {
    console.error("[imessage/outbox] income-verification followups failed:", (e as Error).message);
  }

  const { data, error } = await supabaseAdmin
    .from("sms_outbox")
    .select("id, phone, body")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(20);

  if (error) {
    console.error("[imessage/outbox] query failed:", error.message);
    return NextResponse.json({ messages: [] });
  }

  return NextResponse.json({
    messages: (data ?? []).map((m) => ({ id: m.id, phone: m.phone, body: m.body })),
  });
}

interface AckBody {
  id?: string;
  ok?: boolean;
  error?: string;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: AckBody;
  try {
    body = (await req.json()) as AckBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.id) {
    return NextResponse.json({ error: "missing_id" }, { status: 400 });
  }

  if (body.ok) {
    await supabaseAdmin
      .from("sms_outbox")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("id", body.id);
  } else {
    const { data: row } = await supabaseAdmin
      .from("sms_outbox")
      .select("attempts")
      .eq("id", body.id)
      .maybeSingle();
    await supabaseAdmin
      .from("sms_outbox")
      .update({
        status: "failed",
        error: body.error ?? "send_failed",
        attempts: ((row?.attempts as number | null) ?? 0) + 1,
      })
      .eq("id", body.id);
  }

  return NextResponse.json({ ok: true });
}
