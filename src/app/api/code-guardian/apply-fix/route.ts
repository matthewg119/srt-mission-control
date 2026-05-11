export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import { createFixPR } from "@/lib/code-guardian/github-api";
import type { GuardianAnalysis } from "@/lib/code-guardian/analyzer";

export const runtime = "nodejs";
export const maxDuration = 60;

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

  const body = (await req.json()) as { slack_ts: string; applied_by?: string };
  const { slack_ts, applied_by } = body;

  if (!slack_ts) {
    return NextResponse.json({ error: "slack_ts required" }, { status: 400 });
  }

  // Fetch the pending fix
  const { data: fix, error: fetchErr } = await supabaseAdmin
    .from("code_guardian_fixes")
    .select("*")
    .eq("slack_ts", slack_ts)
    .single();

  if (fetchErr || !fix) {
    return NextResponse.json({ error: "Fix not found" }, { status: 404 });
  }

  if (fix.status !== "pending") {
    return NextResponse.json({ error: `Fix already ${fix.status}` }, { status: 409 });
  }

  const payload = fix.fix_payload as { analysis: GuardianAnalysis; run_id?: string };
  const analysis = payload?.analysis;

  if (!analysis?.proposed_fixes?.length) {
    return NextResponse.json({ error: "No fixes to apply" }, { status: 400 });
  }

  const channel = fix.slack_channel as string;

  try {
    // Mark in-progress immediately to prevent double-apply
    await supabaseAdmin
      .from("code_guardian_fixes")
      .update({ status: "applying", updated_at: new Date().toISOString() })
      .eq("slack_ts", slack_ts);

    const branchName = `guardian/fix-${fix.workflow_name?.toLowerCase().replace(/\s+/g, "-")}-${fix.commit_sha?.slice(0, 7) ?? Date.now()}`;
    const prTitle = `fix: ${analysis.summary.slice(0, 60)}`;
    const prBody =
      `## Code Guardian Auto-Fix\n\n` +
      `**Workflow:** ${fix.workflow_name}\n` +
      `**Commit:** ${fix.commit_sha}\n\n` +
      `### Root Cause\n${analysis.root_cause}\n\n` +
      `### Changes\n${analysis.proposed_fixes.map((f) => `- \`${f.file}\`: ${f.explanation}`).join("\n")}\n\n` +
      (applied_by ? `Applied by <@${applied_by}> via Slack reaction.` : `Applied via Code Guardian.`);

    const prUrl = await createFixPR({
      repo: fix.repo as string,
      baseSha: fix.commit_sha as string,
      fixes: analysis.proposed_fixes,
      branchName,
      prTitle,
      prBody,
    });

    // Update DB
    await supabaseAdmin
      .from("code_guardian_fixes")
      .update({ status: "applied", pr_url: prUrl, updated_at: new Date().toISOString() })
      .eq("slack_ts", slack_ts);

    // Reply in Slack thread
    await slack.postThreadReply(
      channel,
      slack_ts,
      `✅ Fix applied. PR opened: ${prUrl}\n_Branch:_ \`${branchName}\``
    );

    await supabaseAdmin.from("system_logs").insert({
      event_type: "code_guardian_fix_applied",
      description: `PR opened for ${fix.workflow_name}: ${prUrl}`,
      metadata: { pr_url: prUrl, branch: branchName, applied_by },
    });

    return NextResponse.json({ ok: true, pr_url: prUrl });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("[code-guardian/apply-fix] error:", msg);

    await supabaseAdmin
      .from("code_guardian_fixes")
      .update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("slack_ts", slack_ts);

    await slack.postThreadReply(channel, slack_ts, `❌ Failed to apply fix: ${msg}`);

    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
