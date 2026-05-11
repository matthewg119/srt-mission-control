export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { triggerSpeedToLead } from "@/lib/speed-to-lead";

// Allow up to 60s for RingOut polling on Vercel
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  // API key check (for portal cross-origin calls)
  const apiKey = request.headers.get("x-api-key");
  const expectedKey = process.env.SPEED_TO_LEAD_API_KEY;

  if (expectedKey) {
    const origin = request.headers.get("origin") || "";
    const isInternal = !origin || origin.includes("mission.srtagency.com") || origin.includes("localhost");
    if (!isInternal && apiKey !== expectedKey) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const body = await request.json();
    const { leadId, leadPhone, leadName, leadSource } = body;

    if (!leadPhone) {
      return NextResponse.json({ error: "leadPhone is required" }, { status: 400 });
    }

    // Run the full speed-to-lead flow (gates + RingOut + poll + Slack)
    await triggerSpeedToLead({
      leadId,
      leadPhone,
      leadName: leadName || "Unknown Lead",
      leadSource: leadSource || "unknown",
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
