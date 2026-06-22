import { microsoft } from "@/lib/microsoft";
import { SIGNATURE_S_HTML } from "@/config/email-signature";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// PDF-landing free-guide email. Sent from matthew@srtagency.com on first capture
// (10% block) when source === "pdf-landing", and again on demand via the
// /api/leads/resend-guide endpoint (the DNQ "Resend" button). Links to the
// static-hosted guide PDF rather than attaching bytes.
//
// TODO(pdf-guide): final PDF + body copy pending from the user (they will email
// the final guide + body to matthew@srtagency.com, subject "PDF"). Until then
// this uses the placeholder guide URL + the short body below.
export const PDF_GUIDE_URL =
  "https://srtagency.com/freeguide/Business_Owners_Guide_to_Funding_Without_a_Bank.pdf";

export async function sendPdfGuideEmail(to: string, firstName?: string, amountNeeded?: string): Promise<void> {
  const amount = typeof amountNeeded === "string" ? amountNeeded.trim() : "";
  const customLine = amount
    ? `I see you are looking for ${escapeHtml(amount)}, how soon do you need this?`
    : `How much funding are you looking for your business?`;
  const body = `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#333333">
  <div style="background:#0d1b2a;padding:28px 24px;text-align:center">
    <span style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:0.5px">SRT Agency</span>
  </div>
  <div style="padding:32px 24px">
    <h2 style="color:#0d1b2a;margin:0 0 16px">Your Free Funding Guide</h2>
    <p style="margin:0 0 16px">Hi ${firstName || "there"},</p>
    <p style="margin:0 0 16px">Thanks for your interest in business funding. As promised, here is your free guide:</p>
    <p style="margin:0 0 24px">
      <a href="${PDF_GUIDE_URL}" style="display:inline-block;background:#2ee6a8;color:#0d1b2a;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:6px">Download the Guide (PDF)</a>
    </p>
    <p style="margin:0 0 16px">If the button does not work, copy and paste this link into your browser:<br><a href="${PDF_GUIDE_URL}">${PDF_GUIDE_URL}</a></p>
    <p style="margin:0 0 24px">${customLine}</p>
    <p style="margin:0 0 16px">Best regards,</p>
    ${SIGNATURE_S_HTML}
  </div>
  <div style="background:#f5f5f5;padding:16px 24px;text-align:center;font-size:12px;color:#888888">
    <p style="margin:0">SRT Agency &mdash; Business Funding Solutions</p>
  </div>
</div>
  `;

  await microsoft.sendMail({
    to,
    subject: "(FREE PDF GUIDE) Business funding Inquire",
    body,
    isHtml: true,
    fromMailbox: "matthew@srtagency.com",
  });
}
