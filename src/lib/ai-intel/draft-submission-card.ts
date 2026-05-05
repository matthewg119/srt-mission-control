// Posts a "draft submission email" approval card into a deal's Slack thread
// after a bank-statement approval. The card has no Approve/Edit/Cancel
// buttons — the pending action is resolved when Matt replies in the thread
// with lender names (see /api/slack/events thread-reply listener).

import { supabaseAdmin } from "@/lib/db";
import { draftSubmissionEmail, formatRevenueForSubject } from "./deal-submission-builder";
import { postApprovalRequest } from "./slack-approval";
import type { PendingActionPayload } from "./types";
import type { SlackBlock } from "@/lib/slack-bot";

interface RevenueRow {
  month: string;
  deposits: number | null;
  avg_daily_ledger: number | null;
  deposit_count: number | null;
  nsf_count: number | null;
}

export async function postDraftSubmissionCard(opts: {
  dealId: string;
  contactId: string;
  zohoId: string | null;
  revenueTable: RevenueRow[];
  onedriveFolderUrl?: string | null;
  bankStmtDriveItemIds?: string[];
  aiDecisionId?: string;
}): Promise<{ ok: boolean; slackTs: string | null; error?: string }> {
  const { data: deal, error: dealErr } = await supabaseAdmin
    .from("deals")
    .select("id, amount, slack_thread_ts, slack_channel, contacts:contact_id(business_name, industry, monthly_revenue, use_of_funds)")
    .eq("id", opts.dealId)
    .single();

  if (dealErr || !deal) {
    return { ok: false, slackTs: null, error: dealErr?.message ?? "deal_not_found" };
  }

  const row = deal as unknown as {
    id: string;
    amount: number | null;
    slack_thread_ts: string | null;
    slack_channel: string | null;
    contacts: {
      business_name: string | null;
      industry: string | null;
      monthly_revenue: number | null;
      use_of_funds: string | null;
    } | null;
  };

  if (!row.slack_thread_ts || !row.slack_channel) {
    return { ok: false, slackTs: null, error: "no_thread" };
  }

  const businessName = row.contacts?.business_name ?? "Merchant";
  const industry = row.contacts?.industry ?? "General";
  const amount = row.amount ?? 0;
  const useOfFunds = row.contacts?.use_of_funds ?? "working capital";
  const monthlyRevenue = row.contacts?.monthly_revenue ?? null;

  const revenueTableText = formatRevenueTable(opts.revenueTable);

  const draftBody = await draftSubmissionEmail({
    businessName,
    amountRequested: amount,
    useOfFunds,
    revenueTable: revenueTableText,
  });

  const draftSubject = `${businessName} - Funding Application`;

  const payload: PendingActionPayload = {
    action_type: "send_submission",
    deal_id: opts.dealId,
    contact_id: opts.contactId,
    zoho_id: opts.zohoId ?? undefined,
    draft_subject: draftSubject,
    draft_body: draftBody,
    amount,
    onedrive_folder_url: opts.onedriveFolderUrl ?? undefined,
    bank_stmt_drive_item_ids: opts.bankStmtDriveItemIds ?? [],
  };

  const blocks: SlackBlock[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: `📧 *Draft submission email* — ${businessName}` },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Subject:* \`${draftSubject}\`` },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: "```\n" + clip(draftBody, 2800) + "\n```" },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "Reply with lender name(s) and an optional client note.\nExamples:\n• `Forward Financing, Credibly`\n• `Tier 1 only / note: Client looking for expansion capital`\nNote will appear in *italic* in the email.",
        },
      ],
    },
  ];

  const res = await postApprovalRequest({
    summary: "Review submission draft, reply with lender names to send.",
    payload,
    merchantId: opts.contactId,
    zohoId: opts.zohoId ?? undefined,
    aiDecisionId: opts.aiDecisionId,
    channel: row.slack_channel,
    threadTs: row.slack_thread_ts,
    blocks,
  });

  return { ok: !!res.slackTs, slackTs: res.slackTs, error: res.skipped };
}

function formatRevenueTable(rows: RevenueRow[]): string {
  if (!rows || rows.length === 0) return "(Revenue table unavailable — derive from the analysis report above.)";
  const header = "Month | Deposits | AVG Daily Ledger | # of Deposits | NSF";
  const body = rows.map((r) => {
    const dep = r.deposits != null ? `$${Number(r.deposits).toLocaleString()}` : "—";
    const led = r.avg_daily_ledger != null ? `$${Number(r.avg_daily_ledger).toLocaleString()}` : "—";
    const cnt = r.deposit_count != null ? String(r.deposit_count) : "—";
    const nsf = r.nsf_count != null ? String(r.nsf_count) : "—";
    return `${r.month} | ${dep} | ${led} | ${cnt} | ${nsf}`;
  });
  return [header, ...body].join("\n");
}

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + "...";
}
