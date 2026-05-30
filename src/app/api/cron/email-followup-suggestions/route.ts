export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { runFollowupSuggestions } from "@/lib/ai-intel/followup-director";

export const runtime = "nodejs";
export const maxDuration = 300;

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

  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Math.max(1, Math.min(200, parseInt(limitParam, 10) || 100)) : undefined;

  const stats = await runFollowupSuggestions({ limit });

  await supabaseAdmin.from("system_logs").insert({
    event_type: "cron_email_followup_suggestions",
    description: `Follow-up suggestions: ${stats.suggested} cards posted (${stats.processed} processed)`,
    metadata: stats,
  });

  return NextResponse.json({ ok: true, ...stats });
}
