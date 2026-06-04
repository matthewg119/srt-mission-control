// Sales Twin — RingOut dialer ("ring my RingCentral desktop app" mode).
//
// Reuses the EXISTING exported RingOut helpers in src/lib/ringcentral.ts (the
// same app Speed to Lead uses — it has the RingOut/Call-Control permission).
// Nothing in speed-to-lead.ts or ringcentral.ts is modified.
//
// Flow: POST starts a RingOut — RingCentral first rings the rep's device
// (ST_DESKTOP_RINGOUT_NUMBER → the desktop app), the rep answers + presses 1,
// then RC dials the lead and bridges, showing caller ID RC_BUSINESS_NUMBER.
// GET ?id= polls call status; DELETE ?id= cancels.

import { NextRequest, NextResponse } from "next/server";
import { initiateRingOut, getRingOutStatus, cancelRingOut } from "@/lib/ringcentral";

export const dynamic = "force-dynamic";

// The number that rings the rep's RingCentral desktop app. Defaults to the
// account's direct line; override per environment.
function desktopNumber(): string {
  return (
    process.env.ST_DESKTOP_RINGOUT_NUMBER ||
    process.env.RC_AGENT_NUMBER ||
    process.env.RC_BUSINESS_NUMBER ||
    ""
  );
}

export async function POST(req: NextRequest) {
  const { leadPhone } = (await req.json()) as { leadPhone?: string };
  if (!leadPhone) {
    return NextResponse.json({ ok: false, error: "Missing leadPhone" }, { status: 400 });
  }

  const from = desktopNumber();
  if (!from) {
    return NextResponse.json(
      { ok: false, error: "ST_DESKTOP_RINGOUT_NUMBER not set — can't ring your desktop app." },
      { status: 500 }
    );
  }

  const ext = process.env.ST_DESKTOP_RINGOUT_EXTENSION || undefined;
  const result = await initiateRingOut(from, leadPhone, ext);

  if (!result.success || !result.data) {
    return NextResponse.json({ ok: false, error: result.error || "RingOut failed" }, { status: 502 });
  }
  return NextResponse.json({ ok: true, ringoutId: result.data.id });
}

export async function GET(req: NextRequest) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });

  const result = await getRingOutStatus(id);
  if (!result.success || !result.data) {
    return NextResponse.json({ ok: false, error: result.error || "Status check failed" }, { status: 502 });
  }
  return NextResponse.json({ ok: true, status: result.data.status });
}

export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });
  await cancelRingOut(id);
  return NextResponse.json({ ok: true });
}
