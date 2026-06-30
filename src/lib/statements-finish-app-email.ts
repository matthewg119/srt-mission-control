// Sends the "your bank statements are in — finish your application" email (the
// statements-no-app dialer template, which embeds the Outlook "S" signature
// inline and links to srtagency.com/fullapp). Used by the 30-minute follow-up
// cron (/api/cron/statements-finish-app-followup).
//
// The template HTML already ends with ${SIG_S}, so we send it verbatim
// (isHtml: true) — no extra signature append, same path the dialer uses.

import { microsoft } from "@/lib/microsoft";
import { addNoteToLead } from "@/lib/zoho";
import { FULL_HTML_EMAIL_TEMPLATES } from "@/config/dialer-email-templates";

const TEMPLATE_KEY = "statements-no-app";

function fillFirstName(html: string, firstName: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return html.replace(/\{\{\s*firstName\s*\}\}/g, esc(firstName));
}

export interface StatementsFinishAppEmailResult {
  ok: boolean;
  error?: string;
  subject?: string;
}

/**
 * Returns the ready-to-send "finish your application" email content (subject +
 * filled HTML, signature already embedded). Returns null if the template is
 * missing.
 */
export function buildStatementsFinishAppEmailContent(firstName?: string | null):
  | { subject: string; html: string }
  | null {
  const template = FULL_HTML_EMAIL_TEMPLATES[TEMPLATE_KEY];
  if (!template) return null;
  const name = (firstName ?? "").trim() || "there";
  return { subject: template.subject, html: fillFirstName(template.html, name) };
}

/**
 * Sends the finish-application email to `to`. Best-effort Zoho note when a lead
 * id is supplied. Never throws — returns { ok:false, error } on failure so the
 * cron loop can record and continue.
 */
export async function sendStatementsFinishAppEmail(opts: {
  to: string;
  firstName?: string | null;
  zohoLeadId?: string | null;
}): Promise<StatementsFinishAppEmailResult> {
  if (!opts.to) return { ok: false, error: "missing_to" };

  const content = buildStatementsFinishAppEmailContent(opts.firstName);
  if (!content) return { ok: false, error: `template_missing:${TEMPLATE_KEY}` };

  const firstName = (opts.firstName ?? "").trim() || "there";

  try {
    await microsoft.sendMail({
      to: opts.to,
      subject: content.subject,
      body: content.html,
      isHtml: true,
    });
  } catch (e) {
    return { ok: false, error: (e as Error).message, subject: content.subject };
  }

  if (opts.zohoLeadId) {
    try {
      await addNoteToLead(
        opts.zohoLeadId,
        `Email sent — ${content.subject}`,
        `Automated finish-application follow-up sent to ${opts.to}${
          firstName !== "there" ? ` (${firstName})` : ""
        } from matthew@srtagency.com after bank statements were received. Template: ${TEMPLATE_KEY}.`
      );
    } catch (e) {
      console.error("[statements-finish-app-email] note write failed:", (e as Error).message);
    }
  }

  return { ok: true, subject: content.subject };
}
