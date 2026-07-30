// Finalizes an audit run: recomputes the score from whatever audit_runs exist,
// marks the report done, posts the Slack summary, and prepares outreach. Split
// out of api/audit/process/route.ts so the watchdog cron can also finalize a
// run whose final self-chain hop dropped (the common stall).
//
// The two lanes end differently on purpose:
//
// Public free-audit leads (requester_email set) ASKED for the report, so sending
// it is the fulfillment: they get an OUTLOOK DRAFT (the founder reviews and hits
// send — never auto-sent) plus a #hot-leads ping.
//
// Internal /audit runs are COLD, so nothing is written yet. They get the PDF plus
// an intake card in the thread, and email 1 is drafted from Matthew's answers
// under the pre-pitch doctrine (see email-assistant.ts / outreach-intake.ts).

import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import { buildAliases } from "@/lib/audit-engine/mention-match";
import { formatFinalMessage, formatFailureMessage } from "@/lib/audit-engine/slack-format";
import type { AuditReportRow, AuditRunRow } from "@/lib/audit-engine/types";
import { buildReportView, computeWeightedScore, type ReportView, type WeightedScore } from "@/lib/audit-engine/report-view";
import { generateScorecardPDF } from "@/lib/audit-engine/pdf-scorecard";
import { draftInitialEmail } from "@/lib/audit-engine/email-assistant";
import { buildIntakeQuestions, postIntakeCard } from "@/lib/audit-engine/outreach-intake";
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

      // Intake card, NOT finished drafts. A cold prospect's email 1 depends on things only
      // Matthew knows (who the recipient is, what to mention, whether a free redesign was
      // built), so the bot asks first and writes one draft from the answers. See
      // outreach-intake.ts, and the pre-pitch doctrine at the top of email-assistant.ts.
      const questions = await buildIntakeQuestions(report, view);
      await postIntakeCard(report, report.slack_channel_id, report.slack_thread_ts, questions);
    } catch (e) {
      console.error("[finishReport] scorecard/thread post failed:", (e as Error).message);
    }
  }

  // Public free-audit leads: create an Outlook DRAFT (founder hits send) + ping
  // #hot-leads. The draft and the ping are in SEPARATE try blocks on purpose —
  // a lapsed Microsoft token used to throw before the ping was sent, so a
  // finished audit produced no notification at all instead of a notification
  // without a draft link.
  if (report.requester_email) {
    const name = report.client_name || report.business_type || report.website;
    const reportUrl = `${appUrl()}/r/${report.slug}`;
    let draftLink: string | null = null;

    try {
      if (!pdfBuffer) pdfBuffer = generateScorecardPDF(report, view, weighted);
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
      draftLink = draft.webLink ?? null;
    } catch (e) {
      console.error("[finishReport] outlook draft failed:", (e as Error).message);
    }

    try {
      const headline = draftLink
        ? ":large_green_circle: *AI audit ready — Outlook draft prepared*"
        : ":large_green_circle: *AI audit ready* (Outlook draft failed, reconnect Microsoft 365)";
      const who = report.requester_name ? `${report.requester_name} · ` : "";
      const links = [
        draftLink ? `<${draftLink}|✉️ Open draft in Outlook>` : null,
        `<${reportUrl}|📊 View report>`,
      ]
        .filter(Boolean)
        .join(" · ");
      const text =
        `${headline} — *${name}* scored ${report.score ?? weighted.score}/100\n` +
        `Lead: ${who}${report.requester_email}\n` +
        links;

      await postLeadNotification(report, text);
    } catch (e) {
      console.error("[finishReport] hot-leads post failed:", (e as Error).message);
    }
  }
}

/** Reply inside the lead's existing #hot-leads thread when we know it, so the
 *  audit result sits under the lead that triggered it. Falls back to a
 *  top-level post (Slack-triggered /audit runs have no contact). */
async function postLeadNotification(report: AuditReportRow, text: string): Promise<void> {
  const fallbackChannel = process.env.SLACK_HOT_LEADS_CHANNEL || "";

  if (report.contact_id) {
    const { data: contact } = await supabaseAdmin
      .from("contacts")
      .select("slack_thread_ts, slack_channel")
      .eq("id", report.contact_id)
      .maybeSingle();

    if (contact?.slack_thread_ts) {
      await slack.postThreadReply(
        contact.slack_channel || fallbackChannel,
        contact.slack_thread_ts,
        text
      );
      return;
    }
  }

  if (fallbackChannel) await slack.postMessage(fallbackChannel, text);
}
