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

type ForwardAttachment = {
  name: string;
  contentType: string;
  contentBytes: string;
  isInline?: boolean;
  contentId?: string | null;
};

/**
 * Re-download the original New-Deal email's attachments from the submissions@ mailbox.
 * Never throws — some funders accept a body-only pitch, so a download failure returns []
 * and the caller surfaces "no attachments" in the receipt. Shared by both forward paths.
 */
async function downloadOriginalAttachments(messageId: string, mailbox: string): Promise<ForwardAttachment[]> {
  try {
    const raw = await microsoft.getMessageAttachments(messageId, mailbox);
    return raw
      .filter((a) => a.contentBytes) // skip item/reference attachments with no bytes
      .map((a) => ({
        name: a.name,
        contentType: a.contentType || "application/octet-stream",
        contentBytes: a.contentBytes,
        isInline: a.isInline,       // keep the signature image inline (cid) rather than as a stray file
        contentId: a.contentId,
      }));
  } catch (e) {
    console.warn("[forward-deal] attachment re-download failed:", (e as Error).message);
    return [];
  }
}

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
  to_emails: string[] | null;
  cc_emails: string[] | null;
}

/** Ordered To-list for a funder: prefer the seeded to_emails, else the single submission_email. */
function resolveToList(lender: LenderRow): string[] {
  const ordered = (lender.to_emails ?? []).map((e) => e.trim()).filter(Boolean);
  if (ordered.length > 0) return ordered;
  return lender.submission_email ? [lender.submission_email] : [];
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
    .select("id, name, submission_method, submission_email, to_emails, cc_emails")
    .in("id", opts.lenderIds)
    .eq("is_active", true);

  if (lendersErr || !lenders || lenders.length === 0) {
    return { ...result, ok: false, error: lendersErr?.message ?? "no_matching_lenders" };
  }

  // Re-download the original attachments once, from the submissions@ mailbox.
  const attachments = await downloadOriginalAttachments(submission.original_message_id, submission.mailbox);

  const subject = submission.subject || `New Deal — ${submission.business_name}`;
  // Forward the original email body byte-for-byte — NO signature appended.
  const body = submission.html_body ?? "";

  const recorded: Array<{ lenderId: string | null; name: string; email: string; status: "sent" | "failed"; notes?: string }> = [];

  for (const lender of lenders as LenderRow[]) {
    const toList = resolveToList(lender);
    if (lender.submission_method === "portal" || toList.length === 0) {
      result.skipped.push({ id: lender.id, name: lender.name, reason: toList.length > 0 ? "portal_only" : "no_email" });
      continue;
    }
    const ccList = (lender.cc_emails ?? []).map((e) => e.trim()).filter(Boolean);
    const primaryEmail = toList[0];

    try {
      await microsoft.sendMail({
        to: toList,              // ordered To-list (some funders require a specific set/order)
        cc: ccList,              // real CC, not BCC
        subject,
        body,
        isHtml: true,
        attachments,
        fromMailbox: DEFAULTS.submissionsFromAddress,
      });
      result.sent.push({ id: lender.id, name: lender.name });
      recorded.push({ lenderId: lender.id, name: lender.name, email: primaryEmail, status: "sent" });
    } catch (e) {
      const error = (e as Error).message;
      result.failed.push({ id: lender.id, name: lender.name, error });
      recorded.push({ lenderId: lender.id, name: lender.name, email: primaryEmail, status: "failed", notes: error });
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
    const fileCount = attachments.filter((a) => !a.isInline).length;
    const attachNote = fileCount > 0 ? ` (${fileCount} attachment${fileCount === 1 ? "" : "s"})` : " (no attachments)";
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

export interface ForwardAddressesOpts {
  emailSubmissionId: string;
  to: string[];
  cc: string[];
}

export interface ForwardAddressesResult {
  ok: boolean;
  sentTo: string[];
  cc: string[];
  attachmentCount: number;
  error?: string;
}

/**
 * Ad-hoc verbatim forward to raw addresses Matthew typed in the thread (not known lenders).
 * Same package as forwardDealToFunders — original HTML body byte-for-byte + original
 * attachments, sent FROM submissions@ — but to one To-list (+ optional CC) of free-text
 * addresses. Records each To address as a lender-less email_submission_funders row so funder
 * replies still match back, and posts a single thread receipt.
 */
export async function forwardDealToAddresses(opts: ForwardAddressesOpts): Promise<ForwardAddressesResult> {
  const to = opts.to.map((e) => e.trim()).filter(Boolean);
  const cc = opts.cc.map((e) => e.trim()).filter(Boolean);
  if (to.length === 0) {
    return { ok: false, sentTo: [], cc, attachmentCount: 0, error: "no_recipients" };
  }

  const submission = await getEmailSubmissionById(opts.emailSubmissionId);
  if (!submission) {
    return { ok: false, sentTo: [], cc, attachmentCount: 0, error: "email_submission_not_found" };
  }

  const attachments = await downloadOriginalAttachments(submission.original_message_id, submission.mailbox);
  const fileCount = attachments.filter((a) => !a.isInline).length;
  const subject = submission.subject || `New Deal — ${submission.business_name}`;
  const body = submission.html_body ?? "";

  try {
    await microsoft.sendMail({
      to,
      cc,
      subject,
      body,
      isHtml: true,
      attachments,
      fromMailbox: DEFAULTS.submissionsFromAddress,
    });
  } catch (e) {
    const error = (e as Error).message;
    await recordFunderSends(
      submission.id,
      to.map((email) => ({ lenderId: null, name: email, email, status: "failed" as const, notes: error })),
    );
    return { ok: false, sentTo: [], cc, attachmentCount: fileCount, error };
  }

  await recordFunderSends(
    submission.id,
    to.map((email) => ({ lenderId: null, name: email, email, status: "sent" as const })),
  );
  await setEmailSubmissionStatus(submission.id, "forwarded");

  const channel = submission.slack_channel || process.env.SLACK_SUB_CHANNEL || "C0AJXH7PTBM";
  const threadTs = submission.slack_thread_ts;
  if (threadTs) {
    const attachNote = fileCount > 0 ? ` (${fileCount} attachment${fileCount === 1 ? "" : "s"})` : " (no attachments)";
    const ccNote = cc.length ? ` · CC ${cc.join(", ")}` : "";
    await safeThreadReply(channel, threadTs, `✅ Forwarded to *${to.join(", ")}*${ccNote}${attachNote}`);
  }

  return { ok: true, sentTo: to, cc, attachmentCount: fileCount };
}

async function safeThreadReply(channel: string, threadTs: string, text: string): Promise<void> {
  try {
    await slack.postThreadReply(channel, threadTs, text);
  } catch (e) {
    console.warn("[forward-deal] thread reply failed:", (e as Error).message);
  }
}
