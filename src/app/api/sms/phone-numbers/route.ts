export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 30;

function getConfiguredSenders(): { key: string; slug: string }[] {
  const senders: { key: string; slug: string }[] = [];
  for (let i = 1; i <= 10; i++) {
    const val = process.env[`LOOP_SENDER_${i}`];
    if (val) senders.push({ key: `LOOP_SENDER_${i}`, slug: val });
  }
  return senders;
}

function warmupLimit(daysActive: number): number {
  if (daysActive <= 7) return 50;
  if (daysActive <= 14) return 150;
  return 1000;
}

export async function GET() {
  const senders = getConfiguredSenders();
  const now = new Date();

  // UTC boundaries
  const todayStart = new Date(now);
  todayStart.setUTCHours(0, 0, 0, 0);

  const weekStart = new Date(now);
  weekStart.setUTCDate(weekStart.getUTCDate() - 7);
  weekStart.setUTCHours(0, 0, 0, 0);

  const numbers = await Promise.all(
    senders.map(async ({ key, slug }) => {
      // Today
      const { count: sentToday } = await supabaseAdmin
        .from("sms_messages")
        .select("id", { count: "exact", head: true })
        .eq("assigned_sender", slug)
        .eq("direction", "outbound")
        .gte("created_at", todayStart.toISOString());

      // This week
      const { count: sentThisWeek } = await supabaseAdmin
        .from("sms_messages")
        .select("id", { count: "exact", head: true })
        .eq("assigned_sender", slug)
        .eq("direction", "outbound")
        .gte("created_at", weekStart.toISOString());

      // All time + first use
      const { count: sentTotal } = await supabaseAdmin
        .from("sms_messages")
        .select("id", { count: "exact", head: true })
        .eq("assigned_sender", slug)
        .eq("direction", "outbound");

      const { data: firstRow } = await supabaseAdmin
        .from("sms_messages")
        .select("created_at")
        .eq("assigned_sender", slug)
        .eq("direction", "outbound")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      const firstUsedAt = firstRow ? (firstRow.created_at as string) : null;
      const daysActive = firstUsedAt
        ? Math.max(1, Math.floor((now.getTime() - new Date(firstUsedAt).getTime()) / 86400000))
        : 0;

      const recommendedDailyLimit = warmupLimit(daysActive);
      const todayCount = sentToday ?? 0;
      const todayLimitUsedPct = recommendedDailyLimit > 0
        ? Math.round((todayCount / recommendedDailyLimit) * 100)
        : 0;

      return {
        sender: key,
        senderSlug: slug,
        sentToday: todayCount,
        sentThisWeek: sentThisWeek ?? 0,
        sentTotal: sentTotal ?? 0,
        firstUsedAt,
        daysActive,
        warmupStatus: daysActive >= 15 ? "warm" : "warming",
        recommendedDailyLimit,
        todayLimitUsedPct,
      };
    })
  );

  return NextResponse.json({ numbers });
}
