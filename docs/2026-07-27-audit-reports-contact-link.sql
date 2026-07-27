-- Audit Engine — link a public audit report to the contact it came from.
--
-- Public free-audit leads now go through ingestLead() first (src/lib/lead-intake.ts),
-- which opens a #hot-leads thread on the contact. Storing that contact id on the
-- report lets finishReport post the finished scorecard as a REPLY in that thread
-- instead of a standalone message (see src/lib/audit-engine/finish-report.ts).
--
-- Also adds contacts.website: the audited site is the primary datum of these
-- leads and there was nowhere on the contact to keep it.
-- Safe to re-run.

alter table audit_reports add column if not exists contact_id uuid references contacts(id);
create index if not exists audit_reports_contact_id_idx on audit_reports(contact_id);

-- Backs the double-submit guard in run-audit-pipeline.ts (same website+email
-- inside 30 minutes is a stray second beacon, not a real re-audit).
create index if not exists audit_reports_email_website_idx on audit_reports(requester_email, website);

alter table contacts add column if not exists website text;
