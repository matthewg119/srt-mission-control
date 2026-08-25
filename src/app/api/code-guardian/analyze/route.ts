export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { runGuardianAnalysis, guardianRepo, type GuardianSource } from "@/lib/code-guardian/report";

export const runtime = "nodejs";
export const maxDuration = 120;

// Thin entry point. The analysis itself lives in @/lib/code-guardian/report so
// that /api/cron/cron-health can reuse it in-process instead of calling back into
// this route over the network.

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
  return header === `Bearer ${secret}`;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as {
    workflow_name?: string;
    run_id?: string;
    commit_sha?: string;
    branch?: string;
    repo?: string;
    source?: string;
    error_text?: string;
  };

  // Defaults to "github" so the existing workflow_run payload from
  // .github/workflows/code-guardian.yml keeps working untouched.
  const source: GuardianSource = body.source === "vercel-cron" ? "vercel-cron" : "github";

  const result = await runGuardianAnalysis({
    source,
    workflowName: body.workflow_name ?? "Unknown Workflow",
    repo: body.repo || guardianRepo(),
    commitSha: body.commit_sha ?? "",
    runId: body.run_id ?? "",
    errorText: body.error_text ?? "",
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true, confidence: result.confidence, fixes: result.fixes });
}
