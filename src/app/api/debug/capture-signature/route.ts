export const dynamic = "force-dynamic";
// One-time capture: extract an Outlook signature's HTML from a real message.
// Microsoft Graph does not expose Outlook signatures, so to capture the "S"
// signature: compose a NEW mail in Outlook-on-the-web (the default signature
// auto-inserts into an empty body), send it to yourself with a known subject,
// then call this endpoint to read the HTML back.
//
//   GET /api/debug/capture-signature?subject=SIG_S
//   Auth: Authorization: Bearer <CRON_SECRET>
//
// Returns the raw HTML so it can be pasted into SIGNATURE_S_HTML
// (src/config/email-signature.ts).

import { NextRequest, NextResponse } from "next/server";
import { microsoft } from "@/lib/microsoft";

export const runtime = "nodejs";

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
  return header === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const subject = req.nextUrl.searchParams.get("subject") || "SIG_S";

  const match = await microsoft
    .getLatestHtmlBySubject(subject)
    .catch((e) => ({ error: (e as Error).message }) as { error: string });

  if (match && "error" in match) {
    return NextResponse.json({ ok: false, subject, error: match.error }, { status: 500 });
  }
  if (!match) {
    return NextResponse.json(
      { ok: false, subject, error: `no_message_found_with_subject:${subject}` },
      { status: 404 }
    );
  }

  return NextResponse.json({
    ok: true,
    subject,
    message: { id: match.id, subject: match.subject, receivedDateTime: match.receivedDateTime },
    html_length: match.html.length,
    html: match.html,
  });
}
