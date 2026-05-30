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
import { getLead } from "@/lib/zoho";
import { postApprovalRequest } from "@/lib/ai-intel/slack-approval";
import type { PendingActionPayload } from "@/lib/ai-intel/types";

export const runtime = "nodejs";
export const maxDuration = 30;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
  return header === `Bearer ${secret}`;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    zoho_lead_id?: string;
    subject?: string;
    copy?: string;
  };

  const { zoho_lead_id, subject, copy } = body;
  if (!zoho_lead_id || !subject || !copy) {
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

  // Email body: greeting is always prepended; the S signature is appended at
  // send time by buildHtmlBody (signature_name: "S").
  const emailBody = `Hello ${firstName},\n\n${copy}`;

  // Everything past Zoho is wrapped so any Supabase/Slack failure returns a
  // readable JSON error instead of a 500 HTML page (which the extension can
  // only render as a generic "compose_failed").
  try {
    // Resolve the lead's per-lead Slack channel (contacts → sms_conversations).
    // If none, postApprovalRequest routes to the default working-leads channel.
    let channel: string | undefined;
    const { data: contact } = await supabaseAdmin
      .from("contacts")
      .select("id")
      .eq("zoho_lead_id", zoho_lead_id)
      .maybeSingle();
    if (contact?.id) {
      const { data: conv } = await supabaseAdmin
        .from("sms_conversations")
        .select("slack_channel_id")
        .eq("contact_id", contact.id)
        .not("slack_channel_id", "is", null)
        .maybeSingle();
      channel = (conv?.slack_channel_id as string | undefined) ?? undefined;
    }

    const payload: PendingActionPayload = {
      action_type: "send_email",
      to: email,
      subject,
      body: emailBody,
      is_html: false,
      zoho_id: zoho_lead_id,
      contact_id: contact?.id ?? undefined,
      signature_name: "S",
      note: {
        title: "Email sent",
        content: `Email sent successfully from matthew@srtagency.com — Subject: ${subject}`,
      },
    };

    const summary = [
      `*To:* ${email}`,
      `*Subject:* ${subject}`,
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
