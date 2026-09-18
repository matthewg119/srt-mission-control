// POST /api/notify/funnel — email relay for the srtagency.com funnel functions
// (/api/submit + /api/quiz-notify on the static site). Sends through the
// connected Microsoft 365 account (matthew@srtagency.com) via microsoft.sendMail,
// so the funnels need no email provider of their own.
//
// Auth: `x-funnel-secret` header must match FUNNEL_NOTIFY_SECRET (server-to-server
// only; no CORS on purpose). If the delegated Microsoft token has lapsed this
// returns 502 "Microsoft 365 not connected" — reconnect at /dashboard/integrations.

import { NextRequest, NextResponse } from "next/server";
import { microsoft } from "@/lib/microsoft";
import { supabaseAdmin } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // ~5MB per attachment (base64 length checked)

interface FunnelAttachment {
  filename?: string;
  contentBase64?: string;
  contentType?: string;
}

export async function POST(req: NextRequest) {
  const secret = process.env.FUNNEL_NOTIFY_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "relay_not_configured" }, { status: 503 });
  }
  if (req.headers.get("x-funnel-secret") !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: {
    to?: string | string[];
    subject?: string;
    text?: string;
    attachments?: FunnelAttachment[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400 });
  }

  const to = body.to;
  const subject = (body.subject || "").toString().slice(0, 300);
  const text = (body.text || "").toString().slice(0, 20000);
  const toList = (Array.isArray(to) ? to : [to]).filter(
    (t): t is string => typeof t === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t)
  );
  if (!toList.length || !subject || !text) {
    return NextResponse.json({ ok: false, error: "missing_fields" }, { status: 400 });
  }

  const attachments = (body.attachments || [])
    .filter(
      (a) =>
        a &&
        typeof a.contentBase64 === "string" &&
        a.contentBase64.length > 0 &&
        a.contentBase64.length <= (MAX_ATTACHMENT_BYTES * 4) / 3
    )
    .map((a) => ({
      name: (a.filename || "attachment.pdf").toString().slice(0, 120),
      contentType: (a.contentType || "application/pdf").toString().slice(0, 100),
      contentBytes: a.contentBase64 as string,
    }));

  const attachmentBytes = attachments.reduce(
    (n, a) => n + Math.floor((a.contentBytes.length * 3) / 4),
    0
  );

  try {
    await microsoft.sendMail({
      to: toList,
      subject,
      body: text,
      isHtml: false,
      attachments: attachments.length ? attachments : undefined,
      // no fromMailbox -> sends as the connected account (matthew@srtagency.com)
    });
    await logSend(toList, subject, attachments.length > 0, attachmentBytes, "sent");
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("notify/funnel: sendMail failed:", msg);
    await logSend(toList, subject, attachments.length > 0, attachmentBytes, "failed", msg);
    return NextResponse.json({ ok: false, error: msg.slice(0, 300) }, { status: 502 });
  }
}

/**
 * Record the send. ‼️ THIS IS OUR SIDE ONLY, AND IT NEVER BECOMES DELIVERY CONFIRMATION.
 * Graph /sendMail answers 202 with an empty body, so there is no message id to keep, and
 * Microsoft pushes no bounce or complaint events. A row saying "sent" means Graph accepted
 * it, not that anyone received it. Delivery still lives in message trace.
 *
 * WHY IT EXISTS. This route is the public email relay for srtagency.com, and on 2026-09-18 a
 * script drove /api/invisible-lead through it to mail thirteen strangers. When the question
 * became "who did we mail, and did any of it bounce", nothing anywhere could answer, and the
 * reconstruction was reading Sent Items by hand. The subject line identifies the calling
 * route on its own, so nothing upstream had to change to make this useful.
 *
 * ‼️ IT MUST NEVER CHANGE WHAT THE CALLER SEES. The mail has already gone by the time this
 * runs; a logging failure is a logging failure, not a failed send. Hence its own try/catch,
 * and hence the caller getting its answer either way.
 *
 * No caller IP is recorded on purpose: this is called server to server from a Vercel lambda,
 * so the only address visible here is our own. The abuser's IP is in srt-agwb's function logs.
 */
async function logSend(
  recipients: string[],
  subject: string,
  hasAttachment: boolean,
  attachmentBytes: number,
  status: "sent" | "failed",
  error?: string
): Promise<void> {
  try {
    const { error: dbErr } = await supabaseAdmin.from("funnel_relay_sends").insert({
      recipients,
      subject,
      has_attachment: hasAttachment,
      attachment_bytes: attachmentBytes,
      status,
      error: error ? error.slice(0, 1000) : null,
    });
    if (dbErr) console.error("notify/funnel: send log failed:", dbErr.message);
  } catch (err) {
    console.error("notify/funnel: send log threw:", err instanceof Error ? err.message : err);
  }
}
