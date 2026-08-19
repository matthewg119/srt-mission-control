// The weekly report — delivery step 32, Artifact Templates section 4 / PILOT section 11.
//
// ‼️ THERE IS NO RUNNER FOR THIS STEP, AND THAT IS THE DESIGN.
//
// "Weekly report firing" is not a document to generate once. It is a statement about ongoing
// behaviour, and runReadyAutoSteps is built for one-shot generators: it calls a runner once and
// parks a failure in `error` where nothing retries it. A runner here would fire the moment
// first_page cleared, find no week of data, and sit in `error` forever.
//
// The only honest one-shot reading of "firing" is that the FIRST REPORT HAS ACTUALLY POSTED.
// Not that a flag is on — a flag is an assertion, which is the same objection day-zero.ts
// raises about day_0_source = 'manual_step'. So the first successful post ticks the step, via
// ROUTE_COMPLETED, and after that this just runs every week like the rhythm it is.
//
// ‼️ NO NEW CRON. vercel.json already carries 14 entries against a Hobby plan that documents 2.
// report-reminders.ts and content-digest.ts both refuse a 15th in writing, and this refuses for
// the same reason: it is a weekday-gated passenger on /api/cron/followup-digest.
//
// ‼️ WHAT IT WILL NOT SAY.
//   • No lead count. There is no "heard about you from an AI assistant" attribution field
//     anywhere in this system, and printing "0 leads" reads as a RESULT rather than as an
//     unwired question. The report says the question is not wired instead.
//   • No Google review count. The only reviews we can see are the ones that came through our
//     own review tool, so that line is worded as exactly that and never implies a review API.
//   • Crawler activity is never reported without the words "leading indicator" attached, and
//     they live in ONE string so a refactor cannot separate them.

import { supabaseAdmin } from "@/lib/db";
import { loadHubMetrics, type HubMetrics } from "@/lib/hub/analytics";
import { listPublished } from "@/lib/hub/pages";
import { clientsInRhythm } from "./content-digest";
import { notifyThread, autoCompleteStep } from "./delivery-checklist";

/** Thursday, UTC. Late enough in the week to have something to report on. */
const REPORT_WEEKDAY = 4;

/**
 * ‼️ ONE STRING, AND THE COUPLING IS THE POINT.
 *
 * Artifact Templates section 4 and PILOT section 11 both require crawler activity to be
 * reported AND labelled a leading indicator IN THE SAME SENTENCE. Split across two strings,
 * the second one eventually gets dropped by somebody tightening the copy, and the report starts
 * presenting bot fetches as if they were customers. Same trick assembleLabelled/assemblePlain
 * uses to stay unmergeable.
 */
export function crawlerSentence(aiAnswer: number, agents: string[]): string {
  const who = agents.length ? ` (${agents.join(", ")})` : "";
  return (
    `AI answer engines fetched your pages ${aiAnswer} time${aiAnswer === 1 ? "" : "s"}${who} this week. ` +
    `That is a leading indicator: it means the engines are reading the pages, which has to happen ` +
    `before they can cite them. It is not a count of customers and it does not predict one.`
  );
}

export const ATTRIBUTION_NOT_WIRED =
  "This report does not count leads. Nothing in the system asks a caller whether an AI assistant " +
  "sent them, so any number here would be invented. That question has to be added to the booking " +
  "flow before it can be answered.";

