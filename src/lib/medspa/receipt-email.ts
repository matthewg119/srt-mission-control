// The $39 receipt.
//
// It used to carry the single-use OTO token, which was the only place that plaintext
// ever existed outside the address bar. The OTO is gone: the subscription is now sold
// from /get-named after the free training, so this email's job is simply to confirm
// the charge and hand them the training link.
//
// The training link IS a bearer credential (HMAC over the opt-in id), but unlike the
// OTO it never expires and is not single use, so it is safe to sit in an inbox.

import { microsoft } from "@/lib/microsoft";
import { SIGNATURE_S_HTML } from "@/config/email-signature";
import { dollars } from "@/config/medspa-funnel";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface ReceiptParams {
  to: string;
  firstName?: string | null;
  clinicWebsite: string;
  amountCents: number;
  /** Signed /training URL. Null renders no button rather than a dead link. */
  trainingUrl: string | null;
}

export async function sendMedspaReceipt({
  to,
  firstName,
  clinicWebsite,
  amountCents,
  trainingUrl,
}: ReceiptParams): Promise<void> {
  // Same missing-URL rule as the guide email: an unset or unsignable link degrades to
  // no CTA block, never to a 404 in a paid receipt.
  const trainingBlock = trainingUrl
    ? `
    <hr style="border:0;border-top:1px solid #e5e5e5;margin:24px 0">
    <p style="margin:0 0 12px">While it runs, watch the training. It explains what the scorecard is about to show you.</p>
    <p style="margin:0 0 24px">
      <a href="${trainingUrl}" style="display:inline-block;background:#00C9A7;color:#04252b;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:8px">Watch the training</a>
    </p>`
    : "";

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
    ${trainingBlock}
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
