// "You have $39 unused in your cart" — ONE email, once ever, 18 days after the audit.
//
// Modelled on src/lib/statements-finish-app-followup.ts, which is the closest
// existing scan-and-send-once job.
//
// TWO things make it fire exactly once:
//   1. A BOUNDED window, not "older than 18 days". Without an upper bound, the first
//      run after any outage would blast every historical buyer at once.
//   2. STAMP BEFORE SEND, as a conditional UPDATE on `credit_reminder_sent_at is
//      null` that returns the row. Two overlapping ticks cannot both win it. The
//      stamp is put back if Graph throws, so a failure stays retryable.

import { supabaseAdmin } from "@/lib/db";
import { microsoft } from "@/lib/microsoft";
import { SIGNATURE_S_HTML } from "@/config/email-signature";
import { signAccess, isLinkSecretConfigured } from "@/lib/medspa/links";
import { dollars, funnelUrl, PRICES } from "@/config/medspa-funnel";

const DELAY_DAYS = 18;
/** Upper bound on the window. A row older than this is left alone forever. */
const MAX_AGE_DAYS = 25;
const BATCH = 25;

export const CREDIT_REMINDER_SUBJECT = "You have $39 unused in your cart";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Under 80 words, on purpose.
 *
 * The credit, one link, nothing else. No urgency language, no countdown, no second
 * offer: this is a reminder that money is already theirs, and dressing it up as a
 * deadline would make it read like every other cart email.
 */
function buildBody(firstName: string, getNamedUrl: string): string {
  return `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#333333">
  <div style="background:#0a0a0a;padding:28px 24px;text-align:center">
    <span style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:0.5px">SRT Agency</span>
  </div>
  <div style="padding:32px 24px">
    <p style="margin:0 0 16px">Hi ${escapeHtml(firstName || "there")},</p>
    <p style="margin:0 0 16px">Your ${dollars(PRICES.audit)} audit comes off your first month whenever you decide to start. It is still sitting there.</p>
    <p style="margin:0 0 24px">
      <a href="${getNamedUrl}" style="display:inline-block;background:#00C9A7;color:#04252b;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:8px">Use the ${dollars(PRICES.audit)} credit</a>
    </p>
    <p style="margin:0 0 16px">Best,</p>
    ${SIGNATURE_S_HTML}
  </div>
  <div style="background:#f5f5f5;padding:16px 24px;text-align:center;font-size:12px;color:#888888">
    <p style="margin:0">SRT Agency LLC, Search Retrieval Tactics</p>
  </div>
</div>
  `;
}

export interface ReminderResult {
  checked: number;
  sent: number;
  skipped: number;
}

export async function runDueCreditReminders(dry = false): Promise<ReminderResult> {
  if (!isLinkSecretConfigured()) {
    console.warn("[medspa/credit-reminder] MEDSPA_LINK_SECRET unset, cannot sign links. Skipping.");
    return { checked: 0, sent: 0, skipped: 0 };
  }

  const now = Date.now();
  const windowEnd = new Date(now - DELAY_DAYS * 86_400_000).toISOString();
  const windowStart = new Date(now - MAX_AGE_DAYS * 86_400_000).toISOString();

  // Paid audits in the window. The subscription check is done per-row below rather
  // than as a join, because PostgREST cannot express "no matching row in that table".
  const { data: orders } = await supabaseAdmin
    .from("medspa_orders")
    .select("id, email, name, optin_id, paid_at")
    .eq("status", "paid")
    .gte("paid_at", windowStart)
    .lte("paid_at", windowEnd)
    .limit(BATCH);

  const rows = orders ?? [];
  let sent = 0;
  let skipped = 0;

  for (const order of rows) {
    const email = order.email as string;
    const optinId = (order.optin_id as string | null) ?? null;

    // No opt-in row means nothing to stamp and no way to sign a link. Skip rather
    // than invent an unsigned URL.
    if (!optinId) {
      skipped++;
      continue;
    }

    // Suppress if they already subscribed. Checked live rather than trusted from a
    // cached flag, because the whole point of the email is that they have not.
    const { data: sub } = await supabaseAdmin
      .from("medspa_subscriptions")
      .select("id")
      .eq("email", email)
      .in("status", ["active", "trialing", "past_due", "incomplete"])
      .limit(1)
      .maybeSingle();

    if (sub) {
      // Stamp it so the scan stops reconsidering this row every day forever.
      await supabaseAdmin
        .from("medspa_optins")
        .update({ credit_reminder_sent_at: new Date().toISOString() })
        .eq("id", optinId)
        .is("credit_reminder_sent_at", null);
      skipped++;
      continue;
    }

    if (dry) {
      skipped++;
      continue;
    }

    // ── THE CLAIM ──
    // Null -> now(), returning the row. Exactly one tick can win it.
    const { data: claimed } = await supabaseAdmin
      .from("medspa_optins")
      .update({ credit_reminder_sent_at: new Date().toISOString() })
      .eq("id", optinId)
      .is("credit_reminder_sent_at", null)
      .select("id, email, name")
      .maybeSingle();

    if (!claimed) {
      skipped++;
      continue;
    }

    const firstName = (((claimed.name as string) ?? (order.name as string)) ?? "").split(/\s+/)[0] ?? "";
    const url = funnelUrl(`/get-named?k=${encodeURIComponent(signAccess(optinId))}`);

    try {
      await microsoft.sendMail({
        to: (claimed.email as string) || email,
        subject: CREDIT_REMINDER_SUBJECT,
        body: buildBody(firstName, url),
        isHtml: true,
        fromMailbox: process.env.OUTREACH_MAILBOX || "matthew@srtagency.com",
      });
      sent++;
    } catch (e) {
      console.error("[medspa/credit-reminder] send failed:", (e as Error).message);
      // Put it back so the failure is retryable rather than silently swallowed.
      await supabaseAdmin
        .from("medspa_optins")
        .update({ credit_reminder_sent_at: null })
        .eq("id", optinId);
      skipped++;
    }
  }

  return { checked: rows.length, sent, skipped };
}
