/**
 * The weekly med spa funnel report to #alerts-infra.
 *
 * The funnel on srtagency.com beacons what happens on the booking screen to
 * /api/marketing/page-visit, which files it in system_logs under
 * event_type='funnel_event'. This reads those rows back on a Friday.
 *
 * HISTORY WORTH KNOWING. This started life as an A/B/C/D headline test report.
 * The split test was removed on 2026-08-26 (one offer, one headline), so this
 * is now a plain funnel report: how many people reached the booking screen,
 * how many became leads, how many opened the calendar and how many booked.
 * The per-variant grouping is gone; everything else was already measuring the
 * funnel rather than the test, so it survived the change unaltered.
 *
 * ‼️ THE BEACONS STILL CARRY `variant`. Nothing sets it today. It is left in
 * the allowlists on purpose so that restoring a test is a matter of adding a
 * picker to funnel.js, not re-plumbing the measurement. Do not "clean it up".
 *
 * WHY THERE IS NO MIGRATION. A dedicated table would buy three things, and two
 * are already covered:
 *   - a unique constraint against double-counting an exposure. The funnel
 *     guards on sessionStorage AND we count distinct sid here, which also
 *     collapses a reload. A constraint would not have done the second.
 *   - a foreign key from an exposure to the contact it became. The same sid
 *     rides the lead beacon, so that join exists on a column we already have.
 *   - an index, so the query stays cheap as system_logs grows. This is the
 *     only real one, and at a med spa funnel's volume four counts grouped over
 *     seven days is milliseconds. Revisit north of a million rows.
 * Against it: system_logs is the documented house convention for exactly this
 * (/onboardingfree chose it over a migration in as many words).
 *
 * ‼️ THE REPORT PRINTS COUNTS AND DRAWS NO CONCLUSIONS. At this traffic a week
 * is not a result, and a Slack card that implies otherwise is the unearned
 * claim this codebase refuses everywhere else. The caveat lives in the SAME
 * string as the numbers so a later tidy-up cannot separate them.
 */

import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";

/** Friday. UTC, like every other cron in this app. */
const REPORT_WEEKDAY = 5;

/** Below this, the percentages are noise and the report says so. */
const MIN_EXPOSURES = 100;

interface Row {
  metadata: Record<string, unknown> | null;
}

function weekStamp(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function pct(n: number, d: number): string {
  if (!d) return "-";
  return (Math.round((n / d) * 1000) / 10).toFixed(1) + "%";
}

/** Loud failures go here. Same channel and same doctrine as clients/provision.ts. */
async function postInfraAlert(text: string): Promise<void> {
  const channel = process.env.SLACK_ALERTS_INFRA_CHANNEL;
  if (!channel) {
    console.error("[funnel-report] SLACK_ALERTS_INFRA_CHANNEL unset. Report dropped:\n" + text);
    return;
  }
  await slack.postMessage(channel, text);
}

export async function buildFunnelReport(now: Date): Promise<string | null> {
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabaseAdmin
    .from("system_logs")
    .select("metadata")
    .eq("event_type", "funnel_event")
    .gte("created_at", since)
    .limit(20000);

  if (error) {
    console.error("[funnel-report] query failed:", error.message);
    return null;
  }

  // Distinct sid per stage, not row counts: a reload must not inflate anything.
  const exposure = new Set<string>();
  const lead = new Set<string>();
  const dq = new Set<string>();
  const click = new Set<string>();
  const booked = new Set<string>();
  let estimated = 0;

  const byMode: Record<string, Set<string>> = { home: new Set(), pricing: new Set() };

  for (const row of (data ?? []) as Row[]) {
    const m = row.metadata ?? {};
    const event = String(m.event ?? "");
    const sid = String(m.sid ?? "");
    if (!sid) continue;

    if (event === "funnel_exposure") {
      exposure.add(sid);
      const mode = String(m.mode ?? "");
      if (byMode[mode]) byMode[mode].add(sid);
    } else if (event === "funnel_lead") lead.add(sid);
    else if (event === "funnel_dq") dq.add(sid);
    else if (event === "funnel_book_click") click.add(sid);
    else if (event === "funnel_booked") {
      booked.add(sid);
      if (m.estimated === true || m.estimated === "true") estimated += 1;
    }
  }

  if (exposure.size === 0 && lead.size === 0 && dq.size === 0) return null;

  const shown = exposure.size;
  const lines: string[] = [];
  lines.push(`*Med spa funnel* · week ending ${weekStamp(now)}`);
  lines.push("```");
  lines.push(`  reached the offer   ${String(shown).padStart(5)}`);
  lines.push(`  qualified leads     ${String(lead.size).padStart(5)}   ${pct(lead.size, shown)}`);
  lines.push(`  disqualified        ${String(dq.size).padStart(5)}   (under $10k/mo)`);
  lines.push(`  opened the calendar ${String(click.size).padStart(5)}   ${pct(click.size, shown)}`);
  lines.push(`  booked a call       ${String(booked.size).padStart(5)}   ${pct(booked.size, shown)}`);
  lines.push("");
  lines.push(`  from the homepage   ${String(byMode.home.size).padStart(5)}`);
  lines.push(`  from /pricing       ${String(byMode.pricing.size).padStart(5)}`);
  lines.push("```");

  if (estimated > 0) {
    lines.push(
      `:warning: ${estimated} of the bookings above are *estimated*: the Calendly widget did not ` +
        `load for those visitors, so a CTA click was counted instead of a confirmed booking.`
    );
  }

  // Same string as the numbers. Do not split this out.
  lines.push(
    shown < MIN_EXPOSURES
      ? `_${shown} people reached the offer this week. That is too few to read anything into the rates; these are counts, not a trend._`
      : `_${shown} people reached the offer this week. Counts only, no significance testing. Treat a move as a hint about where to look, not a decision._`
  );

  return lines.join("\n");
}

/**
 * The sweep. Rides the daily follow-up digest and does nothing six days in seven.
 *
 * Idempotent on the week stamp, recorded BEFORE the post, so a Slack failure
 * cannot produce a second report on tomorrow's tick. Same ordering as
 * runWeeklyReports and deliverArtifact: record, then announce.
 */
export async function runFunnelReport(opts?: { now?: Date; force?: boolean; dry?: boolean }): Promise<{
  posted: number;
  reason?: string;
}> {
  const now = opts?.now ?? new Date();
  if (!opts?.force && now.getUTCDay() !== REPORT_WEEKDAY) return { posted: 0, reason: "not friday" };

  const stamp = weekStamp(now);

  const { data: existing } = await supabaseAdmin
    .from("system_logs")
    .select("id")
    .eq("event_type", "funnel_weekly_report")
    .eq("description", stamp)
    .maybeSingle();

  if (existing && !opts?.force) return { posted: 0, reason: "already posted this week" };

  const body = await buildFunnelReport(now);
  if (!body) return { posted: 0, reason: "no funnel events in the window" };

  if (opts?.dry) {
    console.info("[funnel-report] dry run, would have posted:\n" + body);
    return { posted: 0, reason: "dry" };
  }

  const { error } = await supabaseAdmin.from("system_logs").insert({
    event_type: "funnel_weekly_report",
    description: stamp,
    metadata: { body },
  });
  if (error) {
    console.error("[funnel-report] stamp insert failed, not posting:", error.message);
    return { posted: 0, reason: "stamp failed" };
  }

  await postInfraAlert(body);
  return { posted: 1 };
}
