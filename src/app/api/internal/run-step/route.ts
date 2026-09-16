// Re-run ONE step's generator for one client, now.
//
// ‼️ WHY THIS EXISTS, AND IT IS A REAL GAP RATHER THAN A CONVENIENCE. runReadyAutoSteps is gated on
// reachableCursor, which breaks at the first unresolved step that waits for a person. That is
// correct for the CHANNEL: it is what keeps one card at a time on the board. But it means a step
// whose card is already posted, twenty places down the board, cannot be re-run at all until the
// walk reaches it, and the only other lever (board-kick) re-walks from the cursor and therefore
// does exactly the same thing.
//
// Measured on SRT, 2026-09-12: `concierge_preview` sat at `pending` holding a demo link on
// concierge.srtagency.com, a host that does not resolve, written by a deploy from before the fix.
// Nothing on the card could re-run it -- a card carries Done, Skip and "I hit a problem", and
// Done runs the VERIFIER, not the generator. The board would have had to be walked to step 18.
//
// ‼️ IT REFUSES A STEP WITH NO ANCHOR, and that is what keeps one-anchor-at-a-time intact. Every
// runner's note goes out through notifyStep, which CREATES the anchor if it is missing, so running
// an unposted step from here would put its top-level message in the channel out of order -- the
// exact leak step-engine's own doc block warns about. A step whose card is already on the board
// cannot leak anything: its anchor exists and this only adds to that thread.
//
// ‼️ IT DOES NOT TICK ANYTHING BY ITSELF. runOneStep parks an auto_then_manual step at `ready` and
// posts its card, and routes an auto step through autoCompleteStep, which runs the verifier. A
// green tick is still evidence.
//
// CRON_SECRET, and a 404 when it is wrong, same as the other internal routes.

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Not found", { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as
    | { clientId?: unknown; stepKey?: unknown }
    | null;

  const clientId = typeof body?.clientId === "string" ? body.clientId : "";
  const stepKey = typeof body?.stepKey === "string" ? body.stepKey.trim() : "";

  if (!UUID.test(clientId)) return NextResponse.json({ ok: false, error: "bad clientId" }, { status: 400 });
  if (!stepKey) return NextResponse.json({ ok: false, error: "no stepKey" }, { status: 400 });

  const { isStepKey } = await import("@/config/delivery-steps");
  if (!isStepKey(stepKey)) {
    return NextResponse.json({ ok: false, error: `unknown step ${stepKey}` }, { status: 400 });
  }

  const { supabaseAdmin } = await import("@/lib/db");
  const { data: row } = await supabaseAdmin
    .from("client_delivery_steps")
    .select("status, slack_anchor_ts")
    .eq("client_id", clientId)
    .eq("step_key", stepKey)
    .maybeSingle();

  if (!row) {
    return NextResponse.json({ ok: false, error: `no ${stepKey} row for this client` }, { status: 404 });
  }

  if (!row.slack_anchor_ts) {
    return NextResponse.json(
      {
        ok: false,
        error:
          `${stepKey} has no anchor yet, so running it here would post its top-level message out ` +
          `of order. Let the board reach it, or use /api/internal/board-kick to walk it.`,
      },
      { status: 409 }
    );
  }

  const { runOneStep } = await import("@/lib/clients/step-engine");
  const result = await runOneStep(clientId, stepKey);

  return NextResponse.json({ ok: result.ok !== false, stepKey, before: row.status, ...result });
}
