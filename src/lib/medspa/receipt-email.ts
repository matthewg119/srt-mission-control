// The $39 receipt, which is also how the OTO link survives a closed tab.
//
// The OTO URL is a bearer credential, so this email is the ONLY place the plaintext
// token is persisted anywhere outside the browser's address bar (the database stores
// only its SHA-256). That is deliberate, and it is why the link expires.

import { microsoft } from "@/lib/microsoft";
import { SIGNATURE_S_HTML } from "@/config/email-signature";
import { dollars, funnelUrl, PRICES } from "@/config/medspa-funnel";
import { otoTtlMinutes } from "@/lib/medspa/oto";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function otoUrlFor(token: string): string {
  return funnelUrl(`/oto/${encodeURIComponent(token)}`);
}

export interface ReceiptParams {
  to: string;
  firstName?: string | null;
  clinicWebsite: string;
  amountCents: number;
  otoToken: string;
}

export async function sendMedspaReceipt({
  to,
  firstName,
  clinicWebsite,
  amountCents,
  otoToken,
}: ReceiptParams): Promise<void> {
  const body = `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#333333">
  <div style="background:#0B1426;padding:28px 24px;text-align:center">
    <span style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:0.5px">SRT Agency</span>
  </div>
  <div style="padding:32px 24px">
    <h2 style="color:#0B1426;margin:0 0 16px">Your audit is running</h2>
    <p style="margin:0 0 16px">Hi ${escapeHtml(firstName || "there")},</p>
    <p style="margin:0 0 16px">Thanks. We are putting all 20 questions to ChatGPT for ${escapeHtml(clinicWebsite)} right now, and the scorecard follows by email.</p>
    <p style="margin:0 0 20px"><strong>Paid today: ${dollars(amountCents)}</strong></p>
    <hr style="border:0;border-top:1px solid #e5e5e5;margin:24px 0">
    <p style="margin:0 0 12px">While it runs, there is one thing on the table for you and it is time limited:</p>
    <p style="margin:0 0 20px">
      <a href="${otoUrlFor(otoToken)}" style="display:inline-block;background:#00C9A7;color:#04252b;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:8px">See the founding offer</a>
    </p>
    <p style="margin:0 0 24px;font-size:13px;color:#666666">This link is personal to you, works once, and expires in ${otoTtlMinutes()} minutes. After that the founding rate of ${dollars(PRICES.founding)} a month is gone.</p>
    <p style="margin:0 0 16px">Best,</p>
    ${SIGNATURE_S_HTML}
  </div>
  <div style="background:#f5f5f5;padding:16px 24px;text-align:center;font-size:12px;color:#888888">
    <p style="margin:0">SRT Agency LLC, Search Retrieval Tactics</p>
    <p style="margin:8px 0 0">Nothing here is medical advice.</p>
  </div>
</div>
  `;

  await microsoft.sendMail({
    to,
    subject: "Your AI Visibility Audit is running",
    body,
    isHtml: true,
    fromMailbox: process.env.OUTREACH_MAILBOX || "matthew@srtagency.com",
  });
}
