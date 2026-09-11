// An audit run whose questions are SUPPLIED, not classified.
//
// Every audit until 2026-09-12 asked twenty questions a model invented from a business profile
// (classify.ts). That is the right shape for a prospect: nobody has told us what they sell. It is
// the wrong shape for a client we have already onboarded, because by then a person has approved
// two hundred phrases (client_keywords) and a tracked question set (client_question_sets), and the
// measured fact everybody wants is whether the engines name them for THOSE.
//
// Matthew, 2026-09-11: "this should be done after we do the visibility audit or simply use the
// results we got from the visibility audit from that profile specifically."
//
// ‼️ IT REUSES THE PIPELINE RATHER THAN COPYING IT, and the reason is arithmetic. runBatch,
// finishReport, the coverage gate, the repair pass and the watchdog do not care where a prompt
// came from: they care that every prompt has an answer before anything is scored. A second runner
// would be a second place for "no_data means unknown, never absent" to be got wrong, which is the
// exact rule that cost a fabricated 0/100 scorecard on 2026-08-05.
//
// What a supplied run deliberately does NOT do, and none of it is by accident:
//  - no Slack scorecard, no final thread message: finishReport hands it to onSuppliedRunDone and
//    returns before any of that.
//  - no lead writeback: contact_id is null, so writeAuditToLead is a no-op anyway, and the early
//    return means it is not even attempted.
//  - no outreach: requester_email is null.
//  - no slack_thread_ts. audit_reports has a UNIQUE partial index on it
//    (docs/2026-07-30-audit-thread-unique.sql), so borrowing the client's step thread would make
//    the SECOND run for a client fail on a constraint nobody would think to look for.
//
// ‼️ THE LABEL IS RESOLVED, NEVER PASSED THROUGH. run-labels.ts downgrades a requested photograph
// to a measurement while one engine is keyed (A2 D-P16). A caller cannot assert fidelity.

import { supabaseAdmin } from "@/lib/db";
import { generateSlug } from "./slug";
import type { AuditBlock, AuditPrompt } from "./classify";
import type { AuditReportRow } from "./types";
import {
  KEYED_ENGINES,
  excludedFromScorecard,
  isPhotographLabel,
  resolveRunLabel,
  type SuppliedLabel,
} from "./run-labels";

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";
}

export interface SuppliedPrompt {
  prompt: string;
  /** Optional: worked out from the phrase when absent. audit_runs.block is NOT NULL. */
  block?: AuditBlock;
  /**
   * client_keywords.id when this prompt IS an approved keyword.
   *
   * ‼️ CARRIED SO THE WRITEBACK NEVER HAS TO MATCH ON TEXT. It rides along in the jsonb (runBatch
   * reads only block and prompt), and applyMeasurement prefers it over the normalized form,
   * because a phrase can be re-worded in one place and not the other.
   */
  keywordId?: string;
}

/**
 * Which block a supplied prompt belongs to.
 *
 * audit_runs.block is NOT NULL and report-view.ts only tallies the four in BLOCK_ORDER, so a
 * missing or invented block silently drops a question out of the score. Deterministic on purpose:
 * a model choosing this would make the same phrase land in different blocks on different runs, and
 * the day 30/60/90 comparison would be measuring the change plus the reclassification.
 */
export function blockFor(prompt: string, clientName: string | null): AuditBlock {
  const p = prompt.toLowerCase();
  const name = (clientName ?? "").toLowerCase().trim();
  if (name.length > 2 && p.includes(name)) return "MARCA";
  if (/\b(vs|versus|compare|compared to|better than|difference between|or)\b.*\?|^\s*(is|are)\b.*\bbetter\b/.test(p)) {
    return "COMPARATIVO";
  }
  if (/\b(vs|versus|compare|better than|difference between)\b/.test(p)) return "COMPARATIVO";
  if (/^(how|what|why|when|does|do|is|are|can|should|will|which)\b/.test(p) || p.includes("?")) return "INFO";
  return "SERVICIO";
}

