-- 2026-08-02: tag each audit report with the public funnel that produced it.
--
-- finishReport runs in a DIFFERENT request from runAuditPipeline (/api/audit/process
-- calls it, and it only ever sees the audit_reports row), so the funnel cannot be
-- passed through in memory. It has to live on the row.
--
-- Read by finish-report.ts to (a) route the "Send it / Hold" pitch card into the
-- #ai-visibility-audits thread instead of #hot-leads for /PDF guide leads, (b) attach
-- the med spa guide CTA to the drafted email, and (c) skip the cold-outreach intake
-- card for a lead who already asked us for the report.
--
-- Add-only. Existing rows stay null, which is the cold-/audit behaviour and is exactly
-- what every code path treats null as.

alter table audit_reports
  add column if not exists lead_source text;

create index if not exists audit_reports_lead_source_idx
  on audit_reports (lead_source);
