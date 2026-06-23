// Vektor inbound bank-statement pipeline (matthew@srtagency.com).
//
// When statements are emailed to Matthew's inbox, the Graph subscription on that
// mailbox fires /api/agent/bank-statements-inbound, which calls
// processInboundForBankStatements() here. We then:
//   1. Pull the PDF attachments and analyze them inline (one Opus pass) so we can
//      read the BUSINESS NAME printed IN the statements — the sender is often an
//      assistant whose email won't match the lead.
//   2. Noise gate: only proceed when the PDFs actually read as bank statements
//      (account holder + a monthly revenue table). Newsletters/signed docs skip
//      silently with no Slack post.
//   3. Post a copy to #srt-sub every time: header + analyzer summary + the PDFs.
//   4. Match the deal by business name (resolveLead), falling back to the sender
//      email, then to a time-proximity list of recently-created leads.
//   5. File to OneDrive — auto on an exact name match, a gated button otherwise.
//   6. Suggest a context-aware reply (gated 👍 send): the "finish your
//      application" email when the app is incomplete, else a short AI ack.
//
// The legacy sender-email path (/api/files/upload + downstream analyzer) is kept
// as a degraded fallback for when inline analysis fails.

import { microsoft } from "@/lib/microsoft";
import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import { postApprovalRequest } from "@/lib/ai-intel/slack-approval";
import { buildIncomeVerificationEmailContent } from "@/lib/income-verification-email";
import { analyzeBankStatements } from "@/lib/ai-intel/bank-statement-analyzer";
import { extractMetrics, formatReport, resolveLead, type BankMetrics } from "@/lib/ai-intel/build-draft";
import { callClaudeText } from "@/lib/claude-calls";
import type { PendingActionPayload } from "@/lib/ai-intel/types";

type ContactRow = {
  id: string;
  email: string | null;
  first_name: string | null;
  business_name: string | null;
  zoho_lead_id: string | null;
  portal_app_completed: boolean | null;
};

const LOG_EVENT = "bank_statements_inbound";

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";
}

function subChannel(): string {
  return process.env.SLACK_SUB_CHANNEL || "C0AJXH7PTBM";
}

