/**
 * Backfill the half of the fanout that was never thrown away.
 *
 *   bun scripts/_backfill-fanout-citations.ts [--commit]
 *
 * run-prompts.ts discarded the search QUERIES on every audit ever run, and those only
 * come back by re-running (about $0.50 a report). But it always stored the CITATIONS,
 * so the "who actually gets quoted for this market" half of the corpus already exists
 * and costs nothing to recover: ~1,820 successful runs across ~101 reports, roughly
 * 11,000 citation rows.
 *
 * Dry by default. Prints exactly what it would write and touches nothing until you
 * pass --commit.
 *
 * IDEMPOTENT: a report that already has fanout_runs rows is skipped whole. Re-running
 * after a partial failure resumes rather than duplicating.
 *
 * The rows it writes carry fanout_queries = none, on purpose. A backfilled run is an
 * honest partial record: we know what was cited, we do not know what was searched.
 * Nothing downstream may infer "this prompt triggered no searches" from their absence.
 */

import { supabaseAdmin } from "../src/lib/db";
import { domainOf } from "../src/lib/audit-engine/fanout-store";
import { stripUnstorable } from "../src/lib/clients/harvest";

const COMMIT = process.argv.includes("--commit");

interface ReportRow {
  id: string;
  client_id: string | null;
  vertical_slug: string | null;
  website: string | null;
  client_name: string | null;
}

interface RunRow {
  prompt: string;
  block: string | null;
  citations: unknown;
}

/**
 * Prove the destination tables exist before counting a single row.
 *
 * ‼️ Do NOT do this with `.select("id", { count: "exact", head: true })`. A HEAD request
 * against a table PostgREST does not know returns 404 with no body, and supabase-js hands
 * back { count: null, error: null } — indistinguishable from an empty table. The first
 * version of this script used that as its idempotency guard, so with the migration
 * unapplied every report looked un-backfilled and the run marched on to fail at the first
 * insert. Same shape as the uploadFilePDF ok:true trap in CLAUDE.md: a falsy-looking
 * success. A real GET surfaces the error.
 */
async function assertTables(): Promise<void> {
  for (const table of ["fanout_runs", "fanout_citations"]) {
    const { error } = await supabaseAdmin.from(table).select("id").limit(1);
    if (error) {
      throw new Error(
        `Table "${table}" is not reachable (${error.message}).\n` +
          `Run docs/2026-08-31-colony-and-fanout.sql against production first.`
      );
    }
  }
}

async function main(): Promise<void> {
  console.log(COMMIT ? "MODE: COMMIT (writing)" : "MODE: DRY RUN (pass --commit to write)");
  console.log("");

  await assertTables();

  const { data: reports, error } = await supabaseAdmin
    .from("audit_reports")
    .select("id, client_id, vertical_slug, website, client_name")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`load reports: ${error.message}`);

  const all = (reports ?? []) as ReportRow[];
  console.log(`${all.length} audit_reports on file`);

  let skipped = 0;
  let reportsWritten = 0;
  let runsWritten = 0;
  let citationsWritten = 0;
  let reportsWithNothing = 0;

  for (const report of all) {
    // A real GET, not a HEAD count. See assertTables() for why.
    const { data: existing, error: existsError } = await supabaseAdmin
      .from("fanout_runs")
      .select("id")
      .eq("report_id", report.id)
      .limit(1);
    if (existsError) throw new Error(`check existing (${report.id}): ${existsError.message}`);
    if ((existing ?? []).length > 0) {
      skipped++;
      continue;
    }

    const { data: runs, error: runsError } = await supabaseAdmin
      .from("audit_runs")
      .select("prompt, block, citations")
      .eq("report_id", report.id)
      .eq("status", "ok");
    if (runsError) throw new Error(`load runs (${report.id}): ${runsError.message}`);

    const usable = ((runs ?? []) as RunRow[])
      .map((r) => ({
        prompt: r.prompt,
        block: r.block,
        citations: Array.isArray(r.citations) ? (r.citations as unknown[]).filter((c): c is string => typeof c === "string") : [],
      }))
      .filter((r) => r.citations.length > 0);

    if (usable.length === 0) {
      reportsWithNothing++;
      continue;
    }

    const ownDomain = report.website ? domainOf(String(report.website)) : null;
    const label = report.client_name ?? report.id.slice(0, 8);

    if (!COMMIT) {
      const totalCites = usable.reduce((n, r) => n + r.citations.length, 0);
      console.log(`  would write ${String(usable.length).padStart(3)} runs / ${String(totalCites).padStart(4)} citations  ${label}`);
      reportsWritten++;
      runsWritten += usable.length;
      citationsWritten += totalCites;
      continue;
    }

    for (const entry of usable) {
      const { data: run, error: runError } = await supabaseAdmin
        .from("fanout_runs")
        .insert({
          report_id: report.id,
          client_id: report.client_id,
          vertical: report.vertical_slug,
          seed_prompt: stripUnstorable(entry.prompt),
          seed_source: "audit_prompt",
          seed_block: entry.block,
          // The model that produced these is not recorded per-run anywhere, and
          // guessing it would be fabrication. Left null on purpose.
          model: null,
          engine: "openai",
          source: "api",
        })
        .select("id")
        .single();
      if (runError || !run) throw new Error(`insert run (${report.id}): ${runError?.message ?? "no row"}`);

      const rows = entry.citations.map((url, ordinal) => {
        const clean = stripUnstorable(url);
        const domain = domainOf(clean);
        return {
          run_id: run.id as string,
          report_id: report.id,
          client_id: report.client_id,
          vertical: report.vertical_slug,
          url: clean,
          domain,
          is_client: ownDomain && domain ? domain === ownDomain : null,
          ordinal,
        };
      });
      const { error: citeError } = await supabaseAdmin.from("fanout_citations").insert(rows);
      if (citeError) throw new Error(`insert citations (${report.id}): ${citeError.message}`);

      runsWritten++;
      citationsWritten += rows.length;
    }

    reportsWritten++;
    console.log(`  wrote ${label}`);
  }

  console.log("");
  console.log("=== summary ===");
  console.log(`reports already backfilled (skipped): ${skipped}`);
  console.log(`reports with no usable citations:     ${reportsWithNothing}`);
  console.log(`reports ${COMMIT ? "written" : "to write"}:                    ${reportsWritten}`);
  console.log(`fanout_runs ${COMMIT ? "written" : "to write"}:                ${runsWritten}`);
  console.log(`fanout_citations ${COMMIT ? "written" : "to write"}:           ${citationsWritten}`);
  if (!COMMIT) console.log("\nNothing was written. Re-run with --commit.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
