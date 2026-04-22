import { supabaseAdmin } from "@/lib/db";
import { microsoft } from "@/lib/microsoft";
import { slack } from "@/lib/slack-bot";
import { callClaudeText } from "@/lib/claude-calls";
import { generateApplicationPDF } from "@/lib/pdf-generator";
import { postApprovalRequest } from "./slack-approval";
import { syncLenderSubmissionsSubform } from "@/lib/zoho-mca-fields";
import type { PendingActionPayload } from "./types";

export interface BuildSubmissionOpts {
  dealId: string;
  lenderIds: string[];
  requestedAmount: number;
  requestedBy: "cron" | "slack_command" | "ui_button";
}

export interface BuildSubmissionResult {
  ok: boolean;
  error?: string;
  pendingActionIds: string[];
  onedriveUrl: string | null;
  dealSubmissionIds: string[];
}

const SUBMISSIONS_CHANNEL = () => process.env.SLACK_SUB_CHANNEL || process.env.SLACK_AI_APPROVALS_CHANNEL || process.env.SLACK_HOT_LEADS_CHANNEL || "";

export async function buildSubmissionPackage(opts: BuildSubmissionOpts): Promise<BuildSubmissionResult> {
  const { data: deal, error: dealErr } = await supabaseAdmin
    .from("deals")
    .select("id, contact_id, stage, pipeline, amount, contacts!inner(id, first_name, last_name, business_name, legal_name, dba, industry, ein, biz_address, biz_city, biz_state, biz_zip, email, phone, mobile_phone, credit_score, monthly_revenue, monthly_deposits, use_of_funds, zoho_lead_id)")
    .eq("id", opts.dealId)
    .maybeSingle();

  if (dealErr || !deal) {
    return { ok: false, error: "deal_not_found", pendingActionIds: [], onedriveUrl: null, dealSubmissionIds: [] };
  }

  const contact = (deal as unknown as { contacts: Record<string, unknown> }).contacts;
  if (!contact) return { ok: false, error: "contact_missing", pendingActionIds: [], onedriveUrl: null, dealSubmissionIds: [] };

  const { data: lenders, error: lendersErr } = await supabaseAdmin
    .from("lenders")
    .select("id, name, submission_email, submission_method")
    .in("id", opts.lenderIds)
    .eq("is_active", true);

  if (lendersErr || !lenders || lenders.length === 0) {
    return { ok: false, error: "no_lenders", pendingActionIds: [], onedriveUrl: null, dealSubmissionIds: [] };
  }

  const revenueTable = await buildRevenueTable(contact.id as string);

  const draftedSubject = `${contact.business_name ?? contact.legal_name ?? contact.dba ?? "Merchant"} | $${opts.requestedAmount.toLocaleString()} | ${contact.industry ?? "General"} | $${formatRevenueForSubject(contact.monthly_revenue)}/mo avg`;

  const draftedBody = await draftSubmissionEmail({
    businessName: (contact.business_name as string) ?? "Merchant",
    amountRequested: opts.requestedAmount,
    useOfFunds: (contact.use_of_funds as string) ?? "working capital",
    revenueTable,
  });

  let onedriveUrl: string | null = null;
  const pdfBuffer = generateApplicationPDF({
    firstName: contact.first_name as string,
    lastName: contact.last_name as string,
    email: contact.email as string,
    businessPhone: contact.phone as string,
    businessName: contact.business_name as string,
    legalName: contact.legal_name as string,
    dba: contact.dba as string,
    industry: contact.industry as string,
    ein: contact.ein as string,
    bizAddress: contact.biz_address as string,
    bizCity: contact.biz_city as string,
    bizState: contact.biz_state as string,
    bizZip: contact.biz_zip as string,
    creditScore: contact.credit_score as string,
    amountNeeded: String(opts.requestedAmount),
    useOfFunds: contact.use_of_funds as string,
    monthlyDeposits: String(contact.monthly_deposits ?? ""),
    hidePhone: true,
  });

  let applicationPdfUrl: string | null = null;

  try {
    const folderName = `Deals/${(contact.business_name as string) ?? "Unknown"}/Completed Package`;
    const folder = await microsoft.createDriveFolder("Completed Package", `Deals/${(contact.business_name as string) ?? "Unknown"}`);
    onedriveUrl = folder.webUrl;

    const appUpload = await microsoft.uploadDriveFile(folderName, "application.pdf", pdfBuffer, "application/pdf");
    applicationPdfUrl = appUpload.webUrl;

    const bodyBuffer = Buffer.from(`Subject: ${draftedSubject}\n\n${draftedBody}`, "utf8");
    await microsoft.uploadDriveFile(folderName, "submission_email_draft.txt", bodyBuffer, "text/plain");
  } catch (e) {
    console.error("[submission-builder] OneDrive upload failed:", (e as Error).message);
  }

  const pendingActionIds: string[] = [];
  const dealSubmissionIds: string[] = [];

  for (const lender of lenders as Array<{ id: string; name: string; submission_email: string | null }>) {
    if (!lender.submission_email) continue;

    const { data: submissionRow } = await supabaseAdmin
      .from("deal_submissions")
      .insert({
        merchant_id: contact.id as string,
        deal_id: opts.dealId,
        lender_id: lender.id,
        amount_requested: opts.requestedAmount,
        status: "pending",
        onedrive_folder_url: onedriveUrl,
      })
      .select("id")
      .single();

    if (submissionRow?.id) dealSubmissionIds.push(submissionRow.id as string);

    const payload: PendingActionPayload = {
      action_type: "submit_deal",
      to: lender.submission_email,
      subject: draftedSubject,
      body: draftedBody,
      is_html: false,
      attachments: applicationPdfUrl
        ? [{ name: "application.pdf", url: applicationPdfUrl, contentType: "application/pdf" }]
        : [],
      deal_id: opts.dealId,
      lender_id: lender.id,
      zoho_id: contact.zoho_lead_id as string | undefined,
      amount: opts.requestedAmount,
      requires_matthew: opts.requestedAmount > 50_000,
    };

    const summary = `📤 *Submission ready:* ${contact.business_name ?? "Merchant"}
*Lender:* ${lender.name}
*Amount:* $${opts.requestedAmount.toLocaleString()}
*Industry:* ${contact.industry ?? "General"}
*Revenue:* $${formatRevenueForSubject(contact.monthly_revenue)}/mo avg
*Subject:* \`${draftedSubject}\`
*OneDrive:* ${onedriveUrl ?? "(upload failed — will send inline only)"}
${opts.requestedAmount > 50_000 ? "🔒 _Matthew approval required._" : ""}`;

    const res = await postApprovalRequest({
      summary,
      payload,
      merchantId: contact.id as string,
      zohoId: contact.zoho_lead_id as string | undefined,
      channel: SUBMISSIONS_CHANNEL(),
    });

    if (res.pendingActionId) pendingActionIds.push(res.pendingActionId);
  }

  if (dealSubmissionIds.length > 0) {
    try {
      await syncLenderSubmissionsSubform(contact.id as string);
    } catch (e) {
      console.warn("[submission-builder] Zoho subform sync failed:", (e as Error).message);
    }
  }

  return {
    ok: true,
    pendingActionIds,
    onedriveUrl,
    dealSubmissionIds,
  };
}

