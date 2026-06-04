// Verbatim forward of a "New Deal" email to the funders Matthew names in Slack.
//
// Parallel to submitToLenders(), but it does NOT AI-draft anything: it forwards
// the ORIGINAL email's HTML body + the ORIGINAL attachments (re-downloaded from
// the submissions@ mailbox by message id) to each selected funder's
// submission_email, sent FROM submissions@, only swapping in the Submissions
// signature. Each send is posted as a thread reply under the deal's #srt-sub
// parent message and recorded in email_submission_funders.

import { supabaseAdmin } from "@/lib/db";
import { microsoft } from "@/lib/microsoft";
import { slack } from "@/lib/slack-bot";
import { DEFAULTS } from "@/config/defaults";
import { getEmailSubmissionById, recordFunderSends, setEmailSubmissionStatus } from "./email-submissions";

export interface ForwardDealOpts {
  emailSubmissionId: string;
  lenderIds: string[];
}

export interface ForwardDealResult {
  ok: boolean;
  sent: Array<{ id: string; name: string }>;
  failed: Array<{ id: string; name: string; error: string }>;
  skipped: Array<{ id: string; name: string; reason: string }>;
  error?: string;
}

interface LenderRow {
  id: string;
  name: string;
  submission_method: string | null;
  submission_email: string | null;
  cc_emails: string[] | null;
}

export async function forwardDealToFunders(opts: ForwardDealOpts): Promise<ForwardDealResult> {
  const result: ForwardDealResult = { ok: true, sent: [], failed: [], skipped: [] };

  if (opts.lenderIds.length === 0) {
    return { ...result, ok: false, error: "no_lenders" };
  }

  const submission = await getEmailSubmissionById(opts.emailSubmissionId);
  if (!submission) {
    return { ...result, ok: false, error: "email_submission_not_found" };
  }

  const { data: lenders, error: lendersErr } = await supabaseAdmin
    .from("lenders")
    .select("id, name, submission_method, submission_email, cc_emails")
    .in("id", opts.lenderIds)
    .eq("is_active", true);

  if (lendersErr || !lenders || lenders.length === 0) {
    return { ...result, ok: false, error: lendersErr?.message ?? "no_matching_lenders" };
  }

  // Re-download the original attachments once, from the submissions@ mailbox.
  let attachments: Array<{ name: string; contentType: string; contentBytes: string }> = [];
  try {
    const raw = await microsoft.getMessageAttachments(submission.original_message_id, submission.mailbox);
    attachments = raw
      .filter((a) => a.contentBytes) // skip item/reference attachments with no bytes
      .map((a) => ({
        name: a.name,
        contentType: a.contentType || "application/octet-stream",
        contentBytes: a.contentBytes,
      }));
  } catch (e) {
    // Don't abort — some funders accept the body-only pitch; surface the issue in the receipt.
    console.warn("[forward-deal] attachment re-download failed:", (e as Error).message);
  }

  const subject = submission.subject || `New Deal — ${submission.business_name}`;
  // Forward the original email body byte-for-byte — NO signature appended.
  const body = submission.html_body ?? "";

  const recorded: Array<{ lenderId: string | null; name: string; email: string; status: "sent" | "failed"; notes?: string }> = [];

  for (const lender of lenders as LenderRow[]) {
    if (lender.submission_method === "portal" || !lender.submission_email) {
      result.skipped.push({ id: lender.id, name: lender.name, reason: lender.submission_email ? "portal_only" : "no_email" });
      continue;
    }

    try {
      await microsoft.sendMail({
        to: lender.submission_email,
        bcc: lender.cc_emails && lender.cc_emails.length > 0 ? lender.cc_emails.join(",") : undefined,
        subject,
        body,
        isHtml: true,
        attachments,
        fromMailbox: DEFAULTS.submissionsFromAddress,
      });
      result.sent.push({ id: lender.id, name: lender.name });
      recorded.push({ lenderId: lender.id, name: lender.name, email: lender.submission_email, status: "sent" });
    } catch (e) {
      const error = (e as Error).message;
      result.failed.push({ id: lender.id, name: lender.name, error });
      recorded.push({ lenderId: lender.id, name: lender.name, email: lender.submission_email, status: "failed", notes: error });
    }
  }

  await recordFunderSends(submission.id, recorded);

  if (result.sent.length > 0) {
    await setEmailSubmissionStatus(submission.id, "forwarded");
  }

  // Per-funder thread receipts under the deal's #srt-sub parent message.
  const channel = submission.slack_channel || process.env.SLACK_SUB_CHANNEL || "C0AJXH7PTBM";
  const threadTs = submission.slack_thread_ts;
  if (threadTs) {
    const attachNote = attachments.length > 0 ? ` (${attachments.length} attachment${attachments.length === 1 ? "" : "s"})` : " (no attachments)";
    for (const s of result.sent) {
      await safeThreadReply(channel, threadTs, `✅ Forwarded to *${s.name}*${attachNote}`);
    }
    for (const f of result.failed) {
      await safeThreadReply(channel, threadTs, `⚠️ Failed to send to *${f.name}* — ${f.error}`);
    }
    for (const sk of result.skipped) {
      await safeThreadReply(channel, threadTs, `⏭️ Skipped *${sk.name}* — ${sk.reason === "no_email" ? "no submission email on file" : "portal-only funder"}`);
    }
  }

  return result;
}

async function safeThreadReply(channel: string, threadTs: string, text: string): Promise<void> {
  try {
    await slack.postThreadReply(channel, threadTs, text);
  } catch (e) {
    console.warn("[forward-deal] thread reply failed:", (e as Error).message);
  }
}
