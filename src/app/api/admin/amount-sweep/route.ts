// Amount sweep — scans submissions@srtagency.com inbox for the last 90 days,
// classifies every message, and proposes clearing MCA_Approved_Amount on any
// Zoho Lead that has an amount on file but NO approval email from a lender in
// the window.
//
// Read-only until Matthew hits 👍 on the Slack approval card — the actual
// Zoho writes happen via execute-action.ts action_type "clear_lead_amounts".
//
// Hit with:  POST /api/admin/amount-sweep  (no body needed)
// Returns JSON preview of the proposal + posts the Slack approval card.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { microsoft } from "@/lib/microsoft";
import { classifyInboundEmail, findContactByBusinessName } from "@/lib/ai-intel/inbound-classifier";
import { postApprovalRequest } from "@/lib/ai-intel/slack-approval";
import { getLead } from "@/lib/zoho";
import type { PendingActionPayload } from "@/lib/ai-intel/types";

export const runtime = "nodejs";
export const maxDuration = 300; // allow up to 5 min; large inboxes take time

const DEFAULT_MAILBOX = "submissions@srtagency.com";
const DEFAULT_WINDOW_DAYS = 90;

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const mailbox = url.searchParams.get("mailbox") ?? DEFAULT_MAILBOX;
  const windowDays = Number(url.searchParams.get("days") ?? DEFAULT_WINDOW_DAYS);
  const maxEmails = Number(url.searchParams.get("max") ?? 500);
  const dryRun = url.searchParams.get("dryrun") !== "0"; // default dry run

  const sinceDate = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

  // Build: merchant_id → has at least one "approved" email in window
  const merchantHasApproval = new Map<string, { businessName: string; zohoLeadId: string | null; lastApprovedSummary: string }>();
  const merchantSeen = new Map<string, { businessName: string; zohoLeadId: string | null }>();

  let scannedCount = 0;
  let classifyFailures = 0;

  for await (const msg of microsoft.listMessages({
    mailbox,
    filter: `receivedDateTime ge ${sinceDate}`,
    top: 100,
  })) {
    if (scannedCount >= maxEmails) break;
    scannedCount++;

    try {
      const { body } = await microsoft.getMessageBody(msg.id, mailbox);
      const { classification } = await classifyInboundEmail({
        subject: msg.subject ?? "",
        from: msg.from?.emailAddress?.address ?? "unknown",
        body,
      });

      if (!classification.business_name) continue;
      const contact = await findContactByBusinessName(classification.business_name);
      if (!contact) continue;

      merchantSeen.set(contact.id, { businessName: contact.business_name ?? classification.business_name, zohoLeadId: contact.zoho_lead_id });

      if (classification.intent === "approved") {
        merchantHasApproval.set(contact.id, {
          businessName: contact.business_name ?? classification.business_name,
          zohoLeadId: contact.zoho_lead_id,
          lastApprovedSummary: classification.summary,
        });
      }
    } catch (e) {
      classifyFailures++;
      console.warn("[amount-sweep] classify failed:", (e as Error).message);
    }
  }

  // Identify merchants that CURRENTLY have MCA_Approved_Amount set in Zoho
  // but did NOT show up as "approved" in the window. These are candidates.
  const candidates: Array<{ merchantId: string; businessName: string; zohoLeadId: string; currentAmount: number }> = [];

  for (const [merchantId, info] of merchantSeen.entries()) {
    if (merchantHasApproval.has(merchantId)) continue;
    if (!info.zohoLeadId) continue;

    try {
      const lead = await getLead(info.zohoLeadId);
      const raw = (lead as Record<string, unknown>).MCA_Approved_Amount;
      const current = Number(raw);
      if (!Number.isFinite(current) || current <= 0) continue;
      candidates.push({
        merchantId,
        businessName: info.businessName,
        zohoLeadId: info.zohoLeadId,
        currentAmount: current,
      });
    } catch (e) {
      console.warn("[amount-sweep] getLead failed for", info.zohoLeadId, (e as Error).message);
    }
  }

  // Sort biggest first so the card surfaces the most consequential ones.
  candidates.sort((a, b) => b.currentAmount - a.currentAmount);

  const summary = buildSummary({
    scannedCount,
    windowDays,
    approvedCount: merchantHasApproval.size,
    merchantsSeen: merchantSeen.size,
    candidates,
  });

  let pendingActionId: string | null = null;
  let slackTs: string | null = null;

  if (!dryRun && candidates.length > 0) {
    const payload: PendingActionPayload = {
      action_type: "clear_lead_amounts",
      requires_matthew: true,
      // Reusing the generic zoho_fields slot to carry the targets.
      zoho_fields: {
        targets: candidates.map((c) => ({ zoho_lead_id: c.zohoLeadId, business_name: c.businessName, current_amount: c.currentAmount })),
      },
    } as PendingActionPayload;

    const res = await postApprovalRequest({
      summary,
      payload,
      channel: process.env.SLACK_VEKTOR_DEALS_CHANNEL || process.env.SLACK_AI_APPROVALS_CHANNEL || process.env.SLACK_HOT_LEADS_CHANNEL || "",
    });
    pendingActionId = res.pendingActionId;
    slackTs = res.slackTs;
  }

  return NextResponse.json({
    ok: true,
    mailbox,
    window_days: windowDays,
    scanned: scannedCount,
    classify_failures: classifyFailures,
    merchants_seen: merchantSeen.size,
    merchants_with_approval: merchantHasApproval.size,
    candidates_count: candidates.length,
    candidates: candidates.slice(0, 50),
    dry_run: dryRun,
    pending_action_id: pendingActionId,
    slack_ts: slackTs,
  });
}

function buildSummary(args: {
  scannedCount: number;
  windowDays: number;
  approvedCount: number;
  merchantsSeen: number;
  candidates: Array<{ businessName: string; currentAmount: number }>;
}): string {
  const top = args.candidates.slice(0, 20);
  const rest = args.candidates.length - top.length;

  const lines = [
    `🧹 *Amount sweep* — scanned ${args.scannedCount} emails over last ${args.windowDays} days`,
    `Merchants seen in inbox: *${args.merchantsSeen}* · with approval: *${args.approvedCount}*`,
    `*Candidates to clear Approved Amount (${args.candidates.length}):*`,
  ];
  for (const c of top) {
    lines.push(`• ${c.businessName} — currently $${c.currentAmount.toLocaleString()}`);
  }
  if (rest > 0) lines.push(`…and ${rest} more`);
  lines.push("");
  lines.push("👍 = clear MCA_Approved_Amount on ALL listed leads • 🚫 = do nothing");
  return lines.join("\n");
}
