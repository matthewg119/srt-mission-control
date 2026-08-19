// The time log nudge — the backstop behind delivery step 31.
//
// Step 31 ("Time log has entries from day 0") is ticked by the route that makes it true, in
// /api/clients/[id]/time-log. There is no runner for it and there must not be: it is a
// predicate about ongoing behaviour, and a generator asked to prove one would sit in `error`
// from the moment day 0 cleared until somebody happened to log an hour.
//
// This is the other half. A client past day 0 with NO entries at all is the state that quietly
// loses the entire time record for a pilot, and A1's whole margin argument is built on that
// record. One nudge, then it goes quiet: a job that complains every morning gets muted, and a
// muted channel is worse than no nudge.
//
// ‼️ NO NEW CRON. Passenger on /api/cron/followup-digest, same as report-reminders.ts and
// content-digest.ts, both of which refuse a 15th vercel.json entry in writing.

import { supabaseAdmin } from "@/lib/db";
import { reportAnchorFor } from "./report-reminders";
import { notifyThread } from "./delivery-checklist";

/** How long after day 0 an empty time log stops being normal and starts being a gap. */
const QUIET_DAYS = 3;

export async function runTimeLogNudges(opts?: { now?: Date }): Promise<{ nudged: number }> {
  const now = opts?.now ?? new Date();

  const { data: clients } = await supabaseAdmin
    .from("clients")
    .select("id, legal_name, dba_name, intake_completed_at")
    .in("billing_status", ["pilot", "active"]);

  let nudged = 0;

  for (const c of clients ?? []) {
    const clientId = c.id as string;

    // Only clients whose step is genuinely outstanding. A complete or skipped step has had
    // its answer, and an `error` row is already in the #alerts-infra digest.
    const { data: step } = await supabaseAdmin
      .from("client_delivery_steps")
      .select("status")
      .eq("client_id", clientId)
      .eq("step_key", "time_log_entries")
      .maybeSingle();

    if (!step || step.status === "complete" || step.status === "skipped") continue;

    // Reused rather than re-derived. reportAnchorFor is already the day-0 anchor, including
    // the honest fallback to intake completion, and two answers to "when did day 0 happen"
    // is how the nudge and the day-30 report start disagreeing.
    const anchor = await reportAnchorFor(clientId, (c.intake_completed_at as string | null) ?? null);
    if (!anchor) continue;

    const days = Math.floor((now.getTime() - anchor.at.getTime()) / 86_400_000);
    if (days < QUIET_DAYS) continue;

    const { count } = await supabaseAdmin
      .from("time_log")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId);

    if ((count ?? 0) > 0) continue;

    // Exactly on the day it comes due, never every day after. Same discipline as the day
    // 30/60/90 reminders: nudge on an exact hit so it does not nag.
    if (days !== QUIET_DAYS) continue;

    const name = (c.dba_name || c.legal_name || "this client") as string;
    await notifyThread(
      clientId,
      `:hourglass: *Time log is empty for ${name}* — ${days} days past ` +
        `${anchor.isArchive ? "the Day-0 archive" : "intake completion (no Day-0 archive on file, so this is measured from intake)"}. ` +
        `Nothing has been logged against this client yet, so there is currently no record of ` +
        `what the pilot cost to deliver. Log the hours already spent on the client board.`
    ).catch(() => {});

    nudged += 1;
  }

  return { nudged };
}
