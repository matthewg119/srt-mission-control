-- Ad-hoc forward target for email-driven deal shopping.
--
-- Lets Matthew reply in a "New Deal" #srt-sub thread with raw addresses
-- ("email this to bob@lender.com and cc jane@lender.com"). The parsed To/CC are
-- staged here; a follow-up `go` reads them, forwards the package, then clears them.
--
-- Run in Supabase prod (SQL editor) before deploying the ad-hoc forward feature.

alter table public.email_submissions
  add column if not exists pending_adhoc_to text[],
  add column if not exists pending_adhoc_cc text[];

comment on column public.email_submissions.pending_adhoc_to is
  'Staged To-recipients for a confirm-first ad-hoc forward; cleared after send.';
comment on column public.email_submissions.pending_adhoc_cc is
  'Staged CC-recipients for a confirm-first ad-hoc forward; cleared after send.';
