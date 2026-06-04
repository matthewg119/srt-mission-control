-- Funder-routing fidelity: replicate exactly how each funder is historically emailed.
--
-- Some funders must be emailed to an ordered list of people (one needs 5), plus a CC set.
-- The old model stored a single submission_email + cc_emails[] (sent as BCC). This adds an
-- ordered To-list and a provenance marker. submission_email stays as the first/fallback To.
--
-- Run in Supabase prod (SQL editor) before deploying the recipient-aware fan-out.

alter table public.lenders
  add column if not exists to_emails text[] not null default '{}',
  add column if not exists recipient_source text;  -- 'seeded_from_sent' | 'manual' | null

-- cc_emails already exists (docs/2026-04-20-lender-fields.sql); it is now sent as real CC, not BCC.

comment on column public.lenders.to_emails is
  'Ordered primary To-recipients for submissions. Empty → fall back to submission_email.';
comment on column public.lenders.recipient_source is
  'How to_emails/cc_emails were populated: seeded_from_sent | manual.';