function leadsMailbox(): string {
  return process.env.LEADS_MAILBOX || "matthew@srtagency.com";
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
async function findContactByEmail(email: string): Promise<ContactRow | null> {
  const { data } = await supabaseAdmin
    .from("contacts")
    .select("id, email, first_name, business_name, zoho_lead_id, portal_app_completed")
    .ilike("email", email)
    .order("application_completion_pct", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  return (data as ContactRow | null) ?? null;
}

/** Fetch a contact row by id (resolveLead gives us the id; we need app/email state). */
async function getContactById(id: string): Promise<ContactRow | null> {
  const { data } = await supabaseAdmin
    .from("contacts")
    .select("id, email, first_name, business_name, zoho_lead_id, portal_app_completed")
    .eq("id", id)
    .maybeSingle();
  return (data as ContactRow | null) ?? null;
}

/**
 * Analyze the inbound PDFs once (Opus vision → report, then a cheap JSON pass for
 * structured metrics). This single pass gives us both the business name (for
 * matching) and the underwriter summary (for the card). Returns null on failure
 * so the caller can degrade to the legacy sender-email path.
 */
async function analyzeInbound(
  pdfs: Array<{ name: string; contentBytes: string }>,
): Promise<{ report: string; metrics: BankMetrics } | null> {
  try {
    const inputs = pdfs.map((p) => ({
      name: p.name || "statement.pdf",
      buffer: Buffer.from(p.contentBytes, "base64"),
    }));
    const analysis = await analyzeBankStatements(inputs);
    const metrics = await extractMetrics(analysis.report);
    return { report: analysis.report, metrics };
  } catch (e) {
    console.error("[inbound-bank-statements] inline analysis failed:", (e as Error).message);
    return null;
  }
}

/**
 * File the statement PDFs into the deal's OneDrive folder, mirroring the Slack-drop
 * sibling (build-draft.ts): Deals/{business}/Bank Statements. Returns the folder
 * webUrl when available. Best-effort.
 */
async function fileToOneDriveDeal(
  business: string,
  pdfs: Array<{ name: string; contentBytes: string }>,
): Promise<string | null> {
  const biz = (business || "Applicant").replace(/[<>:"/\\|?*]/g, "_");
  let folderUrl: string | null = null;
  try {
    const folder = await microsoft.createDriveFolder("Bank Statements", `Deals/${biz}`).catch(() => null);
    folderUrl = folder?.webUrl ?? null;
    for (const p of pdfs) {
      await microsoft.uploadDriveFile(
        `Deals/${biz}/Bank Statements`,
        p.name || "statement.pdf",
        Buffer.from(p.contentBytes, "base64"),
        "application/pdf",
      );
    }
  } catch (e) {
    console.error("[inbound-bank-statements] OneDrive filing failed:", (e as Error).message);
  }
  return folderUrl;
}

interface NearLead {
  business_name: string | null;
  name: string | null;
  email: string | null;
  created_at: string | null;
}

/**
 * Time-proximity fallback: leads/applications created within ±window days of the
 * email's arrival. Used when neither the statement business name nor the sender
 * email matches a known deal — the statements may belong to a freshly-received
 * lead. Best-effort per table.
 */
async function findRecentLeadsNear(receivedISO: string, windowDays?: number): Promise<NearLead[]> {
  const days = windowDays ?? (Number(process.env.INBOUND_PROXIMITY_WINDOW_DAYS) || 3);
  const t = Date.parse(receivedISO);
  if (Number.isNaN(t)) return [];
  const lo = new Date(t - days * 86400000).toISOString();
  const hi = new Date(t + days * 86400000).toISOString();
  const out: NearLead[] = [];

  try {
    const { data } = await supabaseAdmin
      .from("contacts")
      .select("business_name, first_name, email, created_at")
      .gte("created_at", lo)
      .lte("created_at", hi)
      .order("created_at", { ascending: false })
      .limit(10);
    for (const c of (data ?? []) as Array<{ business_name: string | null; first_name: string | null; email: string | null; created_at: string | null }>) {
      out.push({ business_name: c.business_name, name: c.first_name ?? null, email: c.email, created_at: c.created_at });
    }
  } catch (e) {
    console.warn("[inbound-bank-statements] contacts proximity query failed:", (e as Error).message);
  }

  try {
    const { data } = await supabaseAdmin
      .from("standalone_applications")
      .select("business_name, first_name, last_name, email, created_at")
      .gte("created_at", lo)
      .lte("created_at", hi)
      .order("created_at", { ascending: false })
      .limit(10);
    for (const a of (data ?? []) as Array<{ business_name: string | null; first_name: string | null; last_name: string | null; email: string | null; created_at: string | null }>) {
      out.push({
        business_name: a.business_name,
        name: [a.first_name, a.last_name].filter(Boolean).join(" ") || null,
        email: a.email,
        created_at: a.created_at,
      });
    }
  } catch (e) {
    console.warn("[inbound-bank-statements] standalone_applications proximity query failed:", (e as Error).message);
  }

  return out;
}

interface ReplyDraft {
  subject: string;
  body: string;
  isHtml: boolean;
  signatureName?: string;
  preview: string; // plain-text shown in the Slack approval card
}

/**
 * Build the context-aware reply to the sender:
 *  • Matched lead whose application is still incomplete → the existing
 *    "finish your application" email (srtagency.com/fullapp, "S" sig embedded).
 *  • Otherwise (app complete, or no matched contact) → a short AI acknowledgement
 *    in Matthew's voice, with the "S" signature appended at send time.
 */
async function buildContextReply(args: {
  businessName: string;
  subject: string;
  contact: ContactRow | null;
}): Promise<ReplyDraft> {
  const firstName = args.contact?.first_name ?? null;
  const replySubject = args.subject ? `RE: ${args.subject}` : `Re: Bank statements — ${args.businessName}`;

  if (args.contact && !args.contact.portal_app_completed && args.contact.email) {
    const content = buildIncomeVerificationEmailContent(firstName);
    if (content) {
      return {
        subject: content.subject,
        body: content.html,
        isHtml: true, // template embeds the "S" signature
        preview: `Finish-your-application email (srtagency.com/fullapp) → ${args.contact.email}`,
      };
    }
  }

  const name = (firstName ?? "").trim();
  let body: string;
  try {
    const { text } = await callClaudeText({
      model: "claude-sonnet-4-6",
      system:
        "You are Matthew Garcia, a capital strategist at SRT Agency, writing a SHORT reply to a merchant who just emailed their business bank statements. 2 to 3 sentences. Warm but professional. Confirm the statements were received, say you are reviewing them and will follow up shortly with options. Do not promise specific terms. Do NOT use em dashes; use commas, periods, or hyphens. Do not add a signature or sign-off; it is appended automatically. Plain text only.",
      user: `Merchant business: ${args.businessName}.${name ? ` Contact first name: ${name}.` : ""} Write the reply body.`,
      maxTokens: 220,
      temperature: 0.4,
    });
    body = text.trim();
  } catch {
    body = `Thank you for sending the statements${name ? `, ${name}` : ""}. We have received them and are reviewing everything now. I will follow up shortly with your options.`;
  }

  return { subject: replySubject, body, isHtml: false, signatureName: "S", preview: body };
}

/** Post the gated send_email approval card with the drafted reply, threaded under the copy. */
async function gateReply(args: {
  draft: ReplyDraft;
  toAddress: string;
  messageId: string;
  threadTs: string | null;
  contact: ContactRow | null;
  zohoLeadId: string | null;
}): Promise<void> {
  const payload: PendingActionPayload = {
    action_type: "send_email",
    to: args.toAddress,
    subject: args.draft.subject,
    body: args.draft.body,
    is_html: args.draft.isHtml,
    signature_name: args.draft.signatureName,
    from_mailbox: leadsMailbox(),
    reply_to_graph_message_id: args.messageId, // threaded reply in the lead's conversation
    zoho_id: args.zohoLeadId ?? undefined,
    contact_id: args.contact?.id,
    note: {
      title: "Email sent — statements reply",
      content: `Reply to ${args.toAddress} after bank statements were received.`,
    },
  };

  const summary = `✉️ *Suggested reply to ${args.toAddress}:*\n>>>\n${args.draft.preview}\n>>>\n👍 to send (threaded reply, "S" signature).`;

  await postApprovalRequest({
    summary,
    payload,
    merchantId: args.contact?.id,
    zohoId: args.zohoLeadId ?? undefined,
    channel: subChannel(),
    threadTs: args.threadTs ?? undefined,
  });
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
  if (!msg.hasAttachments) return { status: "skipped", reason: "no_attachments" };

  const fromAddress = msg.from?.emailAddress?.address?.toLowerCase() ?? "";
  if (!fromAddress) return { status: "skipped", reason: "no_sender" };

  const attachments = await microsoft.getMessageAttachments(messageId, mailbox);
  const pdfs = attachments.filter(isPdfAttachment);
  if (pdfs.length === 0) return { status: "skipped", reason: "no_pdf" };

  // Analyze inline so we can match on the business name printed IN the statements
  // (the sender is often an assistant whose email won't match the lead).
  const analysis = await analyzeInbound(pdfs);

  // Degrade gracefully if analysis fails: fall back to the legacy sender-email
  // match + existing OneDrive/analyzer pipeline so a real lead is never lost.
  if (!analysis) {
    const contact = await findContactByEmail(fromAddress);
    if (!contact) {
      await logProcessed(messageId, `Analysis failed, no email match (${fromAddress})`, {
        from: fromAddress,
        reason: "analysis_failed",
      });
      return { status: "skipped", reason: "analysis_failed" };
    }
    await forwardToFilesUpload({
      contactId: contact.id,
      businessName: contact.business_name || "Applicant",
      pdfs: pdfs.map((p) => ({ name: p.name, contentBytes: p.contentBytes, contentType: p.contentType })),
    });
    let followupSlackTs: string | null = null;
    if (!contact.portal_app_completed) {
      const followup = await registerSuggestedFollowup(contact, messageId).catch((e) => {
        console.error("[inbound-bank-statements] follow-up suggestion failed:", (e as Error).message);
        return { slackTs: null, draftKey: "" };
      });
      followupSlackTs = followup.slackTs;
    }
    await logProcessed(messageId, `Bank statements (degraded) from ${fromAddress} → ${contact.business_name || contact.id}`, {
      from: fromAddress,
      contact_id: contact.id,
      pdf_count: pdfs.length,
      degraded: true,
    });
    return { status: "processed", contact_id: contact.id, pdf_count: pdfs.length, followup_slack_ts: followupSlackTs };
  }

  const metrics = analysis.metrics;

  // NOISE GATE — Matthew's inbox is noisy. Only treat as bank statements when the
  // analyzer extracted an account holder AND a monthly revenue table. Newsletters,
  // signed PDFs, etc. yield neither → skip silently (no Slack post).
  const isStatements = !!metrics.account_holder && metrics.revenue_table.length > 0;
  if (!isStatements) {
    await logProcessed(messageId, `Inbound PDFs are not bank statements (${fromAddress})`, {
      from: fromAddress,
      reason: "not_bank_statements",
    });
    return { status: "skipped", reason: "not_bank_statements" };
  }

  const accountHolder = (metrics.account_holder as string).trim();
  const channel = subChannel();

  // ALWAYS post the copy to #srt-sub from here on: header + underwriter summary.
  const header = `📑 *Bank statements received* from ${fromAddress} — *${accountHolder}*\n${formatReport(accountHolder, metrics)}`;
  const posted = (await slack.postMessage(channel, header)) as { ok?: boolean; ts?: string };
  const threadTs = posted?.ok && posted.ts ? posted.ts : null;

  // Attach the statement PDFs into the thread (a true "copy" in Slack).
  if (threadTs) {
    for (const p of pdfs) {
      try {
        await slack.uploadFilePDF(channel, p.name || "statement.pdf", Buffer.from(p.contentBytes, "base64"), threadTs);
      } catch (e) {
        console.warn("[inbound-bank-statements] PDF attach failed:", (e as Error).message);
      }
    }
  }

  // MATCH CASCADE — (1) business name from statements, (2) sender email.
  const nameMatch = await resolveLead(accountHolder);
  let confidence: "exact" | "fuzzy" | "email" | "none" = nameMatch.confidence;
  let businessName = (nameMatch.businessName || accountHolder).trim();
  let zohoLeadId = nameMatch.zohoLeadId;
  let contact: ContactRow | null = nameMatch.mcContactId ? await getContactById(nameMatch.mcContactId) : null;

  if (confidence === "none") {
    const emailContact = await findContactByEmail(fromAddress);
    if (emailContact) {
      contact = emailContact;
      confidence = "email";
      businessName = (emailContact.business_name || accountHolder).trim();
      zohoLeadId = emailContact.zoho_lead_id;
    }
  } else if (contact) {
    zohoLeadId = zohoLeadId ?? contact.zoho_lead_id;
  }

  // OneDrive routing — auto-file on an exact name match, a gated button otherwise.
  if (confidence === "exact") {
    const folderUrl = await fileToOneDriveDeal(businessName, pdfs);
    if (threadTs) {
      await slack.postThreadReply(
        channel,
        threadTs,
        `✅ Filed to OneDrive *Deals/${businessName}/Bank Statements*${folderUrl ? ` — <${folderUrl}|open>` : ""}`,
      );
    }
  } else if (confidence === "fuzzy" || confidence === "email") {
    await postApprovalRequest({
      summary: `📁 File these statements into *${businessName}*'s OneDrive? (${confidence} match)`,
      payload: {
        action_type: "file_to_onedrive",
        onedrive_business_name: businessName,
        source_message_id: messageId,
        source_mailbox: mailbox,
        contact_id: contact?.id,
        zoho_id: zohoLeadId ?? undefined,
      },
      merchantId: contact?.id,
      zohoId: zohoLeadId ?? undefined,
      channel,
      threadTs: threadTs ?? undefined,
    });
  } else {
    // (3) NO MATCH — alert + time-proximity candidates.
    const near = await findRecentLeadsNear(msg.receivedDateTime);
    const list = near
      .slice(0, 12)
      .map((n) => `• ${n.business_name || n.name || "—"}${n.email ? ` · ${n.email}` : ""}${n.created_at ? ` · ${n.created_at.slice(0, 10)}` : ""}`)
      .join("\n");
    const alert =
      `⚠️ *No lead in system* for "${accountHolder}".\n` +
      (list
        ? `Leads created around this email's arrival:\n${list}\nIf one matches, file it manually or create the lead, then use the button below.`
        : `No leads were created near ${msg.receivedDateTime.slice(0, 10)}.`);
    if (threadTs) await slack.postThreadReply(channel, threadTs, alert);
    await postApprovalRequest({
      summary: `📁 File these statements into a OneDrive folder *Deals/${accountHolder}*?`,
      payload: {
        action_type: "file_to_onedrive",
        onedrive_business_name: accountHolder,
        source_message_id: messageId,
        source_mailbox: mailbox,
      },
      channel,
      threadTs: threadTs ?? undefined,
    });
  }

  // Context-aware reply — gated send for every branch.
  try {
    const draft = await buildContextReply({ businessName, subject: msg.subject, contact });
    await gateReply({ draft, toAddress: fromAddress, messageId, threadTs, contact, zohoLeadId });
  } catch (e) {
    console.error("[inbound-bank-statements] reply draft failed:", (e as Error).message);
  }

  await logProcessed(messageId, `Bank statements from ${fromAddress} → ${businessName} (${confidence})`, {
    from: fromAddress,
    contact_id: contact?.id ?? null,
    business_name: businessName,
    confidence,
    pdf_count: pdfs.length,
  });

  return {
    status: "processed",
    contact_id: contact?.id,
    pdf_count: pdfs.length,
    followup_slack_ts: threadTs,
  };
}
