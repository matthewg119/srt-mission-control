// Vektor inbound bank-statement pipeline (matthew@srtagency.com).
//
// When a CRM lead emails bank statements to Matthew's inbox, the Graph
// subscription on that mailbox fires /api/agent/bank-statements-inbound, which
// calls processInboundForBankStatements() here. We then:
//   1. Match the sender to a CRM contact (by contacts.email).
//   2. Pull the PDF attachments off the message.
//   3. Forward them to /api/files/upload → OneDrive (lead's Working Files folder)
//      + deal_notes, which in turn triggers /api/agent/bank-statements (analyzer
//      → backfill contact data → completeness check + approval card to #srt-sub).
//   4. If the lead's application is still incomplete, register a GATED suggested
//      follow-up email (asking them to finish at srtagency.com/fullapp) surfaced
//      in BOTH Slack (approval card) and textwin.ai (email_outbox 'suggested').
//
// Everything downstream is reused, production-proven code. This file is just the
// wiring from "PDF landed in Matthew's inbox" to that pipeline.

import { microsoft } from "@/lib/microsoft";
import { supabaseAdmin } from "@/lib/db";
import { postApprovalRequest } from "@/lib/ai-intel/slack-approval";
import { buildIncomeVerificationEmailContent } from "@/lib/income-verification-email";
import type { PendingActionPayload } from "@/lib/ai-intel/types";

const LOG_EVENT = "bank_statements_inbound";

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";
}

function isPdfAttachment(a: { name: string; contentType: string; isInline: boolean; contentBytes: string }): boolean {
  if (a.isInline) return false;
  if (!a.contentBytes) return false;
  const name = (a.name || "").toLowerCase();
  return a.contentType === "application/pdf" || name.endsWith(".pdf");
}

interface InboundMessage {
  id: string;
  subject: string;
  from: { emailAddress: { address: string; name: string } };
  hasAttachments: boolean;
  receivedDateTime: string;
  conversationId: string;
}

/**
 * Idempotency: have we already run the pipeline for this Graph message? A prior
 * marker row in system_logs means yes (Graph re-delivers notifications, and the
 * renew/replay paths can re-run). Best-effort — a query failure treats it as new.
 */
async function alreadyProcessed(messageId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("system_logs")
    .select("id")
    .eq("event_type", LOG_EVENT)
    .eq("metadata->>message_id", messageId)
    .limit(1)
    .maybeSingle();
  return !!data;
}

async function logProcessed(messageId: string, description: string, metadata: Record<string, unknown>): Promise<void> {
  try {
    await supabaseAdmin.from("system_logs").insert({
      event_type: LOG_EVENT,
      description,
      metadata: { message_id: messageId, ...metadata },
    });
  } catch {
    /* logging is best-effort */
  }
}

/**
 * Fetch a single message from `mailbox`, pulling only the fields we branch on.
 * Uses the same mailbox token path as the submissions webhook.
 */
