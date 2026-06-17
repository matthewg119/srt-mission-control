import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { analyzeBankStatements } from "@/lib/ai-intel/bank-statement-analyzer";
import { callClaudeJSON } from "@/lib/claude-calls";
import { postDealThreadUpdate } from "@/lib/ai-intel/deal-thread";
import { postApprovalRequest } from "@/lib/ai-intel/slack-approval";
import { maybePostSubmissionReady } from "@/lib/ai-intel/submission-ready";
import { microsoft } from "@/lib/microsoft";
import { slack } from "@/lib/slack-bot";
import type { PendingActionPayload } from "@/lib/ai-intel/types";
import type { SlackBlock } from "@/lib/slack-bot";

const SUB_CHANNEL = () => process.env.SLACK_SUB_CHANNEL || "C0AJXH7PTBM";
const REQUIRED_BANK_STMTS = 3; // mirror src/lib/ai-intel/pre-approved-handler.ts

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface RequestBody {
  deal_id?: string;
  contact_id?: string;
  merchant_name?: string;
  pdf_urls?: string[];
  drive_item_ids?: string[];
  source?: "onedrive" | "slack_drop" | "manual" | "portal";
  onedrive_folder_url?: string;
  slack_channel?: string;
  slack_thread_ts?: string;
}

interface RevenueTableRow {
  month: string;             // "December", "Jan", "Feb", "March"
  deposits: number | null;   // total deposits for the month
  avg_daily_ledger: number | null; // average daily ledger balance
  deposit_count: number | null;    // number of deposits
  nsf_count: number | null;        // number of NSFs
}

interface BankMetrics {
  account_holder: string | null;
  business_address: string | null;
  business_city: string | null;
  business_state: string | null;
  business_zip: string | null;
  avg_monthly_deposits: number | null;
  avg_daily_balance: number | null;
  total_nsfs: number | null;
  negative_balance_days: number | null;
  existing_mca_positions: number | null;
  existing_mca_monthly_burden: number | null;
  revenue_trend: "growing" | "stable" | "declining" | null;
  top_mca_lenders: string[];
  red_flags: string[];
  qualification_signal: "strong" | "moderate" | "weak" | null;
  statement_months_covered: string[];
  revenue_table: RevenueTableRow[];
}

const METRICS_SYSTEM = `You extract structured underwriting metrics from a bank-statement analysis report.

Output JSON only, matching this shape:
{
  "account_holder": string | null,
  "business_address": string | null,
  "business_city": string | null,
  "business_state": string | null,
  "business_zip": string | null,
  "avg_monthly_deposits": number | null,
  "avg_daily_balance": number | null,
  "total_nsfs": number | null,
  "negative_balance_days": number | null,
  "existing_mca_positions": number | null,
  "existing_mca_monthly_burden": number | null,
  "revenue_trend": "growing" | "stable" | "declining" | null,
  "top_mca_lenders": string[],
  "red_flags": string[],
  "qualification_signal": "strong" | "moderate" | "weak" | null,
  "statement_months_covered": string[],
  "revenue_table": Array<{
    "month": string,
    "deposits": number | null,
    "avg_daily_ledger": number | null,
    "deposit_count": number | null,
    "nsf_count": number | null
  }>
}

Rules:
- account_holder: business or individual name from the Account Summary "Account Holder" field.
- business_address / business_city / business_state / business_zip: the mailing
  address printed on the statement header, split into parts. null when not shown.
- null when the report doesn't state the value.
- Dollar values as plain numbers (no $/commas).
- red_flags: max 6 concise items from the report's Red Flags section.
- top_mca_lenders: names only, max 5.
- statement_months_covered: YYYY-MM format from the Monthly Breakdown section.
- revenue_table: one row per statement month the report covers. Use the short
  month label the report uses (e.g. "December", "Jan", "Feb", "March"). Populate
  deposits (total deposits for month), avg_daily_ledger, deposit_count, and
  nsf_count from the Monthly Breakdown. Leave individual fields null if absent.`;