export interface SuppliedRunResult {
  ok: true;
  reportId: string;
  label: SuppliedLabel;
  /** Set when A2 D-P16 downgraded a requested photograph. Belongs on the card verbatim. */
  downgradeReason: string | null;
  questions: number;
}

/**
 * Insert the report and start it. Returns as soon as the first hop has been scheduled.
 *
 * ‼️ IT DOES NOT AWAIT THE RUN. Sixty questions is fifteen batches of four, each one a web search
 * per prompt, so a run is minutes long and cannot sit inside the Slack command that asked for it.
 * process-run.ts hops between requests; the outcome arrives in the step's thread.
 */
export async function runSuppliedAudit(args: {
  clientId: string;
  prompts: readonly SuppliedPrompt[];
  runLabel: SuppliedLabel;
  /** Null for a business that does not sell locally: runOpenAI prefixes "I'm in {city}." */
  city?: string | null;
}): Promise<SuppliedRunResult | { ok: false; error: string }> {
  const prompts = args.prompts.filter((p) => p.prompt.trim().length > 0);
  if (prompts.length === 0) return { ok: false, error: "no questions were supplied" };

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, legal_name, dba_name, city, website, domain, business_type, vertical_slug")
    .eq("id", args.clientId)
    .maybeSingle();

  if (!client) return { ok: false, error: "client not found" };

  // ‼️ client_name AND website ARE THE MENTION MATCH. buildAliases is fed
  // `client_name ?? business_type ?? website`, so a null name falls through to a CATEGORY ("med
  // spa"), and every answer that says the words "med spa" would count as naming this client.
  const clientName = ((client.dba_name as string | null) || (client.legal_name as string | null)) ?? null;
  if (!clientName) {
    return { ok: false, error: "the client has neither a legal name nor a DBA, so nothing can be matched in an answer" };
  }

  const resolved = resolveRunLabel(args.runLabel);
  const website = ((client.website as string | null) || (client.domain as string | null)) ?? null;
  const city = args.city === undefined ? ((client.city as string | null) ?? null) : args.city;

  const rows: AuditPrompt[] = prompts.map((p) => ({
    block: p.block ?? blockFor(p.prompt, clientName),
    prompt: p.prompt.trim(),
    ...(p.keywordId ? { keyword_id: p.keywordId } : {}),
  })) as AuditPrompt[];

  const slug = await generateSlug();

  const { data: inserted, error } = await supabaseAdmin
    .from("audit_reports")
    .insert({
      slug,
      client_id: args.clientId,
      client_name: clientName,
      website,
      city,
      business_type: (client.business_type as string | null) ?? null,
      vertical_slug: (client.vertical_slug as string | null) ?? null,
      competitors: [],
      prompts: rows,
      engines: KEYED_ENGINES,
      run_label: resolved.label,
      excluded_from_scorecard: excludedFromScorecard(resolved.label),
      status: "running",
      // All null, and each one switches something off in finishReport. See the header.
      contact_id: null,
      requester_email: null,
      slack_channel_id: null,
      slack_thread_ts: null,
      research_source: null,
    })
    .select("id")
    .single();

  if (error || !inserted) {
    return { ok: false, error: `the run could not be recorded: ${error?.message ?? "unknown error"}` };
  }

  const reportId = (inserted as { id: string }).id;

  const kicked = await kickFirstHop(reportId);
  if (!kicked.ok) {
    // The row stays `running` and the daily watchdog re-kicks it. Said plainly rather than
    // pretending the questions are being asked right now.
    return {
      ok: true,
      reportId,
      label: resolved.label,
      downgradeReason: resolved.reason,
      questions: rows.length,
    };
  }

  return {
    ok: true,
    reportId,
    label: resolved.label,
    downgradeReason: resolved.reason,
    questions: rows.length,
  };
}

/**
 * Hand the first batch to a fresh request.
 *
 * Awaited with a timeout, never fire and forget: a fetch nobody awaits can be frozen with the
 * lambda before it leaves, which is exactly how the audit engine's original self-chain vanished
 * (api/audit/process's header records it). The route answers 202 as soon as the work is scheduled.
 */
