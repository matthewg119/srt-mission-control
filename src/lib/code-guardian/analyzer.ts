import { callClaudeJSON, callClaudeText } from "@/lib/claude-calls";
import type { JobLog, CommitFile, ProposedFix } from "./github-api";

const SCHEMA_HINT = `{
  "root_cause": string,
  "affected_files": string[],
  "proposed_fixes": [
    {
      "file": string,
      "old_code": string,
      "new_code": string,
      "explanation": string
    }
  ],
  "confidence": "high" | "medium" | "low",
  "summary": string
}`;

const SYSTEM_PROMPT = `You are Code Guardian — an AI engineer monitoring a Next.js TypeScript monorepo (srt-mission-control) for SRT Agency LLC.

Your job: given a failed GitHub Actions workflow, its error logs, and the changed files from the triggering commit, identify the root cause and propose a minimal, targeted fix.

Rules:
- Only propose fixes you are highly confident about. If unsure, set confidence="low" and leave proposed_fixes empty.
- Each fix must be a complete file replacement (full new_code for the file), not a partial snippet.
- Prefer the smallest diff that resolves the issue. Do not refactor unrelated code.
- If the error is a transient infrastructure issue (network timeout, rate limit), set confidence="low" and explain in root_cause.
- proposed_fixes array may be empty if no code change is needed.
- summary is 1-2 sentences for the Slack card headline.`;

export interface GuardianAnalysis {
  root_cause: string;
  affected_files: string[];
  proposed_fixes: ProposedFix[];
  confidence: "high" | "medium" | "low";
  summary: string;
}

export async function analyzeFailure(opts: {
  workflowName: string;
  commitSha: string;
  repo: string;
  jobLogs: JobLog[];
  changedFiles: CommitFile[];
}): Promise<GuardianAnalysis> {
  const { workflowName, commitSha, repo, jobLogs, changedFiles } = opts;

  const logsSection = jobLogs.length
    ? jobLogs.map((j) => `### Job: ${j.jobName}\n${j.log || "(no log)"}`).join("\n\n")
    : "(no logs available)";

  const filesSection = changedFiles.length
    ? changedFiles
        .map(
          (f) =>
            `### ${f.filename} (${f.status})\n` +
            (f.patch ? `**Diff:**\n\`\`\`diff\n${f.patch.slice(0, 2000)}\n\`\`\`\n` : "") +
            (f.content ? `**Full content:**\n\`\`\`typescript\n${f.content.slice(0, 4000)}\n\`\`\`` : "")
        )
        .join("\n\n")
    : "(no changed files available)";

  const userPrompt = `Workflow: ${workflowName}
Repo: ${repo}
Commit: ${commitSha}

## Error Logs
${logsSection}

## Changed Files in This Commit
${filesSection}

Identify the root cause and provide proposed fixes.`;

  const result = await callClaudeJSON<GuardianAnalysis>({
    model: "claude-sonnet-4-6",
    system: SYSTEM_PROMPT,
    user: userPrompt,
    maxTokens: 4096,
    temperature: 0.1,
    schemaHint: SCHEMA_HINT,
  });

  return result.data;
}

/** Follow-up conversational analysis — used when the user replies in thread. */
export async function answerGuardianQuestion(opts: {
  question: string;
  originalAnalysis: GuardianAnalysis;
  workflowName: string;
}): Promise<string> {
  const { question, originalAnalysis, workflowName } = opts;

  const result = await callClaudeText({
    model: "claude-sonnet-4-6",
    system: `You are Code Guardian, answering follow-up questions about a code failure in ${workflowName}. Be direct and concise. No filler. Facts only.`,
    user: `Original analysis:\n${JSON.stringify(originalAnalysis, null, 2)}\n\nUser question: ${question}`,
    maxTokens: 1024,
    temperature: 0.2,
  });

  return result.text;
}