export async function POST(req: NextRequest) {
  const body = (await req.json()) as RequestBody;

  // Mark the contact as "processing" as early as possible so the portal overlay
  // (Part D) can start polling while the analyzer runs. Guarded — never throws.
  if (body.contact_id) {
    await setAnalysisStatus(body.contact_id, "processing");
  }

  const fetched: Array<{ name: string; buffer: Buffer; drive_item_id?: string; source_url?: string }> = [];

  if (body.drive_item_ids && body.drive_item_ids.length > 0) {
    for (const id of body.drive_item_ids) {
      try {
        const file = await microsoft.downloadDriveItem(id);
        fetched.push({ name: file.name, buffer: file.buffer, drive_item_id: id });
      } catch (e) {
        console.error("[bank-statements] drive download failed:", id, (e as Error).message);
      }
    }
  }

  if (body.pdf_urls && body.pdf_urls.length > 0) {
    for (let i = 0; i < body.pdf_urls.length; i++) {
      const url = body.pdf_urls[i];
      try {
        const res = await fetch(url);
        if (!res.ok) {
          console.error("[bank-statements] fetch failed:", url, res.status);
          continue;
        }
        const buffer = Buffer.from(await res.arrayBuffer());
        const name = url.split("/").pop()?.split("?")[0] ?? `statement-${i + 1}.pdf`;
        fetched.push({ name, buffer, source_url: url });
      } catch (e) {
        console.error("[bank-statements] fetch error:", url, (e as Error).message);
      }
    }
  }

  if (fetched.length === 0) {
    if (body.contact_id) await setAnalysisStatus(body.contact_id, "error");
    return NextResponse.json({ error: "no PDFs to analyze (pass pdf_urls or drive_item_ids)" }, { status: 400 });
  }

  const slackChannel = body.slack_channel ?? null;
  const slackThreadTs = body.slack_thread_ts ?? null;

  // Resolve the deal — deal_id wins, otherwise look up by contact_id or merchant_name
  let dealId = body.deal_id ?? null;
  let contactId = body.contact_id ?? null;
  let zohoId: string | null = null;
  let merchantName: string | null = body.merchant_name ?? null;

  if (dealId) {
    const { data } = await supabaseAdmin
      .from("deals")
      .select("id, contact_id, zoho_lead_id, contacts:contact_id(business_name)")
      .eq("id", dealId)
      .maybeSingle();
    if (data) {
      contactId = (data.contact_id as string | null) ?? contactId;
      zohoId = (data.zoho_lead_id as string | null) ?? null;
      const c = (data as { contacts?: { business_name?: string } | null }).contacts;
      merchantName = c?.business_name ?? merchantName;
    }
  } else if (contactId) {
    const { data } = await supabaseAdmin
      .from("deals")
      .select("id, contact_id, zoho_lead_id, contacts:contact_id(business_name)")
      .eq("contact_id", contactId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      dealId = data.id as string;
      zohoId = (data.zoho_lead_id as string | null) ?? null;
      const c = (data as { contacts?: { business_name?: string } | null }).contacts;
      merchantName = c?.business_name ?? merchantName;
    }
  } else if (body.merchant_name) {
    const { data: contact } = await supabaseAdmin
      .from("contacts")
      .select("id, business_name")
      .ilike("business_name", `%${body.merchant_name}%`)
      .limit(1)
      .maybeSingle();
    if (contact) {
      contactId = contact.id as string;
      merchantName = (contact.business_name as string | null) ?? merchantName;
      const { data: deal } = await supabaseAdmin
        .from("deals")
        .select("id, zoho_lead_id")
        .eq("contact_id", contactId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (deal) {
        dealId = deal.id as string;
        zohoId = (deal.zoho_lead_id as string | null) ?? null;
      }
    }
  }

  // Run analyzer (before deal check so we can extract account_holder for deal lookup)
  let analysis;
  try {
    analysis = await analyzeBankStatements(fetched.map((f) => ({ name: f.name, buffer: f.buffer })));
  } catch (e) {
    if (contactId) await setAnalysisStatus(contactId, "error");
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  // Extract structured metrics (includes account_holder for deal lookup)
  let metrics: BankMetrics = {
    account_holder: null,
    business_address: null,
    business_city: null,
    business_state: null,
    business_zip: null,
    avg_monthly_deposits: null,
    avg_daily_balance: null,
    total_nsfs: null,
    negative_balance_days: null,
    existing_mca_positions: null,
    existing_mca_monthly_burden: null,
    revenue_trend: null,
    top_mca_lenders: [],
    red_flags: [],
    qualification_signal: null,
    statement_months_covered: [],
    revenue_table: [],
  };
  try {
    const metricsResult = await callClaudeJSON<BankMetrics>({
      model: "claude-sonnet-4-6",
      system: METRICS_SYSTEM,
      user: analysis.report,
      maxTokens: 1800,
      temperature: 0.1,
    });
    metrics = { ...metrics, ...metricsResult.data };
  } catch (e) {
    console.error("[bank-statements] metrics extraction failed:", (e as Error).message);
  }

  // If we still don't have a deal, try matching by the account holder extracted from the PDF
  let nameAdjusted = false;
  const extractedName = metrics.account_holder?.trim() ?? null;
  if (!dealId && extractedName) {
    const { data: contact } = await supabaseAdmin
      .from("contacts")
      .select("id, business_name")
      .ilike("business_name", `%${extractedName.split(" ")[0]}%`)
      .limit(1)
      .maybeSingle();
    if (contact) {
      contactId = contact.id as string;
      if ((contact.business_name as string | null)?.toLowerCase() !== extractedName.toLowerCase()) {
        nameAdjusted = true;
      }
      merchantName = extractedName; // use exact bank-statement name for subject
      const { data: deal } = await supabaseAdmin
        .from("deals")
        .select("id, zoho_lead_id")
        .eq("contact_id", contactId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (deal) {
        dealId = deal.id as string;
        zohoId = (deal.zoho_lead_id as string | null) ?? null;
      }
    }
  }

  // Use exact bank-statement name (if available) as the authoritative merchant name
  if (extractedName && merchantName !== extractedName) {
    merchantName = extractedName;
    nameAdjusted = true;
  }

  // No deal found — post a Slack ask instead of a hard error
  if (!dealId) {
    // Still backfill what we extracted onto the contact (if we resolved one) so the
    // portal can pre-fill, and clear the processing overlay.
    if (contactId) {
      await backfillContactFromMetrics(contactId, metrics);
      await setAnalysisStatus(contactId, "analyzed");
    }
    const displayName = extractedName ?? merchantName ?? "Unknown Merchant";
    if (slackChannel && slackThreadTs) {
      await slack.postThreadReply(
        slackChannel,
        slackThreadTs,
        `📄 Found bank statements for *${displayName}* but no deal exists in the pipeline.\n\nReply \`create deal\` to create one, or \`link to [deal name]\` if it's under a different name.`,
      );
      return NextResponse.json({ ok: true, status: "no_deal_found", merchant: displayName });
    }
    return NextResponse.json({ error: "could not resolve a deal", merchant: displayName }, { status: 400 });
  }

  // Build Zoho field patches (only non-null numerics — unknown fields fall into the Note)
  const zoho_fields: Record<string, unknown> = {};
  if (metrics.avg_monthly_deposits != null) {
    zoho_fields.Monthly_Revenue = Math.round(metrics.avg_monthly_deposits);
    zoho_fields.Monthly_Deposits = Math.round(metrics.avg_monthly_deposits);
  }
  if (metrics.avg_daily_balance != null) zoho_fields.Avg_Daily_Balance = Math.round(metrics.avg_daily_balance);
  if (metrics.total_nsfs != null) zoho_fields.NSF_Count_Last_3mo = metrics.total_nsfs;
  if (metrics.existing_mca_positions != null) zoho_fields.Existing_Positions = metrics.existing_mca_positions;
  if (metrics.existing_mca_monthly_burden != null) {
    zoho_fields.Existing_MCA_Monthly_Burden = Math.round(metrics.existing_mca_monthly_burden);
  }

  // Log the decision
  const { data: decision } = await supabaseAdmin
    .from("ai_decisions")
    .insert({
      merchant_id: contactId,
      trigger_type: (body.source === "onedrive" || body.source === "slack_drop") ? "webhook_zoho" : "slack_command",
      state_classified: "bank_statement_analysis",
      action_taken: "slack_alert",
      reasoning: `Analyzed ${fetched.length} bank statement${fetched.length > 1 ? "s" : ""} via Opus 4.7 vision for deal ${dealId}`,
      raw_response: {
        report_preview: analysis.report.slice(0, 500),
        metrics,
        tokens: analysis.tokens,
        source: body.source,
        drive_item_ids: fetched.map((f) => f.drive_item_id).filter(Boolean),
      },
      model_used: analysis.model,
      latency_ms: analysis.latencyMs,
    })
    .select("id")
    .single();

  // Post the report to the deal thread
  const nameNote = nameAdjusted && extractedName
    ? `\n⚠️ _Name in bank statements: *${extractedName}* — deal name adjusted to match._`
    : "";
  const reportBlocks: SlackBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `🏦 *Bank Statement Analysis* — ${merchantName ?? "Merchant"}\n_${fetched.length} statement${fetched.length > 1 ? "s" : ""} · ${analysis.model} · ${(analysis.latencyMs / 1000).toFixed(1)}s · source: ${body.source ?? "manual"}_${nameNote}`,
      },
    },
  ];
  if (body.onedrive_folder_url) {
    reportBlocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `📁 <${body.onedrive_folder_url}|OneDrive folder>` }],
    });
  }
  for (const chunk of chunkText(analysis.report, 2800).slice(0, 40)) {
    reportBlocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "```\n" + chunk + "\n```" },
    });
  }

  await postDealThreadUpdate({
    dealId,
    action: "note",
    text: `🏦 Bank statement analysis ready — ${fetched.length} statement${fetched.length > 1 ? "s" : ""}`,
    blocks: reportBlocks,
  });

  // Re-read the deal to pick up thread_ts / channel that postDealThreadUpdate just set
  const { data: dealAfter } = await supabaseAdmin
    .from("deals")
    .select("slack_thread_ts, slack_channel")
    .eq("id", dealId)
    .single();

  // Build approval card
  const qualIcon = metrics.qualification_signal === "strong" ? "✅"
    : metrics.qualification_signal === "moderate" ? "⚠️"
    : metrics.qualification_signal === "weak" ? "❌"
    : "❓";

  const fieldRows = Object.entries(zoho_fields)
    .map(([k, v]) => `• *${k}:* \`${String(v)}\``)
    .join("\n");
  const redFlagLines = metrics.red_flags.length > 0
    ? metrics.red_flags.slice(0, 6).map((f) => `• ${f}`).join("\n")
    : "_None flagged_";
  const monthsStr = metrics.statement_months_covered.length > 0
    ? metrics.statement_months_covered.join(", ")
    : "unspecified";
  const topLendersStr = metrics.top_mca_lenders.length > 0
    ? metrics.top_mca_lenders.slice(0, 5).join(", ")
    : "none detected";

  const approvalBlocks: SlackBlock[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: `${qualIcon} *Proposed Zoho updates*` },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Months covered:* ${monthsStr}\n*Qualification:* ${metrics.qualification_signal ?? "unknown"}\n*Revenue trend:* ${metrics.revenue_trend ?? "unknown"}\n*Existing MCA lenders:* ${topLendersStr}`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: Object.keys(zoho_fields).length > 0
          ? `*Zoho fields to patch:*\n${fieldRows}`
          : "_No field patches proposed (metrics couldn't be extracted). Full report will save to Zoho as a Note only._",
      },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Red flags:*\n${redFlagLines}` },
    },
    {
      type: "actions",
      elements: [
        { type: "button", text: { type: "plain_text", text: ":thumbsup: Approve", emoji: true }, style: "primary", action_id: "ai_approve", value: "pending" },
        { type: "button", text: { type: "plain_text", text: ":pencil2: Edit", emoji: true }, action_id: "ai_edit", value: "pending" },
        { type: "button", text: { type: "plain_text", text: ":no_entry: Cancel", emoji: true }, style: "danger", action_id: "ai_cancel", value: "pending" },
      ],
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: `📄 Full report above • 👍 writes fields + Note to Zoho Lead \`${zohoId ?? "(none)"}\`` }],
    },
  ];

  const payload: PendingActionPayload = {
    action_type: "update_zoho",
    zoho_id: zohoId ?? undefined,
    zoho_fields,
    note: {
      title: `Bank Statement Analysis${merchantName ? ` — ${merchantName}` : ""}`,
      content: analysis.report,
    },
    deal_id: dealId,
    contact_id: contactId ?? undefined,
    requires_matthew: false,
    // After 👍 updates Zoho, execute-action will chain a submission-email
    // draft card into the same thread using the extracted revenue_table.
    followup: "draft_submission",
    onedrive_folder_url: body.onedrive_folder_url,
    bank_stmt_drive_item_ids: fetched.map((f) => f.drive_item_id).filter(Boolean) as string[],
    revenue_table: metrics.revenue_table,
  };

  let approvalTs: string | null = null;
  if (!zohoId) {
    console.warn("[bank-statements] deal has no zoho_lead_id — approval card will still post but 👍 will fail until Zoho ID is set", { dealId });
  }
  if (dealAfter?.slack_thread_ts && dealAfter?.slack_channel) {
    const res = await postApprovalRequest({
      summary: "Review bank-statement-derived Zoho field patches.",
      payload,
      merchantId: contactId ?? undefined,
      zohoId: zohoId ?? undefined,
      aiDecisionId: decision?.id as string | undefined,
      channel: dealAfter.slack_channel as string,
      threadTs: dealAfter.slack_thread_ts as string,
      blocks: approvalBlocks,
    });
    approvalTs = res.slackTs;
  } else {
    console.warn("[bank-statements] no deal thread yet — skipping approval card", { dealId });
  }

  // ── Supabase contacts backfill + digestion pipeline ──
  // Backfill extracted business data onto the contact so the portal can pre-fill the
  // application (and skip re-asking), then mark the analysis complete so the portal
  // processing overlay clears.
  let completeness: CompletenessSummary | null = null;
  if (contactId) {
    await backfillContactFromMetrics(contactId, metrics);
    completeness = await postCompletenessCheck({
      contactId,
      dealId,
      businessName: merchantName,
      monthsCovered: metrics.statement_months_covered,
      statementsAnalyzed: fetched.length,
    });
    await setAnalysisStatus(contactId, "analyzed");
    // If the application is already complete, post the pick-lenders card now.
    // (Gated + idempotent inside the helper; no-op until the app is done.)
    await maybePostSubmissionReady(contactId).catch((e) =>
      console.warn("[bank-statements] maybePostSubmissionReady failed:", (e as Error).message)
    );
  }

  return NextResponse.json({
    ok: true,
    deal_id: dealId,
    zoho_id: zohoId,
    decision_id: decision?.id ?? null,
    statements_analyzed: fetched.length,
    tokens: analysis.tokens,
    latency_ms: analysis.latencyMs,
    metrics,
    proposed_zoho_fields: zoho_fields,
    slack_thread_ts: dealAfter?.slack_thread_ts ?? null,
    approval_ts: approvalTs,
    completeness,
  });
}

