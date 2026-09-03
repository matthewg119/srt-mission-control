/**
 * The one door onto the follow-ups board: the Loom handover.
 *
 * ‼️ NOTHING ELSE MAY CREATE A PROSPECT ANY MORE. Matthew, 2026-09-03: "every message in follow
 * ups channel should be from people we already sent the loom to." The way to make that true is not
 * to filter the board, it is to make enrolment impossible before the Loom, so "on the board" and
 * "has the Loom" are one fact rather than two that can drift.
 *
 * Called from thread-assistant.ts at the same instant loom_state reaches "done" and the CRM stage
 * becomes Loom Sent, so all three land together or none of them do.
 */
import { supabaseAdmin } from "@/lib/db";
import { upsertProspect, updateProspect, getProspectByEmail } from "./prospects";
import { loomNextTouch } from "./loom-cadence";
import type { AuditReportRow } from "@/lib/audit-engine/types";

export type LoomEnrolOutcome = "enrolled" | "restarted" | "no_email" | "error";

export interface LoomEnrolResult {
  outcome: LoomEnrolOutcome;
  detail?: string;
  dueAt?: string;
}

/**
 * Put this report's recipient on the ladder, starting now.
 *
 * ‼️ AN EXISTING ROW IS RESTARTED, NOT SKIPPED. A second Loom for the same clinic is a new
 * conversation and deserves a fresh D+3 and D+7. upsertProspect() fills blanks only and would
 * leave a spent ladder spent, so the reset is written explicitly here: step 0, first_sent_at now,
 * state back to SENT_NO_REPLY, and unpaused. `confirmed` is set because a person just made this
 * person a video by hand, which is a stronger confirmation than any sweep can produce.
 *
 * ‼️ NEVER THROWS. It runs inside the Loom handover, and a follow-up scheduling failure must not
 * cost somebody the script they are about to read on camera.
 */
export async function enrolLoomFollowup(report: AuditReportRow): Promise<LoomEnrolResult> {
  const email = (report.requester_email ?? report.prospect_email ?? "").trim();
  if (!email) {
    return {
      outcome: "no_email",
      detail: "this report has no requester_email, so there is nobody to follow up with",
    };
  }

  try {
    const now = new Date();
    const due = loomNextTouch(0, now);

    const existing = await getProspectByEmail(email);

    await upsertProspect({
      email,
      name: report.requester_name ?? report.prospect_name ?? null,
      company: report.client_name ?? null,
      website: report.website ?? null,
      city: report.city ?? null,
      phone: report.requester_phone ?? null,
      audit_report_id: report.id,
      contact_id: report.contact_id ?? null,
      source: "loom",
      confirmed: true,
    });

    // The reset. upsertProspect fills blanks, so the clock has to be set here either way.
    const row = await getProspectByEmail(email);
    if (!row) return { outcome: "error", detail: "the prospect row could not be read back" };

    await updateProspect(row.id, {
      state: "SENT_NO_REPLY",
      step: 0,
      first_sent_at: now.toISOString(),
      last_touch_at: now.toISOString(),
      next_touch_at: due ? due.toISOString() : null,
      next_channel: "email",
      call_attempts: 0,
      paused: false,
      closed_reason: null,
      confirmed: true,
      audit_report_id: report.id,
      source: "loom",
    });

    return {
      outcome: existing ? "restarted" : "enrolled",
      dueAt: due?.toISOString(),
      detail: due
        ? `first follow-up due ${due.toISOString().slice(0, 10)}, phone call four days after that`
        : "the ladder returned no due date, which should be impossible with two rungs",
    };
  } catch (err) {
    return { outcome: "error", detail: err instanceof Error ? err.message : "unknown failure" };
  }
}

/**
 * Does this prospect still have a Loom behind them?
 *
 * ‼️ THE SECOND RAIL, AND IT EXISTS BECAUSE THE FIRST ONE IS A PROMISE ABOUT CALLERS. Enrolment is
 * the only door today, but a sweep, a backfill or a hand-inserted row could put somebody on the
 * board tomorrow, and the failure would be silent: a stranger appearing on a board Matthew reads
 * as "people who have my video". So the digest re-checks the fact rather than trusting the row.
 *
 * Reads the same two signals priorReportFor() does, for the same reason: loom_url means the video
 * exists, and loom_state.stage === "done" means the handover happened.
 */
export async function hasLoom(prospect: {
  audit_report_id: string | null;
  email: string;
}): Promise<boolean> {
  try {
    if (prospect.audit_report_id) {
      const { data } = await supabaseAdmin
        .from("audit_reports")
        .select("loom_url, loom_state")
        .eq("id", prospect.audit_report_id)
        .maybeSingle();
      if (data) return looksSent(data);
    }

    // No report on the row: fall back to the address, so a prospect linked by a sweep rather than
    // by the handover is still judged on whether a Loom exists for them.
    const { data: byEmail } = await supabaseAdmin
      .from("audit_reports")
      .select("loom_url, loom_state")
      .ilike("requester_email", prospect.email)
      .eq("status", "done")
      .order("created_at", { ascending: false })
      .limit(3);

    return (byEmail ?? []).some(looksSent);
  } catch {
    // ‼️ FAILS CLOSED. An unreadable table means we cannot prove the Loom went out, and the board's
    // whole promise is that everybody on it already has one. A quiet board is recoverable; a board
    // with a stranger on it teaches Matthew not to trust the board.
    return false;
  }
}

function looksSent(row: { loom_url?: unknown; loom_state?: unknown }): boolean {
  const state = (row.loom_state ?? null) as { stage?: string } | null;
  return Boolean(row.loom_url) || state?.stage === "done";
}