/** ISO week stamp, e.g. 2026-W34. The idempotency key. */
export function weekStamp(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export interface WeeklyReport {
  clientId: string;
  clientName: string;
  weekStamp: string;
  body: string;
}

export async function buildWeeklyReport(
  clientId: string,
  clientName: string,
  now: Date
): Promise<WeeklyReport | null> {
  let metrics: HubMetrics;
  try {
    metrics = await loadHubMetrics(clientId, 7);
  } catch (e) {
    // ‼️ SKIP, NEVER POST A ZERO. loadHubMetrics THROWS rather than returning an empty series,
    // deliberately, because an empty series rendered as a report tells a paying client that no
    // AI engine has ever fetched their pages. A Supabase blip must not become that sentence.
    console.error(`[weekly-report] metrics unavailable for ${clientId}:`, (e as Error).message);
    return null;
  }

  const pages = await listPublished(clientId).catch(() => []);
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const newPages = pages.filter((p) => {
    const at = (p as { publishedAt?: string | null }).publishedAt;
    return at ? new Date(at) >= weekAgo : false;
  });

  const { count: reviewCount } = await supabaseAdmin
    .from("review_tool_submissions")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .gte("created_at", weekAgo.toISOString());

  const answerAgents = metrics.agents
    .filter((a) => a.botClass === "ai_answer" && a.botName)
    .map((a) => a.botName as string);

  const lines: string[] = [
    `*Weekly report — ${clientName}*`,
    `Week of ${weekAgo.toISOString().slice(0, 10)} to ${now.toISOString().slice(0, 10)}`,
    "",
    crawlerSentence(metrics.totals.aiAnswer, [...new Set(answerAgents)]),
    "",
    `*Your hub*`,
    `• ${metrics.totals.hits} total fetches, ${metrics.totals.human} of them from people`,
    `• ${pages.length} page${pages.length === 1 ? "" : "s"} published in total` +
      (newPages.length ? `, ${newPages.length} of them this week` : ", none new this week"),
  ];

  if (metrics.pages.length) {
    lines.push("", "*Most fetched pages this week*");
    for (const p of metrics.pages.slice(0, 5)) {
      lines.push(`• /${p.slug} — ${p.hits} fetches, ${p.aiAnswer} by answer engines`);
    }
  }

  lines.push(
    "",
    `*Reviews through your review tool:* ${reviewCount ?? 0} this week.`,
    "That counts submissions through the tool we gave you. It is not a count of everything " +
      "posted to Google, which we have no way to read.",
    "",
    ATTRIBUTION_NOT_WIRED
  );

  if (!metrics.lastHitAt) {
    lines.push(
      "",
      ":warning: No hit of any kind has ever been recorded for this hub. That is more likely a " +
        "collector problem than a traffic problem, and it is worth checking before this goes out."
    );
  }

  return { clientId, clientName, weekStamp: weekStamp(now), body: lines.join("\n") };
}

/**
 * The sweep. Runs from the daily digest; does nothing on six days out of seven.
 *
 * Idempotent on (client_id, week_stamp), the same guarantee client_messages' unique
 * (client_id, draft_key) gives the content digest: a cron that runs twice on a Thursday posts
 * one report. The row is also the archive the day-90 package reads.
 */
export async function runWeeklyReports(opts?: { now?: Date; force?: boolean }): Promise<{
  posted: number;
  skipped: number;
}> {
  const now = opts?.now ?? new Date();
  if (!opts?.force && now.getUTCDay() !== REPORT_WEEKDAY) return { posted: 0, skipped: 0 };

  const clients = await clientsInRhythm();
  let posted = 0;
  let skipped = 0;

  for (const c of clients) {
    const stamp = weekStamp(now);

    const { data: existing } = await supabaseAdmin
      .from("client_weekly_reports")
      .select("id")
      .eq("client_id", c.clientId)
      .eq("week_stamp", stamp)
      .maybeSingle();

    if (existing) {
      skipped += 1;
      continue;
    }

    const report = await buildWeeklyReport(c.clientId, c.name, now);
    if (!report) {
      skipped += 1;
      continue;
    }

    // The row goes in BEFORE the post, so a Slack failure cannot produce a second report next
    // time the digest runs. Same ordering as deliverArtifact: record, then announce.
    const { error } = await supabaseAdmin.from("client_weekly_reports").insert({
      client_id: c.clientId,
      week_stamp: stamp,
      body: report.body,
    });

    if (error) {
      console.error(`[weekly-report] insert failed for ${c.clientId}:`, error.message);
      skipped += 1;
      continue;
    }

    await notifyThread(c.clientId, report.body).catch(() => {});

    // The first one that actually posts is what makes "weekly report firing" true.
    // autoCompleteStep is a no-op on an already-complete step's cascade only in the sense that
    // it re-runs it, so it is guarded on status the same way the time-log tick is.
    const { data: step } = await supabaseAdmin
      .from("client_delivery_steps")
      .select("status")
      .eq("client_id", c.clientId)
      .eq("step_key", "weekly_report")
      .maybeSingle();

    if (step && step.status !== "complete" && step.status !== "skipped") {
      await autoCompleteStep(
        c.clientId,
        "weekly_report",
        ":white_check_mark: First weekly report posted. The rhythm is running."
      ).catch(() => {});
    }

    posted += 1;
  }

  return { posted, skipped };
}
