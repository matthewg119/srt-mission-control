// Full-HTML dialer email templates that are sent VERBATIM — no "Hello {name},"
// greeting and NO signature appended. The SRT Auto-Dialer (v22+) references
// these by key via the `template_key` field on /api/zoho/compose-email-approval.
//
// When a template_key matches one of these, the compose-email-approval route
// builds the approval-card payload with is_html:true and omits signature_name,
// so buildHtmlBody() (src/lib/ai-intel/execute-action.ts) returns the HTML
// untouched. The email is mailed exactly as defined here.

export interface FullHtmlEmailTemplate {
  subject: string;
  html: string;
}

// The "Business loan Inquire (Next Steps)" email Matthew sends after a call:
// skyline banner → "Nice speaking with you!" → 2-minute application (Start Now,
// linking to srtagency.com/capital) → last 3 months of bank statements to
// matthew@srtagency.com → "funded in less than 24 hours" → "Best regards,".
// Sent verbatim — no greeting, no signature.
//
// NOTE: TODO_SKYLINE_IMAGE_URL must be replaced with the real hosted skyline
// image URL from the original Outlook email before this renders correctly.
export const FULL_HTML_EMAIL_TEMPLATES: Record<string, FullHtmlEmailTemplate> = {
  "next-steps": {
    subject: "Business loan Inquire (Next Steps)",
    html: `<div style="font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;max-width:640px;">
  <p style="text-align:center;"><img src="TODO_SKYLINE_IMAGE_URL" alt="Miami skyline" width="560" style="max-width:100%;height:auto;border:0;border-radius:6px;" /></p>
  <p style="text-align:center;font-size:16px;">Nice speaking with you!</p>
  <p style="text-align:center;font-size:15px;">Please complete the following <strong>application &amp; Income Verification</strong>:</p>
  <p style="text-align:center;"><span style="background:#fff200;padding:2px 4px;">&rarr; 2-minute <strong>Funding</strong> application</span></p>
  <p style="text-align:center;">
    <a href="https://srtagency.com/capital" style="display:inline-block;background:#2ee6a8;color:#0d1b2a;text-decoration:none;font-weight:700;padding:10px 28px;border-radius:6px;">Start Now &#8594;</a>
  </p>
  <p style="text-align:center;"><span style="background:#fff200;padding:2px 4px;">&rarr; Last 3 months of <strong>business bank statements</strong> sent to <a href="mailto:matthew@srtagency.com">matthew@srtagency.com</a></span></p>
  <p style="text-align:center;font-size:15px;">Once you send that over to me, I can get you an approval and have you funded in less than 24 hours.</p>
  <p style="text-align:center;font-size:15px;">Best regards,</p>
</div>`,
  },
};
