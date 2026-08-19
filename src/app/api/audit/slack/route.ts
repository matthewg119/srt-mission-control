// /audit <website|"Business Name"> [| city] [| competitor1, competitor2] — Slack slash command.
//
// TWO TARGET SHAPES, because a large share of local businesses have no website at all:
//
//   /audit leadwebsite.com                        the original, unchanged
//   /audit Hernandez Complete Auto Repair | Chicago, IL
//   /audit "Smith & Co. Plumbing" | Chicago, IL   quotes force name mode
//
// The grammar and its reasoning live in lib/audit-engine/parse-audit-command.ts — a Next route
// module may only export handlers, so the parser cannot live here.
//
// City and competitors are NEVER required on a website run: researchWebsite + classifyBusiness
// do the work of figuring out the business type and location on their own. Asking Matthew for
// the city is the rare fallback (low-confidence detection only), not the default path. See
// src/lib/audit-engine/classify.ts.
//
// ‼️ On a NAME run the city IS required, and that is a correctness rule rather than a
// convenience. There is no site to detect a city from, and a trading name is not unique:
// "Hernandez Auto Repair" trades in Durham NC as well as Chicago, so without a city the run
// would score whichever one search happened to surface.
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
import { describeCommand, parseCommandText } from "@/lib/audit-engine/parse-audit-command";

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

  const parsed = parseCommandText(text);
  if (parsed.kind === "error") {
    return NextResponse.json({ response_type: "ephemeral", text: parsed.message });
  }

  const isName = parsed.kind === "name";
  const label = describeCommand(parsed);

  waitUntil(
    runAuditPipeline({
      website: parsed.kind === "website" ? parsed.website : undefined,
      businessName: parsed.kind === "name" ? parsed.name : undefined,
      city: parsed.city,
      competitors: parsed.competitors,
      requestedBy: userId,
      onNeedsCity: (site, bestGuess) => respondToSlack(responseUrl, formatAwaitingCityMessage(site, bestGuess)),
      onError: (message) => respondToSlack(responseUrl, `⚠️ ${message}`),
    })
  );

  return NextResponse.json({
    response_type: "ephemeral",
    text: isName
      ? `🔍 Researching ${label} from third-party sources (no website)...`
      : `🔍 Researching ${label}...`,
  });
}
