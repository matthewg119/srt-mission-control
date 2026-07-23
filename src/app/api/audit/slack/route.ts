// /audit <website> [| city] [| competitor1, competitor2] — Slack slash command.
//
// City and competitors are NEVER required: researchWebsite + classifyBusiness do
// the work of figuring out the business type and location on their own. Asking
// Matthew for the city is the rare fallback (low-confidence detection only), not
// the default path. See src/lib/audit-engine/classify.ts.
//
// Acks in <3s, then does the real work in the background (waitUntil) and reports
// back via response_url + a message in #ai-visibility-audits.

import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { slack } from "@/lib/slack-bot";
import { supabaseAdmin } from "@/lib/db";
import { researchWebsite } from "@/lib/audit-engine/site-research";
import { classifyBusiness } from "@/lib/audit-engine/classify";
import { generateSlug } from "@/lib/audit-engine/slug";
import { getOrCreateAuditChannel } from "@/lib/audit-engine/audit-channel";
import { formatPromptDrop, formatAwaitingCityMessage } from "@/lib/audit-engine/slack-format";
import type { AuditReportRow } from "@/lib/audit-engine/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";
}

async function respondToSlack(responseUrl: string, text: string): Promise<void> {
  if (!responseUrl) return;
  await fetch(responseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ response_type: "ephemeral", text }),
  }).catch((e) => console.error("[audit/slack] response_url post failed:", (e as Error).message));
}

function parseCommandText(text: string): { website: string; city?: string; competitors?: string[] } {
  const parts = text.split("|").map((p) => p.trim()).filter(Boolean);
  const [website, city, competitorsRaw] = parts;
  const competitors = competitorsRaw
    ? competitorsRaw.split(",").map((c) => c.trim()).filter(Boolean)
    : undefined;
  return { website, city, competitors };
}

async function runAudit(params: { website: string; city?: string; competitors?: string[]; userId: string; responseUrl: string }) {
  const { website, city, competitors, userId, responseUrl } = params;

  let research;
  try {
    research = await researchWebsite(website);
  } catch (e) {
    await respondToSlack(responseUrl, `⚠️ Couldn't fetch ${website}: ${(e as Error).message}`);
    return;
  }

  let classification;
  try {
    classification = await classifyBusiness(research, { city, competitors });
  } catch (e) {
    await respondToSlack(responseUrl, `⚠️ Classification failed for ${website}: ${(e as Error).message}`);
    return;
  }

  // A city is only ever required for local businesses — a national/online/B2B
  // business (is_local:false) proceeds with no city, no fallback question.
  if (classification.is_local && classification.city_confidence === "low") {
    await respondToSlack(responseUrl, formatAwaitingCityMessage(website, classification.city_detected));
    return;
  }

  const channel = await getOrCreateAuditChannel();
  const slug = await generateSlug();

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("audit_reports")
    .insert({
      slug,
      website,
      city: classification.city_detected,
      business_type: classification.business_type,
      vertical_slug: classification.vertical_slug,
      buyer_persona: classification.buyer_persona,
      competitors: classification.likely_competitors,
      prompts: classification.prompts,
      status: "running",
      requested_by: userId,
      slack_channel_id: channel.id,
    })
    .select("*")
    .single();

  if (insertError || !inserted) {
    await respondToSlack(responseUrl, `⚠️ Could not save audit report: ${insertError?.message ?? "unknown error"}`);
    return;
  }

  const report = inserted as AuditReportRow;
  const { text: dropText } = formatPromptDrop(report);
  const posted = await slack.postMessage(channel.id, dropText);
  const threadTs = (posted as { ts?: string }).ts;

  if (threadTs) {
    await supabaseAdmin.from("audit_reports").update({ slack_thread_ts: threadTs }).eq("id", report.id);
  }

  // Kick off batch processing. Internal route self-chains through the remaining
  // batches. MUST be awaited here — runAudit() itself runs inside waitUntil() at
  // the call site below, and waitUntil only keeps the lambda alive until the
  // promise IT was given settles. A fire-and-forget fetch here resolves
  // runAudit() instantly, letting Vercel freeze the lambda before the request
  // is actually sent — the kick-off silently vanishes. (Confirmed in production:
  // the first real /audit run left status:"running" forever with zero audit_runs
  // rows, because this fetch never got out the door.)
  const secret = process.env.AUDIT_INTERNAL_SECRET || "";
  try {
    await fetch(`${appUrl()}/api/audit/process?id=${report.id}&batch=0`, {
      method: "POST",
      headers: { "x-audit-secret": secret },
    });
  } catch (e) {
    console.error("[audit/slack] failed to kick off processing:", (e as Error).message);
  }
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  const signingSecret = process.env.SLACK_SIGNING_SECRET || "";
  const timestamp = req.headers.get("x-slack-request-timestamp") || "";
  const signature = req.headers.get("x-slack-signature") || "";

  if (!signingSecret || !timestamp || !signature) {
    return NextResponse.json({ error: "missing_signature" }, { status: 403 });
  }
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp, 10)) > 300) {
    return NextResponse.json({ error: "stale_request" }, { status: 403 });
  }
  if (!slack.verifySignature(signingSecret, timestamp, rawBody, signature)) {
    return NextResponse.json({ error: "bad_signature" }, { status: 403 });
  }

  const params = new URLSearchParams(rawBody);
  const text = (params.get("text") ?? "").trim();
  const userId = params.get("user_id") ?? "";
  const responseUrl = params.get("response_url") ?? "";

  const { website, city, competitors } = parseCommandText(text);
  if (!website) {
    return NextResponse.json({
      response_type: "ephemeral",
      text: "Usage: `/audit https://website.com` (optionally `| City, ST | competitor1, competitor2` — both optional, the system researches these on its own).",
    });
  }

  waitUntil(runAudit({ website, city, competitors, userId, responseUrl }));

  return NextResponse.json({
    response_type: "ephemeral",
    text: `🔍 Researching ${website}...`,
  });
}
