// Tick or untick one internal delivery step.
//
// AUTHENTICATED: middleware guards /dashboard/*, not /api/*, and this writes to a Slack
// channel. Same pattern as the time-log route beside it.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { setDeliveryStep, stepByKey } from "@/lib/clients/delivery-checklist";
import { waiveDay0 } from "@/lib/clients/day-zero";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

// ‼️ THE CASCADE RUNS INSIDE THIS REQUEST, AND IT IS THE DEEPEST ONE IN THE APP.
// setDeliveryStep awaits postReadySteps + runReadyAutoSteps deliberately (a fire-and-forget
// generator vanishes when Vercel freezes the function), and completing one step can now chain
// several: ticking avatar_confirmed runs custom_question_set, then page_candidates, then --
// once the other gates clear -- findings_doc and call_sheet, and findings_doc fetches up to
// five screenshots over the network while it renders. The platform default would kill that
// midway and leave a step claimed as `running` with nothing produced.
export const maxDuration = 300;

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

  const actor = session.user.name ?? session.user.email ?? null;

  // The door in the Day 0 wall. It lives on this route rather than the hub one because
  // waiving is a statement about the CHECKLIST, not about a page: it says the archive is
  // not going to happen for this client and we are proceeding anyway. It is deliberately
  // not reachable by accident — the board only offers it after a publish has been refused.
  if (body.action === "waive_day_zero") {
    const reason = typeof body.reason === "string" ? body.reason : "";
    const result = await waiveDay0({ clientId: id, reason, by: actor });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  }

  const stepKey = typeof body.stepKey === "string" ? body.stepKey : "";
  if (!stepByKey(stepKey)) {
    return NextResponse.json({ ok: false, error: "Unknown step." }, { status: 400 });
  }

  const result = await setDeliveryStep({
    clientId: id,
    stepKey,
    // The board sends a checkbox, so it can only ever tick or reopen. Skipping is a Slack
    // affordance: it wants a reason typed into the thread next to it.
    transition: body.complete ? "complete" : "reopened",
    actor: session.user.name ?? session.user.email ?? null,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
