-- /onboarding2: capture the signer's full name on screen 1, before the agreement.
--
-- Additive only. The four onboarding2 tables already exist in production
-- (docs/2026-09-01-onboarding2.sql), so this cannot be folded into that file.
--
-- Nothing else is needed for the v4 cut or for the delivery cascade. The cascade claims
-- idempotently against `clients.intake_completed_at is null` and `clients.ops_thread_ts is
-- null`, both of which already exist, so it needs no column of its own.
--
-- onboarding2_leads.contact_name already exists and is unchanged.

alter table public.onboarding2_signings
  add column if not exists contact_name text;

comment on column public.onboarding2_signings.contact_name is
  'Full name captured on screen 1 with the email, before the agreement opens. Pre-fills
   print_name on the signature screen and feeds clients.dba_name, so an email address can
   never end up as a company name on a board.';
