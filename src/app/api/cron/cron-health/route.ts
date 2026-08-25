export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { WATCHED_CRONS, CRON_HEALTH_EVENT, isErrorEvent } from "@/lib/cron-health";
import { runGuardianAnalysis, hasRecentPendingCard, guardianRepo } from "@/lib/code-guardian/report";

export const runtime = "nodejs";
export const maxDuration = 300;

// Hourly watchdog over the Vercel crons. See src/lib/cron-health.ts for why a 200
// from a cron route is not evidence that the cron worked.
//
// Every finding is routed through the same Code Guardian card as a GitHub failure,
// so triage lives in one channel with one set of reactions.

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
  return header === `Bearer ${secret}`;
}

interface Finding {
  name: string;
  kind: "silent" | "error";
  detail: string;
}

/** Window start for the error sweep: the previous sweep, or an hour ago on first run. */
async function lastSweepAt(): Promise<string> {
  const { data } = await supabaseAdmin
    .from("system_logs")
    .select("created_at")
    .eq("event_type", CRON_HEALTH_EVENT)
    .order("created_at", { ascending: false })
    .limit(1);
  const prev = (data ?? [])[0]?.created_at as string | undefined;
  return prev ?? new Date(Date.now() - 60 * 60 * 1000).toISOString();
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const since = await lastSweepAt();
  const findings: Finding[] = [];

  // 1. Errors first, so the silence check can absorb them. A cron that fails
  //    before it can log success is BOTH silent and erroring; carding it twice
  //    would be two alerts for one problem — crm-exclusion-sync is exactly that
  //    case, erroring every morning having never once logged a success.
  const { data: errRows } = await supabaseAdmin
    .from("system_logs")
    .select("event_type, description, created_at")
    .gt("created_at", since)
    .order("created_at", { ascending: false })
    .limit(500);

  const errorByType = new Map<string, { description: string; created_at: string }>();
  for (const row of errRows ?? []) {
    const eventType = row.event_type as string;
    if (!isErrorEvent(eventType) || errorByType.has(eventType)) continue;
    errorByType.set(eventType, {
      description: (row.description as string) ?? "(no description)",
      created_at: row.created_at as string,
    });
  }

  // 2. Silence check, folding in any error that belongs to the same cron.
  //    "cron_crm_exclusion_sync_error" is matched to success event
  //    "cron_crm_exclusion_sync" by prefix.
  const claimedErrors = new Set<string>();
  for (const cron of WATCHED_CRONS) {
    const { data, error } = await supabaseAdmin
      .from("system_logs")
      .select("created_at")
      .eq("event_type", cron.successEvent)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) continue; // a failed probe is not evidence of a failed cron

    const ownErrors = [...errorByType.entries()].filter(([type]) => type.startsWith(cron.successEvent));
    for (const [type] of ownErrors) claimedErrors.add(type);
    const errorDetail = ownErrors
      .map(([type, e]) => `Logged "${type}" at ${e.created_at}: ${e.description}`)
      .join(" | ");

    const latest = (data ?? [])[0]?.created_at as string | undefined;
    const cutoffMs = Date.now() - cron.maxGapHours * 60 * 60 * 1000;
    const silent = !latest || new Date(latest).getTime() < cutoffMs;

    if (!silent && ownErrors.length === 0) continue;

    let detail: string;
    if (!latest) {
      detail = `${cron.path} has never written its success event "${cron.successEvent}".`;
    } else if (silent) {
      const hoursAgo = Math.round((Date.now() - new Date(latest).getTime()) / 3_600_000);
      detail =
        `${cron.path} last wrote "${cron.successEvent}" ${hoursAgo}h ago (${latest}), ` +
        `past its ${cron.maxGapHours}h window. It either did not run or failed before logging.`;
    } else {
      detail = `${cron.path} is running but logged an error.`;
    }

    findings.push({
      name: cron.name,
      kind: silent ? "silent" : "error",
      detail: errorDetail ? `${detail} ${errorDetail}` : detail,
    });
  }

  // 3. Errors that belong to no watched cron still deserve a card — this is what
  //    covers routes not listed in WATCHED_CRONS, and ones that do not exist yet.
  for (const [type, e] of errorByType) {
    if (claimedErrors.has(type)) continue;
    findings.push({
      name: type,
      kind: "error",
      detail: `system_logs recorded "${type}" at ${e.created_at}: ${e.description}`,
    });
  }

  // 3. Card each finding once, unless it is already sitting unactioned.
  const repo = guardianRepo();
  const posted: string[] = [];
  const suppressed: string[] = [];

  for (const finding of findings) {
    if (await hasRecentPendingCard(finding.name)) {
      suppressed.push(finding.name);
      continue;
    }
    const result = await runGuardianAnalysis({
      source: "vercel-cron",
      workflowName: finding.name,
      repo,
      errorText: finding.detail,
    });
    if (result.posted) posted.push(finding.name);
    else suppressed.push(`${finding.name} (${result.error ?? "not posted"})`);
  }

  // Written last so the timestamp bounds the NEXT sweep's error window, and only
  // after the findings above were handled — a crash mid-sweep leaves the window
  // open so nothing is skipped on the retry.
  await supabaseAdmin.from("system_logs").insert({
    event_type: CRON_HEALTH_EVENT,
    description: `Checked ${WATCHED_CRONS.length} crons, ${findings.length} finding(s), ${posted.length} carded`,
    metadata: { since, findings, posted, suppressed },
  });

  return NextResponse.json({
    ok: true,
    since,
    checked: WATCHED_CRONS.length,
    findings,
    posted,
    suppressed,
  });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
