// 30-minute "finish your application" follow-up runner.
//
// Emails the branded finish-application email to any lead whose bank statements
// were analyzed ~30 minutes ago but who has NOT completed their application yet.
// If the application is already complete, the lead is skipped (and stamped so we
// stop scanning it).
//
// Clock: contacts.statements_analyzed_at is stamped when the bank-statement
// analyzer flips bank_statement_analysis_status → "analyzed". Dedupe:
// contacts.statements_finish_app_followup_sent_at.
//
// Invoked by /api/cron/statements-finish-app-followup (daily backup + external
// pinger). Mirrors the income-verification follow-up pattern.

import { supabaseAdmin } from "@/lib/db";
import { sendStatementsFinishAppEmail } from "@/lib/statements-finish-app-email";

const FOLLOWUP_DELAY_MS = 30 * 60 * 1000;        // 30 minutes
const FOLLOWUP_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours — don't chase stale rows

interface Candidate {
  id: string;
  email: string | null;
  first_name: string | null;
  zoho_lead_id: string | null;
  portal_app_completed: boolean | null;
  application_stage: string | null;
}

function appComplete(c: Candidate): boolean {
  return c.portal_app_completed === true || c.application_stage === "Application Complete";
}

export interface FollowupRunResult {
  checked: number;
  sent: number;
  results: Array<{ id: string; status: string; reason?: string }>;
}

/**
 * Scans for due finish-application follow-ups and emails them. Stamps
 * statements_finish_app_followup_sent_at BEFORE sending so overlapping ticks
 * can't double-send. Safe to call from a cron or a polling loop.
 */
export async function runDueStatementsFinishAppFollowups(): Promise<FollowupRunResult> {
  const now = Date.now();
  const windowStart = new Date(now - FOLLOWUP_MAX_AGE_MS).toISOString();
  const windowEnd = new Date(now - FOLLOWUP_DELAY_MS).toISOString();

  const { data, error } = await supabaseAdmin
    .from("contacts")
    .select("id, email, first_name, zoho_lead_id, portal_app_completed, application_stage")
    .eq("bank_statement_analysis_status", "analyzed")
    .is("statements_finish_app_followup_sent_at", null)
    .gte("statements_analyzed_at", windowStart)
    .lte("statements_analyzed_at", windowEnd)
    .not("email", "is", null)
    .limit(50);

  if (error) {
    console.error("[statements-finish-app-followup] query failed:", error.message);
    throw new Error(error.message);
  }

  const candidates = (data ?? []) as Candidate[];
  const results: FollowupRunResult["results"] = [];

  for (const c of candidates) {
    if (!c.email) {
      results.push({ id: c.id, status: "skipped", reason: "no_email" });
      continue;
    }
    if (appComplete(c)) {
      // Application already in — disregard, but stamp so we stop scanning it.
      await supabaseAdmin
        .from("contacts")
        .update({ statements_finish_app_followup_sent_at: new Date().toISOString() })
        .eq("id", c.id);
      results.push({ id: c.id, status: "skipped", reason: "app_complete" });
      continue;
    }

    // Stamp first to prevent a double-send on an overlapping tick.
    await supabaseAdmin
      .from("contacts")
      .update({ statements_finish_app_followup_sent_at: new Date().toISOString() })
      .eq("id", c.id);

    const res = await sendStatementsFinishAppEmail({
      to: c.email,
      firstName: c.first_name,
      zohoLeadId: c.zoho_lead_id,
    });

    if (res.ok) {
      results.push({ id: c.id, status: "sent" });
    } else {
      results.push({ id: c.id, status: "error", reason: res.error });
      console.error("[statements-finish-app-followup] send failed for", c.id, res.error);
    }
  }

  return { checked: candidates.length, sent: results.filter((r) => r.status === "sent").length, results };
}
