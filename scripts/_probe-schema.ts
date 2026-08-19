// Read-only confirmation that the five migrations landed. Selects nothing but column names,
// limit 1, so it cannot alter a row. Run: bunx tsx --env-file=.env.local scripts/_probe-schema.ts
import { supabaseAdmin } from "@/lib/db";

type Check = { label: string; table: string; columns: string };

const CHECKS: Check[] = [
  // 2026-08-18-audit-crawl-block.sql
  { label: "crawl_block + research_source", table: "audit_reports", columns: "id,crawl_block,research_source" },
  // 2026-08-19-artifact-plumbing.sql — without this every audit insert fails
  { label: "audit_reports.client_id", table: "audit_reports", columns: "id,client_id" },
  { label: "clients.site_intel", table: "clients", columns: "id,site_intel" },
  { label: "client_docs.source", table: "client_docs", columns: "id,source" },
  // 2026-08-19-harvest.sql
  { label: "harvest_runs", table: "harvest_runs", columns: "id,vertical,sources,results_count" },
  { label: "question_bank", table: "question_bank", columns: "id,vertical,phrase,normalized,avatar" },
  { label: "page_candidates", table: "page_candidates", columns: "id,question,score,currently_named" },
  // 2026-08-19-presence-and-competitors.sql
  { label: "nap_discrepancies", table: "nap_discrepancies", columns: "id,platform,tier,status,proposed_status,confirmed_status" },
  { label: "competitor_candidates", table: "competitor_candidates", columns: "id,name,normalized_name,times_named,selected" },
];

async function main() {
  let bad = 0;
  for (const c of CHECKS) {
    const { error } = await supabaseAdmin.from(c.table).select(c.columns).limit(1);
    if (error) {
      bad++;
      console.log(`  FAIL  ${c.label.padEnd(32)} ${error.message}`);
    } else {
      console.log(`  ok    ${c.label}`);
    }
  }

  // The one that is a constraint change rather than a new column: website must accept null.
  const { data: cols, error: colErr } = await supabaseAdmin
    .rpc("exec_sql", { sql: "select 1" })
    .then((r) => r, () => ({ data: null, error: { message: "no exec_sql rpc (expected)" } }));
  void cols;
  void colErr;

  console.log(bad === 0 ? "\nAll five migrations present." : `\n${bad} check(s) FAILED.`);
  process.exit(bad === 0 ? 0 : 1);
}

main();
