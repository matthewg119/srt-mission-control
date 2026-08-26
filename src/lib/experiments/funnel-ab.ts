/**
 * The med spa booking headline test, and its Friday report to #alerts-infra.
 *
 * The funnel on srtagency.com serves one of four booking headlines (A, B, C, D)
 * and beacons what happened to /api/marketing/page-visit, which files it in
 * system_logs under event_type='funnel_event'. This reads those rows back.
 *
 * WHY THERE IS NO MIGRATION. A dedicated experiments table would buy three
 * things, and two of them are already covered:
 *   - a unique constraint against double-counting an exposure. The funnel
 *     guards on sessionStorage AND we count distinct sid here, which also
 *     collapses a reload. A constraint would not have done the second.
 *   - a foreign key from an exposure to the contact it became. The same sid
 *     rides the lead beacon, so that join exists on a column we already have.
 *   - an index, so the query stays cheap as system_logs grows. This is the
 *     only real one, and at a med spa ad funnel's volume, four counts grouped
 *     over seven days is milliseconds. Revisit north of a million rows.
 * Against it: system_logs is the documented house convention for exactly this
 * (/onboardingfree chose it over a migration in as many words), and this test
 * is over in weeks. See srt-agwb/CLAUDE.md.
 *
 * ‼️ THE REPORT PRINTS COUNTS AND NEVER DECLARES A WINNER. At this traffic a
 * week is not significant, and a Slack card saying "B wins" is exactly the
 * unearned claim this codebase refuses everywhere else. The caveat lives in
 * the SAME string as the numbers so a later tidy-up cannot separate them.
 */

import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";

/** Friday. UTC, like every other cron in this app. */
const REPORT_WEEKDAY = 5;

/** Below this, the percentages are noise and the report says so. */
const MIN_EXPOSURES_TO_COMPARE = 100;

const VARIANTS = ["a", "b", "c", "d"] as const;

interface Row {
  metadata: Record<string, unknown> | null;
}

interface Tally {
  exposure: Set<string>;
  lead: Set<string>;
  click: Set<string>;
  booked: Set<string>;
  estimated: number;
}

function emptyTally(): Tally {
  return { exposure: new Set(), lead: new Set(), click: new Set(), booked: new Set(), estimated: 0 };
}

function weekStamp(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function pct(n: number, d: number): string {
  if (!d) return "  -  ";
  return (Math.round((n / d) * 1000) / 10).toFixed(1) + "%";
}

/** Loud failures go here. Same channel and same doctrine as clients/provision.ts. */
async function postInfraAlert(text: string): Promise<void> {
  const channel = process.env.SLACK_ALERTS_INFRA_CHANNEL;
  if (!channel) {
    console.error("[funnel-ab] SLACK_ALERTS_INFRA_CHANNEL unset. Report dropped:\n" + text);
    return;
  }
  await slack.postMessage(channel, text);
}

export async function buildFunnelAbReport(now: Date): Promise<string | null> {
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabaseAdmin
    .from("system_logs")
    .select("metadata")
    .eq("event_type", "funnel_event")
    .gte("created_at", since)
    .limit(20000);

  if (error) {
    console.error("[funnel-ab] query failed:", error.message);
    return null;
  }

  const tallies: Record<string, Tally> = {};
  for (const v of VARIANTS) tallies[v] = emptyTally();

  let forcedSkipped = 0;

  for (const row of (data ?? []) as Row[]) {
    const m = row.metadata ?? {};
    const variant = String(m.variant ?? "");
    const event = String(m.event ?? "");
    // A ?v= override is the founder looking at a specific headline. Counting
    // those would let checking the page move the numbers it reports.
    if (m.forced === true || m.forced === "true") { forcedSkipped += 1; continue; }
    if (!VARIANTS.includes(variant as (typeof VARIANTS)[number])) continue;

    // Distinct sid, not row count: a reload must not inflate the denominator.
    const sid = String(m.sid ?? "");
    if (!sid) continue;
    const t = tallies[variant];

    if (event === "funnel_exposure") t.exposure.add(sid);
    else if (event === "funnel_lead") t.lead.add(sid);
    else if (event === "funnel_book_click") t.click.add(sid);
    else if (event === "funnel_booked") {
      t.booked.add(sid);
      if (m.estimated === true || m.estimated === "true") t.estimated += 1;
    }
  }

  const totalExposure = VARIANTS.reduce((n, v) => n + tallies[v].exposure.size, 0);
  if (totalExposure === 0) return null;

  const lines: string[] = [];
  lines.push(`*Med spa booking headline test* · week ending ${weekStamp(now)}`);
  lines.push("```");
  lines.push("        shown   lead   click  booked   lead%   book%");
  for (const v of VARIANTS) {
    const t = tallies[v];
    const shown = t.exposure.size;
    if (shown === 0 && t.lead.size === 0) continue;
    lines.push(
      `  ${v.toUpperCase()}   ` +
        String(shown).padStart(5) +
        String(t.lead.size).padStart(7) +
        String(t.click.size).padStart(7) +
        String(t.booked.size).padStart(8) +
        pct(t.lead.size, shown).padStart(8) +
        pct(t.booked.size, shown).padStart(8)
    );
  }
  lines.push("```");

  const estimatedTotal = VARIANTS.reduce((n, v) => n + tallies[v].estimated, 0);
  if (estimatedTotal > 0) {
    lines.push(
      `:warning: ${estimatedTotal} of the bookings above are *estimated*: the Calendly widget did ` +
        `not load for those visitors, so a CTA click was counted instead of a confirmed booking.`
    );
  }
  if (forcedSkipped > 0) {
    lines.push(`_${forcedSkipped} forced (?v=) events excluded._`);
  }

  // ‼️ Same string as the numbers. Do not split this out.
  lines.push(
    totalExposure < MIN_EXPOSURES_TO_COMPARE
      ? `_${totalExposure} exposures this week. That is too few to compare headlines. These are counts, not a result, and nothing here says which one is winning._`
      : `_${totalExposure} exposures this week. Counts only. This report does not run a significance test and does not pick a winner; treat a gap as a hint about where to look, not a decision._`
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
export async function runFunnelAbReport(opts?: { now?: Date; force?: boolean; dry?: boolean }): Promise<{
  posted: number;
  reason?: string;
}> {
  const now = opts?.now ?? new Date();
  if (!opts?.force && now.getUTCDay() !== REPORT_WEEKDAY) return { posted: 0, reason: "not friday" };

  const stamp = weekStamp(now);

  const { data: existing } = await supabaseAdmin
    .from("system_logs")
    .select("id")
    .eq("event_type", "funnel_ab_report")
    .eq("description", stamp)
    .maybeSingle();

  if (existing && !opts?.force) return { posted: 0, reason: "already posted this week" };

  const body = await buildFunnelAbReport(now);
  if (!body) return { posted: 0, reason: "no funnel events in the window" };

  if (opts?.dry) {
    console.info("[funnel-ab] dry run, would have posted:\n" + body);
    return { posted: 0, reason: "dry" };
  }

  const { error } = await supabaseAdmin.from("system_logs").insert({
    event_type: "funnel_ab_report",
    description: stamp,
    metadata: { body },
  });
  if (error) {
    console.error("[funnel-ab] stamp insert failed, not posting:", error.message);
    return { posted: 0, reason: "stamp failed" };
  }

  await postInfraAlert(body);
  return { posted: 1 };
}
