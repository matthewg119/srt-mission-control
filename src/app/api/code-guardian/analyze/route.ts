import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { slack, type SlackBlock } from "@/lib/slack-bot";
import { fetchWorkflowLogs, fetchCommitFiles } from "@/lib/code-guardian/github-api";
import { analyzeFailure } from "@/lib/code-guardian/analyzer";

export const runtime = "nodejs";
export const maxDuration = 120;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
  return header === `Bearer ${secret}`;
}

function buildSlackBlocks(opts: {
  workflowName: string;
  commitSha: string;
  repo: string;
  summary: string;
  rootCause: string;
  fixes: Array<{ file: string; explanation: string }>;
  confidence: string;
}): SlackBlock[] {
  const { workflowName, commitSha, repo, summary, rootCause, fixes, confidence } = opts;
  const shortSha = commitSha.slice(0, 7);
  const confidenceEmoji = confidence === "high" ? "🟢" : confidence === "medium" ? "🟡" : "🔴";

  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: "🛡️ Code Guardian — Failure Detected", emoji: true },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Workflow:*\n${workflowName}` },
        { type: "mrkdwn", text: `*Commit:*\n\`${shortSha}\` on \`main\`` },
        { type: "mrkdwn", text: `*Repo:*\n${repo}` },
        { type: "mrkdwn", text: `*Confidence:*\n${confidenceEmoji} ${confidence}` },
      ],
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Summary:* ${summary}` },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Root cause:*\n${rootCause}` },
    },
  ];

  if (fixes.length > 0) {
    const fixLines = fixes.map((f) => `• \`${f.file}\` — ${f.explanation}`).join("\n");
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Proposed fixes (${fixes.length}):*\n${fixLines}` },
    });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `React ✅ to apply fixes as a PR  |  React ✏️ to request revision  |  React ❌ to skip`,
      },
    });
  } else {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `_No code fix proposed — reply in thread for more analysis._`,
      },
    });
  }

  return blocks;
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
  };

  const workflowName = body.workflow_name ?? "Unknown Workflow";
  const runId = body.run_id ?? "";
  const commitSha = body.commit_sha ?? "";
  const repo = body.repo ?? "";

  const guardianChannel = process.env.SLACK_CODE_GUARDIAN_CHANNEL;
  if (!guardianChannel) {
    return NextResponse.json({ ok: false, error: "SLACK_CODE_GUARDIAN_CHANNEL not set" }, { status: 500 });
  }

  const start = Date.now();
  try {
    // Fetch logs and changed files in parallel
    const [jobLogs, changedFiles] = await Promise.all([
      fetchWorkflowLogs(repo, runId),
      commitSha ? fetchCommitFiles(repo, commitSha) : Promise.resolve([]),
    ]);

    // Run Claude analysis
    const analysis = await analyzeFailure({ workflowName, commitSha, repo, jobLogs, changedFiles });

    // Post to Slack
    const blocks = buildSlackBlocks({
      workflowName,
      commitSha,
      repo,
      summary: analysis.summary,
      rootCause: analysis.root_cause,
      fixes: analysis.proposed_fixes.map((f) => ({ file: f.file, explanation: f.explanation })),
      confidence: analysis.confidence,
    });

    const slackRes = await slack.postMessage(guardianChannel, `🛡️ Code Guardian: ${workflowName} failed`, blocks);
    const slackTs = (slackRes as Record<string, unknown>)?.ts as string | undefined;

    // Persist to DB
    if (slackTs) {
      await supabaseAdmin.from("code_guardian_fixes").insert({
        slack_ts: slackTs,
        slack_channel: guardianChannel,
        workflow_name: workflowName,
        commit_sha: commitSha,
        repo,
        fix_payload: { analysis, run_id: runId, changed_files: changedFiles.map((f) => f.filename) },
        status: "pending",
      });
    }

    await supabaseAdmin.from("system_logs").insert({
      event_type: "code_guardian_analyzed",
      description: `${workflowName}: ${analysis.summary}`,
      metadata: { repo, commit_sha: commitSha, confidence: analysis.confidence, duration_ms: Date.now() - start },
    });

    return NextResponse.json({ ok: true, confidence: analysis.confidence, fixes: analysis.proposed_fixes.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("[code-guardian/analyze] error:", msg);
    await supabaseAdmin.from("system_logs").insert({
      event_type: "code_guardian_error",
      description: msg,
      metadata: { workflow_name: workflowName, repo, duration_ms: Date.now() - start },
    });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
