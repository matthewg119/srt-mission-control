import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [decisions, pending, submissions] = await Promise.all([
    supabaseAdmin.from("ai_decisions").select("id", { count: "exact", head: true }),
    supabaseAdmin.from("pending_slack_actions").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabaseAdmin.from("deal_submissions").select("id", { count: "exact", head: true }),
  ]);

  return NextResponse.json({
    ai_decisions: decisions.count ?? 0,
    pending: pending.count ?? 0,
    submissions: submissions.count ?? 0,
  });
}
