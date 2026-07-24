// /audit <website> [| city] [| competitor1, competitor2] — Slack slash command.
//
// City and competitors are NEVER required: researchWebsite + classifyBusiness do
// the work of figuring out the business type and location on their own. Asking
// Matthew for the city is the rare fallback (low-confidence detection only), not
// the default path. See src/lib/audit-engine/classify.ts.
//
// Acks in <3s, then does the real work in the background (waitUntil) and reports
// back via response_url + a message in #ai-visibility-audits. The actual
// research/classify/create/kick-off pipeline is shared with the public
// srtagency.com free-audit intake — see run-audit-pipeline.ts.

import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { slack } from "@/lib/slack-bot";
import { runAuditPipeline } from "@/lib/audit-engine/run-audit-pipeline";
import { formatAwaitingCityMessage } from "@/lib/audit-engine/slack-format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

  waitUntil(
    runAuditPipeline({
      website,
      city,
      competitors,
      requestedBy: userId,
      onNeedsCity: (site, bestGuess) => respondToSlack(responseUrl, formatAwaitingCityMessage(site, bestGuess)),
      onError: (message) => respondToSlack(responseUrl, `⚠️ ${message}`),
    })
  );

  return NextResponse.json({
    response_type: "ephemeral",
    text: `🔍 Researching ${website}...`,
  });
}
