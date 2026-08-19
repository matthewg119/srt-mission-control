// Shared "research → classify → create report → post prompt drop → kick off
// batch 0" pipeline. Used by both the Slack /audit command and the public
// srtagency.com free-audit intake — each just supplies how to report back on
// a low-confidence-city or a hard failure (Slack has a thread to reply into;
// the public intake has no one to ask, so it proceeds on a best guess).

import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import { researchWebsite } from "./site-research";
import { classifyBusiness } from "./classify";
import { generateSlug } from "./slug";
import { getOrCreateAuditChannel } from "./audit-channel";
import { formatPromptDrop } from "./slack-format";
import { detectSiteSignals } from "./site-signals";
import { checkRobots, type RobotsCheck } from "./robots-check";
import type { AuditReportRow } from "./types";

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";
}

export interface RunAuditPipelineParams {
  website: string;
  city?: string;
  competitors?: string[];
  requestedBy?: string; // Slack user id, when triggered from Slack
  requesterName?: string;
  requesterEmail?: string;
  requesterPhone?: string;
  /** Links the report to the #hot-leads thread opened by ingestLead, so the
   *  finished report replies under the lead instead of posting standalone. */
  contactId?: string;
  /** Which public funnel produced this lead ("audit" | "pdf" | "contact"). Persisted on the
   *  row rather than kept in memory because finishReport runs in a DIFFERENT request
   *  (/api/audit/process) and only ever sees the audit_reports row. It routes the pitch card
   *  and decides whether the drafted email carries the med spa guide. */
  leadSource?: string;
  /** Public intake has no one to ask for a city — proceed on the best guess instead of blocking. */
  allowLowConfidenceCity?: boolean;
  onNeedsCity?: (website: string, bestGuess: string | null) => Promise<void>;
  onError?: (message: string) => Promise<void>;
  /**
   * Fired the moment the audit_reports row exists, BEFORE the Slack post and before the
   * batch kick-off.
   *
   * This function does not return until the ENTIRE audit is finished: the kick-off fetch
   * below is awaited (it has to be, see the comment there), and /api/audit/process runs every
   * batch and then finishReport before it responds. So `reportId` in the return value arrives
   * minutes late, which is useless to a caller that needs to show progress or link a row.
   * /scan uses this to attach its session to the report within ~30s instead of ~5 minutes.
   *
   * Best-effort: a throw here must not sink an audit that is otherwise fine.
   */
  onReportCreated?: (reportId: string) => Promise<void>;
}

export interface RunAuditPipelineResult {
  ok: boolean;
  reportId?: string;
}

/**
 * How long after it started a run may still plausibly be alive.
 *
 * A full run is 4 to 6 minutes; past this it died without reaching `done` and the
 * watchdog is the only thing that will notice, once a day. Shared so the button that
 * refuses to start a second run and the page that greys it out cannot disagree — two
 * literals is exactly how a lead ends up with its audit button stuck off until
 * tomorrow morning.
 */
export const RUN_IN_FLIGHT_MINUTES = 15;

/** Minutes within which a repeat request for the same website+email is treated
 *  as a double submit rather than a genuine re-audit. A full run is 20 engine
 *  calls plus classification, so a stray second beacon is expensive. */
const DEDUP_WINDOW_MINUTES = 30;

