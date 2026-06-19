export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { postApprovalRequest } from "@/lib/ai-intel/slack-approval";
import { dedupCheck, suggestActions, buildApplyCard, type ApplyInput } from "@/lib/ai-intel/apply-intel";

// Ingestion endpoint for srtagency.com/apply submissions. The portal calls this
// after it has stored the standalone_applications row and uploaded the PDFs.
// We run a dedup search, ask Claude what to do, and post a gated #srt-sub card
// with a "Check" button (executes the suggested actions on click).
export async function POST(req: NextRequest) {
  // Shared-secret guard. Enforced only when APPLY_INGEST_SECRET is configured,
  // so the flow keeps working before the env is set on both repos.
  const secret = process.env.APPLY_INGEST_SECRET;
  if (secret && req.headers.get("x-api-key") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: { applicationId?: string; application?: ApplyInput; onedriveLinks?: string };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const applicationId = payload.applicationId;
  const app = payload.application;
  if (!applicationId || !app) {
    return NextResponse.json({ error: "applicationId and application required" }, { status: 400 });
  }

  const businessName = (app.business_name || "").trim();

  try {
    const dedup = await dedupCheck(businessName);
    const suggestion = await suggestActions(app, dedup);

    const result = await postApprovalRequest({
      summary: suggestion.summary,
      channel: process.env.SLACK_SUB_CHANNEL || "C0AJXH7PTBM",
      blocks: buildApplyCard(app, dedup, suggestion, payload.onedriveLinks),
      payload: {
        action_type: "apply_followup",
        application_id: applicationId,
        business_name: businessName,
        suggested_actions: suggestion.actions,
        dedup,
        zoho_id: dedup.existing_zoho_id ?? undefined,
      },
    });

    // Persist the card ts back onto the application row.
    if (result.slackTs) {
      await supabaseAdmin
        .from("standalone_applications")
        .update({ slack_ts: result.slackTs })
        .eq("id", applicationId);
    }

    return NextResponse.json({ ok: true, slackTs: result.slackTs, dedup, actions: suggestion.actions.length });
  } catch (e) {
    console.error("[apply/ingest] failed:", (e as Error).message);
    return NextResponse.json({ error: "ingest_failed" }, { status: 500 });
  }
}
