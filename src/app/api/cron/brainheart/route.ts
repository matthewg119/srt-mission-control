import { NextRequest, NextResponse } from "next/server";
import { runBrainHeartPulse } from "@/lib/brainheart";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Allow up to 60s for AI processing

export async function GET(req: NextRequest) {
  try {
    // Verify cron secret (external cron service sends this)
    const authHeader = req.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET || "";

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check kill switch
    if (process.env.BRAINHEART_ENABLED !== "true") {
      return NextResponse.json({ status: "disabled", message: "BrainHeart is disabled. Set BRAINHEART_ENABLED=true to activate." });
    }

    // Determine pulse type based on current time (EST)
    const now = new Date();
    const estTime = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
    const hour = estTime.getHours();

    let pulseType: "morning_briefing" | "routine" | "checkin";
    if (hour < 10) {
      pulseType = "morning_briefing"; // 9am pulse
    } else if (hour >= 17) {
      pulseType = "checkin"; // 6pm end-of-day
    } else {
      pulseType = "routine"; // 12pm, 3pm
    }

    const result = await runBrainHeartPulse(pulseType);

    return NextResponse.json({
      status: "ok",
      pulseType,
      summary: result.summary,
      tasksCreated: result.tasksCreated,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("BrainHeart cron error:", error);
    return NextResponse.json(
      { error: "BrainHeart pulse failed", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
