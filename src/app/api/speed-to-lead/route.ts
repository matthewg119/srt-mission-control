export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { triggerSpeedToLead } from "@/lib/speed-to-lead";

// Allow up to 60s for RingOut polling on Vercel
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  // Auth for cross-origin callers. Accepts the portal's x-api-key
  // (SPEED_TO_LEAD_API_KEY) OR a Bearer CRON_SECRET — the latter lets the auto-dialer
  // Call button reuse the same key it already stores for draft-sms.
  const expectedKey = process.env.SPEED_TO_LEAD_API_KEY;
  const cronSecret = process.env.CRON_SECRET;
  const origin = request.headers.get("origin") || "";
  const isInternal = !origin || origin.includes("mission.srtagency.com") || origin.includes("localhost");

  if (!isInternal && (expectedKey || cronSecret)) {
    const apiKey = request.headers.get("x-api-key");
    const authHeader = request.headers.get("authorization") || request.headers.get("Authorization") || "";
    const apiKeyOk = Boolean(expectedKey) && apiKey === expectedKey;
    const bearerOk = Boolean(cronSecret) && authHeader === `Bearer ${cronSecret}`;
    if (!apiKeyOk && !bearerOk) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const body = await request.json();
    const { leadId, leadPhone, leadName, leadSource, manual } = body;

    if (!leadPhone) {
      return NextResponse.json({ error: "leadPhone is required" }, { status: 400 });
    }

    // Run the full speed-to-lead flow (gates + RingOut + poll + Slack). A manual
    // "Call now" (dialer Call button) bypasses business-hours + cooldown gates.
    await triggerSpeedToLead({
      leadId,
      leadPhone,
      leadName: leadName || "Unknown Lead",
      leadSource: leadSource || "unknown",
      manual: manual === true,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Speed to Lead] API route error:", error);
    return NextResponse.json(
      { error: "Internal error" },
      { status: 500 }
    );
  }
}
