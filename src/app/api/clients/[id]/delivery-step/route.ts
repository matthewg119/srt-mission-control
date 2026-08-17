// Tick or untick one internal delivery step.
//
// AUTHENTICATED: middleware guards /dashboard/*, not /api/*, and this writes to a Slack
// channel. Same pattern as the time-log route beside it.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { setDeliveryStep, stepByKey } from "@/lib/clients/delivery-checklist";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth().catch(() => null);
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }

  const stepKey = typeof body.stepKey === "string" ? body.stepKey : "";
  if (!stepByKey(stepKey)) {
    return NextResponse.json({ ok: false, error: "Unknown step." }, { status: 400 });
  }

  const result = await setDeliveryStep({
    clientId: id,
    stepKey,
    complete: Boolean(body.complete),
    actor: session.user.name ?? session.user.email ?? null,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
