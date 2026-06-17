export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { postOrThreadLeadUpdate, LeadThreadAction } from "@/lib/lead-thread";

// Cross-origin endpoint called by the portal (and internally by Mission Control)
// to post or thread-reply Slack notifications for a lead.
//
// Auth: x-api-key header must match LEAD_THREAD_API_KEY env var.
// Internal calls (no origin or mission.srtagency.com origin) are allowed.

export const maxDuration = 15;

const VALID_ACTIONS: LeadThreadAction[] = [
  "create",
  "update",
  "phone",
  "login",
  "statements",
  "complete",
];

export async function POST(request: NextRequest) {
  const apiKey = request.headers.get("x-api-key");
  const expectedKey = process.env.LEAD_THREAD_API_KEY;

  if (expectedKey) {
    const origin = request.headers.get("origin") || "";
    const isInternal =
      !origin ||
      origin.includes("mission.srtagency.com") ||
      origin.includes("localhost");
    if (!isInternal && apiKey !== expectedKey) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let body: { contactId?: string; action?: string; note?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { contactId, action, note } = body;
  if (!contactId || !action) {
    return NextResponse.json(
      { error: "contactId and action are required" },
      { status: 400 }
    );
  }
  if (!VALID_ACTIONS.includes(action as LeadThreadAction)) {
    return NextResponse.json(
      { error: `Invalid action. Must be one of: ${VALID_ACTIONS.join(", ")}` },
      { status: 400 }
    );
  }

  try {
    await postOrThreadLeadUpdate({
      contactId,
      action: action as LeadThreadAction,
      note: typeof note === "string" ? note : undefined,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[lead-thread route] error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
