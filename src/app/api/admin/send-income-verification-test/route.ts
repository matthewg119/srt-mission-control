export const dynamic = "force-dynamic";
// Send the branded income-verification email to an arbitrary address so we can
// confirm it renders WITH the Matthew Garcia "S" signature (like the decline
// email). This is the verification step for the 7-minute follow-up build.
//
// Hit with:  POST /api/admin/send-income-verification-test
//   Authorization: Bearer <CRON_SECRET>
//   (optional body) { "to": "...", "firstName": "..." }
//
// Defaults to chronos9d@gmail.com / "Chronos".

import { NextRequest, NextResponse } from "next/server";
import { sendIncomeVerificationEmail } from "@/lib/income-verification-email";

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

  const body = (await req.json().catch(() => ({}))) as { to?: string; firstName?: string };
  const to = body.to?.trim() || "chronos9d@gmail.com";
  const firstName = body.firstName?.trim() || "Chronos";

  const res = await sendIncomeVerificationEmail({ to, firstName });
  if (!res.ok) {
    return NextResponse.json({ ok: false, error: res.error }, { status: 502 });
  }
  return NextResponse.json({ ok: true, sent: true, to, subject: res.subject });
}
