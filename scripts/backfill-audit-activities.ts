// One-shot: put every finished audit that already has a lead onto that lead's timeline.
//
// From here on, finishReport calls writeAuditToLead itself. This exists only for the
// reports that finished BEFORE that wiring existed, so their leads do not look like they
// were never scanned.
//
//   bun run scripts/backfill-audit-activities.ts          (dry run, prints what it would do)
//   bun run scripts/backfill-audit-activities.ts --write
//
// SAFE TO RE-RUN. logActivity is unique on (source, external_id) and this passes the
// report id as externalId, so a second pass inserts nothing.
//
// It deliberately does NOT backfill FIELDS. Writing an old audit's business_type over a
// value someone has since corrected by hand would be a silent regression, and unlike the
// timeline entry there is no reading of "what happened" that makes it obviously right.
// New audits still patch fields; history just does not get rewritten.

import { supabaseAdmin } from "../src/lib/db";
import { loadReportView, computeWeightedScore } from "../src/lib/audit-engine/report-view";
import { logActivity } from "../src/lib/crm";
import type { AuditReportRow } from "../src/lib/audit-engine/types";

const WRITE = process.argv.includes("--write");

async function main() {
  const { data, error } = await supabaseAdmin
    .from("audit_reports")
    .select("*")
    .eq("status", "done")
    .not("contact_id", "is", null)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);

  const reports = (data ?? []) as AuditReportRow[];
  console.log(`${reports.length} finished audits with a linked lead.`);
  if (!WRITE) console.log("Dry run. Pass --write to insert.\n");

  let wrote = 0;
  for (const report of reports) {
    const view = await loadReportView(report);
    const score = report.score ?? computeWeightedScore(view).score;
    const line = `${report.client_name ?? report.website} — ${score}/100 — ${report.contact_id}`;

    if (!WRITE) {
      console.log(`  would log: ${line}`);
      continue;
    }

    const id = await logActivity({
      contactId: report.contact_id as string,
      activityType: "audit",
      direction: "internal",
      channel: "web",
      subject: `AI visibility audit: ${score}/100`,
      body: `Named in ${view.totalMentioned} of ${view.totalPrompts} questions.`,
      actor: "Audit engine",
      source: "audit_engine",
      externalId: report.id,
      occurredAt: report.created_at as string,
      metadata: { reportId: report.id, slug: report.slug, score, backfilled: true },
    });

    if (id) wrote++;
    console.log(`  ${id ? "logged" : "skipped (already present)"}: ${line}`);
  }

  if (WRITE) console.log(`\nDone. ${wrote} new timeline entries.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
