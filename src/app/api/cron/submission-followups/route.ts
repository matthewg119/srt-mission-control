export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";

export const runtime = "nodejs";

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

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: due, error } = await supabaseAdmin
    .from("deal_submissions")
    .select("id, merchant_id, deal_id, amount_requested, submitted_at, lender_id, lenders(name, submission_email)")
    .eq("status", "pending")
    .eq("follow_up_sent", false)
    .not("submitted_at", "is", null)
    .lt("submitted_at", cutoff)
    .is("last_funder_response_at", null);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const channel = process.env.SLACK_SUB_CHANNEL || process.env.SLACK_AI_APPROVALS_CHANNEL || process.env.SLACK_HOT_LEADS_CHANNEL || "";
  const results: Array<Record<string, unknown>> = [];

  for (const row of due ?? []) {
    const r = row as unknown as {
      id: string;
      merchant_id: string | null;
      amount_requested: number | null;
      submitted_at: string;
      lenders: { name: string; submission_email: string | null } | null;
    };
    const hoursAgo = Math.floor((Date.now() - new Date(r.submitted_at).getTime()) / (1000 * 60 * 60));
    const msg = `⏰ *No response yet* — ${r.merchant_id ?? "Merchant"} @ ${r.lenders?.name ?? "lender"} ($${(r.amount_requested ?? 0).toLocaleString()}, ${hoursAgo}h ago)\nFollow up: ${r.lenders?.submission_email ?? "no email on file"}`;

    if (channel) {
      await slack.postMessage(channel, msg);
    }

    await supabaseAdmin
      .from("deal_submissions")
      .update({ follow_up_sent: true })
      .eq("id", r.id);

    results.push({ id: r.id, hours_ago: hoursAgo, posted: Boolean(channel) });
  }

  await supabaseAdmin.from("system_logs").insert({
    event_type: "cron_submission_followups",
    description: `Submission follow-ups: ${results.length} alerts posted`,
    metadata: { results },
  });

  return NextResponse.json({ ok: true, count: results.length, results });
}
