const GH_API = "https://api.github.com";

function token(): string {
  return process.env.GITHUB_TOKEN ?? "";
}

function headers() {
  return {
    Authorization: `Bearer ${token()}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

export interface JobLog {
  jobName: string;
  log: string;
}

/** Fetch all job logs for a workflow run. Returns truncated text per job. */
export async function fetchWorkflowLogs(repo: string, runId: string): Promise<JobLog[]> {
  const t = token();
  if (!t) return [];

  // Get list of jobs for this run
  const jobsRes = await fetch(`${GH_API}/repos/${repo}/actions/runs/${runId}/jobs`, { headers: headers() });
  if (!jobsRes.ok) return [];
  const jobsJson = (await jobsRes.json()) as { jobs: Array<{ id: number; name: string; conclusion: string }> };

  const failedJobs = jobsJson.jobs.filter((j) => j.conclusion === "failure" || j.conclusion === "timed_out");
  if (failedJobs.length === 0) return jobsJson.jobs.slice(0, 3).map((j) => ({ jobName: j.name, log: "" }));

  const logs = await Promise.all(
    failedJobs.slice(0, 3).map(async (job) => {
      const logRes = await fetch(`${GH_API}/repos/${repo}/actions/jobs/${job.id}/logs`, {
        headers: headers(),
        redirect: "follow",
      });
      const logText = logRes.ok ? await logRes.text() : "";
      // Keep last 6000 chars (most relevant tail)
      return { jobName: job.name, log: logText.slice(-6000) };
    })
  );
  return logs;
}

export interface CommitFile {
  filename: string;
  status: string;
  patch?: string;
  content?: string;
}

/** Get files changed in a commit with their content (base64-decoded). */
export async function fetchCommitFiles(repo: string, sha: string): Promise<CommitFile[]> {
  const t = token();
  if (!t) return [];

  const res = await fetch(`${GH_API}/repos/${repo}/commits/${sha}`, { headers: headers() });
  if (!res.ok) return [];
  const json = (await res.json()) as { files?: Array<{ filename: string; status: string; patch?: string }> };
  if (!json.files) return [];

  const relevant = json.files
    .filter((f) => f.status !== "removed" && /\.(ts|tsx|js|jsx|json|yml|yaml)$/.test(f.filename))
    .slice(0, 10);

  const withContent = await Promise.all(
    relevant.map(async (f) => {
      const contentRes = await fetch(`${GH_API}/repos/${repo}/contents/${f.filename}?ref=${sha}`, {
        headers: headers(),
      });
      let content = "";
      if (contentRes.ok) {
        const json2 = (await contentRes.json()) as { content?: string; encoding?: string };
        if (json2.encoding === "base64" && json2.content) {
          content = Buffer.from(json2.content.replace(/\n/g, ""), "base64").toString("utf8");
        }
      }
      return { filename: f.filename, status: f.status, patch: f.patch, content };
    })
  );
  return withContent;
}

export interface ProposedFix {
  file: string;
  old_code: string;
  new_code: string;
  explanation: string;
}

/** Create a branch, commit the fixes, and open a PR. Returns the PR URL. */
export async function createFixPR(opts: {
  repo: string;
  /** The commit that failed. Context only — the fix branches from head of main. */
  baseSha?: string;
  fixes: ProposedFix[];
  branchName: string;
  prTitle: string;
  prBody: string;
}): Promise<string> {
  const { repo, fixes, branchName, prTitle, prBody } = opts;

  // 1. Branch from the CURRENT head of main, tree and parent both.
  //
  // These used to disagree: the tree was based on the failing commit while the
  // parent was head of main. Git resolves that as "make the repo look like the old
  // commit, on top of main", so merging the PR silently reverted every file changed
  // in between. The failing commit is still shown on the card for context, but it
  // must never be the base of the fix.
  const refRes = await fetch(`${GH_API}/repos/${repo}/git/ref/heads/main`, { headers: headers() });
  if (!refRes.ok) throw new Error(`Failed to get main ref: ${await refRes.text()}`);
  const refJson = (await refRes.json()) as { object: { sha: string } };
  const headSha = refJson.object.sha;

  // base_tree needs a TREE sha, not a commit sha — read the commit to get it.
  const headCommitRes = await fetch(`${GH_API}/repos/${repo}/git/commits/${headSha}`, { headers: headers() });
  if (!headCommitRes.ok) throw new Error(`Failed to read main commit: ${await headCommitRes.text()}`);
  const headCommit = (await headCommitRes.json()) as { tree: { sha: string } };
  const baseTreeSha = headCommit.tree.sha;

  // 2. Create blobs for each changed file
  const treeItems = await Promise.all(
    fixes.map(async (fix) => {
      const blobRes = await fetch(`${GH_API}/repos/${repo}/git/blobs`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ content: fix.new_code, encoding: "utf-8" }),
      });
      if (!blobRes.ok) throw new Error(`Failed to create blob for ${fix.file}`);
      const blob = (await blobRes.json()) as { sha: string };
      return { path: fix.file, mode: "100644", type: "blob", sha: blob.sha };
    })
  );

  // 3. Create a new tree
  const treeRes = await fetch(`${GH_API}/repos/${repo}/git/trees`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeItems }),
  });
  if (!treeRes.ok) throw new Error(`Failed to create tree: ${await treeRes.text()}`);
  const tree = (await treeRes.json()) as { sha: string };

  // 4. Create a commit
  const commitRes = await fetch(`${GH_API}/repos/${repo}/git/commits`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      message: `fix: ${prTitle}\n\nApplied by Code Guardian`,
      tree: tree.sha,
      parents: [headSha],
    }),
  });
  if (!commitRes.ok) throw new Error(`Failed to create commit: ${await commitRes.text()}`);
  const commit = (await commitRes.json()) as { sha: string };

  // 5. Create branch pointing at new commit
  const branchRes = await fetch(`${GH_API}/repos/${repo}/git/refs`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: commit.sha }),
  });
  if (!branchRes.ok) throw new Error(`Failed to create branch: ${await branchRes.text()}`);

  // 6. Open PR
  const prRes = await fetch(`${GH_API}/repos/${repo}/pulls`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ title: prTitle, body: prBody, head: branchName, base: "main" }),
  });
  if (!prRes.ok) throw new Error(`Failed to create PR: ${await prRes.text()}`);
  const pr = (await prRes.json()) as { html_url: string };
  return pr.html_url;
}
