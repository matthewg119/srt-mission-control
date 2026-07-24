-- Audit Engine v2 — public "Free Audit" intake funnel (srtagency.com).
-- Unlike a Slack-triggered audit, a public form submission has no Slack user —
-- it has a name/email/phone instead, so the completed report/PDF gets emailed
-- directly to the requester (see src/app/api/audit/public-intake/route.ts).
-- Safe to re-run.

alter table audit_reports add column if not exists requester_name text;
alter table audit_reports add column if not exists requester_email text;
alter table audit_reports add column if not exists requester_phone text;
