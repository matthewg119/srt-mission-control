// Persists the fanout: the searches the model actually ran, and the pages it cited.
//
// Split out of run-batch.ts on purpose. Everything in here is BEST-EFFORT and can
// never throw into the audit:
//
//   1. The migration is applied by hand (there is no migration ledger, see CLAUDE.md),
//      so there is a window where this code is deployed and the tables do not exist.
//      A throw in that window would take down a healthy, revenue-critical audit engine
//      to collect a nice-to-have. Every failure is logged to system_logs and swallowed.
//   2. For the same reason the fanout is NOT written as a column on audit_runs.
//      PostgREST rejects an insert naming a column that does not exist, which would
//      fail the whole audit_runs row, not just the new field.
//
// run-batch.ts deletes and reinserts audit_runs on every re-run, so these tables are
// the durable record, not a mirror of that one.
//
// client_id is nullable and usually null: 101 of the reports on file are PROSPECT
// audits with no client row. That is the point. Keyed by vertical, this becomes a
// market-wide record of what the engines search for a category, reusable by every
// future client in it, not a per-client scratchpad.

import { supabaseAdmin } from "@/lib/db";
import { normalizePhrase, stripUnstorable } from "@/lib/clients/harvest";

export interface FanoutEntry {
  prompt: string;
  block: string;
  fanoutQueries: string[];
  citations: string[];
}

/** Host of a URL, lowercased, `www.` dropped. null when it will not parse. */
export function domainOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

async function logFailure(reportId: string, stage: string, detail: string): Promise<void> {
  try {
    await supabaseAdmin.from("system_logs").insert({
      event_type: "fanout_store_failed",
      description: `Fanout capture failed at ${stage} for report ${reportId}: ${detail}`,
      metadata: { report_id: reportId, stage, detail },
    });
  } catch {
    // The logger itself failing must not escape either.
  }
}

/**
 * Writes one fanout_runs row per prompt, plus its queries and citations.
 *
 * Returns the number of queries stored so the caller can report it; 0 is a normal
 * outcome (the model may answer from memory without searching) and never an error.
 */
export async function recordFanout(reportId: string, entries: FanoutEntry[]): Promise<number> {
  const usable = entries.filter((e) => e.fanoutQueries.length > 0 || e.citations.length > 0);
  if (usable.length === 0) return 0;

  try {
    const { data: report, error: reportError } = await supabaseAdmin
      .from("audit_reports")
      .select("client_id, vertical_slug, website")
      .eq("id", reportId)
      .single();
    if (reportError) {
      await logFailure(reportId, "load_report", reportError.message);
      return 0;
    }

    const clientId = (report?.client_id as string | null) ?? null;
    const vertical = (report?.vertical_slug as string | null) ?? null;
    const ownDomain = report?.website ? domainOf(String(report.website)) : null;

    let stored = 0;

    for (const entry of usable) {
      const { data: run, error: runError } = await supabaseAdmin
        .from("fanout_runs")
        .insert({
          report_id: reportId,
          client_id: clientId,
          vertical,
          seed_prompt: stripUnstorable(entry.prompt),
          seed_source: "audit_prompt",
          seed_block: entry.block,
          model: process.env.OPENAI_AUDIT_MODEL || "gpt-4.1-mini",
          engine: "openai",
          source: "api",
        })
        .select("id")
        .single();
      if (runError || !run) {
        await logFailure(reportId, "insert_run", runError?.message ?? "no row returned");
        return stored;
      }

      const runId = run.id as string;

      if (entry.fanoutQueries.length > 0) {
        const rows = entry.fanoutQueries.map((query, ordinal) => {
          const clean = stripUnstorable(query);
          return {
            run_id: runId,
            report_id: reportId,
            client_id: clientId,
            vertical,
            query: clean,
            normalized: normalizePhrase(clean),
            ordinal,
          };
        });
        const { error } = await supabaseAdmin.from("fanout_queries").insert(rows);
        if (error) await logFailure(reportId, "insert_queries", error.message);
        else stored += rows.length;
      }

      if (entry.citations.length > 0) {
        const rows = entry.citations.map((url, ordinal) => {
          const clean = stripUnstorable(url);
          const domain = domainOf(clean);
          return {
            run_id: runId,
            report_id: reportId,
            client_id: clientId,
            vertical,
            url: clean,
            domain,
            // Whether the business itself got cited. null when we have no site on
            // file to compare against, which is NOT the same as "no", and callers
            // must not read it as a confirmed absence.
            is_client: ownDomain && domain ? domain === ownDomain : null,
            ordinal,
          };
        });
        const { error } = await supabaseAdmin.from("fanout_citations").insert(rows);
        if (error) await logFailure(reportId, "insert_citations", error.message);
      }
    }

    return stored;
  } catch (e) {
    await logFailure(reportId, "unexpected", e instanceof Error ? e.message : String(e));
    return 0;
  }
}
