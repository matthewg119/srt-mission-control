export const dynamic = "force-dynamic";
// Drains textwin.ai's email_outbox: sends 'pending' rows via Graph (from Matthew's
// mailbox, "S" signature appended), marks them 'sent', and logs the outbound
// email_message echo so it shows in the lead's unified chat. Mirrors the
// sms_outbox → Mac-bridge pattern, but Mission Control owns the send here.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { microsoft } from "@/lib/microsoft";
import { SIGNATURE_S_HTML } from "@/config/email-signature";

export const runtime = "nodejs";
export const maxDuration = 120;

const LEADS_MAILBOX = process.env.LEADS_MAILBOX || "matthew@srtagency.com";

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

// Plain body → branded HTML with the "S" signature. HTML bodies (e.g. a Vektor
// template that already embeds the signature) are sent verbatim.
function toHtml(body: string, isHtml: boolean): string {
  if (isHtml) return body;
  const sig = process.env.SIGNATURE_S_HTML || SIGNATURE_S_HTML;
  const htmlBody = body
    .split("\n")
    .map((line) =>
      line.trim() === ""
        ? "<br>"
        : `<p style="margin:0 0 8px 0;">${line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`,
    )
    .join("");
  return `${htmlBody}<br><br>${sig}`;
}

async function resolveConversationId(row: {
  conversation_id: string | null;
  contact_id: string | null;
  to_address: string;
}): Promise<string | null> {
  if (row.conversation_id) return row.conversation_id;
  if (!row.contact_id) return null;
  const { data: existing } = await supabaseAdmin
    .from("email_conversations")
    .select("id")
    .eq("contact_id", row.contact_id)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (existing?.id) return existing.id as string;
  const { data: created } = await supabaseAdmin
    .from("email_conversations")
    .insert({ contact_id: row.contact_id, participant_email: row.to_address, last_message_at: new Date().toISOString() })
    .select("id")
    .maybeSingle();
  return (created?.id as string) ?? null;
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: rows } = await supabaseAdmin
    .from("email_outbox")
    .select("id, conversation_id, contact_id, to_address, cc, subject, body, is_html, reply_to_graph_message_id, attempts")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(25);

  const results: Array<Record<string, unknown>> = [];
  for (const row of rows ?? []) {
    try {
      const html = toHtml(row.body as string, !!row.is_html);
      await microsoft.sendMail({
        to: row.to_address as string,
        subject: row.subject as string,
        body: html,
        isHtml: true,
        fromMailbox: LEADS_MAILBOX,
      });

      const nowIso = new Date().toISOString();
      await supabaseAdmin.from("email_outbox").update({ status: "sent", sent_at: nowIso }).eq("id", row.id);

      // Log the outbound echo into the lead's email thread.
      const conversationId = await resolveConversationId({
        conversation_id: (row.conversation_id as string | null) ?? null,
        contact_id: (row.contact_id as string | null) ?? null,
        to_address: row.to_address as string,
      });
      if (conversationId) {
        await supabaseAdmin.from("email_messages").insert({
          conversation_id: conversationId,
          direction: "outbound",
          subject: row.subject as string,
          html_body: html,
          text_preview: (row.body as string).slice(0, 240),
          from_address: LEADS_MAILBOX,
          to_addresses: [row.to_address as string],
          sent_at: nowIso,
        });
        await supabaseAdmin.from("email_conversations").update({ last_message_at: nowIso }).eq("id", conversationId);
      }
      results.push({ id: row.id, sent: true });
    } catch (e) {
      await supabaseAdmin
        .from("email_outbox")
        .update({ status: "failed", error: (e as Error).message, attempts: ((row.attempts as number) ?? 0) + 1 })
        .eq("id", row.id);
      results.push({ id: row.id, error: (e as Error).message });
    }
  }

  return NextResponse.json({ ok: true, drained: results.length, results });
}

export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}
