// A workflow is written once and runs against any client.
//
// Matthew, 2026-09-11: "SRT agency at some point is just a chatbot UI with workflows ... so if we
// build one workflow for 1 client it can be functional for each one."
//
// ‼️ WHY A NEW LAYER RATHER THAN THE ONE THAT EXISTS. Four systems in this repo are called
// workflows and none of them fits:
//   `workflows`        Content Engine v3 reel recipes: scenes, songs, render specs, keyed by
//                      VERTICAL. No client_id, and its columns describe a video.
//   `content_jobs`     a Slack-thread state machine keyed by vertical and picker message ts,
//                      driven forward by emoji reactions.
//   `custom_workflows` a node-and-edge builder with CRUD and, as of today, no executor at all.
//   AUTO_RUNNERS       per-client and exactly right in shape, but client_delivery_steps is one
//                      row per step per client: a checklist, which a repeatable run is not.
// A client_id stuffed into one of their jsonb blobs would be a client dimension nothing can join
// on, which is the thing this layer exists to stop.
//
// ‼️ DEFINITIONS ARE CODE, RUNS ARE ROWS. The registry below is a code map, like AUTO_RUNNERS and
// format-registry.ts: a workflow writes copy that goes out under a client's name, so it is
// reviewed and deployed like everything else that does that. A table of editable definitions would
// be a way to change what a client is told without a diff.
//
// ‼️ EVERYTHING HERE PRODUCES DRAFTS. Nothing publishes, nothing sends, nothing touches a property
// the client controls. The output lands in their ops thread for a person to read, and
// client-messages.ts's rule stands: client-facing messages are drafts and nothing can send them.

import { supabaseAdmin } from "@/lib/db";

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";
}

export interface WorkflowContext {
  clientId: string;
  clientName: string;
  requestedBy: string;
}

export type WorkflowResult =
  | { ok: true; output: Record<string, unknown>; summary: string }
  /** Refusals say what is missing and what to do about it, never "failed". */
  | { ok: false; error: string };

export interface ClientWorkflow {
  key: string;
  label: string;
  /** Said to the model in the tool description, so it has to be a sentence about when to use it. */
  description: string;
  /** What must be true before it can run, in words, for the refusal and the card. */
  needs: string;
  run(ctx: WorkflowContext): Promise<WorkflowResult>;
}

export const CLIENT_WORKFLOWS: Record<string, ClientWorkflow> = {
  gbp_social_posts: {
    key: "gbp_social_posts",
    label: "Google Business and social posts",
    description:
      "Draft Google Business Profile posts and social captions for a client, built on the four buying questions (price, fears, comparisons, how it works) from their approved plan and keywords.",
    needs: "a locked offer, and either an approved page plan or approved keywords",
    run: async (ctx) => {
      const { runGbpSocialPosts } = await import("./gbp-social-posts");
      return runGbpSocialPosts(ctx);
    },
  },
  post_call_email: {
    key: "post_call_email",
    label: "Post-call email",
    description:
      "Draft the follow-up email after a call with a client, written from the call notes on file: what was promised, what was asked, and what happens next.",
    needs: "call notes on the client's audit report",
    run: async (ctx) => {
      const { runPostCallEmail } = await import("./post-call-email");
      return runPostCallEmail(ctx);
    },
  },
};

export function listClientWorkflows(): Array<{ key: string; label: string; description: string; needs: string }> {
  return Object.values(CLIENT_WORKFLOWS).map((w) => ({
    key: w.key,
    label: w.label,
    description: w.description,
    needs: w.needs,
  }));
}

export interface WorkflowRunRow {
  id: string;
  workflowKey: string;
  status: string;
  error: string | null;
  requestedBy: string | null;
  startedAt: string;
  finishedAt: string | null;
  output: Record<string, unknown> | null;
}

