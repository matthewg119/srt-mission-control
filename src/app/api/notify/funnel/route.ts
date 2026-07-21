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

  try {
    await microsoft.sendMail({
      to: toList,
      subject,
      body: text,
      isHtml: false,
      attachments: attachments.length ? attachments : undefined,
      // no fromMailbox -> sends as the connected account (matthew@srtagency.com)
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("notify/funnel: sendMail failed:", msg);
    return NextResponse.json({ ok: false, error: msg.slice(0, 300) }, { status: 502 });
  }
}
