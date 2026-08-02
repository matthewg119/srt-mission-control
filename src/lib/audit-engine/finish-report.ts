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
import { slack, SlackBlock } from "@/lib/slack-bot";
import { buildAliases } from "@/lib/audit-engine/mention-match";
import { formatFinalMessage, formatFailureMessage } from "@/lib/audit-engine/slack-format";
import type { AuditReportRow, AuditRunRow } from "@/lib/audit-engine/types";
import { buildReportView, computeWeightedScore, type ReportView, type WeightedScore } from "@/lib/audit-engine/report-view";
import { generateScorecardPDF } from "@/lib/audit-engine/pdf-scorecard";
import { draftInitialEmail } from "@/lib/audit-engine/email-assistant";
import { buildIntakeQuestions, postIntakeCard } from "@/lib/audit-engine/outreach-intake";
import { companiesConflict } from "@/lib/company-identity";
import { microsoft } from "@/lib/microsoft";
import { waitUntil } from "@vercel/functions";
import {
  AUTOSEND_MINUTES,
  auditSignatureHtml,
  autoSendEnabled,
  buildPitchBlocks,
  buildPitchHtml,
  sendAuditPitch,
} from "@/lib/audit-engine/lead-pitch";

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";
}

/** The company this report is about, resolved the same way everywhere it is displayed. */
function displayName(report: AuditReportRow): string {
  return report.client_name || report.business_type || report.website;
}

/**
 * One scorecard filename for both the Slack upload and the Outlook attachment.
 *
 * These used to be built by two different expressions, so the Slack file was named after the
 * CATEGORY ("AI Visibility Scorecard - electrical control panel design...") while the emailed
 * one was named after the COMPANY. Reading the two side by side looked exactly like a
 * scorecard for the wrong business, which cost a real investigation.
 */
