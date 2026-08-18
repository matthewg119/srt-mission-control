// "Today the day 30 report is due for X."
//
// NOTHING IS GENERATED HERE. The reminder is a nudge, and the report draft is written
// when Matthew presses the button on that client's board. A report is the one message in
// this system that needs a human to have looked at the numbers first, so a cron that
// drafted one would be producing something nobody had read.
//
// ─── WHY THERE IS NO NEW CRON ────────────────────────────────────────────────────────
//
// vercel.json already carries 14 entries against a Hobby plan that documents 2, daily
// only. Whether the extras run or are silently ignored, adding a 15th is not the way to
// find out. This hangs off /api/cron/followup-digest, which already runs daily at 13:00
// UTC and is already the "what is due today" job.
//
// ─── DAY 0 IS THE ARCHIVE, NOT THE SIGNUP ────────────────────────────────────────────
//
// The day_zero_archive step is the scan every later scorecard is measured against, so it
// is the only honest anchor for "day 30". Signup date would drift from it by however long
// the call took to book. When the gate was never ticked there is nothing to measure
// against at all, so the reminder falls back to intake completion AND SAYS SO rather than
// quietly measuring from the wrong day.

import { supabaseAdmin } from "@/lib/db";
import { notifyThread } from "@/lib/clients/delivery-checklist";
import { REPORT_MILESTONES, reportDraftKey, clientDisplayName } from "@/lib/clients/client-drafts";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ReportAnchor {
  at: Date;
  /** False when day_zero_archive was never ticked and this is intake completion. */
  isArchive: boolean;
}

/** Whole days elapsed, UTC midnight to UTC midnight, so a 09:00 call is not day -1. */
export function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((b - a) / DAY_MS);
}

/**
 * Which milestones this client has reached and not yet drafted.
 *
 * Used two ways, and the difference matters. The CRON asks for an exact hit so it nudges
 * once rather than every morning until someone acts. The BOARD asks for everything
 * reached, so a milestone whose nudge was missed is still visible; a persistent line on a
 * page nobody is being interrupted by is the right place for that, and it is also the
 * backstop if a cron day is ever dropped.
 */
export function milestonesReached(daysSince: number, drafted: Set<string>): number[] {
  return REPORT_MILESTONES.filter(
    (day) => daysSince >= day && !drafted.has(reportDraftKey(day))
  );
}

export function milestoneDueToday(daysSince: number, drafted: Set<string>): number | null {
  return (
    REPORT_MILESTONES.find((day) => daysSince === day && !drafted.has(reportDraftKey(day))) ?? null
  );
}

export function dayLabel(day: number): string {
  return `day ${day}`;
}

export async function reportAnchorFor(
  clientId: string,
  intakeCompletedAt: string | null
): Promise<ReportAnchor | null> {
  const { data } = await supabaseAdmin
    .from("client_delivery_steps")
    .select("completed_at")
    .eq("client_id", clientId)
    .eq("step_key", "day_zero_archive")
    .eq("status", "complete")
    .maybeSingle();

  if (data?.completed_at) return { at: new Date(data.completed_at as string), isArchive: true };
  if (intakeCompletedAt) return { at: new Date(intakeCompletedAt), isArchive: false };
  return null;
}

/** Which report keys already have a row, so a drafted milestone is never nudged again. */
async function draftedKeys(clientId: string): Promise<Set<string>> {
  const { data } = await supabaseAdmin
    .from("client_messages")
    .select("draft_key")
    .eq("client_id", clientId)
    .eq("kind", "report");
  return new Set((data ?? []).map((r) => r.draft_key as string));
}

export interface DueReport {
  clientId: string;
  name: string;
  day: number;
  anchor: ReportAnchor;
}

/** Everything reached and undrafted for one client. Powers the board panel. */
export async function reportsOutstanding(client: {
  id: string;
  legal_name?: string | null;
  dba_name?: string | null;
  intake_completed_at?: string | null;
}): Promise<DueReport[]> {
  const anchor = await reportAnchorFor(client.id, client.intake_completed_at ?? null);
  if (!anchor) return [];

  const drafted = await draftedKeys(client.id);
  const daysSince = daysBetween(anchor.at, new Date());

  return milestonesReached(daysSince, drafted).map((day) => ({
    clientId: client.id,
    name: clientDisplayName(client),
    day,
    anchor,
  }));
}

/**
 * The daily sweep. Posts one nudge per client that hits a milestone exactly today.
 *
 * Never throws into its caller: this is a passenger on the follow-up digest and must not
 * be able to take that job down.
 */
export async function runClientReportReminders(opts: { dry?: boolean } = {}): Promise<{
  checked: number;
  reminded: DueReport[];
}> {
  const { data: clients } = await supabaseAdmin
    .from("clients")
    .select("id, legal_name, dba_name, intake_completed_at, ops_thread_ts")
    .in("billing_status", ["pilot", "active"]);

  const rows = clients ?? [];
  const reminded: DueReport[] = [];

  for (const client of rows) {
    try {
      // No thread means nowhere to post. That is a client who never finished intake.
      if (!client.ops_thread_ts) continue;

      const anchor = await reportAnchorFor(
        client.id as string,
        (client.intake_completed_at as string) ?? null
      );
      if (!anchor) continue;

      const drafted = await draftedKeys(client.id as string);
      const day = milestoneDueToday(daysBetween(anchor.at, new Date()), drafted);
      if (day === null) continue;

      const due: DueReport = {
        clientId: client.id as string,
        name: clientDisplayName(client),
        day,
        anchor,
      };
      reminded.push(due);

      if (!opts.dry) {
        await notifyThread(due.clientId, reminderText(due)).catch(() => {});
      }
    } catch (e) {
      console.error("[report-reminders] client failed:", (e as Error).message);
    }
  }

  return { checked: rows.length, reminded };
}

function reminderText(due: DueReport): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";
  const lines = [
    `:calendar: *The ${dayLabel(due.day)} report is due today for ${due.name}.*`,
    `Re-run the same questions on the same engines, then draft it from their board:`,
    `${appUrl}/dashboard/clients/${due.clientId}`,
  ];

  // Stated rather than hidden. A reminder measured from intake is measuring from the
  // wrong day, and the person reading it is the only one who can decide whether that
  // matters for this client.
  if (!due.anchor.isArchive) {
    lines.push(
      `:warning: Counted from intake, not from the Day-0 archive, because that step was never ticked. There is no archived baseline to measure this report against.`
    );
  }

  return lines.join("\n");
}
