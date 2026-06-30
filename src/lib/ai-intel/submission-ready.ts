// Auto-drafts the lender submissions exactly once, and ONLY when BOTH are true:
// the bank statements have been analyzed AND the application is complete. Safe to
// call from multiple triggers (the bank-statement analyzer, the app-completion
// signal, and the 👍 approval path) — it is idempotent via the deal_submissions
// rows buildSubmissionPackage creates, so whichever event lands last drafts the
// submissions and the others no-op.
//
// Instead of asking the operator to reply with lender names, we auto-draft to a
// fixed default lender set (Matthew's choice: "SRT submissions" + "BTF"). Each
// drafted lender email is still GATED — buildSubmissionPackage posts a per-lender
// approval card; nothing is sent until 👍.

import { supabaseAdmin } from "@/lib/db";
import { buildSubmissionPackage } from "./deal-submission-builder";

// Default lenders to auto-draft to on a full package. Resolved to lenders.id by
// name (case-insensitive). Adjust here if the default set changes.
const DEFAULT_SUBMISSION_LENDERS = ["SRT submissions", "BTF"];

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

type ContactGateRow = {
  portal_app_completed: boolean | null;
  application_stage: string | null;
  bank_statement_analysis_status: string | null;
  zoho_lead_id: string | null;
  amount_needed: string | number | null;
  portal_funding_range: string | null;
};

const GATE_SELECT =
  "portal_app_completed, application_stage, bank_statement_analysis_status, zoho_lead_id, amount_needed, portal_funding_range";

/**
 * Auto-draft to the default lender set the moment statements are analyzed and a
 * deal with a Slack thread exists — regardless of whether the application is
 * complete yet. Same idempotency + gating as the app-complete path, so whichever
 * trigger lands last no-ops. Drafts are still GATED (per-lender 👍 Send card).
 */
export async function maybeDraftPackageOnStatements(
  contactId: string,
  opts: SubmissionReadyOpts = {}
): Promise<{ posted: boolean; reason?: string }> {
  const { data: contact } = await supabaseAdmin
    .from("contacts")
    .select(GATE_SELECT)
    .eq("id", contactId)
    .maybeSingle();
  if (!contact) return { posted: false, reason: "no_contact" };
  if ((contact as ContactGateRow).bank_statement_analysis_status !== "analyzed") {
    return { posted: false, reason: "statements_not_analyzed" };
  }
  return draftDefaultPackage(contactId, contact as ContactGateRow, opts);
}

export async function maybePostSubmissionReady(
  contactId: string,
  opts: SubmissionReadyOpts = {}
): Promise<{ posted: boolean; reason?: string }> {
  // 1) Gate on contact state: app complete AND statements analyzed.
  const { data: contact } = await supabaseAdmin
    .from("contacts")
    .select(GATE_SELECT)
    .eq("id", contactId)
    .maybeSingle();
  if (!contact) return { posted: false, reason: "no_contact" };

  const c = contact as ContactGateRow;
  const appComplete =
    c.portal_app_completed === true || c.application_stage === "Application Complete";
  const stmtsAnalyzed = c.bank_statement_analysis_status === "analyzed";
  if (!appComplete) return { posted: false, reason: "app_incomplete" };
  if (!stmtsAnalyzed) return { posted: false, reason: "statements_not_analyzed" };

  return draftDefaultPackage(contactId, c, opts);
}

/**
 * Shared core: resolve the deal + thread, idempotency-check, resolve the default
 * lender set, and build the gated package. Callers apply their own state gate
 * (app-complete vs statements-analyzed) before invoking this.
 */
async function draftDefaultPackage(
  contactId: string,
  contact: ContactGateRow,
  opts: SubmissionReadyOpts
): Promise<{ posted: boolean; reason?: string }> {
  // 2) Resolve the deal and require a Slack thread (the analyzer / ensure-deal creates it).
  let dealId = opts.dealId;
  let dealThreadOk = false;
  let dealAmount = 0;
  if (dealId) {
    const { data: d } = await supabaseAdmin
      .from("deals")
      .select("id, amount, slack_thread_ts, slack_channel")
      .eq("id", dealId)
      .maybeSingle();
    dealThreadOk = !!(d?.slack_thread_ts && d?.slack_channel);
    dealAmount = Number(d?.amount) || 0;
  } else {
    const { data: d } = await supabaseAdmin
      .from("deals")
      .select("id, amount, slack_thread_ts, slack_channel")
      .eq("contact_id", contactId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (d) {
      dealId = d.id as string;
      dealThreadOk = !!(d.slack_thread_ts && d.slack_channel);
      dealAmount = Number(d.amount) || 0;
    }
  }
  if (!dealId) return { posted: false, reason: "no_deal" };
  if (!dealThreadOk) return { posted: false, reason: "no_thread" };

  // 3) Idempotency: skip if submissions were already drafted for this deal.
  const { data: existing } = await supabaseAdmin
    .from("deal_submissions")
    .select("id")
    .eq("deal_id", dealId)
    .limit(1)
    .maybeSingle();
  if (existing) return { posted: false, reason: "already_drafted" };

  // 4) Resolve the default lender set → lenders.id[].
  const orFilter = DEFAULT_SUBMISSION_LENDERS.map((n) => `name.ilike.%${n}%`).join(",");
  const { data: lenderRows } = await supabaseAdmin
    .from("lenders")
    .select("id, name")
    .or(orFilter)
    .eq("is_active", true);
  const lenderIds = (lenderRows ?? []).map((l) => l.id as string);
  if (lenderIds.length === 0) return { posted: false, reason: "no_default_lenders" };

  // 5) Auto-draft the gated lender submissions (per-lender approval cards).
  const requestedAmount =
    dealAmount ||
    parseFloat(String(contact.amount_needed ?? contact.portal_funding_range ?? "0").replace(/[^0-9.]/g, "")) ||
    0;
  const res = await buildSubmissionPackage({
    dealId,
    lenderIds,
    requestedAmount,
    requestedBy: "cron",
  });
  return { posted: !!res.ok, reason: res.error };
}
