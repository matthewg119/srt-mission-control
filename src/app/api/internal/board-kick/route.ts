// Re-walk one client's board, and re-number its old cards.
//
// ‼️ WHY THIS EXISTS: A DEPLOY THAT INSERTS STEPS DOES NOT MOVE ANY BOARD BY ITSELF. The board only
// walks when a step changes (setDeliveryStep's cascade). On 2026-09-11 the prep call moved to step
// 11 and the keyword step arrived at 14 for SRT Agency, a client already past both, and nothing
// posted either card until somebody pressed a button. Worse, every card already in the channel
// still showed the number it was posted with ("11. Findings written up" is step 13 now), so
// Matthew replied `terms:` in the findings thread and a keyword list in the citation cleanup
// thread, the general assistant answered both, and nothing was saved.
//
// This does two things, in this order:
//   1. re-renders every existing anchor from the CURRENT step list, so each card's number and
//      "step N of M" are true again. Edited in place, never re-posted, so channel order holds;
//   2. runs the same cascade a transition runs: anchors in order, auto runners, ready cards, the
//      pinned header.
//
// CRON_SECRET, and a 404 when it is wrong, same as /api/internal/pre-call-pages. Awaited rather
// than handed to waitUntil, so the caller gets back what actually happened.

import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Not found", { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as { clientId?: unknown } | null;
  const clientId = typeof body?.clientId === "string" ? body.clientId : "";
  if (!UUID.test(clientId)) return NextResponse.json({ ok: false, error: "bad clientId" }, { status: 400 });

  const { supabaseAdmin } = await import("@/lib/db");
  const { refreshStepAnchor } = await import("@/lib/clients/step-board");
  const { ensureReachableAnchors, runReadyAutoSteps, postReadySteps, reachableCursor } = await import(
    "@/lib/clients/step-engine"
  );
  const { refreshDeliveryChecklist } = await import("@/lib/clients/delivery-checklist");

  const { data: anchored, error } = await supabaseAdmin
    .from("client_delivery_steps")
    .select("step_key")
    .eq("client_id", clientId)
    .not("slack_anchor_ts", "is", null);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  let renumbered = 0;
  const failed: string[] = [];
  for (const r of anchored ?? []) {
    const res = await refreshStepAnchor(clientId, String(r.step_key));
    if (res.ok) renumbered += 1;
    else failed.push(`${r.step_key}: ${res.error ?? "unknown"}`);
  }

  await ensureReachableAnchors(clientId);
  await runReadyAutoSteps(clientId);
  await postReadySteps(clientId);
  await refreshDeliveryChecklist(clientId).catch(() => {});

  const cursor = [...(await reachableCursor(clientId))];
  return NextResponse.json({ ok: true, renumbered, failed, cursor });
}