async function fetchMessage(mailbox: string, messageId: string): Promise<InboundMessage | null> {
  const token = await microsoft.getMailboxToken();
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/messages/${messageId}` +
      `?$select=id,subject,from,hasAttachments,receivedDateTime,conversationId`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    const err = await res.text();
    await logProcessed(messageId, `Graph fetch failed (${res.status}) for ${mailbox}`, {
      status: res.status,
      error: err.slice(0, 300),
    });
    return null;
  }
  return (await res.json()) as InboundMessage;
}

/** Match an inbound sender address to a CRM contact. Returns null for non-CRM senders. */
async function findContactByEmail(email: string): Promise<{
  id: string;
  email: string | null;
  first_name: string | null;
  business_name: string | null;
  zoho_lead_id: string | null;
  portal_app_completed: boolean | null;
} | null> {
  const { data } = await supabaseAdmin
    .from("contacts")
    .select("id, email, first_name, business_name, zoho_lead_id, portal_app_completed")
    .ilike("email", email)
    .order("application_completion_pct", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  return (data as typeof data & { portal_app_completed: boolean | null }) ?? null;
}

/**
 * Push the downloaded PDF attachments through the existing OneDrive + analyzer
 * pipeline by posting them to /api/files/upload (which uploads to the lead's
 * Working Files folder, writes a deal_note, and triggers the bank-statement
 * analyzer → #srt-sub completeness check + approval card). Returns the upload
 * route's JSON or throws.
 */
async function forwardToFilesUpload(args: {
  contactId: string;
  businessName: string;
  pdfs: Array<{ name: string; contentBytes: string; contentType: string }>;
}): Promise<unknown> {
  const form = new FormData();
  form.append("contactId", args.contactId);
  form.append("businessName", args.businessName || "Applicant");
  for (const pdf of args.pdfs) {
    const buffer = Buffer.from(pdf.contentBytes, "base64");
    const file = new File([buffer], pdf.name || "statement.pdf", {
      type: pdf.contentType || "application/pdf",
    });
    form.append("files", file);
  }
  const res = await fetch(`${appUrl()}/api/files/upload`, { method: "POST", body: form });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`files/upload ${res.status}: ${err.slice(0, 200)}`);
  }
  return res.json().catch(() => ({}));
}

/**
 * Register the "finish your application" follow-up as a GATED suggestion, never
 * an auto-send:
 *  • Slack — postApprovalRequest(send_email); 👍 fires executePendingAction.
 *  • textwin.ai — a row in email_outbox with status 'suggested' + a shared
 *    draft_key so the operator can approve/edit/send it remotely. Best-effort:
 *    if the email_outbox table isn't migrated yet, the Slack card still works.
 */
async function registerSuggestedFollowup(contact: {
  id: string;
  email: string | null;
  first_name: string | null;
  business_name: string | null;
  zoho_lead_id: string | null;
}, messageId: string): Promise<{ slackTs: string | null; draftKey: string }> {
  const draftKey = `bsf_${contact.id}_${messageId}`;
  const content = buildIncomeVerificationEmailContent(contact.first_name);
  if (!content || !contact.email) {
    return { slackTs: null, draftKey };
  }

  const payload: PendingActionPayload & { draft_key?: string } = {
    action_type: "send_email",
    to: contact.email,
    subject: content.subject,
    body: content.html,
    is_html: true,
    from_mailbox: process.env.LEADS_MAILBOX || "matthew@srtagency.com",
    // Thread the reply under the email the lead sent the statements in.
    reply_to_graph_message_id: messageId,
    zoho_id: contact.zoho_lead_id ?? undefined,
    contact_id: contact.id,
    note: {
      title: `Email sent — ${content.subject}`,
      content: `Income-verification follow-up (statements received) sent to ${contact.email}.`,
    },
    draft_key: draftKey,
  };

  const summary =
    `📑 Bank statements received from *${contact.business_name || contact.first_name || contact.email}*.\n` +
    `Suggested follow-up: ask them to finish the application at srtagency.com/fullapp ` +
    `(*${content.subject}* → ${contact.email}). Approve to send.`;

  const card = await postApprovalRequest({
    summary,
    payload,
    merchantId: contact.id,
    zohoId: contact.zoho_lead_id ?? undefined,
    channel: process.env.SLACK_SUB_CHANNEL || "C0AJXH7PTBM",
  });

  // textwin.ai surface — best-effort (table is created by the Phase-3 email migration).
  try {
    await supabaseAdmin.from("email_outbox").insert({
      contact_id: contact.id,
      to_address: contact.email,
      subject: content.subject,
      body: content.html,
      is_html: true, // the app-no-statements template is full HTML with the "S" sig embedded
      signature_name: "S",
      reply_to_graph_message_id: messageId, // thread under the lead's statements email
      status: "suggested",
      ai_reason: "Bank statements received — ask the merchant to finish the application at srtagency.com/fullapp.",
      draft_key: draftKey,
    });
  } catch (e) {
    console.warn("[inbound-bank-statements] email_outbox suggestion skipped:", (e as Error).message);
  }

  return { slackTs: card.slackTs, draftKey };
}

export interface InboundResult {
  status: "processed" | "skipped";
  reason?: string;
  contact_id?: string;
  pdf_count?: number;
  followup_slack_ts?: string | null;
}

/**
 * Main entry. Idempotent and best-effort: every early return logs a marker so a
 * re-delivered notification is a cheap no-op. Returns a summary for the webhook
 * response / observability.
 */
export async function processInboundForBankStatements(
  mailbox: string,
  messageId: string,
): Promise<InboundResult> {
  if (await alreadyProcessed(messageId)) {
    return { status: "skipped", reason: "already_processed" };
  }

  const msg = await fetchMessage(mailbox, messageId);
  if (!msg) return { status: "skipped", reason: "fetch_failed" };

  if (!msg.hasAttachments) {
    return { status: "skipped", reason: "no_attachments" };
  }

  const fromAddress = msg.from?.emailAddress?.address?.toLowerCase() ?? "";
  if (!fromAddress) return { status: "skipped", reason: "no_sender" };

  const contact = await findContactByEmail(fromAddress);
  if (!contact) {
    // Not a CRM lead — Matthew's inbox is noisy, most mail isn't a statement reply.
    return { status: "skipped", reason: "no_crm_match" };
  }

  const attachments = await microsoft.getMessageAttachments(messageId, mailbox);
  const pdfs = attachments.filter(isPdfAttachment);
  if (pdfs.length === 0) {
    return { status: "skipped", reason: "no_pdf", contact_id: contact.id };
  }

  // Run the existing OneDrive + analyzer pipeline.
  await forwardToFilesUpload({
    contactId: contact.id,
    businessName: contact.business_name || "Applicant",
    pdfs: pdfs.map((p) => ({ name: p.name, contentBytes: p.contentBytes, contentType: p.contentType })),
  });

  // Gated follow-up only when the application still isn't finished.
  let followupSlackTs: string | null = null;
  if (!contact.portal_app_completed) {
    const followup = await registerSuggestedFollowup(contact, messageId).catch((e) => {
      console.error("[inbound-bank-statements] follow-up suggestion failed:", (e as Error).message);
      return { slackTs: null, draftKey: "" };
    });
    followupSlackTs = followup.slackTs;
  }

  await logProcessed(messageId, `Bank statements from ${fromAddress} → ${contact.business_name || contact.id}`, {
    from: fromAddress,
    contact_id: contact.id,
    pdf_count: pdfs.length,
    followup_posted: !!followupSlackTs,
  });

  return {
    status: "processed",
    contact_id: contact.id,
    pdf_count: pdfs.length,
    followup_slack_ts: followupSlackTs,
  };
}
