// Workflows that are about the business rather than about one client.
//
// ‼️ A SIBLING OF CLIENT_WORKFLOWS, NOT A WIDENING OF IT. client_workflow_runs.client_id is NOT NULL
// and workflowRuns() filters on it, so an ops run stored there would be invisible to the only
// function that lists runs while every caller believed it listed them all. The two registries share
// a shape in code and nothing in SQL.
//
// ‼️ DEFINITIONS ARE CODE, RUNS ARE ROWS, the same rule the client registry states: a workflow
// writes copy that goes out under our name, so it is reviewed and deployed like everything else
// that does that. A table of editable definitions would be a way to change what somebody is told
// without a diff.
//
// ‼️ EVERYTHING HERE PRODUCES DRAFTS. Nothing sends, publishes, or touches a property anyone else
// controls. The Today chat can start one of these unattended precisely because that is true.

import { supabaseAdmin } from "@/lib/db";

const OPS_SQL = "docs/2026-09-26-ops-workflow-runs.sql";

export interface OpsWorkflowContext {
  requestedBy: string;
  note: string | null;
}

export type OpsWorkflowResult =
  | { ok: true; output: Record<string, unknown>; summary: string }
  | { ok: false; error: string };

export interface OpsWorkflow {
  key: string;
  label: string;
  /** Fed verbatim into the model's tool description, so it reads as the offer it is. */
  description: string;
  /** Preconditions in words, for the refusal text. */
  needs: string;
  run(ctx: OpsWorkflowContext): Promise<OpsWorkflowResult>;
}

/**
 * The registry.
 *
 * ‼️ TWO ENTRIES, AND BOTH ARE OBVIOUSLY NOT ABOUT ONE CLIENT. That is the test for belonging here:
 * if a workflow has a subject, it is a client workflow and CLIENT_WORKFLOWS is its home.
 */
export const OPS_WORKFLOWS: Record<string, OpsWorkflow> = {
  day_review: {
    key: "day_review",
    label: "Review the day",
    description:
      "Read today's plan across every live client and write a short review: what is waiting longest, what unblocks the most, and what was deferred. Produces a summary, changes nothing.",
    needs: "nothing. It reads the delivery board, the page plan and the open follow-ups.",
    run: async (ctx) => {
      const { buildDayPlan } = await import("@/lib/today/plan");
      const plan = await buildDayPlan();
      const all = [...plan.groups.flatMap((g) => g.items), ...plan.later];
      if (!all.length) {
        return { ok: true, output: { items: 0 }, summary: "Nothing is waiting on anybody today." };
      }

      const top = [...all].sort((a, b) => b.score - a.score).slice(0, 5);
      const lines = [
        `*${all.length} thing${all.length === 1 ? "" : "s"} waiting*, about ${plan.estMinutes} minutes estimated.`,
        "",
        ...plan.groups.map((g) => `• *${g.label}*: ${g.items.length}, ~${g.estMinutes}m`),
        "",
        "*Worth doing first:*",
        ...top.map((i) => `  • ${i.title} _(${i.reasons[0] ?? ""})_`),
      ];
      if (plan.later.length) lines.push("", `${plan.later.length} deferred to another day.`);
      if (plan.unreadable.length) lines.push("", `:warning: ${plan.unreadable.join(" and ")} could not be read.`);
      if (ctx.note) lines.push("", `_Asked for: ${ctx.note}_`);

      return { ok: true, output: { items: all.length, estMinutes: plan.estMinutes }, summary: lines.join("\n") };
    },
  },

  uncontacted_sweep: {
    key: "uncontacted_sweep",
    label: "Who we have not contacted",
    description:
      "List the leads with an open follow-up and no date set, or a date that has passed, so they can be worked through. Reads only; it drafts nothing and sends nothing.",
    needs: "nothing. It reads lead_tasks and contacts.",
    run: async () => {
      const { data, error } = await supabaseAdmin
        .from("lead_tasks")
        .select("id, title, due_at, contacts!inner(id, first_name, last_name, business_name, do_not_contact)")
        .eq("status", "open")
        .order("due_at", { ascending: true, nullsFirst: true })
        .limit(40);

      if (error) return { ok: false, error: `the follow-up tasks could not be read: ${error.message}` };

      const rows = (data ?? []) as unknown as Array<{
        id: string;
        title: string;
        due_at: string | null;
        contacts: { first_name: string | null; last_name: string | null; business_name: string | null; do_not_contact: boolean | null };
      }>;

      // ‼️ do_not_contact IS A DECISION SOMEBODY MADE. A sweep that lists one is how it gets undone.
      const live = rows.filter((r) => !r.contacts.do_not_contact);
      if (!live.length) return { ok: true, output: { count: 0 }, summary: "Nobody is waiting on a follow-up." };

      const now = Date.now();
      const named = live.map((r) => {
        const who =
          r.contacts.business_name || [r.contacts.first_name, r.contacts.last_name].filter(Boolean).join(" ") || "a lead";
        const when = !r.due_at
          ? "no date set"
          : new Date(r.due_at).getTime() < now
            ? "overdue"
            : "due today";
        return `  • ${who}: ${r.title} _(${when})_`;
      });

      return {
        ok: true,
        output: { count: live.length },
        summary: [`*${live.length} open follow-up${live.length === 1 ? "" : "s"}.*`, "", ...named.slice(0, 25)].join("\n"),
      };
    },
  },
};

