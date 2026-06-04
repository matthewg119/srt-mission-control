// Stage-handler — single dispatch point for Zoho stage changes.
//
// Phase 1: just mirrors the stage into deal_events + posts to the deal
// thread. Phase 2 adds lender-matcher dispatch on Pre-Approved, pitch
// angles on Approved, etc. Keep this file thin — it's the switchboard,
// not the worker.

import { supabaseAdmin } from "@/lib/db";
import { postDealThreadUpdate } from "./deal-thread";
import { onPreApproved } from "./pre-approved-handler";
import { onApproved } from "./approved-handler";
import { onClosed } from "./closed-handler";
import type { ZohoStage } from "@/config/pipeline";

/**
 * Called by /api/zoho/webhook and /api/cron/zoho-sync whenever a deal's
 * Zoho Stage changes. Idempotent: recording the same transition twice
 * results in two deal_events rows but no duplicate Slack posts (thread
 * reply is fine to repeat; the caller should guard against re-dispatch).
 */
export async function handleStageChange(opts: {
  dealId: string;
  oldStage: ZohoStage | null;
  newStage: ZohoStage;
  source: "zoho_webhook" | "zoho_cron" | "manual" | "vektor";
}): Promise<void> {
  const { dealId, oldStage, newStage, source } = opts;
  if (!dealId || !newStage) return;

  // 1. Update zoho_stage on deals + timestamp.
  const { error: updateErr } = await supabaseAdmin
    .from("deals")
    .update({ zoho_stage: newStage, zoho_stage_updated_at: new Date().toISOString() })
    .eq("id", dealId);
  if (updateErr) {
    console.error("[stage-handler] deals update failed:", updateErr.message);
    return;
  }

  // 2. Append stage_change event.
  await supabaseAdmin.from("deal_events").insert({
    deal_id: dealId,
    event_type: "stage_change",
    description: `Zoho stage: ${oldStage ?? "null"} → ${newStage}`,
    old_stage: oldStage ?? null,
    new_stage: newStage,
    source,
  });

  // 3. Post into the deal's Slack thread.
  const text = oldStage
    ? `Stage changed: *${oldStage}* → *${newStage}*`
    : `Stage set to *${newStage}*`;

  await postDealThreadUpdate({
    dealId,
    action: "stage_change",
    text,
  });

  // 4. Phase-2 dispatch (lender-matcher, pitch angles) will hook in here.
  //    For now we just log and return.
  switch (newStage) {
    case "Shopping":
      // TODO Phase 2.1: onShopping(dealId)
      break;
    case "Pre-Approved":
      try {
        await onPreApproved(dealId);
      } catch (e) {
        console.error("[stage-handler] onPreApproved failed:", (e as Error).message);
      }
      break;
    case "Approved":
      try {
        await onApproved(dealId);
      } catch (e) {
        console.error("[stage-handler] onApproved failed:", (e as Error).message);
      }
      break;
    case "Closed":
      try {
        await onClosed(dealId);
      } catch (e) {
        console.error("[stage-handler] onClosed failed:", (e as Error).message);
      }
      break;
    default:
      break;
  }
}
