// What a paid $39 order actually buys: a real audit run.
//
// This is the EXPENSIVE half of provisioning, which is why it has its own claim flag.
// Marking an order paid is cheap and safe to repeat; running 20 prompts against a
// live engine is neither, and a webhook retry that shared one flag with the cheap
// work would bill us twice.

import { waitUntil } from "@vercel/functions";
import { supabaseAdmin } from "@/lib/db";
import { runAuditPipeline } from "@/lib/audit-engine/run-audit-pipeline";
import { slack } from "@/lib/slack-bot";

/** The lead_source stamped on audit_reports for a paid buyer. */
export const PAID_LEAD_SOURCE = "medspa_paid";

interface OrderRow {
  id: string;
  email: string;
  name: string | null;
  clinic_website: string;
  contact_id: string | null;
  city: string | null;
}

async function note(message: string): Promise<void> {
  const channel = process.env.SLACK_CEO_CHANNEL;
  if (!channel) return;
  await slack.postMessage(channel, message).catch(() => {});
}

/**
 * Kick off the audit for a paid order, exactly once.
 *
 * `fulfillment_state` pending -> running is the claim. A caller that loses simply
 * returns; it must not wait, and it must not run a second pipeline.
 */
export async function fulfillMedspaOrder(orderId: string): Promise<void> {
  const { data: order } = await supabaseAdmin
    .from("medspa_orders")
    .update({ fulfillment_state: "running", updated_at: new Date().toISOString() })
    .eq("id", orderId)
    .eq("fulfillment_state", "pending")
    .select("id, email, name, clinic_website, contact_id, city")
    .maybeSingle();

  if (!order) return; // Already running, done, or owned by another request.

  const row = order as OrderRow;

  waitUntil(runFulfillment(row));
}

async function runFulfillment(order: OrderRow): Promise<void> {
  try {
    const result = await runAuditPipeline({
      website: order.clinic_website,
      city: order.city ?? undefined,
      requesterEmail: order.email,
      requesterName: order.name ?? undefined,
      contactId: order.contact_id ?? undefined,
      leadSource: PAID_LEAD_SOURCE,
      // Nobody is on the other end of a purchase to answer a follow-up question, so
      // proceed on the best guess rather than blocking the run.
      allowLowConfidenceCity: true,

      // Use the CALLBACK, never the return value. runAuditPipeline awaits the entire
      // run before returning, so its reportId arrives minutes late. This fires the
      // moment the row exists, roughly 15s in, which is what lets the OTO page show
      // progress instead of a spinner. Getting this wrong is what made /scan's
      // stepped UI dead code on its first build.
      onReportCreated: async (reportId) => {
        await supabaseAdmin
          .from("medspa_orders")
          .update({ audit_report_id: reportId, updated_at: new Date().toISOString() })
          .eq("id", order.id);
      },

      onError: async (message) => {
        await supabaseAdmin
          .from("medspa_orders")
          .update({ fulfillment_state: "failed", updated_at: new Date().toISOString() })
          .eq("id", order.id);
        await note(
          `:rotating_light: Paid med spa audit FAILED for ${order.email} (${order.clinic_website}). ` +
            `They have been charged. Reason: ${message}`
        );
      },
    });

    if (!result.ok) return; // onError already reported and flagged it.

    // ── The free-scan dedup collision ──
    // findRecentReport() in run-audit-pipeline.ts returns an EXISTING report when the
    // same website+email was audited in the last 30 minutes. A buyer who ran the free
    // /scan minutes before paying therefore gets that row back, and it carries
    // lead_source 'scan', so it will never get the paid treatment. Delivering it is
    // the right outcome for the customer (they get their answer instantly), but it
    // must be VISIBLE rather than a silent mystery later.
    if (result.reportId) {
      const { data: report } = await supabaseAdmin
        .from("audit_reports")
        .select("lead_source")
        .eq("id", result.reportId)
        .maybeSingle();

      if (report && report.lead_source !== PAID_LEAD_SOURCE) {
        await note(
          `:information_source: Paid order for ${order.email} reused an existing ` +
            `\`${report.lead_source}\` report (30 min dedup on ${order.clinic_website}). ` +
            `They were served immediately, but this report will not get the paid lane's ` +
            `auto-send. Check they received it.`
        );
      }
    }

    await supabaseAdmin
      .from("medspa_orders")
      .update({
        fulfillment_state: "done",
        fulfilled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", order.id);
  } catch (e) {
    console.error("[medspa/fulfillment] threw:", (e as Error).message);
    await supabaseAdmin
      .from("medspa_orders")
      .update({ fulfillment_state: "failed", updated_at: new Date().toISOString() })
      .eq("id", order.id);
    await note(
      `:rotating_light: Paid med spa audit threw for ${order.email}: ${(e as Error).message}`
    );
  }
}