// ── Supabase contacts backfill + digestion helpers ──

type AnalysisStatus = "processing" | "analyzed" | "error";

async function setAnalysisStatus(contactId: string, status: AnalysisStatus): Promise<void> {
  try {
    await supabaseAdmin
      .from("contacts")
      .update({ bank_statement_analysis_status: status })
      .eq("id", contactId);
  } catch (e) {
    console.warn("[bank-statements] setAnalysisStatus failed:", (e as Error).message);
  }
}

/**
 * Backfill extracted business data onto contacts WITHOUT clobbering good data:
 * business_name + address parts only fill when currently blank; monthly_revenue /
 * monthly_deposits + statement_months_covered always refresh from the latest analysis
 * (these are derived numbers, not user-entered, so newer wins).
 */
async function backfillContactFromMetrics(contactId: string, metrics: BankMetrics): Promise<void> {
  try {
    const { data: existing } = await supabaseAdmin
      .from("contacts")
      .select("business_name, biz_address, biz_city, biz_state, biz_zip")
      .eq("id", contactId)
      .maybeSingle();

    const update: Record<string, unknown> = {};

    const extractedName = metrics.account_holder?.trim();
    if (extractedName && !existing?.business_name) update.business_name = extractedName;

    if (metrics.business_address && !existing?.biz_address) update.biz_address = metrics.business_address;
    if (metrics.business_city && !existing?.biz_city) update.biz_city = metrics.business_city;
    if (metrics.business_state && !existing?.biz_state) update.biz_state = metrics.business_state;
    if (metrics.business_zip && !existing?.biz_zip) update.biz_zip = metrics.business_zip;

    if (metrics.avg_monthly_deposits != null) {
      update.monthly_revenue = Math.round(metrics.avg_monthly_deposits);
      update.monthly_deposits = Math.round(metrics.avg_monthly_deposits);
    }
    if (metrics.statement_months_covered.length > 0) {
      update.statement_months_covered = metrics.statement_months_covered;
    }

    if (Object.keys(update).length > 0) {
      await supabaseAdmin.from("contacts").update(update).eq("id", contactId);
    }
  } catch (e) {
    console.warn("[bank-statements] backfillContactFromMetrics failed:", (e as Error).message);
  }
}

