// The "20 Questions" lead magnet, delivered on opt-in.
//
// Links a statically hosted PDF rather than attaching bytes, the same call
// pdf-guide-email.ts makes. Sends through Microsoft Graph as matthew@srtagency.com.
// There is no Resend, SendGrid or SMTP anywhere in this codebase.
//
// THE MISSING-URL RULE. When MEDSPA_QUESTIONS_PDF_URL is unset the email still goes
// out, carrying the training link and no download button. It never renders a dead
// link. This is the guideCtaHtml() precedent in finish-report.ts: an unset env var
// must degrade to a missing CTA, not a 404 in a fulfillment email.

import { microsoft } from "@/lib/microsoft";
import { SIGNATURE_S_HTML } from "@/config/email-signature";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const GUIDE_SUBJECT = "The 20 questions your patients ask ChatGPT before they book";

function ctaBlock(pdfUrl: string): string {
  return `
    <p style="margin:0 0 12px">
      <a href="${pdfUrl}" style="display:inline-block;background:#00C9A7;color:#04252b;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:8px">Download the 20 questions (PDF)</a>
    </p>
    <p style="margin:0 0 24px;font-size:13px;color:#666666">If the button does not work, paste this into your browser:<br><a href="${pdfUrl}" style="color:#1B65A7">${pdfUrl}</a></p>
  `;
}

export interface GuideEmailParams {
  to: string;
  firstName?: string;
  /** Signed /training link. Omitted if the link secret is not configured. */
  trainingUrl?: string | null;
}

export async function sendMedspaGuideEmail({
  to,
  firstName,
  trainingUrl,
}: GuideEmailParams): Promise<{ sent: true; hadPdf: boolean }> {
  const pdfUrl = (process.env.MEDSPA_QUESTIONS_PDF_URL || "").trim();
  const hadPdf = Boolean(pdfUrl);

  if (!hadPdf) {
    console.warn(
      "[medspa/guide-email] MEDSPA_QUESTIONS_PDF_URL is not set. Sending the confirmation " +
        "with no download button rather than a dead link."
    );
  }

  const greeting = firstName ? escapeHtml(firstName) : "there";

  const trainingBlock = trainingUrl
    ? `
    <p style="margin:0 0 12px">Your training seat is ready too:</p>
    <p style="margin:0 0 24px">
      <a href="${trainingUrl}" style="color:#1B65A7;font-weight:600">Watch the training</a>
    </p>`
    : "";

  const body = `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#333333">
  <div style="background:#0B1426;padding:28px 24px;text-align:center">
    <span style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:0.5px">SRT Agency</span>
  </div>
  <div style="padding:32px 24px">
    <h2 style="color:#0B1426;margin:0 0 16px">The 20 questions</h2>
    <p style="margin:0 0 16px">Hi ${greeting},</p>
    <p style="margin:0 0 16px">Here are the 20 questions your patients are putting to ChatGPT before they ever land on your website.</p>
    ${hadPdf ? ctaBlock(pdfUrl) : `<p style="margin:0 0 24px">The PDF is on its way separately, we are finishing the final version now.</p>`}
    ${trainingBlock}
    <p style="margin:0 0 16px">Worth doing: pick three of them, ask ChatGPT yourself, and see whether your clinic gets named. Most owners are surprised.</p>
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
    subject: GUIDE_SUBJECT,
    body,
    isHtml: true,
    fromMailbox: process.env.OUTREACH_MAILBOX || "matthew@srtagency.com",
  });

  return { sent: true, hadPdf };
}
