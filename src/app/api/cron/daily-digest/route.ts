import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [leads, submissions, calls, decisions, pending, newDeals] = await Promise.all([
    supabaseAdmin.from("contacts").select("id", { count: "exact", head: true }).gte("created_at", since),
    supabaseAdmin.from("deal_submissions").select("id", { count: "exact", head: true }).gte("submitted_at", since),
    supabaseAdmin.from("call_log").select("id", { count: "exact", head: true }).gte("created_at", since),
    supabaseAdmin.from("ai_decisions").select("id", { count: "exact", head: true }).gte("created_at", since),
    supabaseAdmin.from("pending_slack_actions").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabaseAdmin.from("deals").select("id", { count: "exact", head: true }).gte("created_at", since),
  ]);

  const channel = process.env.SLACK_TEAM_CHANNEL || process.env.SLACK_HOT_LEADS_CHANNEL || "";
  if (!channel) {
    return NextResponse.json({ ok: false, error: "no_channel_configured" }, { status: 200 });
  }

  const date = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const blocks = [
    { type: "header", text: { type: "plain_text", text: `📊 SRT Daily Digest — ${date}`, emoji: true } },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*New leads:* ${leads.count ?? 0}` },
        { type: "mrkdwn", text: `*New deals:* ${newDeals.count ?? 0}` },
        { type: "mrkdwn", text: `*Deals submitted:* ${submissions.count ?? 0}` },
        { type: "mrkdwn", text: `*Calls logged:* ${calls.count ?? 0}` },
        { type: "mrkdwn", text: `*AI decisions:* ${decisions.count ?? 0}` },
        { type: "mrkdwn", text: `*Pending approvals:* ${pending.count ?? 0}` },
      ],
    },
    { type: "context", elements: [{ type: "mrkdwn", text: "Full activity: `/srt activity`  •  Follow-ups: `/srt followups`  •  Pending emails: `/srt emails`" }] },
  ];

  await slack.postMessage(channel, `📊 Daily Digest — ${date}`, blocks as unknown as Parameters<typeof slack.postMessage>[2]);

  await supabaseAdmin.from("system_logs").insert({
    event_type: "cron_daily_digest",
    description: `Daily digest posted`,
    metadata: { counts: { leads: leads.count, deals: newDeals.count, submissions: submissions.count, calls: calls.count, decisions: decisions.count, pending: pending.count } },
  });

  return NextResponse.json({ ok: true, counts: { leads: leads.count, deals: newDeals.count, submissions: submissions.count, calls: calls.count, decisions: decisions.count, pending: pending.count } });
}
