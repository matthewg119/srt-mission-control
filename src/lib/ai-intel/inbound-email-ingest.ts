// textwin.ai — inbound lead-email ingestion (Matthew's mailbox).
//
// Runs off the same Graph subscription on matthew@srtagency.com as the inbound
// bank-statement pipeline. For each created message we ingest the INBOUND email
// from a CRM lead into email_conversations/email_messages so it shows in that
// lead's unified chat in textwin.ai. Outbound (Matthew-sent) messages are skipped
// here — the email_outbox drain cron logs those at send time (no double-logging).
//
// Idempotent (email_messages.graph_message_id is unique) and best-effort: any
// failure is logged and swallowed so it never breaks the bank-statement path.

import { microsoft } from "@/lib/microsoft";
import { supabaseAdmin } from "@/lib/db";

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface FullMessage {
  id: string;
  subject: string;
  from: { emailAddress: { address: string; name: string } };
  toRecipients?: Array<{ emailAddress: { address: string } }>;
  body: { content: string; contentType: string };
  bodyPreview: string;
  receivedDateTime: string;
  conversationId: string;
}

export interface IngestResult {
  status: "ingested" | "skipped";
  reason?: string;
  contact_id?: string;
  email_message_id?: string;
}

export async function ingestLeadEmail(mailbox: string, messageId: string): Promise<IngestResult> {
  const mailboxAddr = mailbox.toLowerCase();
  const token = await microsoft.getMailboxToken();
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/messages/${messageId}` +
      `?$select=id,subject,from,toRecipients,body,bodyPreview,receivedDateTime,conversationId`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    return { status: "skipped", reason: `fetch_failed_${res.status}` };
  }
  const msg = (await res.json()) as FullMessage;

  const fromAddress = msg.from?.emailAddress?.address?.toLowerCase() ?? "";
  if (!fromAddress) return { status: "skipped", reason: "no_sender" };
  // Outbound (Matthew sent it) → the drain cron logs that; skip here.
  if (fromAddress === mailboxAddr) return { status: "skipped", reason: "outbound_self" };

  const { data: contact } = await supabaseAdmin
    .from("contacts")
    .select("id, email")
    .ilike("email", fromAddress)
    .order("application_completion_pct", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (!contact) return { status: "skipped", reason: "no_crm_match" };

  // Already ingested? (idempotent on the Graph message id)
  const { data: existing } = await supabaseAdmin
    .from("email_messages")
    .select("id")
    .eq("graph_message_id", msg.id)
    .limit(1)
    .maybeSingle();
  if (existing) return { status: "skipped", reason: "already_ingested", contact_id: contact.id as string };

  // Upsert the email conversation (one per contact + Graph conversationId).
  const { data: conv } = await supabaseAdmin
    .from("email_conversations")
    .upsert(
      {
        contact_id: contact.id,
        graph_conversation_id: msg.conversationId ?? null,
        participant_email: fromAddress,
        subject: msg.subject ?? null,
        last_message_at: msg.receivedDateTime ?? null,
      },
      { onConflict: "contact_id,graph_conversation_id" },
    )
    .select("id")
    .maybeSingle();

  let conversationId = conv?.id as string | undefined;
  if (!conversationId) {
    // onConflict no-op (existing row) — fetch it.
    const { data: found } = await supabaseAdmin
      .from("email_conversations")
      .select("id")
      .eq("contact_id", contact.id)
      .eq("graph_conversation_id", msg.conversationId ?? "")
      .maybeSingle();
    conversationId = found?.id as string | undefined;
  }
  if (!conversationId) return { status: "skipped", reason: "conversation_upsert_failed", contact_id: contact.id as string };

  const html = msg.body?.contentType === "html" ? msg.body.content : `<pre>${msg.body?.content ?? ""}</pre>`;
  const preview = (msg.bodyPreview || stripHtml(msg.body?.content ?? "")).slice(0, 240);

  const { data: inserted } = await supabaseAdmin
    .from("email_messages")
    .insert({
      conversation_id: conversationId,
      graph_message_id: msg.id,
      direction: "inbound",
      subject: msg.subject ?? null,
      html_body: html,
      text_preview: preview,
      from_address: fromAddress,
      to_addresses: (msg.toRecipients ?? []).map((r) => r.emailAddress.address),
      received_at: msg.receivedDateTime ?? null,
    })
    .select("id")
    .maybeSingle();

  // Refresh conversation recency.
  await supabaseAdmin
    .from("email_conversations")
    .update({ last_message_at: msg.receivedDateTime ?? null })
    .eq("id", conversationId);

  return { status: "ingested", contact_id: contact.id as string, email_message_id: inserted?.id as string | undefined };
}
