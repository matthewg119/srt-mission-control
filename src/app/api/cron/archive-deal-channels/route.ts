// Archive per-deal Slack channels whose deal was created ≥90 days ago.
// Triggered by Vercel cron daily. Safe to re-run — Slack returns
// "already_archived" for already-archived channels and we clear
// slack_deal_channel_id on success so we skip them next time.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";

export const runtime = "nodejs";

const ARCHIVE_AFTER_DAYS = 90;

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

  const cutoff = new Date(Date.now() - ARCHIVE_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: deals, error } = await supabaseAdmin
    .from("deals")
    .select("id, slack_deal_channel_id, slack_deal_channel_name, created_at")
    .not("slack_deal_channel_id", "is", null)
    .lt("created_at", cutoff);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const results: Array<{ deal_id: string; channel: string | null; archived: boolean; error?: string }> = [];

  for (const deal of deals ?? []) {
    const channelId = deal.slack_deal_channel_id as string;
    try {
      const res = await slack.archiveChannel(channelId);
      if (res.ok || res.error === "already_archived") {
        await supabaseAdmin
          .from("deals")
          .update({ slack_deal_channel_id: null })
          .eq("id", deal.id);
        results.push({ deal_id: deal.id as string, channel: deal.slack_deal_channel_name as string | null, archived: true });
      } else {
        results.push({ deal_id: deal.id as string, channel: deal.slack_deal_channel_name as string | null, archived: false, error: res.error });
      }
    } catch (e) {
      results.push({ deal_id: deal.id as string, channel: deal.slack_deal_channel_name as string | null, archived: false, error: (e as Error).message });
    }
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}