function scorecardFileName(report: AuditReportRow): string {
  return `AI Visibility Scorecard - ${displayName(report)}.pdf`;
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

  // Every run with a Slack thread gets the PDF in #ai-visibility-audits.
  if (report.slack_channel_id && report.slack_thread_ts) {
    try {
      pdfBuffer = generateScorecardPDF(report, view, weighted);
      await slack.uploadFilePDF(report.slack_channel_id, scorecardFileName(report), pdfBuffer, report.slack_thread_ts);

      // Intake card, NOT finished drafts. A cold prospect's email 1 depends on things only
      // Matthew knows (who the recipient is, what to mention, whether a free redesign was
      // built), so the bot asks first and writes one draft from the answers. See
      // outreach-intake.ts, and the pre-pitch doctrine at the top of email-assistant.ts.
      //
      // Skipped for the /PDF guide funnel: that lead filled out a form and asked for the
      // guide, so there is no permission to earn and draftInitialEmail already writes the
      // email. An intake card there would ask Matthew to author cold outreach to someone
      // who is already expecting a reply.
      if (!isGuideLead(report)) {
        const questions = await buildIntakeQuestions(report, view);
        await postIntakeCard(report, report.slack_channel_id, report.slack_thread_ts, questions);
      }
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
    const name = displayName(report);
    const reportUrl = `${appUrl()}/r/${report.slug}`;
    let draftLink: string | null = null;
    let draftSubject: string | null = null;
    let draftBody: string | null = null;
    let autoSendAt: Date | null = null;

    try {
      // Everything below (recipient, PDF, filename, subject, body) must descend from ONE
      // report row. It does today, and this assert is the net for whoever later adds a second
      // query to this block: an email addressed to one company carrying another company's
      // scorecard is the worst output this system could produce.
      if (view.reportId !== report.id) {
        throw new Error(
          `report/view mismatch: view was built for ${view.reportId} but the draft is for ${report.id}. Refusing to create a draft.`
        );
      }

      if (!pdfBuffer) pdfBuffer = generateScorecardPDF(report, view, weighted);
      const { subject, body } = await draftInitialEmail(report, view);
      // The signature comes from Outlook by name so it can be edited there
      // without a deploy. A pitch that goes out unsigned reads as a robot.
      // buildPitchHtml escapes the body, so the guide CTA has to ride in ahead of
      // the signature rather than be concatenated onto the body text.
      const htmlBody = buildPitchHtml(body, guideCtaHtml(report) + (await auditSignatureHtml()));
      draftSubject = subject;
      draftBody = body;

      const draft = await microsoft.createDraft({
        to: report.requester_email,
        subject,
        body: htmlBody,
        attachments: [
          {
            name: scorecardFileName(report),
            contentType: "application/pdf",
            contentBytes: pdfBuffer.toString("base64"),
          },
        ],
      });
      draftLink = draft.webLink ?? null;

      // The draft id is what the Send button and the auto-send backstop act on:
      // sending the stored draft means what goes out is exactly what was
      // reviewed, including any edit made in Outlook first.
      if (autoSendEnabled()) autoSendAt = new Date(Date.now() + AUTOSEND_MINUTES * 60_000);
      await supabaseAdmin
        .from("audit_reports")
        .update({
          draft_message_id: draft.id,
          auto_send_state: "pending",
          auto_send_at: autoSendAt ? autoSendAt.toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", report.id);
    } catch (e) {
      console.error("[finishReport] outlook draft failed:", (e as Error).message);
    }

    try {
      const blocks = buildPitchBlocks({
        report,
        score: report.score ?? weighted.score,
        companyName: name,
        reportUrl,
        draftLink,
        subject: draftSubject,
        bodyPreview: draftBody,
        autoSendAt,
      });
      const fallback = `AI audit ready — ${name} scored ${report.score ?? weighted.score}/100, lead ${report.requester_email}`;
      await postLeadNotification(report, fallback, blocks);
    } catch (e) {
      console.error("[finishReport] hot-leads post failed:", (e as Error).message);
    }

    // Fast path for auto-send: hold this invocation open rather than waiting for
    // a cron, because Vercel Hobby crons only run daily. The row is still the
    // source of truth, so a cold start here costs latency, not the send.
    if (autoSendAt && draftLink) {
      const delay = Math.max(0, autoSendAt.getTime() - Date.now());
      waitUntil(
        new Promise<void>((resolve) => setTimeout(resolve, delay)).then(async () => {
          const res = await sendAuditPitch(report.id, "auto-send timer");
          if (res.outcome === "sent") {
            await postLeadNotification(report, `🚀 Auto-sent the pitch to ${report.requester_email}.`).catch(() => {});
          }
        })
      );
    }
  }
}

/** srtagency.com/PDF, the med spa free-guide funnel. */
function isGuideLead(report: AuditReportRow): boolean {
  return report.lead_source === "pdf";
}

/**
 * The guide the /PDF funnel promised, delivered with the report rather than as a
 * separate email: the page tells them it is built around their actual website, and
 * the report is the part that actually is. No URL configured means no CTA at all,
 * because a dead link in a fulfillment email is worse than a missing one.
 */
function guideCtaHtml(report: AuditReportRow): string {
  const url = process.env.MEDSPA_GUIDE_URL || "";
  if (!isGuideLead(report) || !url) return "";
  const safe = url.replace(/"/g, "&quot;");
  return (
    `<div style="margin:24px 0;padding:20px;background:#F7FAFC;border-left:4px solid #00C9A7;` +
    `font-family:'Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.5">` +
    `<p style="margin:0 0 12px">Here is the guide you asked for, alongside the report above.</p>` +
    `<a href="${safe}" style="display:inline-block;padding:12px 24px;background:#1B65A7;color:#ffffff;` +
    `text-decoration:none;border-radius:8px;font-weight:600">Download the guide</a>` +
    `<p style="margin:12px 0 0;font-size:12px;color:#4A5568">Or paste this into your browser: ${safe}</p>` +
    `</div>`
  );
}

/** Reply inside the lead's existing #hot-leads thread when we know it, so the
 *  audit result sits under the lead that triggered it. Falls back to a
 *  top-level post (Slack-triggered /audit runs have no contact). */
async function postLeadNotification(
  report: AuditReportRow,
  text: string,
  blocks?: SlackBlock[]
): Promise<void> {
  const fallbackChannel = process.env.SLACK_HOT_LEADS_CHANNEL || "";

  // Guide leads split the two jobs across two channels on purpose: #hot-leads keeps the
  // lead and their funnel answers, and everything to do with drafting and sending the
  // report lives in #ai-visibility-audits, under the thread this run already opened.
  if (isGuideLead(report) && report.slack_channel_id && report.slack_thread_ts) {
    await slack.postThreadReply(report.slack_channel_id, report.slack_thread_ts, text, blocks);
    return;
  }

  if (report.contact_id) {
    const { data: contact } = await supabaseAdmin
      .from("contacts")
      .select("slack_thread_ts, slack_channel, website, business_name")
      .eq("id", report.contact_id)
      .maybeSingle();

    // Never post one company's audit into another company's thread. Contacts are matched on
    // email or phone, so a shared front-desk line or one person handling two businesses can
    // still land a report on a contact that describes someone else. lead-intake now refuses to
    // reuse a conflicting contact, but rows linked before that fix are still out there.
    const conflict =
      contact &&
      companiesConflict(
        { website: contact.website, businessName: contact.business_name },
        { website: report.website, businessName: report.client_name }
      );

    if (contact?.slack_thread_ts && !conflict) {
      await slack.postThreadReply(
        contact.slack_channel || fallbackChannel,
        contact.slack_thread_ts,
        text,
        blocks
      );
      return;
    }

    if (conflict && fallbackChannel) {
      await slack.postMessage(
        fallbackChannel,
        `${text}\n\n:warning: Posted here instead of the lead's thread: that contact is recorded as ` +
          `*${contact?.business_name || contact?.website || "another business"}*, not *${displayName(report)}*. ` +
          `Worth checking whether two businesses got merged onto one contact.`
      );
      return;
    }
  }

  if (fallbackChannel) await slack.postMessage(fallbackChannel, text, blocks);
}