export function listOpsWorkflows(): Array<{ key: string; label: string; description: string; needs: string }> {
  return Object.values(OPS_WORKFLOWS).map((w) => ({
    key: w.key,
    label: w.label,
    description: w.description,
    needs: w.needs,
  }));
}

function missingTable(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return err.code === "42P01" || err.code === "PGRST205" || /does not exist|schema cache/i.test(err.message ?? "");
}

/**
 * Start one, and return before it finishes.
 *
 * ‼️ THE SAME SHAPE startClientWorkflow USES, AND FOR THE SAME REASON: /api/chat is capped at 60
 * seconds, so the run happens behind /api/internal/ops-workflow in a waitUntil. The kick is AWAITED
 * because an un-awaited fetch can be frozen with the lambda before it leaves, which is how the audit
 * engine's original self-chain vanished.
 */
export async function startOpsWorkflow(args: {
  workflowKey: string;
  requestedBy: string;
  note?: string | null;
}): Promise<{ ok: true; runId: string; label: string } | { ok: false; error: string }> {
  const workflow = OPS_WORKFLOWS[args.workflowKey];
  if (!workflow) {
    return { ok: false, error: `there is no workflow called "${args.workflowKey}". ${listOpsWorkflows().map((w) => w.key).join(", ")}` };
  }

  const { data, error } = await supabaseAdmin
    .from("ops_workflow_runs")
    .insert({
      workflow_key: workflow.key,
      status: "running",
      inputs: args.note ? { note: args.note } : {},
      requested_by: args.requestedBy,
    })
    .select("id")
    .maybeSingle();

  if (error || !data) {
    if (missingTable(error)) return { ok: false, error: `run ${OPS_SQL} on this database first.` };
    return { ok: false, error: error?.message ?? "the run could not be recorded" };
  }

  const runId = data.id as string;
  const kicked = await kick(runId);
  if (!kicked.ok) {
    await finish(runId, { ok: false, error: kicked.error });
    return { ok: false, error: kicked.error };
  }
  return { ok: true, runId, label: workflow.label };
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";
}

async function kick(runId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${appUrl()}/api/internal/ops-workflow`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` },
      body: JSON.stringify({ runId }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status !== 202) return { ok: false, error: `the runner answered ${res.status} rather than 202` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `the runner could not be reached: ${(e as Error).message}` };
  }
}

async function finish(runId: string, result: OpsWorkflowResult): Promise<void> {
  await supabaseAdmin
    .from("ops_workflow_runs")
    .update({
      status: result.ok ? "done" : "failed",
      output: result.ok ? result.output : null,
      error: result.ok ? null : result.error,
      finished_at: new Date().toISOString(),
    })
    .eq("id", runId);
}

/** Run it for real. Called only from /api/internal/ops-workflow, inside waitUntil. */
export async function continueOpsRun(runId: string): Promise<void> {
  const { data } = await supabaseAdmin
    .from("ops_workflow_runs")
    .select("id, workflow_key, status, inputs, requested_by")
    .eq("id", runId)
    .maybeSingle();

  if (!data || data.status !== "running") return;
  const workflow = OPS_WORKFLOWS[data.workflow_key as string];
  if (!workflow) {
    await finish(runId, { ok: false, error: `there is no workflow called "${data.workflow_key}" any more` });
    return;
  }

  let result: OpsWorkflowResult;
  try {
    result = await workflow.run({
      requestedBy: (data.requested_by as string) ?? "somebody",
      note: ((data.inputs as Record<string, unknown>)?.note as string) ?? null,
    });
  } catch (e) {
    result = { ok: false, error: (e as Error).message };
  }

  await finish(runId, result);

  // ‼️ #alerts-infra, WHICH IS WHERE stepDigest ALREADY POSTS. An ops run is about the business, so
  // its outcome belongs in the one channel that already carries the daily record of it.
  const { postInfraAlert } = await import("@/lib/alerts");
  const head = result.ok
    ? `:jigsaw: *${workflow.label}*, asked for by ${(data.requested_by as string) ?? "somebody"}. Drafts only, nothing has been sent.`
    : `:warning: *${workflow.label}* did not run: ${result.error}`;
  await postInfraAlert(result.ok ? `${head}\n\n${result.summary}` : head);
}

/** Recent runs, newest first. */
export async function opsWorkflowRuns(limit = 10): Promise<
  Array<{ id: string; workflowKey: string; status: string; startedAt: string; error: string | null }>
> {
  const { data, error } = await supabaseAdmin
    .from("ops_workflow_runs")
    .select("id, workflow_key, status, started_at, error")
    .order("started_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 50));
  if (error || !data) return [];
  return data.map((r) => ({
    id: r.id as string,
    workflowKey: r.workflow_key as string,
    status: r.status as string,
    startedAt: r.started_at as string,
    error: (r.error as string) ?? null,
  }));
}
