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
  /** Public intake has no one to ask for a city — proceed on the best guess instead of blocking. */
  allowLowConfidenceCity?: boolean;
  onNeedsCity?: (website: string, bestGuess: string | null) => Promise<void>;
  onError?: (message: string) => Promise<void>;
}

export interface RunAuditPipelineResult {
  ok: boolean;
  reportId?: string;
}

export async function runAuditPipeline(params: RunAuditPipelineParams): Promise<RunAuditPipelineResult> {
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
      slack_channel_id: channel.id,
    })
    .select("*")
    .single();

  if (insertError || !inserted) {
    await params.onError?.(`Could not save audit report: ${insertError?.message ?? "unknown error"}`);
    return { ok: false };
  }

  const report = inserted as AuditReportRow;
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
