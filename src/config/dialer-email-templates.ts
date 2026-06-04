// Full-HTML dialer email templates that are sent VERBATIM — no "Hello {name},"
// greeting and NO signature appended. The SRT Auto-Dialer (v22+) references
// these by key via the `template_key` field on /api/zoho/compose-email-approval.
//
// When a template_key matches one of these, the compose-email-approval route
// builds the approval-card payload with is_html:true and omits signature_name,
// so buildHtmlBody() (src/lib/ai-intel/execute-action.ts) returns the HTML
// untouched. The email is mailed exactly as defined here.

import { SIGNATURE_S_HTML } from "@/config/email-signature";

export interface FullHtmlEmailTemplate {
  subject: string;
  html: string;
}

// Resolve the Outlook "S" signature, preferring a runtime env override.
const SIG_S = process.env.SIGNATURE_S_HTML || SIGNATURE_S_HTML;

// The "Business loan Inquire (Next Steps)" email Matthew sends after a call:
// skyline banner → "Nice speaking with you!" → 2-minute application (Start Now,
// linking to srtagency.com/capital) → last 3 months of bank statements to
// matthew@srtagency.com → "funded in less than 24 hours" → "Best regards,".
// Sent verbatim — no greeting, no signature.
//
// NOTE: the skyline banner image was removed for now (per request). Add it back
// as an <img> at the top of the html when a hosted URL is available.
export const FULL_HTML_EMAIL_TEMPLATES: Record<string, FullHtmlEmailTemplate> = {
  "next-steps": {
    subject: "(Next Steps) Business loan Inquire",
    html: `<div style="font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;font-size:15px;line-height:1.5;max-width:640px;text-align:left;">
  <p style="margin:0 0 24px 0;text-align:left;font-size:16px;">Nice speaking with you!</p>
  <p style="margin:0 0 24px 0;text-align:left;">Please complete the following <strong>application &amp; Income Verification</strong>:</p>
  <p style="margin:0 0 16px 0;text-align:left;"><span style="background:#fff200;padding:2px 4px;line-height:1.8;">&rarr; 2-minute <strong>Funding</strong> application</span></p>
  <p style="margin:0 0 28px 0;text-align:left;">
    <a href="https://srtagency.com/capital" style="display:inline-block;background:#2ee6a8;color:#0d1b2a;text-decoration:none;font-weight:700;padding:10px 28px;border-radius:6px;">Start Now &#8594;</a>
  </p>
  <p style="margin:0 0 32px 0;text-align:left;"><span style="background:#fff200;padding:2px 4px;line-height:1.8;">&rarr; Last 3 months of <strong>business bank statements</strong> sent to <a href="mailto:matthew@srtagency.com">matthew@srtagency.com</a></span></p>
  <p style="margin:0 0 24px 0;text-align:left;">Once you send that over to me,<br>I can get you an approval and have you funded in less than 24 hours.</p>
  <p style="margin:0 0 24px 0;text-align:left;">Best regards,</p>
</div>
${SIG_S}`,
  },
};
