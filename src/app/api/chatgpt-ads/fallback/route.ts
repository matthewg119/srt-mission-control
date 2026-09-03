// The 60-second nudge on a Call Me Now that has not been answered yet.
//
// Fired by the client when its countdown runs out, which is the only place that knows. The
// server cannot infer it: nothing here observes whether a phone rang, because nothing in this
// stack places the call. A human does, from their own handset.
//
// ‼️ IT THREADS UNDER TEMPLATE A, and that is the entire reason this route exists rather than
// a second top-level alert. The person reading Slack already has one 🚨 message about this
// lead open; a second one two screens down is a different lead as far as a glance is
// concerned. chatgpt_ads_leads.slack_thread_ts holds the ts of that first card.
//
// NO SLACK THREAD, NO POST. If Template A never landed (no bot token, no channel configured)
// there is nothing to reply to, and this quietly does nothing rather than inventing a
// top-level alert with no context above it.

import { NextRequest, NextResponse } from "next/server";
import { slack } from "@/lib/slack-bot";
import { clean, validEmail } from "@/lib/medspa/validate";
import { findLeadByEmail, upsertLead } from "@/lib/chatgpt-ads/lead";
import { fallbackReply } from "@/lib/chatgpt-ads/card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const email = clean(body.email, 254).toLowerCase();
  if (!validEmail(email)) return NextResponse.json({ ok: false }, { status: 400 });

  const row = await findLeadByEmail(email);
  // Unknown email is a 200 with nothing done, not a 404. This route is public and telling a
  // caller which addresses exist in the table is a lookup oracle for no benefit.
  if (!row || row.signup_path !== "call_me_now") return NextResponse.json({ ok: true });

  // Idempotent. A tab left open, refreshed, or restored by the browser can fire this more
  // than once, and one nudge per lead is the useful number.
  if (row.fallback_slot_shown_at) return NextResponse.json({ ok: true });

  await upsertLead({ email, fallback_slot_shown_at: new Date().toISOString() });

  const channel = process.env.SLACK_HOT_LEADS_CHANNEL || "";
  if (channel && row.slack_thread_ts) {
    await slack.postThreadReply(channel, row.slack_thread_ts, fallbackReply(row));
  }

  return NextResponse.json({ ok: true });
}
