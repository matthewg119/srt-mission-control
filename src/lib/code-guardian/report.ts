// The guardian's core: take a failure, analyze it, post the card, persist it.
//
// This lives in a lib rather than inside the analyze route because there are now
// two callers with different failure shapes:
//   - "github"      — a workflow_run failure forwarded by .github/workflows/code-guardian.yml
//   - "vercel-cron" — a Vercel cron that died or logged an error, found by /api/cron/cron-health
//
// Vercel crons have no GitHub run id and therefore no job logs, so that path
// carries its own error text instead. Everything downstream (Claude analysis,
// Slack card, code_guardian_fixes row) is identical, and keeping it identical is
// the point: the ✅/✏️/❌ reaction handlers in api/slack/events work on the row,
// not on where the failure came from.

import { supabaseAdmin } from "@/lib/db";
import { slack, type SlackBlock } from "@/lib/slack-bot";
import { fetchWorkflowLogs, fetchCommitFiles } from "./github-api";
import { analyzeFailure } from "./analyzer";

export type GuardianSource = "github" | "vercel-cron";

export interface GuardianReportInput {
  source: GuardianSource;
  /** Workflow name, or for crons the route path. Stored as code_guardian_fixes.workflow_name. */
  workflowName: string;
  repo: string;
  commitSha?: string;
  /** GitHub only. */
  runId?: string;
  /** vercel-cron only: what actually went wrong, used in place of job logs. */
  errorText?: string;
}

export interface GuardianReportResult {
  ok: boolean;
  posted: boolean;
  confidence?: string;
  fixes?: number;
  error?: string;
}

/** Repo slug for GitHub API reads. Overridable, but the default is the live repo. */
export function guardianRepo(): string {
  return process.env.GITHUB_REPO || "matthewg119/srt-mission-control";
}

function buildSlackBlocks(opts: {
  source: GuardianSource;
  workflowName: string;
  commitSha: string;
  repo: string;
  summary: string;
  rootCause: string;
  fixes: Array<{ file: string; explanation: string }>;
  confidence: string;
}): SlackBlock[] {
  const { source, workflowName, commitSha, repo, summary, rootCause, fixes, confidence } = opts;
  const shortSha = commitSha ? commitSha.slice(0, 7) : "unknown";
  const confidenceEmoji = confidence === "high" ? "🟢" : confidence === "medium" ? "🟡" : "🔴";
  const isCron = source === "vercel-cron";

  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: isCron ? "🛡️ Code Guardian — Cron Failure" : "🛡️ Code Guardian — Failure Detected",
        emoji: true,
      },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*${isCron ? "Cron" : "Workflow"}:*\n${workflowName}` },
        { type: "mrkdwn", text: `*Commit:*\n\`${shortSha}\` on \`main\`` },
        { type: "mrkdwn", text: `*Repo:*\n${repo}` },
        { type: "mrkdwn", text: `*Confidence:*\n${confidenceEmoji} ${confidence}` },
      ],
    },
    { type: "section", text: { type: "mrkdwn", text: `*Summary:* ${summary}` } },
    { type: "section", text: { type: "mrkdwn", text: `*Root cause:*\n${rootCause}` } },
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
      text: { type: "mrkdwn", text: `_No code fix proposed — reply in thread for more analysis._` },
    });
  }

  return blocks;
}

/**
 * Has this same failure already been carded and left unactioned recently? Without
 * this an hourly sweep re-cards a stuck cron every hour until someone reacts.
 */
export async function hasRecentPendingCard(workflowName: string, withinHours = 24): Promise<boolean> {
  const since = new Date(Date.now() - withinHours * 60 * 60 * 1000).toISOString();
  const { data } = await supabaseAdmin
    .from("code_guardian_fixes")
    .select("id")
    .eq("workflow_name", workflowName)
    .eq("status", "pending")
    .gte("created_at", since)
    .limit(1);
  return (data ?? []).length > 0;
}

/** Analyze a failure and post the guardian card. Throws only on programmer error. */
export async function runGuardianAnalysis(input: GuardianReportInput): Promise<GuardianReportResult> {
  const { source, workflowName, repo, commitSha = "", runId = "", errorText = "" } = input;

  const guardianChannel = process.env.SLACK_CODE_GUARDIAN_CHANNEL;
  if (!guardianChannel) {
    return { ok: false, posted: false, error: "SLACK_CODE_GUARDIAN_CHANNEL not set" };
  }

  const start = Date.now();
  try {
    // A cron failure has no GitHub run to pull logs from — its error text is the
    // log. Commit files are still worth fetching: a cron that started failing is
    // usually explained by whatever shipped most recently.
    const [jobLogs, changedFiles] = await Promise.all([
      source === "github" && runId ? fetchWorkflowLogs(repo, runId) : Promise.resolve([]),
      commitSha ? fetchCommitFiles(repo, commitSha) : Promise.resolve([]),
    ]);

    const logs =
      source === "vercel-cron"
        ? [{ jobName: `Vercel cron ${workflowName}`, log: errorText || "(no error text captured)" }]
        : jobLogs;

    const analysis = await analyzeFailure({ workflowName, commitSha, repo, jobLogs: logs, changedFiles });

    const blocks = buildSlackBlocks({
      source,
      workflowName,
      commitSha,
      repo,
      summary: analysis.summary,
      rootCause: analysis.root_cause,
      fixes: analysis.proposed_fixes.map((f) => ({ file: f.file, explanation: f.explanation })),
      confidence: analysis.confidence,
    });

    const headline =
      source === "vercel-cron"
        ? `🛡️ Code Guardian: cron ${workflowName} failed`
        : `🛡️ Code Guardian: ${workflowName} failed`;
    const slackRes = await slack.postMessage(guardianChannel, headline, blocks);
    const slackTs = (slackRes as Record<string, unknown>)?.ts as string | undefined;

    if (slackTs) {
      await supabaseAdmin.from("code_guardian_fixes").insert({
        slack_ts: slackTs,
        slack_channel: guardianChannel,
        workflow_name: workflowName,
        commit_sha: commitSha,
        repo,
        fix_payload: {
          analysis,
          source,
          run_id: runId,
          error_text: errorText || undefined,
          changed_files: changedFiles.map((f) => f.filename),
        },
        status: "pending",
      });
    }

    await supabaseAdmin.from("system_logs").insert({
      event_type: "code_guardian_analyzed",
      description: `${workflowName}: ${analysis.summary}`,
      metadata: {
        repo,
        source,
        commit_sha: commitSha,
        confidence: analysis.confidence,
        duration_ms: Date.now() - start,
      },
    });

    return { ok: true, posted: Boolean(slackTs), confidence: analysis.confidence, fixes: analysis.proposed_fixes.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("[code-guardian] analysis failed:", msg);
    await supabaseAdmin.from("system_logs").insert({
      event_type: "code_guardian_error",
      description: msg,
      metadata: { workflow_name: workflowName, source, repo, duration_ms: Date.now() - start },
    });
    return { ok: false, posted: false, error: msg };
  }
}