async function kickFirstHop(reportId: string): Promise<{ ok: boolean; error?: string }> {
  const secret = process.env.AUDIT_INTERNAL_SECRET || "";
  try {
    const res = await fetch(`${appUrl()}/api/internal/audit-continue`, {
      method: "POST",
      headers: { "x-audit-secret": secret, "content-type": "application/json" },
      body: JSON.stringify({ id: reportId, batch: 0, hop: 0 }),
      signal: AbortSignal.timeout(15_000),
    });
    return res.status === 202 ? { ok: true } : { ok: false, error: `the route answered ${res.status}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Which step's thread a supplied run reports back into, derived from what it is.
 *
 * No column stores this and none should: a label already says what the run was for, and a stored
 * step key would be a second answer to the same question that could disagree with the first.
 */
export function stepForLabel(label: SuppliedLabel): "keyword_set" | "day_zero_archive" {
  return isPhotographLabel(label) ? "day_zero_archive" : "keyword_set";
}

/**
 * Everything that happens when a supplied run finishes. Called by finishReport INSTEAD of the
 * scorecard and outreach path.
 *
 * ‼️ SAFE TO RUN TWICE. The watchdog calls finishReport directly on any report still `running`
 * after three minutes, so this can be reached again for a report that already completed.
 * applyMeasurement only moves a row when the measurement actually changed, and the Day 0 tick goes
 * through setDeliveryStep, which re-verifies rather than re-stamping.
 */
export async function onSuppliedRunDone(row: AuditReportRow): Promise<void> {
  if (!row.client_id) return;

  const { applyMeasurement } = await import("@/lib/clients/client-keywords");
  const measured = await applyMeasurement(row.client_id, row.id);

  const { notifyStep } = await import("@/lib/clients/step-board");
  const stepKey = stepForLabel((row.run_label ?? "measurement") as SuppliedLabel);

  const lines = [
    `:bar_chart: *${row.run_label}* finished: ${row.prompts?.length ?? 0} questions, ` +
      `${KEYED_ENGINES.length} engine.`,
    measured.ok
      ? `${measured.updated} keyword${measured.updated === 1 ? "" : "s"} updated` +
        (measured.named + measured.notNamed > 0
          ? `: named in ${measured.named}, not named in ${measured.notNamed}.`
          : ".") +
        (measured.skipped > 0
          ? ` ${measured.skipped} got no answer and were recorded as nothing, never as "not named".`
          : "")
      : `:warning: the keyword writeback failed: ${measured.error}`,
  ];

  // ‼️ A PHOTOGRAPH TICKS ITS OWN STEP, THROUGH THE VERIFIER, AND NEVER STAMPS THE WALL ITSELF.
  //
  // autoCompleteStep runs verifyStep first, and that verifier now looks for exactly this run, so
  // the tick is still evidence rather than an assertion. setDeliveryStep then stamps day_0_source
  // by OBSERVING the same run. Writing stampDay0 from here would open the wall with the step still
  // pending, and day-zero.ts's whole design is that the tick and the stamp cannot drift.
  //
  // With one engine keyed this never runs: the label comes back `measurement`, so the step stays
  // waiting for a person and the keywords are still measured.
  if (isPhotographLabel(row.run_label ?? "")) {
    const { autoCompleteStep } = await import("@/lib/clients/delivery-checklist");
    const ticked = await autoCompleteStep(row.client_id, "day_zero_archive").catch((e) => ({
      ok: false as const,
      error: (e as Error).message,
    }));
    lines.push(
      ticked.ok
        ? ":white_check_mark: Day 0 is archived and the wall is open: pages can publish from here."
        : `:warning: The Day 0 step did not tick itself: ${ticked.error}. The run is recorded either way.`
    );
  }

  await notifyStep(row.client_id, stepKey, lines.join("\n")).catch((e) =>
    console.error("[supplied-run] could not post the outcome:", (e as Error).message)
  );
}