interface CompletenessSummary {
  ready: boolean;
  statementsAnalyzed: number;
  monthsCovered: number;
  bankStmtsOnFile: number;
  missing: string[];
}

/**
 * Post a Vektor completeness check to #srt-sub summarizing what's present vs missing
 * for shopping the deal. Reuses the ≥3-statements gate (REQUIRED_BANK_STMTS) by
 * counting PDFs in the deal's OneDrive Bank Statements folder.
 *
 * TODO(digestion): this currently posts the completeness summary only. When ready,
 * hook the full package builder here — call buildSubmissionPackage() from
 * src/lib/ai-intel/deal-submission-builder.ts (it builds the revenue table, drafts the
 * funder email, generates the Application PDF, uploads to Deals/{business}/Completed
 * Package, inserts deal_submissions, and posts the approval card to #srt-sub). It is
 * gated behind lender selection (lenderIds), which is chosen by a human reply in the
 * #srt-sub thread today — so wiring it unconditionally here would auto-submit without
 * funder selection. Left as a deliberate stub pending that lender-selection decision.
 */
async function postCompletenessCheck(args: {
  contactId: string;
  dealId: string;
  businessName: string | null;
  monthsCovered: string[];
  statementsAnalyzed: number;
}): Promise<CompletenessSummary> {
  const business = args.businessName ?? "Merchant";

  // ≥3-statements gate — count PDFs in Deals/{business}/Bank Statements (same as
  // pre-approved-handler). Best-effort; falls back to the analyzed count.
  let bankStmtsOnFile = args.statementsAnalyzed;
  try {
    const children = await microsoft.listFolderChildren(`Deals/${business}/Bank Statements`);
    const pdfCount = children.filter((c) => c.isFile && /\.pdf$/i.test(c.name)).length;
    if (pdfCount > 0) bankStmtsOnFile = pdfCount;
  } catch (e) {
    console.warn("[bank-statements] bank-stmt count failed:", (e as Error).message);
  }

  // Pull application fields from the contact to report what's still missing.
  const { data: contact } = await supabaseAdmin
    .from("contacts")
    .select("business_name, biz_address, use_of_funds, amount_needed, signature")
    .eq("id", args.contactId)
    .maybeSingle();

  const missing: string[] = [];
  if (bankStmtsOnFile < REQUIRED_BANK_STMTS) missing.push(`${REQUIRED_BANK_STMTS - bankStmtsOnFile} more bank statement(s)`);
  // MTD is pulled separately from Plaid (see TODO below) — flag when absent.
  // NOTE(MTD): current-month-to-date deposits require Plaid /transactions data, which
  // this analyzer route does not receive (it only gets statement PDFs / drive items).
  // The Plaid path (exchangePlaidPublicToken in srt-portal) is the integration point
  // that can feed MTD in. Until that path calls this route with MTD, we flag it as a
  // gap rather than fabricate a number.
  missing.push("MTD deposits (pull via Plaid)");
  if (!contact?.use_of_funds) missing.push("use of funds");
  if (!contact?.amount_needed) missing.push("requested amount");
  if (!contact?.signature) missing.push("application signature");

  const ready = missing.length === 0;
  const summary: CompletenessSummary = {
    ready,
    statementsAnalyzed: args.statementsAnalyzed,
    monthsCovered: args.monthsCovered.length,
    bankStmtsOnFile,
    missing,
  };

  const channel = SUB_CHANNEL();
  if (channel) {
    const monthsStr = args.monthsCovered.length > 0 ? args.monthsCovered.join(", ") : "unspecified";
    const text = ready
      ? `✅ *${business}* — ${bankStmtsOnFile} months + MTD + application fields → ready to shop.\nMonths: ${monthsStr}`
      : `🟡 *${business}* — statements analyzed (${args.statementsAnalyzed}; months: ${monthsStr}).\nMissing before we can shop: ${missing.join(", ")}.`;
    try {
      await slack.postMessage(channel, text);
    } catch (e) {
      console.warn("[bank-statements] completeness post failed:", (e as Error).message);
    }
  }

  return summary;
}

function chunkText(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const chunks: string[] = [];
  let pos = 0;
  while (pos < text.length) {
    let end = Math.min(pos + max, text.length);
    if (end < text.length) {
      const nl = text.lastIndexOf("\n", end);
      if (nl > pos + max * 0.7) end = nl;
    }
    chunks.push(text.slice(pos, end));
    pos = end;
  }
  return chunks;
}
