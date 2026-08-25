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
- If a file is too large for you to reproduce in full, DO NOT propose a fix for it. Describe the
  problem in root_cause instead and leave it out of proposed_fixes. A truncated file is worse than
  no fix at all, because it silently deletes code.
- Never emit a new_code shorter than the original unless you are deliberately deleting code and say so.
- Prefer the smallest diff that resolves the issue. Do not refactor unrelated code.
- If the error is a transient infrastructure issue (network timeout, rate limit), set confidence="low" and explain in root_cause.
- proposed_fixes array may be empty if no code change is needed.
- summary is 1-2 sentences for the Slack card headline.`;

// Roughly 6k tokens of source. A whole-file rewrite has to fit inside the 8k
// output ceiling along with the rest of the JSON payload, so anything past this
// cannot be safely rewritten and is withheld from the prompt instead.
const MAX_REWRITABLE_CHARS = 24_000;

// A rewrite that comes back dramatically shorter than the file it replaces is the
// signature of a truncated generation, not a deliberate deletion. Applying one
// would delete working code, and the apply path opens a PR straight from it.
const MIN_REWRITE_RATIO = 0.6;

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

  // With neither logs nor changed files there is nothing to reason from, and the
  // model will still happily produce a plausible root cause. Usually this means
  // GITHUB_TOKEN is unset, so both fetchers returned [] silently — say that
  // instead of guessing.
  const hasLogs = jobLogs.some((j) => j.log?.trim());
  if (!hasLogs && changedFiles.length === 0) {
    return {
      root_cause:
        "No diagnostic context was available: no job logs and no changed files. " +
        "This usually means GITHUB_TOKEN is unset or lacks access, so the log and " +
        "commit fetches returned empty rather than failing.",
      affected_files: [],
      proposed_fixes: [],
      confidence: "low",
      summary: `${workflowName} failed, but no logs or diff could be retrieved to analyze it.`,
    };
  }

  const logsSection = jobLogs.length
    ? jobLogs.map((j) => `### Job: ${j.jobName}\n${j.log || "(no log)"}`).join("\n\n")
    : "(no logs available)";

  // A file is shown in full only when a full rewrite is achievable within the
  // output budget. Past that it is named but withheld: showing the first N chars
  // while asking for a whole-file replacement is what produced confident rewrites
  // of files the model never saw the end of.
  const filesSection = changedFiles.length
    ? changedFiles
        .map((f) => {
          const head = `### ${f.filename} (${f.status})\n`;
          const diff = f.patch ? `**Diff:**\n\`\`\`diff\n${f.patch.slice(0, 2000)}\n\`\`\`\n` : "";
          if (!f.content) return head + diff;
          if (f.content.length > MAX_REWRITABLE_CHARS) {
            return (
              head +
              diff +
              `**Full content omitted** — ${f.content.length} chars, too large to rewrite in full. ` +
              `Diagnose it if relevant, but do not propose a fix for it.`
            );
          }
          return head + diff + `**Full content:**\n\`\`\`typescript\n${f.content}\n\`\`\``;
        })
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
    maxTokens: 8000, // MAX_RETRY_TOKENS in claude-calls.ts caps retries here anyway
    temperature: 0.1,
    schemaHint: SCHEMA_HINT,
  });

  return dropTruncatedFixes(result.data, changedFiles);
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

/**
 * Drop any proposed fix whose new_code looks truncated relative to the file it
 * claims to replace, and downgrade confidence when that happens. Silence here is
 * intentional-looking damage; a dropped fix just means someone reads the root
 * cause and fixes it by hand.
 */
function dropTruncatedFixes(analysis: GuardianAnalysis, changedFiles: CommitFile[]): GuardianAnalysis {
  if (!analysis.proposed_fixes?.length) return analysis;

  const sizeByFile = new Map<string, number>();
  for (const f of changedFiles) {
    if (f.content) sizeByFile.set(f.filename, f.content.length);
  }

  const rejected: string[] = [];
  const kept = analysis.proposed_fixes.filter((fix) => {
    const original = sizeByFile.get(fix.file);
    if (original === undefined) return true; // never saw the file; nothing to compare against
    if (original > MAX_REWRITABLE_CHARS) {
      rejected.push(`${fix.file} (file too large to rewrite safely)`);
      return false;
    }
    if ((fix.new_code?.length ?? 0) < original * MIN_REWRITE_RATIO) {
      rejected.push(`${fix.file} (rewrite was ${fix.new_code?.length ?? 0} chars vs ${original} original)`);
      return false;
    }
    return true;
  });

  if (rejected.length === 0) return analysis;

  return {
    ...analysis,
    proposed_fixes: kept,
    confidence: "low",
    root_cause:
      `${analysis.root_cause}\n\n⚠️ Discarded ${rejected.length} proposed fix(es) that came back ` +
      `truncated: ${rejected.join("; ")}. Fix these by hand.`,
  };
}
