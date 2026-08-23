// Photograph I: the client's AI visibility before anything is changed.
//
// ‼️ THIS LIVES HERE RATHER THAN INSIDE /api/onboarding/save BECAUSE IT HAS TWO CALLERS NOW.
// The save route fires it once when the intake funnel finishes. `/api/clients/[id]/rescan`
// fires it again, which is the thing that did not exist: a scan that ran with no OpenAI
// credit measured nothing, ticked its step green, and there was no way to ask for another one
// short of re-running the whole onboarding funnel.

import { supabaseAdmin } from "@/lib/db";
import { runAuditPipeline } from "@/lib/audit-engine/run-audit-pipeline";
import { autoCompleteStep, setDeliveryStep } from "@/lib/clients/delivery-checklist";
import { anchorTsFor, notifyStep } from "@/lib/clients/step-board";

export const BASELINE_STEP_KEY = "baseline_scan";

/**
 * How many of this report's prompts actually came back with an answer.
 *
 * ‼️ THIS IS THE DIFFERENCE BETWEEN A BASELINE AND AN EMPTY ROW, and until now nothing
 * measured it. `run-prompts.ts` resolves a failed call to `status: "no_data"` rather than
 * inventing a mention — correct, and it means a run with a dead API key completes cleanly
 * with twenty no_data rows and `runAuditPipeline` still answers `{ ok: true }`, because the
 * PIPELINE did finish. Ticking the step off that is how "Photograph I across the keyed
 * engines" ends up green over a photograph of nothing.
 *
 * Same rule the audit engine already enforces one level down, applied one level up: a
 * measurement that measured nothing is not a measurement.
 */
export async function measuredPrompts(reportId: string): Promise<number> {
  const { count } = await supabaseAdmin
    .from("audit_runs")
    .select("id", { count: "exact", head: true })
    .eq("report_id", reportId)
    .eq("status", "ok");

  return count ?? 0;
}

/**
 * Fire the AI visibility scan against the website the client confirmed at intake.
 *
 * Honest about what it is. The pilot spec's Photograph I is 20 questions across four
 * engines; this repo has ONE engine, because Perplexity was removed after its key had
 * been rejected since launch and there is no Gemini or SERP integration at all. So the
 * thread reply says "one engine" rather than letting a single-engine run be filed as
 * "the baseline". Overstating coverage is the same failure mode the audit engine's own
 * no-fabrication rule exists to prevent.
 *
 * contactId is passed so the audit's lead writeback fires too: the scan lands on the CRM
 * record as well as here.
 */
export async function startBaselineScan(clientId: string): Promise<void> {
  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, website, city, state, email, legal_name, dba_name, contact_id, ops_thread_ts")
    .eq("id", clientId)
    .maybeSingle();

  if (!client?.website) {
    await notifyStep(clientId, BASELINE_STEP_KEY, "No website on file, so no baseline scan was started.");
    return;
  }

  const city = [client.city, client.state].filter(Boolean).join(", ") || undefined;

  await notifyStep(
    clientId,
    BASELINE_STEP_KEY,
    `:mag: Baseline scan started for ${client.website as string}. One engine, ChatGPT with web search.`
  );

  // ‼️ WHERE THE REPORT COMES BACK. Without this the pipeline resolves #ai-visibility-audits
  // and finishReport uploads the scorecard there, so an already-onboarded client's baseline
  // lands in the prospecting channel and reads as a new lead.
  //
  // ‼️ IT IS THE BASELINE STEP'S OWN THREAD, NOT ops_thread_ts. The audit pipeline emits
  // four separate messages — the twenty-prompt drop, the report, the scorecard PDF and, until
  // 2026-08-22, a cold-outreach intake card — and pointing them at the header thread is a
  // third of the wall on its own. They belong under step 2, which is the step that produced
  // them, and audit_reports.slack_thread_ts then points there so every thread command on the
  // report keeps working in the place the report actually is.
  const onboardingChannel = process.env.SLACK_CLIENT_ONBOARDING_CHANNEL;
  const stepThreadTs = onboardingChannel ? await anchorTsFor(clientId, BASELINE_STEP_KEY) : null;
  const deliveryThread =
    onboardingChannel && stepThreadTs
      ? { channelId: onboardingChannel, threadTs: stepThreadTs }
      : undefined;

  if (!deliveryThread) {
    console.error(
      `[baseline-scan] no delivery thread for client ${clientId} ` +
        `(channel=${onboardingChannel ? "set" : "missing"}, anchor=${stepThreadTs ? "set" : "missing"}); ` +
        `the baseline scorecard will land in the audit channel`
    );
  }

  const result = await runAuditPipeline({
    website: client.website as string,
    city,
    requesterEmail: (client.email as string) ?? undefined,
    requesterName: ((client.dba_name || client.legal_name) as string) ?? undefined,
    contactId: (client.contact_id as string) ?? undefined,
    clientId,
    deliveryThread,
    leadSource: "aeo_client_onboarding",
    allowLowConfidenceCity: true,
    onError: async (message: string) => {
      await notifyStep(clientId, BASELINE_STEP_KEY, `:warning: Baseline scan failed: ${message}`);
    },
  });

  // Ticked here rather than in onReportCreated. That callback fires the moment the row
  // exists, seconds in, which would mark "baseline scan run" complete while the engine
  // was still working. runAuditPipeline only returns once every batch and finishReport
  // are done, so this is the honest moment.
  if (!result.ok) return;

  // ‼️ AND THE PIPELINE FINISHING IS NOT ENOUGH. This used to be `if (result.ok)` and nothing
  // else, which is exactly how the SRT pilot ended up with a green Photograph I over a run
  // where every prompt returned no_data for want of an OpenAI credit. The competitor
  // shortlist built off that run then named nobody, and the checklist gave no hint why.
  const reportId = result.reportId ?? null;
  const measured = reportId ? await measuredPrompts(reportId) : 0;

  if (measured === 0) {
    await notifyStep(
      clientId,
      BASELINE_STEP_KEY,
      `:warning: The baseline scan finished but *measured nothing* — 0 prompts returned an ` +
        `answer, so every one of them is filed as no_data. That is almost always the OpenAI ` +
        `key: no credit, or ` + "`OPENAI_API_KEY`" + ` unset. The step is left OUTSTANDING on ` +
        `purpose, because a photograph of nothing is not a baseline. Fix the key and hit ` +
        `*Re-run baseline scan* on the client board.`
    );
    return;
  }

  await autoCompleteStep(
    clientId,
    BASELINE_STEP_KEY,
    `:bar_chart: Baseline measured ${measured} prompt${measured === 1 ? "" : "s"} with a real answer.`
  ).catch(() => {});
}

/**
 * Run it again, on purpose, from the client board.
 *
 * Reopens the step first so the checklist tells the truth while the engine is working — a
 * step that stays green through a re-run is a step nobody can tell is being re-measured.
 * `reopened` is an existing transition and it cascades exactly like the others.
 */
export async function rerunBaselineScan(clientId: string, actor: string): Promise<void> {
  await setDeliveryStep({
    clientId,
    stepKey: BASELINE_STEP_KEY,
    transition: "reopened",
    actor,
  }).catch(() => ({ ok: false }));

  await startBaselineScan(clientId);
}
