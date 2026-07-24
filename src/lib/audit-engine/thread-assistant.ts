// Routes Slack thread replies inside an audit-report thread to the email
// assistant. Called from src/app/api/slack/events/route.ts, gated there by
// channel === AUDIT_CHANNEL_ID before this even runs — so it only ever does a
// DB lookup for genuine audit-channel thread replies, never on every message
// in the workspace. Returns false fast for a thread that isn't (yet) an audit
// report thread, so it never interferes with the many other thread lanes
// already wired in events.ts.
//
// Flow: "email N" or a pasted prospect reply drafts 3 choose-from options and
// stores them on the report row. Replying "1", "2", or "3" turns the chosen
// option into an Outlook DRAFT (Microsoft Graph) that Matthew opens and sends.

import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import { microsoft } from "@/lib/microsoft";
import { buildReportView } from "./report-view";
import { buildAliases } from "./mention-match";
import { draftEmailOptions, BELIEF_SEQUENCE, type EmailOption } from "./email-assistant";
import type { AuditReportRow, AuditRunRow } from "./types";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Persist the 3 options on the report row and post them to the thread as a numbered card. */
export async function postOptions(
  report: AuditReportRow,
  channel: string,
  threadTs: string,
  header: string,
  options: EmailOption[]
): Promise<void> {
  await supabaseAdmin.from("audit_reports").update({ pending_drafts: options }).eq("id", report.id);
  const body = options
    .map((o, i) => `*${i + 1}. ${o.label}*\nSubject: ${o.subject}\n\n${o.body}`)
    .join("\n\n· · ·\n\n");
  await slack.postThreadReply(
    channel,
    threadTs,
    `${header}\n\n_Reply *1*, *2*, or *3* in this thread and I'll create the Outlook draft for you to send._\n\n${body}`
  );
}

/** Turn the chosen stored option into an Outlook draft and confirm with the open-in-Outlook link. */
async function createOutlookDraftFromPick(report: AuditReportRow, channel: string, threadTs: string, pick: number): Promise<void> {
  const drafts = report.pending_drafts ?? [];
  const chosen = drafts[pick - 1];
  if (!chosen) {
    await slack.postThreadReply(
      channel,
      threadTs,
      `I don't have option ${pick} queued in this thread. Reply "email 2" (through email ${BELIEF_SEQUENCE.length}) or paste the prospect's reply, and I'll draft 3 options first.`
    );
    return;
  }
  try {
    const htmlBody = `<div style="white-space:pre-wrap;font-family:'Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.5">${escapeHtml(chosen.body)}</div>`;
    const draft = await microsoft.createDraft({
      to: report.requester_email ?? undefined,
      subject: chosen.subject,
      body: htmlBody,
    });
    const noRecipient = report.requester_email ? "" : "\nNo recipient on file, so add the To address in Outlook before sending.";
    await slack.postThreadReply(
      channel,
      threadTs,
      `:envelope_with_arrow: Outlook draft created for option ${pick} (${chosen.label}). <${draft.webLink}|Open in Outlook>${noRecipient}`
    );
  } catch (e) {
    await slack.postThreadReply(channel, threadTs, `:warning: Couldn't create the Outlook draft: ${(e as Error).message}`).catch(() => {});
  }
}

export async function handleAuditThreadReply(args: { channel: string; threadTs: string; text: string }): Promise<boolean> {
  const { data: reportData } = await supabaseAdmin
    .from("audit_reports")
    .select("*")
    .eq("slack_thread_ts", args.threadTs)
    .maybeSingle();

  if (!reportData) return false; // not an audit thread — let other handlers run
  const report = reportData as AuditReportRow;

  if (report.status !== "done") {
    await slack.postThreadReply(args.channel, args.threadTs, "⏳ This audit hasn't finished running yet — I'll have the scorecard and email options once it's done.");
    return true;
  }

  const text = args.text.trim();

  // "1" / "2" / "3" → create the Outlook draft from the last posted options.
  const pickMatch = text.match(/^([123])$/);
  if (pickMatch) {
    await createOutlookDraftFromPick(report, args.channel, args.threadTs, parseInt(pickMatch[1], 10));
    return true;
  }

  const { data: runsData } = await supabaseAdmin.from("audit_runs").select("*").eq("report_id", report.id);
  const runs = (runsData ?? []) as AuditRunRow[];
  const aliases = buildAliases(report.client_name ?? report.business_type ?? report.website, report.website);
  const view = buildReportView(report, runs, aliases);

  const emailMatch = text.match(/^email\s+(\d+)$/i);

  try {
    if (emailMatch) {
      const step = parseInt(emailMatch[1], 10);
      const belief = BELIEF_SEQUENCE.find((b) => b.n === step);
      const options = await draftEmailOptions(report, view, { kind: "sequence", step });
      await postOptions(report, args.channel, args.threadTs, `✉️ Email ${step}${belief ? ` — ${belief.name}` : ""} · 3 options:`, options);
    } else {
      const options = await draftEmailOptions(report, view, { kind: "objection", prospectSaid: text });
      await postOptions(report, args.channel, args.threadTs, `✉️ Reply drafts · 3 options:`, options);
    }
  } catch (e) {
    await slack.postThreadReply(args.channel, args.threadTs, `⚠️ Couldn't draft that: ${(e as Error).message}`).catch(() => {});
  }

  return true;
}