async function draftSubmissionEmail(args: { businessName: string; amountRequested: number; useOfFunds: string; revenueTable: string }): Promise<string> {
  const system = `You are SRT Submissions, writing a deal-submission email to an MCA funder. Follow SRT's exact format:

Hello team,

[Revenue table with columns: Month | Deposits | AVG Daily Ledger | # of Deposits | NSF]

Merchant is looking for $[amount] to [use of funds].

King regards,
SRT Submissions
Scaling Revenue Together
T: (786) 282-2937 | F: (252) 556-1444

Output plain text only. No preamble. No markdown. No signature extras. Keep revenue table as-is from input.`;

  const user = `Business: ${args.businessName}
Amount requested: $${args.amountRequested.toLocaleString()}
Use of funds: ${args.useOfFunds}

Revenue table:
${args.revenueTable}`;

  const { text } = await callClaudeText({
    model: "claude-opus-4-7",
    system,
    user,
    maxTokens: 1000,
    temperature: 0.3,
  });
  return text;
}

async function buildRevenueTable(contactId: string): Promise<string> {
  const { data: summary } = await supabaseAdmin
    .from("plaid_transaction_summary")
    .select("month, total_deposits, avg_daily_ledger, deposit_count, nsf_count")
    .eq("contact_id", contactId)
    .order("month", { ascending: false })
    .limit(3);

  if (summary && summary.length > 0) {
    return [
      "Month | Deposits | AVG Daily Ledger | # of Deposits | NSF",
      ...summary.map((r: { month: string; total_deposits: number; avg_daily_ledger: number; deposit_count: number; nsf_count: number }) =>
        `${r.month} | $${Number(r.total_deposits).toLocaleString()} | $${Number(r.avg_daily_ledger).toLocaleString()} | ${r.deposit_count} | ${r.nsf_count}`
      ),
    ].join("\n");
  }

  const { data: contact } = await supabaseAdmin
    .from("contacts")
    .select("monthly_revenue, monthly_deposits")
    .eq("id", contactId)
    .maybeSingle();

  if (contact?.monthly_revenue) {
    return `Month | Deposits | AVG Daily Ledger | # of Deposits | NSF
(rolling avg) | $${Number(contact.monthly_revenue).toLocaleString()} | n/a | n/a | n/a
(no Plaid data available — verify with bank statements)`;
  }

  return "(Revenue data not available — bank statements pending)";
}

function formatRevenueForSubject(rev: unknown): string {
  if (typeof rev === "number") return Math.round(rev).toLocaleString();
  if (typeof rev === "string") {
    const parsed = parseFloat(rev.replace(/[^0-9.]/g, ""));
    if (!Number.isNaN(parsed)) return Math.round(parsed).toLocaleString();
  }
  return "unknown";
}

void slack;
