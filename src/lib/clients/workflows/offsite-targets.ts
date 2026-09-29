// The `offsite_targets` workflow: read the citation corpus, keep it, say what is in it.
//
// ‼️ IT WRITES A LIST AND CONTACTS NOBODY. Every domain here arrived because an engine cited
// it while answering a question about this client's market. That makes it a research finding,
// not a mailing list, and the step between the two is a person reading it.

import type { WorkflowContext, WorkflowResult } from "./registry";
import { readCitationCorpus, storeTargets, listedSubjects } from "@/lib/clients/offsite-targets";

export async function runOffsiteTargets(ctx: WorkflowContext): Promise<WorkflowResult> {
  const { targets, runId, reports } = await readCitationCorpus(ctx.clientId);

  if (reports === 0) {
    return {
      ok: false,
      error:
        "This client has no audit on file, so there are no citations to read. " +
        "The `baseline_scan` step attaches one.",
    };
  }

  if (targets.length === 0) {
    return {
      ok: false,
      error:
        `${reports} audit${reports === 1 ? "" : "s"} on file and not one engine answer cited a source. ` +
        "That is a real finding rather than a failure: it usually means the questions were " +
        "answered from the model's own memory, which is the hardest kind of answer to get into.",
    };
  }

  const stored = await storeTargets(ctx.clientId, targets, runId);
  if (!stored.ok) return { ok: false, error: `The targets were not saved: ${stored.error}` };

  const subjects = await listedSubjects(ctx.clientId);

  const byKind = new Map<string, number>();
  for (const t of targets) byKind.set(t.kind, (byKind.get(t.kind) ?? 0) + 1);

  const top = targets.slice(0, 12);

  const output = [
    `*Where the engines get their answers, for ${ctx.clientName}.*`,
    `${targets.length} domains across ${reports} audit${reports === 1 ? "" : "s"}.`,
    "",
    ...top.map((t) => `\`${t.domain}\`  ${t.kind}, cited ${t.timesCited}x`),
    targets.length > top.length ? `_and ${targets.length - top.length} more, all saved._` : "",
    "",
    `*The mix:* ${[...byKind.entries()].map(([k, n]) => `${n} ${k}`).join(", ")}.`,
    "",
    // ‼️ THE HONEST DISTINCTION, SAID ON THE CARD. Everything above is a stranger. A listed
    // subject is somebody already on one of our pages, which is a different first line.
    subjects.length > 0
      ? `*${subjects.length} subject${subjects.length === 1 ? "" : "s"} named on your own roundups and reviews* are already qualified: they are in it, so the email is not a favour ask.`
      : "_No roundup, comparison or review page names anybody yet, so there are no qualified subjects. Those are the pages that produce them._",
    "",
    "Nothing has been contacted. `citation_outreach` drafts one email per target, for review.",
  ]
    .filter((l) => l !== "")
    .join("\n");

  return {
    ok: true,
    // ‼️ THE ROWS TRAVEL WITH THE CARD, NOT JUST THE CARD. output is jsonb on
    // client_workflow_runs, so a run is the record of what was found rather than a picture of
    // it. The next lane reads offsite_targets directly; this is what makes a run auditable
    // months later when somebody asks where a target came from.
    output: {
      note: output,
      domains: targets.length,
      reports,
      listedSubjects: subjects.length,
      targets: targets.map((t) => ({ domain: t.domain, kind: t.kind, timesCited: t.timesCited })),
    },
    summary: `${targets.length} off-site targets saved for ${ctx.clientName}`,
  };
}
