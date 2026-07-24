// Finalizes an audit run: recomputes the score from whatever audit_runs exist,
// marks the report done, posts the Slack summary, and prepares outreach. Split
// out of api/audit/process/route.ts so the watchdog cron can also finalize a
// run whose final self-chain hop dropped (the common stall).
//
// Public free-audit leads (requester_email set) get an OUTLOOK DRAFT (the
// founder reviews and hits send — never auto-sent) plus a #hot-leads ping.
// Internal /audit runs get the PDF + a copy/paste draft in the report thread.

import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import { buildAliases } from "@/lib/audit-engine/mention-match";
import { formatFinalMessage, formatFailureMessage } from "@/lib/audit-engine/slack-format";
import type { AuditReportRow, AuditRunRow } from "@/lib/audit-engine/types";
import { buildReportView, computeWeightedScore, type ReportView, type WeightedScore } from "@/lib/audit-engine/report-view";
import { generateScorecardPDF } from "@/lib/audit-engine/pdf-scorecard";
import { draftInitialEmail, draftEmailOptions } from "@/lib/audit-engine/email-assistant";
import { postOptions } from "@/lib/audit-engine/thread-assistant";
import { microsoft } from "@/lib/microsoft";

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function failReport(row: AuditReportRow, message: string): Promise<void> {
  await supabaseAdmin
    .from("audit_reports")
    .update({ status: "failed", error: message, updated_at: new Date().toISOString() })
    .eq("id", row.id);

  if (row.slack_channel_id && row.slack_thread_ts) {
    await slack
      .postThreadReply(
        row.slack_channel_id,
        row.slack_thread_ts,
        formatFailureMessage({ ...row, status: "failed", error: message })
      )
      .catch(() => {});
  }
}

export async function finishReport(row: AuditReportRow): Promise<void> {
  const { data: runsData } = await supabaseAdmin.from("audit_runs").select("*").eq("report_id", row.id);
  const runs = (runsData ?? []) as AuditRunRow[];

  const aliases = buildAliases(row.client_name ?? row.business_type ?? row.website, row.website);
  const view = buildReportView(row, runs, aliases);
  const weighted = computeWeightedScore(view);

  const { data: updated } = await supabaseAdmin
    .from("audit_reports")
    .update({ status: "done", score: weighted.score, updated_at: new Date().toISOString() })
    .eq("id", row.id)
    .select("*")
    .single();

  const finalRow = (updated as AuditReportRow | null) ?? { ...row, status: "done" as const, score: weighted.score };
  if (finalRow.slack_channel_id && finalRow.slack_thread_ts) {
    await slack
      .postThreadReply(finalRow.slack_channel_id, finalRow.slack_thread_ts, formatFinalMessage(finalRow, view))
      .catch(() => {});
  }
  await postScorecardAndOutreach(finalRow, view, weighted);
}

// Best-effort: scorecard PDF + outreach. Never throws into finishReport — a
// failure here just means Matthew regenerates manually. Split into two
// independent try/catch blocks so a Slack failure can't skip the Outlook draft,
// and vice versa.
async function postScorecardAndOutreach(report: AuditReportRow, view: ReportView, weighted: WeightedScore): Promise<void> {
  let pdfBuffer: Buffer | null = null;

  // Internal /audit runs (have a Slack thread): PDF + copy/paste draft in-thread.
  if (report.slack_channel_id && report.slack_thread_ts) {
    try {
      pdfBuffer = generateScorecardPDF(report, view, weighted);
      const fileName = `AI Visibility Scorecard - ${report.business_type ?? report.website}.pdf`;
      await slack.uploadFilePDF(report.slack_channel_id, fileName, pdfBuffer, report.slack_thread_ts);

      const options = await draftEmailOptions(report, view, { kind: "initial" });
      await postOptions(
        report,
        report.slack_channel_id,
        report.slack_thread_ts,
        "✉️ Draft outreach, 3 angles to choose from (show the loss / verification first / competitor urgency):",
        options
      );
    } catch (e) {
      console.error("[finishReport] scorecard/thread post failed:", (e as Error).message);
    }
  }

  // Public free-audit leads: create an Outlook DRAFT (founder hits send) + ping #hot-leads.
  if (report.requester_email) {
    try {
      if (!pdfBuffer) pdfBuffer = generateScorecardPDF(report, view, weighted);
      const reportUrl = `${appUrl()}/r/${report.slug}`;
      const name = report.client_name || report.business_type || report.website;
      const { subject, body } = await draftInitialEmail(report, view);
      const htmlBody = `<div style="white-space:pre-wrap;font-family:'Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.5">${escapeHtml(body)}</div>`;

      const draft = await microsoft.createDraft({
        to: report.requester_email,
        subject,
        body: htmlBody,
        attachments: [
          {
            name: `AI Visibility Scorecard - ${name}.pdf`,
            contentType: "application/pdf",
            contentBytes: pdfBuffer.toString("base64"),
          },
        ],
      });

      const hot = process.env.SLACK_HOT_LEADS_CHANNEL || "";
      if (hot) {
        const who = report.requester_name ? `${report.requester_name} · ` : "";
        await slack
          .postMessage(
            hot,
            `:large_green_circle: *AI audit ready — Outlook draft prepared* — *${name}* scored ${report.score ?? weighted.score}/100\n` +
              `Lead: ${who}${report.requester_email}\n` +
              `<${draft.webLink}|✉️ Open draft in Outlook> · <${reportUrl}|📊 View report>`
          )
          .catch(() => {});
      }
    } catch (e) {
      console.error("[finishReport] outlook draft / hot-leads failed:", (e as Error).message);
    }
  }
}