export async function workflowRuns(clientId: string, limit = 10): Promise<WorkflowRunRow[]> {
  const { data, error } = await supabaseAdmin
    .from("client_workflow_runs")
    .select("id, workflow_key, status, error, requested_by, started_at, finished_at, output")
    .eq("client_id", clientId)
    .order("started_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 50));

  if (error) {
    console.error("[workflows] runs could not be read:", error.message);
    return [];
  }

  return (data ?? []).map((r) => ({
    id: r.id as string,
    workflowKey: r.workflow_key as string,
    status: r.status as string,
    error: (r.error as string | null) ?? null,
    requestedBy: (r.requested_by as string | null) ?? null,
    startedAt: r.started_at as string,
    finishedAt: (r.finished_at as string | null) ?? null,
    output: (r.output as Record<string, unknown> | null) ?? null,
  }));
}

/**
 * Start a run and hand it to a fresh request.
 *
 * ‼️ IT DOES NOT RUN THE WORKFLOW. /api/chat has a 60 second budget and a workflow is one or more
 * model calls over a client's whole plan, so running it inside the tool call would time the chat
 * out and leave a row claiming `running` forever. The same shape the pre-call drafting waves and
 * the audit hops use: an AWAITED fetch to an internal route that answers 202 and works in
 * waitUntil. Awaited, because a fetch nobody waits for can be frozen with the lambda before it
 * leaves, which is how the audit engine's original self-chain vanished.
 */
export async function startClientWorkflow(args: {
  clientId: string;
  workflowKey: string;
  requestedBy: string;
}): Promise<{ ok: true; runId: string; label: string } | { ok: false; error: string }> {
  const workflow = CLIENT_WORKFLOWS[args.workflowKey];
  if (!workflow) {
    return {
      ok: false,
      error: `no workflow called "${args.workflowKey}". Available: ${Object.keys(CLIENT_WORKFLOWS).join(", ")}.`,
    };
  }

  const { data, error } = await supabaseAdmin
    .from("client_workflow_runs")
    .insert({
      client_id: args.clientId,
      workflow_key: workflow.key,
      status: "running",
      requested_by: args.requestedBy,
      inputs: {},
    })
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, error: `the run could not be recorded: ${error?.message ?? "unknown error"}` };
  }

  const runId = data.id as string;
  const kicked = await kickRun(runId);

  if (!kicked.ok) {
    // Said out loud rather than left `running` for somebody to find. A row that claims to be
    // working when nothing is working is the failure mode this whole file is careful about.
    await finishRun(runId, { ok: false, error: `it could not be started: ${kicked.error}` });
    return { ok: false, error: `the workflow could not be started: ${kicked.error}` };
  }

  return { ok: true, runId, label: workflow.label };
}

async function kickRun(runId: string): Promise<{ ok: boolean; error?: string }> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return { ok: false, error: "CRON_SECRET is not set" };
  try {
    const res = await fetch(`${appUrl()}/api/internal/client-workflow`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify({ runId }),
      signal: AbortSignal.timeout(15_000),
    });
    return res.status === 202 ? { ok: true } : { ok: false, error: `the route answered ${res.status}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Close a run out, once. */
async function finishRun(
  runId: string,
  outcome: { ok: true; output: Record<string, unknown> } | { ok: false; error: string }
): Promise<void> {
  await supabaseAdmin
    .from("client_workflow_runs")
    .update({
      status: outcome.ok ? "done" : "failed",
      output: outcome.ok ? outcome.output : null,
      error: outcome.ok ? null : outcome.error,
      finished_at: new Date().toISOString(),
    })
    .eq("id", runId);
}

/**
 * Do the work. Called by the internal route, inside waitUntil.
 *
 * The outcome always lands somewhere a person will see it: the run row for the record, the client's
 * ops thread for the reading, and client_events so it is in the order everything else happened in.
 */
export async function continueWorkflowRun(runId: string): Promise<void> {
  const { data: run } = await supabaseAdmin
    .from("client_workflow_runs")
    .select("id, client_id, workflow_key, status")
    .eq("id", runId)
    .maybeSingle();

  if (!run) return;
  if (run.status !== "running") return;

  const workflow = CLIENT_WORKFLOWS[run.workflow_key as string];
  if (!workflow) {
    await finishRun(runId, { ok: false, error: `no workflow called "${run.workflow_key as string}"` });
    return;
  }

  const clientId = run.client_id as string;

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("legal_name, dba_name")
    .eq("id", clientId)
    .maybeSingle();

  const clientName = ((client?.dba_name || client?.legal_name) as string | undefined) ?? "this client";

  let outcome: WorkflowResult;
  try {
    outcome = await workflow.run({ clientId, clientName, requestedBy: "the assistant" });
  } catch (e) {
    outcome = { ok: false, error: (e as Error).message };
  }

  await finishRun(
    runId,
    outcome.ok ? { ok: true, output: outcome.output } : { ok: false, error: outcome.error }
  );

  const { notifyThread } = await import("../delivery-checklist");
  const header = outcome.ok
    ? `:jigsaw: *${workflow.label}* for *${clientName}*. Drafts only, nothing has been sent or published.`
    : `:warning: *${workflow.label}* did not run for *${clientName}*: ${outcome.error}`;

  await notifyThread(clientId, outcome.ok ? `${header}\n\n${outcome.summary}` : header).catch((e) =>
    console.error("[workflows] outcome not posted:", (e as Error).message)
  );
}
