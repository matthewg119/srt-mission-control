export const dynamic = "force-dynamic";
// Dialer email composer → Slack approval card.
// Called by the SRT Auto-Dialer Chrome extension (v22). Matthew picks a template
// or types custom copy in the dialer; this endpoint builds the full email
// ("Hello {firstName}," + copy + Outlook "S" signature appended at send) and
// posts a Vektor 👍/✏️/🚫 card into the lead's Slack channel. He confirms with
// 👍 and the existing send_email pipeline mails it from matthew@srtagency.com
// and writes a Zoho note.
//
// POST body: { zoho_lead_id, subject, copy }

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { getLead, addNoteToLead } from "@/lib/zoho";
import { postApprovalRequest } from "@/lib/ai-intel/slack-approval";
import { executePendingAction } from "@/lib/ai-intel/execute-action";
import { VEKTOR_CHANNELS } from "@/config/vektor";
import { FULL_HTML_EMAIL_TEMPLATES } from "@/config/dialer-email-templates";
import type { PendingActionPayload } from "@/lib/ai-intel/types";

export const runtime = "nodejs";
export const maxDuration = 30;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
  return header === `Bearer ${secret}`;
}

// Fill the {{firstName}} / {{customLine}} placeholders in a verbatim full-HTML
// template. {{customLine}} is the dialer's edited custom-intro copy (scaling-intro);
// templates without these tokens pass through unchanged.
function fillTokens(html: string, firstName: string, customLine?: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return html
    .replace(/\{\{\s*firstName\s*\}\}/g, esc(firstName))
    .replace(/\{\{\s*customLine\s*\}\}/g, customLine ? esc(customLine) : "");
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    zoho_lead_id?: string;
    subject?: string;
    copy?: string;
    template_key?: string;
    send_now?: boolean;
  };

  const { zoho_lead_id, subject, copy, template_key, send_now } = body;

  // Full-HTML templates (e.g. "next-steps") are sent verbatim — no greeting,
  // no signature. They only need a zoho_lead_id; subject + body come from the
  // stored template, so the dialer's textarea copy is ignored.
  const fullHtmlTemplate = template_key ? FULL_HTML_EMAIL_TEMPLATES[template_key] : undefined;

  if (!zoho_lead_id) {
    return NextResponse.json({ error: "missing zoho_lead_id" }, { status: 400 });
  }
  if (!fullHtmlTemplate && (!subject || !copy)) {
    return NextResponse.json({ error: "missing zoho_lead_id, subject, or copy" }, { status: 400 });
  }

  // Fetch lead email + first name from Zoho
  let zohoLead;
  try {
    zohoLead = await getLead(zoho_lead_id);
  } catch (err) {
    return NextResponse.json({ error: `zoho_fetch_failed: ${(err as Error).message}` }, { status: 500 });
  }

  const email = (zohoLead.Email ?? "") as string;
  const firstName = ((zohoLead.First_Name ?? "") as string).trim() || "there";
  if (!email) {
    return NextResponse.json({ error: "no_email_on_lead" }, { status: 422 });
  }

  // Email body: for normal templates the greeting is prepended and the S
  // signature is appended at send time by buildHtmlBody (signature_name: "S").
  // Full-HTML templates skip both — they're sent exactly as stored.
  const emailSubject = fullHtmlTemplate ? fullHtmlTemplate.subject : (subject as string);
  const emailBody = fullHtmlTemplate
    ? fillTokens(fullHtmlTemplate.html, firstName, copy)
    : `Hello ${firstName},\n\n${copy}`;

  // Everything past Zoho is wrapped so any Supabase/Slack failure returns a
  // readable JSON error instead of a 500 HTML page (which the extension can
  // only render as a generic "compose_failed").
  try {
    // Look up the contact only for contact_id / merchant linkage on the payload.
    const { data: contact } = await supabaseAdmin
      .from("contacts")
      .select("id")
      .eq("zoho_lead_id", zoho_lead_id)
      .maybeSingle();

    // Dialer email-approval cards post to #vektor-email-director (not the lead's
    // hot-leads channel). If SLACK_VEKTOR_EMAIL_DIRECTOR_CHANNEL isn't set,
    // postApprovalRequest falls back via the working_lead category.
    const channel: string | undefined = VEKTOR_CHANNELS.emailDirector || undefined;

    // Tracking note: who got which template. Logged to the Zoho lead so every
    // send is auditable from the CRM timeline.
    const templateLabel = template_key || "custom copy";
    const noteTitle = `Email sent — ${emailSubject}`;
    const noteContent = `Sent to ${email}${firstName !== "there" ? ` (${firstName})` : ""} from matthew@srtagency.com. Template: ${templateLabel}. Subject: "${emailSubject}".`;

    const payload: PendingActionPayload = {
      action_type: "send_email",
      to: email,
      subject: emailSubject,
      body: emailBody,
      // Full-HTML templates send verbatim (is_html:true → no greeting/signature);
      // normal templates send plain text with the "S" signature appended.
      is_html: !!fullHtmlTemplate,
      zoho_id: zoho_lead_id,
      contact_id: contact?.id ?? undefined,
      ...(fullHtmlTemplate ? {} : { signature_name: "S" }),
      note: { title: noteTitle, content: noteContent },
    };

    // Direct send (dialer default): skip the Slack 👍 round-trip and mail the
    // email immediately via the same executor the Slack approval would have run.
    // The tracking note is written here (not inside sendEmail) so we can report
    // back whether it landed in Zoho — payload.note is dropped to avoid a double note.
    if (send_now) {
      const result = await executePendingAction({
        actionId: "dialer-direct",
        actionType: "send_email",
        payload: { ...payload, note: undefined },
        approvedBy: "dialer",
      });
      if (!result.ok) {
        return NextResponse.json({ error: result.error || "send_failed" }, { status: 502 });
      }

      let noteWritten = false;
      let noteError: string | undefined;
      try {
        await addNoteToLead(zoho_lead_id, noteTitle, noteContent);
        noteWritten = true;
      } catch (e) {
        noteError = (e as Error).message;
        console.error("[compose-email-approval] note write failed:", noteError);
      }

      return NextResponse.json({ ok: true, sent: true, to: email, template: templateLabel, note_written: noteWritten, note_error: noteError });
    }

    const summary = fullHtmlTemplate
      ? [
          `*To:* ${email}`,
          `*Subject:* ${emailSubject}`,
          ``,
          `*Sends the branded "Next Steps" email (verbatim — no signature).*`,
        ].join("\n")
      : [
          `*To:* ${email}`,
          `*Subject:* ${emailSubject}`,
          ``,
          "```",
          `Hello ${firstName},`,
          ``,
          copy,
          "```",
          `_+ your Outlook "S" signature (appended on send)_`,
        ].join("\n");

    const res = await postApprovalRequest({
      summary,
      payload,
      channel,
      category: "working_lead",
      zohoId: zoho_lead_id,
      merchantId: contact?.id ?? undefined,
    });

    if (!res.slackTs) {
      return NextResponse.json({ error: res.skipped || "slack_post_failed" }, { status: 502 });
    }

    return NextResponse.json({ ok: true, channel: res.channel, ts: res.slackTs });
  } catch (err) {
    console.error("[compose-email-approval] failed:", (err as Error).message);
    return NextResponse.json({ error: `compose_error: ${(err as Error).message}` }, { status: 500 });
  }
}
