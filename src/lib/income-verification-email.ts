// Sends the branded "Income Verification" email (the app-no-statements dialer
// template, which embeds the Outlook "S" signature inline). Used by the
// 7-minute follow-up cron (/api/cron/income-verification-followup) and the
// admin test endpoint (/api/admin/send-income-verification-test).
//
// The template HTML already ends with ${SIG_S}, so we send it verbatim
// (isHtml: true) and the signature renders without any extra append step —
// the same path the dialer's send_now flow uses for full-HTML templates.

import { microsoft } from "@/lib/microsoft";
import { addNoteToLead } from "@/lib/zoho";
import { FULL_HTML_EMAIL_TEMPLATES } from "@/config/dialer-email-templates";

const TEMPLATE_KEY = "app-no-statements";

// Mirror the {{firstName}} substitution + escaping used in compose-email-approval.
function fillFirstName(html: string, firstName: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return html.replace(/\{\{\s*firstName\s*\}\}/g, esc(firstName));
}

export interface IncomeVerificationEmailResult {
  ok: boolean;
  error?: string;
  subject?: string;
}

/**
 * Returns the ready-to-send income-verification email content (subject + filled
 * HTML, signature already embedded). Shared by the auto-sender below and by the
 * inbound-bank-statements flow, which posts it as a GATED suggestion (Slack +
 * textwin.ai) rather than sending it directly. Returns null if the template is
 * missing.
 */
export function buildIncomeVerificationEmailContent(firstName?: string | null):
  | { subject: string; html: string }
  | null {
  const template = FULL_HTML_EMAIL_TEMPLATES[TEMPLATE_KEY];
  if (!template) return null;
  const name = (firstName ?? "").trim() || "there";
  return { subject: template.subject, html: fillFirstName(template.html, name) };
}

/**
 * Sends the income-verification email to `to`. Best-effort Zoho note when a
 * lead id is supplied. Never throws — returns { ok:false, error } on failure so
 * callers (cron loop / test endpoint) can record and continue.
 */
export async function sendIncomeVerificationEmail(opts: {
  to: string;
  firstName?: string | null;
  zohoLeadId?: string | null;
}): Promise<IncomeVerificationEmailResult> {
  if (!opts.to) return { ok: false, error: "missing_to" };

  const content = buildIncomeVerificationEmailContent(opts.firstName);
  if (!content) return { ok: false, error: `template_missing:${TEMPLATE_KEY}` };

  const firstName = (opts.firstName ?? "").trim() || "there";
  const template = { subject: content.subject };
  const html = content.html;

  try {
    await microsoft.sendMail({
      to: opts.to,
      subject: template.subject,
      body: html,
      isHtml: true,
    });
  } catch (e) {
    return { ok: false, error: (e as Error).message, subject: template.subject };
  }

  if (opts.zohoLeadId) {
    try {
      await addNoteToLead(
        opts.zohoLeadId,
        `Email sent — ${template.subject}`,
        `Automated income-verification follow-up sent to ${opts.to}${
          firstName !== "there" ? ` (${firstName})` : ""
        } from matthew@srtagency.com. Template: ${TEMPLATE_KEY}.`
      );
    } catch (e) {
      console.error("[income-verification-email] note write failed:", (e as Error).message);
    }
  }

  return { ok: true, subject: template.subject };
}
