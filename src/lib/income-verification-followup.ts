// 7-minute Income-Verification follow-up runner.
//
// Emails the branded income-verification email to any lead who reached income
// verification ~7 minutes ago and still has NO bank statements on file. If the
// file is already complete (Plaid verified or statements uploaded/analyzed),
// the lead is skipped.
//
// Clock: contacts.income_verification_prompted_at is stamped by the portal when
// a lead first lands on the income-verification step (or submits the app) with
// no statements. Dedupe: contacts.income_verification_followup_sent_at.
//
// Invoked by /api/cron/income-verification-followup (daily backup + external
// pinger) and the Mac-bridge outbox poll (~10s, the real-time trigger, since
// the Vercel account is on Hobby = daily-only crons).

import { supabaseAdmin } from "@/lib/db";
import { sendIncomeVerificationEmail } from "@/lib/income-verification-email";

const FOLLOWUP_DELAY_MS = 7 * 60 * 1000;       // 7 minutes
const FOLLOWUP_MAX_AGE_MS = 60 * 60 * 1000;     // 60 minutes — don't chase stale rows

interface Candidate {
  id: string;
  email: string | null;
  first_name: string | null;
  zoho_lead_id: string | null;
  portal_statements_uploaded: boolean | null;
  plaid_verified: boolean | null;
  bank_statement_analysis_status: string | null;
  statement_months_covered: string[] | null;
}

// Same "has statements" logic the portal uses in api/leads/me/route.ts.
function hasStatements(c: Candidate): boolean {
  if (c.portal_statements_uploaded === true) return true;
  if (c.plaid_verified === true) return true;
  if (c.bank_statement_analysis_status === "analyzed") return true;
  if (Array.isArray(c.statement_months_covered) && c.statement_months_covered.length >= 3) return true;
  return false;
}

export interface FollowupRunResult {
  checked: number;
  sent: number;
  results: Array<{ id: string; status: string; reason?: string }>;
}

/**
 * Scans for due income-verification follow-ups and emails them. Stamps
 * income_verification_followup_sent_at BEFORE sending so overlapping ticks
 * can't double-send. Safe to call from a cron or a polling loop.
 */
export async function runDueIncomeVerificationFollowups(): Promise<FollowupRunResult> {
  const now = Date.now();
  const windowStart = new Date(now - FOLLOWUP_MAX_AGE_MS).toISOString();
  const windowEnd = new Date(now - FOLLOWUP_DELAY_MS).toISOString();

  const { data, error } = await supabaseAdmin
    .from("contacts")
    .select(
      "id, email, first_name, zoho_lead_id, portal_statements_uploaded, plaid_verified, bank_statement_analysis_status, statement_months_covered"
    )
    .is("income_verification_followup_sent_at", null)
    .gte("income_verification_prompted_at", windowStart)
    .lte("income_verification_prompted_at", windowEnd)
    .not("email", "is", null)
    .limit(50);

  if (error) {
    console.error("[income-verif-followup] query failed:", error.message);
    throw new Error(error.message);
  }

  const candidates = (data ?? []) as Candidate[];
  const results: FollowupRunResult["results"] = [];

  for (const c of candidates) {
    if (!c.email) {
      results.push({ id: c.id, status: "skipped", reason: "no_email" });
      continue;
    }
    if (hasStatements(c)) {
      // File already complete — disregard, but stamp so we stop scanning it.
      await supabaseAdmin
        .from("contacts")
        .update({ income_verification_followup_sent_at: new Date().toISOString() })
        .eq("id", c.id);
      results.push({ id: c.id, status: "skipped", reason: "has_statements" });
      continue;
    }

    // Stamp first to prevent a double-send on an overlapping tick.
    await supabaseAdmin
      .from("contacts")
      .update({ income_verification_followup_sent_at: new Date().toISOString() })
      .eq("id", c.id);

    const res = await sendIncomeVerificationEmail({
      to: c.email,
      firstName: c.first_name,
      zohoLeadId: c.zoho_lead_id,
    });

    if (res.ok) {
      results.push({ id: c.id, status: "sent" });
    } else {
      results.push({ id: c.id, status: "error", reason: res.error });
      console.error("[income-verif-followup] send failed for", c.id, res.error);
    }
  }

  return { checked: candidates.length, sent: results.filter((r) => r.status === "sent").length, results };
}
