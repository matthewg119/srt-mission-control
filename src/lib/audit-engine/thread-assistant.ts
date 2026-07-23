// Routes Slack thread replies inside an audit-report thread to the email
// assistant. Called from src/app/api/slack/events/route.ts, gated there by
// channel === AUDIT_CHANNEL_ID before this even runs — so it only ever does a
// DB lookup for genuine audit-channel thread replies, never on every message
// in the workspace. Returns false fast for a thread that isn't (yet) an audit
// report thread, so it never interferes with the many other thread lanes
// already wired in events.ts.

import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import { buildReportView } from "./report-view";
import { buildAliases } from "./mention-match";
import { draftSequenceEmail, draftObjectionReply, BELIEF_SEQUENCE } from "./email-assistant";
import type { AuditReportRow, AuditRunRow } from "./types";

export async function handleAuditThreadReply(args: { channel: string; threadTs: string; text: string }): Promise<boolean> {
  const { data: reportData } = await supabaseAdmin
    .from("audit_reports")
    .select("*")
    .eq("slack_thread_ts", args.threadTs)
    .maybeSingle();

  if (!reportData) return false; // not an audit thread — let other handlers run
  const report = reportData as AuditReportRow;

  if (report.status !== "done") {
    await slack.postThreadReply(args.channel, args.threadTs, "⏳ This audit hasn't finished running yet — I'll have the scorecard and email draft once it's done.");
    return true;
  }

  const { data: runsData } = await supabaseAdmin.from("audit_runs").select("*").eq("report_id", report.id);
  const runs = (runsData ?? []) as AuditRunRow[];
  const aliases = buildAliases(report.client_name ?? report.business_type ?? report.website, report.website);
  const view = buildReportView(report, runs, aliases);

  const emailMatch = args.text.trim().match(/^email\s+(\d+)$/i);

  try {
    const { subject, body } = emailMatch
      ? await draftSequenceEmail(report, view, parseInt(emailMatch[1], 10))
      : await draftObjectionReply(report, view, args.text.trim());

    const label = emailMatch
      ? `✉️ Email ${emailMatch[1]}${BELIEF_SEQUENCE.find((b) => b.n === parseInt(emailMatch[1], 10)) ? ` — ${BELIEF_SEQUENCE.find((b) => b.n === parseInt(emailMatch[1], 10))!.name}` : ""}:`
      : `✉️ Draft reply:`;
    const subjectLine = subject ? `Subject: ${subject}\n\n` : "";

    await slack.postThreadReply(args.channel, args.threadTs, `${label}\n\n${subjectLine}${body}`);
  } catch (e) {
    await slack.postThreadReply(args.channel, args.threadTs, `⚠️ Couldn't draft that: ${(e as Error).message}`).catch(() => {});
  }

  return true;
}
