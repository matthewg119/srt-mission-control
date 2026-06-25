export const dynamic = "force-dynamic";
// TextWin extension — live email history for a conversation's contact, read
// straight from Outlook/Graph (NOT the email_messages table) so the full
// back-and-forth shows up GHL-style without depending on the ingest pipeline.
// Mirrors textwin.ai's /api/sms/conversations/[id]/email-thread but gated by the
// extension bearer token + CORS.
//
//   GET  (no params)                       → list the contact's messages (received + sent)
//   GET  ?messageId=<id>                    → full HTML body of one message (popup expand)
//   POST { body, subject?, replyToMessageId? } → send via Graph ("S" sig appended)
//   POST { action: "save-email", email }    → persist contacts.email for this contact

import { NextRequest } from "next/server";
import { requireExtTenant, jsonCors, preflight } from "@/lib/ext-auth";
import { supabaseAdmin } from "@/lib/db";
import { microsoft } from "@/lib/microsoft";
import { SIGNATURE_S_HTML } from "@/config/email-signature";

export const runtime = "nodejs";
export const maxDuration = 30;

export function OPTIONS(req: NextRequest) {
  return preflight(req);
}

async function resolveContact(conversationId: string): Promise<{ contactId: string | null; email: string | null }> {
  const { data: conv } = await supabaseAdmin
    .from("sms_conversations")
    .select("contact_id")
    .eq("id", conversationId)
    .maybeSingle();
  const contactId = (conv?.contact_id as string | null) ?? null;
  let email: string | null = null;
  if (contactId) {
    const { data: contact } = await supabaseAdmin
      .from("contacts")
      .select("email")
      .eq("id", contactId)
      .maybeSingle();
    email = (contact?.email as string | null) ?? null;
  }
  return { contactId, email };
}

// Plain text → HTML paragraphs + the Outlook "S" signature (matches MC outbound,
// see buildHtmlBody() in src/lib/ai-intel/execute-action.ts).
function wrapWithSSignature(body: string): string {
  const htmlBody = body
    .split("\n")
    .map((line) =>
      line.trim() === ""
        ? "<br>"
        : `<p style="margin:0 0 8px 0;">${line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`
    )
    .join("");
  return `${htmlBody}<br><br>${process.env.SIGNATURE_S_HTML || SIGNATURE_S_HTML}`;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenant = await requireExtTenant(req);
  if (!tenant) return jsonCors(req, { ok: false, error: "unauthorized" }, 401);

  const { id } = await params;
  const url = new URL(req.url);
  const messageId = url.searchParams.get("messageId");

  // Single-message body fetch (popup expand) — no contact lookup needed.
  if (messageId) {
    try {
      const { html, conversationId } = await microsoft.getMessageHtml(messageId);
      return jsonCors(req, { html, conversationId });
    } catch (e) {
      return jsonCors(req, { error: e instanceof Error ? e.message : "fetch_failed" }, 502);
    }
  }

  const resolved = await resolveContact(id);
  const email = (url.searchParams.get("email") || resolved.email || "").trim();
  if (!email) {
    return jsonCors(req, { email: null, needsEmail: true, messages: [] });
  }

  try {
    const raw = await microsoft.searchMessagesWithAddress(email);
    const lower = email.toLowerCase();
    const messages = raw
      .map((m) => {
        const fromAddr = m.from?.emailAddress?.address ?? "";
        const date = m.sentDateTime || m.receivedDateTime || "";
        return {
          id: m.id,
          conversationId: m.conversationId,
          subject: m.subject || "(no subject)",
          fromAddress: fromAddr,
          fromName: m.from?.emailAddress?.name ?? "",
          toAddresses: (m.toRecipients ?? [])
            .map((r) => r.emailAddress?.address)
            .filter(Boolean)
            .join(", "),
          preview: m.bodyPreview ?? "",
          date,
          // Inbound = the lead sent it; otherwise we sent it.
          direction: fromAddr.toLowerCase() === lower ? "inbound" : "outbound",
        };
      })
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    return jsonCors(req, { email, messages });
  } catch (e) {
    return jsonCors(req, { email, error: e instanceof Error ? e.message : "fetch_failed", messages: [] }, 502);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenant = await requireExtTenant(req);
  if (!tenant) return jsonCors(req, { ok: false, error: "unauthorized" }, 401);

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    email?: string;
    body?: string;
    subject?: string;
    replyToMessageId?: string | null;
  };

  const resolved = await resolveContact(id);

  // Persist a manually-entered email onto the contact so it's remembered.
  if (body.action === "save-email") {
    const email = (body.email ?? "").trim();
    if (!email) return jsonCors(req, { ok: false, error: "missing_email" }, 400);
    if (!resolved.contactId) return jsonCors(req, { ok: false, error: "no_contact" }, 400);
    const { error } = await supabaseAdmin.from("contacts").update({ email }).eq("id", resolved.contactId);
    if (error) return jsonCors(req, { ok: false, error: error.message }, 500);
    return jsonCors(req, { ok: true, email });
  }

  // Send / reply.
  const text = (body.body ?? "").trim();
  if (!text) return jsonCors(req, { ok: false, error: "missing_body" }, 400);
  const to = (body.email ?? resolved.email ?? "").trim();
  if (!to) return jsonCors(req, { ok: false, error: "no_recipient_email" }, 400);

  const html = wrapWithSSignature(text);
  try {
    if (body.replyToMessageId) {
      await microsoft.sendReplyHtml({ messageId: body.replyToMessageId, html });
    } else {
      const subject = (body.subject ?? "").trim() || "Following up";
      await microsoft.sendMail({ to, subject, body: html, isHtml: true });
    }
    return jsonCors(req, { ok: true });
  } catch (e) {
    return jsonCors(req, { ok: false, error: e instanceof Error ? e.message : "send_failed" }, 502);
  }
}
