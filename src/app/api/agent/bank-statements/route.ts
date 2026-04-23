import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { analyzeBankStatements } from "@/lib/ai-intel/bank-statement-analyzer";
import { callClaudeJSON } from "@/lib/claude-calls";
import { postDealThreadUpdate } from "@/lib/ai-intel/deal-thread";
import { postApprovalRequest } from "@/lib/ai-intel/slack-approval";
import { microsoft } from "@/lib/microsoft";
import type { PendingActionPayload } from "@/lib/ai-intel/types";
import type { SlackBlock } from "@/lib/slack-bot";

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
}

interface BankMetrics {
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
}

const METRICS_SYSTEM = `You extract structured underwriting metrics from a bank-statement analysis report.

Output JSON only, matching this shape:
{
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
  "statement_months_covered": string[]
}

Rules:
- null when the report doesn't state the value.
- Dollar values as plain numbers (no $/commas).
- red_flags: max 6 concise items from the report's Red Flags section.
- top_mca_lenders: names only, max 5.
- statement_months_covered: YYYY-MM format from the Monthly Breakdown section.`;

export async function POST(req: NextRequest) {
  const body = (await req.json()) as RequestBody;

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
    return NextResponse.json({ error: "no PDFs to analyze (pass pdf_urls or drive_item_ids)" }, { status: 400 });
  }

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

  if (!dealId) {
    return NextResponse.json({ error: "could not resolve a deal — pass deal_id or contact_id or merchant_name" }, { status: 400 });
  }

  // Run analyzer
  let analysis;
  try {
    analysis = await analyzeBankStatements(fetched.map((f) => ({ name: f.name, buffer: f.buffer })));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  // Extract structured metrics
  let metrics: BankMetrics = {
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
  };
  try {
    const metricsResult = await callClaudeJSON<BankMetrics>({
      model: "claude-sonnet-4-6",
      system: METRICS_SYSTEM,
      user: analysis.report,
      maxTokens: 1200,
      temperature: 0.1,
    });
    metrics = { ...metrics, ...metricsResult.data };
  } catch (e) {
    console.error("[bank-statements] metrics extraction failed:", (e as Error).message);
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
  const reportBlocks: SlackBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `🏦 *Bank Statement Analysis* — ${merchantName ?? "Merchant"}\n_${fetched.length} statement${fetched.length > 1 ? "s" : ""} · ${analysis.model} · ${(analysis.latencyMs / 1000).toFixed(1)}s · source: ${body.source ?? "manual"}_`,
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
    requires_matthew: false,
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
  });
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
