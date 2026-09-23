// Reading this repository's own source, at runtime.
//
// ‼️ IT CANNOT BE THE FILESYSTEM, AND THIS IS THE WHOLE REASON THE FILE EXISTS. `src/` is not in the
// Vercel serverless bundle. scripts/_probe-do-this-now.ts reads the tree with readdirSync and works
// because a probe is a SCRIPT, run with the repository on disk; the same call in a route returns
// nothing, or throws, depending on the runtime. The only thing in this repo that reads its own code
// in production is Code Guardian, through the GitHub API, and this uses the same door and the same
// token.
//
// ‼️ BOUNDED, ALWAYS. Four files, fourteen thousand characters each, named by the caller. A weekly
// review that fetched the tree would spend its whole budget on files it did not need and would put
// the entire codebase into one model call for a suggestion about one card.
//
// ‼️ NO TOKEN IS AN EMPTY ANSWER, NEVER A THROWN ONE. github-api.ts makes the same choice and
// analyzer.ts's prompt then says so out loud rather than letting the model invent what it could not
// read.

const GH_API = "https://api.github.com";

export function guardianRepo(): string {
  return process.env.GITHUB_REPO || "matthewg119/srt-mission-control";
}

function headers(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN;
  return {
    accept: "application/vnd.github+json",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

export interface SourceFile {
  path: string;
  content: string;
}

/**
 * Fetch named files from the default branch.
 *
 * Paths are repository-relative, exactly as `implementedIn` records them ("src/lib/clients/x.ts").
 * A file that cannot be read is skipped rather than failing the batch: three of four files is still
 * a proposal worth making, and the caller says which it read.
 */
export async function fetchFileContents(repo: string, paths: readonly string[]): Promise<SourceFile[]> {
  if (!process.env.GITHUB_TOKEN) return [];

  const out: SourceFile[] = [];
  for (const path of paths.slice(0, 4)) {
    try {
      const res = await fetch(`${GH_API}/repos/${repo}/contents/${encodeURI(path)}`, {
        headers: headers(),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) continue;
      const json = (await res.json()) as { content?: string; encoding?: string };
      if (!json.content || json.encoding !== "base64") continue;
      out.push({ path, content: Buffer.from(json.content, "base64").toString("utf8") });
    } catch (e) {
      console.error(`[ops/source-read] ${path} not read:`, (e as Error).message);
    }
  }
  return out;
}
