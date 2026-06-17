// Posts the "reply with lender names" submission card exactly once, and ONLY when
// BOTH are true: the bank statements have been analyzed AND the application is
// complete. Safe to call from multiple triggers (the bank-statement analyzer, the
// app-completion signal, and the 👍 approval path) — it is idempotent via the
// existing pending_slack_actions row, so whichever event lands last posts the card
// and the others no-op. The human lender-selection reply → buildSubmissionPackage
// flow downstream is unchanged.

import { supabaseAdmin } from "@/lib/db";
import { postDraftSubmissionCard } from "./draft-submission-card";

interface RevenueRow {
  month: string;
  deposits: number | null;
  avg_daily_ledger: number | null;
  deposit_count: number | null;
  nsf_count: number | null;
}

export interface SubmissionReadyOpts {
  dealId?: string;
  zohoId?: string | null;
  revenueTable?: RevenueRow[];
  onedriveFolderUrl?: string | null;
  bankStmtDriveItemIds?: string[];
  aiDecisionId?: string;
}

export async function maybePostSubmissionReady(
  contactId: string,
  opts: SubmissionReadyOpts = {}
): Promise<{ posted: boolean; reason?: string }> {
  // 1) Gate on contact state: app complete AND statements analyzed.
  const { data: contact } = await supabaseAdmin
    .from("contacts")
    .select("portal_app_completed, application_stage, bank_statement_analysis_status, zoho_lead_id")
    .eq("id", contactId)
    .maybeSingle();
  if (!contact) return { posted: false, reason: "no_contact" };

  const appComplete =
    contact.portal_app_completed === true || contact.application_stage === "Application Complete";
  const stmtsAnalyzed = contact.bank_statement_analysis_status === "analyzed";
  if (!appComplete) return { posted: false, reason: "app_incomplete" };
  if (!stmtsAnalyzed) return { posted: false, reason: "statements_not_analyzed" };

  // 2) Resolve the deal and require a Slack thread (the analyzer creates it).
  let dealId = opts.dealId;
  let dealThreadOk = false;
  if (dealId) {
    const { data: d } = await supabaseAdmin
      .from("deals")
      .select("id, slack_thread_ts, slack_channel")
      .eq("id", dealId)
      .maybeSingle();
    dealThreadOk = !!(d?.slack_thread_ts && d?.slack_channel);
  } else {
    const { data: d } = await supabaseAdmin
      .from("deals")
      .select("id, slack_thread_ts, slack_channel")
      .eq("contact_id", contactId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (d) {
      dealId = d.id as string;
      dealThreadOk = !!(d.slack_thread_ts && d.slack_channel);
    }
  }
  if (!dealId) return { posted: false, reason: "no_deal" };
  if (!dealThreadOk) return { posted: false, reason: "no_thread" };

  // 3) Idempotency: skip if a pick-lenders card is already pending for this deal.
  const { data: existing } = await supabaseAdmin
    .from("pending_slack_actions")
    .select("id")
    .eq("action_type", "send_submission")
    .eq("status", "pending")
    .eq("payload->>deal_id", dealId)
    .limit(1)
    .maybeSingle();
  if (existing) return { posted: false, reason: "already_posted" };

  // 4) Revenue table — prefer the caller's, else reconstruct from the latest analysis.
  let revenueTable: RevenueRow[] = opts.revenueTable && opts.revenueTable.length > 0 ? opts.revenueTable : [];
  if (revenueTable.length === 0) {
    const { data: decision } = await supabaseAdmin
      .from("ai_decisions")
      .select("raw_response")
      .eq("merchant_id", contactId)
      .eq("state_classified", "bank_statement_analysis")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const raw = decision?.raw_response as { metrics?: { revenue_table?: RevenueRow[] } } | null;
    revenueTable = raw?.metrics?.revenue_table ?? [];
  }

  // 5) Post the card into the deal thread.
  const res = await postDraftSubmissionCard({
    dealId,
    contactId,
    zohoId: opts.zohoId ?? (contact.zoho_lead_id as string | null) ?? null,
    revenueTable,
    onedriveFolderUrl: opts.onedriveFolderUrl,
    bankStmtDriveItemIds: opts.bankStmtDriveItemIds,
    aiDecisionId: opts.aiDecisionId,
  });
  return { posted: !!res.ok, reason: res.error };
}