async function findRecentReport(website: string, email?: string): Promise<string | null> {
  if (!email) return null;
  const cutoff = new Date(Date.now() - DEDUP_WINDOW_MINUTES * 60_000).toISOString();
  const { data } = await supabaseAdmin
    .from("audit_reports")
    .select("id")
    .eq("website", website)
    .eq("requester_email", email)
    .in("status", ["classifying", "running", "done"])
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

export async function runAuditPipeline(params: RunAuditPipelineParams): Promise<RunAuditPipelineResult> {
  const duplicateOf = await findRecentReport(params.website, params.requesterEmail);
  if (duplicateOf) {
    console.log(`[run-audit-pipeline] skipping duplicate for ${params.website} (report ${duplicateOf})`);
    return { ok: true, reportId: duplicateOf };
  }

  let research;
  try {
    research = await researchWebsite(params.website);
  } catch (e) {
    await params.onError?.(`Couldn't fetch ${params.website}: ${(e as Error).message}`);
    return { ok: false };
  }

  let classification;
  try {
    classification = await classifyBusiness(research, { city: params.city, competitors: params.competitors });
  } catch (e) {
    await params.onError?.(`Classification failed for ${params.website}: ${(e as Error).message}`);
    return { ok: false };
  }

  // A city is only ever required for local businesses — a national/online/B2B
  // business (is_local:false) proceeds with no city, no fallback question.
  if (classification.is_local && classification.city_confidence === "low" && !params.allowLowConfidenceCity) {
    await params.onNeedsCity?.(params.website, classification.city_detected);
    return { ok: false };
  }

  const channel = await getOrCreateAuditChannel();
  const slug = await generateSlug();

  // The "one thing working against you" hook for cold email 1, computed from the homepage
  // markup we already have. Best-effort: a regex surprise here must never sink an audit.
  let siteSignals: ReturnType<typeof detectSiteSignals> = [];
  try {
    siteSignals = detectSiteSignals({
      html: research.homepageHtml,
      website: research.website,
      schemaHints: research.schemaHints,
      currentYear: new Date().getFullYear(),
    });
  } catch (e) {
    console.error("[run-audit-pipeline] site-signal scan failed:", (e as Error).message);
  }

  // Does robots.txt lock the AI crawlers out? Tri-state on purpose (see robots-check.ts):
  // null = never ran, so nothing downstream may claim anything about their crawler access.
  let robotsCheck: RobotsCheck = null;
  try {
    robotsCheck = await checkRobots(research.website);
  } catch (e) {
    console.error("[run-audit-pipeline] robots check failed:", (e as Error).message);
  }

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("audit_reports")
    .insert({
      slug,
      website: params.website,
      client_name: classification.business_name,
      city: classification.city_detected,
      business_type: classification.business_type,
      vertical_slug: classification.vertical_slug,
      buyer_persona: classification.buyer_persona,
      competitors: classification.likely_competitors,
      prompts: classification.prompts,
      status: "running",
      requested_by: params.requestedBy ?? null,
      requester_name: params.requesterName ?? null,
      requester_email: params.requesterEmail ?? null,
      requester_phone: params.requesterPhone ?? null,
      contact_id: params.contactId ?? null,
      lead_source: params.leadSource ?? null,
      slack_channel_id: channel.id,
      site_signals: siteSignals,
      robots_check: robotsCheck,
    })
    .select("*")
    .single();

  if (insertError || !inserted) {
    await params.onError?.(`Could not save audit report: ${insertError?.message ?? "unknown error"}`);
    return { ok: false };
  }

  const report = inserted as AuditReportRow;

  // Announce the row before anything slow happens to it. See onReportCreated's doc comment:
  // everything below this line, including the awaited kick-off, takes minutes.
  try {
    await params.onReportCreated?.(report.id);
  } catch (e) {
    console.error("[run-audit-pipeline] onReportCreated failed:", (e as Error).message);
  }

  const { text: dropText } = formatPromptDrop(report);
  const posted = await slack.postMessage(channel.id, dropText);
  const threadTs = (posted as { ts?: string }).ts;

  if (threadTs) {
    await supabaseAdmin.from("audit_reports").update({ slack_thread_ts: threadTs }).eq("id", report.id);
  }

  // Kick off batch processing. Internal route self-chains through the remaining
  // batches. MUST be awaited here — this function may itself run inside
  // waitUntil() at the call site, which only keeps the lambda alive until the
  // promise IT was given settles. A fire-and-forget fetch resolves this
  // function instantly, letting Vercel freeze the lambda before the request is
  // actually sent — the kick-off silently vanishes. (Confirmed in production:
  // the first real /audit run left status:"running" forever with zero
  // audit_runs rows, because this fetch never got out the door.)
  const secret = process.env.AUDIT_INTERNAL_SECRET || "";
  try {
    await fetch(`${appUrl()}/api/audit/process?id=${report.id}&batch=0`, {
      method: "POST",
      headers: { "x-audit-secret": secret },
    });
  } catch (e) {
    console.error("[run-audit-pipeline] failed to kick off processing:", (e as Error).message);
  }

  return { ok: true, reportId: report.id };
}
