-- Onboarding evidence: screenshots replying in a Slack thread become filed evidence.
--
-- Safe to run more than once.
--
-- WHY THIS EXISTS. Runner v3 §3: "Files uploaded in a task thread are captured via the
-- Slack events API, stored in Supabase storage, written to onboarding_docs against that
-- task. That is how screenshots become evidence without me filing anything."
--
-- This is the load-bearing piece for the whole manual half of the checklist. The presence
-- sweep is eighteen platforms, most of them manual, and the evidence for "missing" is a
-- screenshot of an empty search result. If filing that evidence is a separate chore it does
-- not happen, and then the 3c PDF has nothing to show and the findings doc has nothing
-- behind section 2.
--
-- client_docs ALREADY EXISTS (docs/2026-08-16-client-onboarding.sql) and has never been
-- written to by anything — zero references in src/ or scripts/. It is reused rather than
-- superseded. Two changes below.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Which STEP the evidence belongs to
-- ─────────────────────────────────────────────────────────────────────────────
--
-- client_docs.step_id points at client_onboarding_steps — the EIGHT client-facing pilot
-- stages. That is the wrong altitude for evidence: "photograph_1" covers ten of the
-- delivery steps, so filing a Yelp screenshot against it says almost nothing.
--
-- The operational steps are client_delivery_steps, keyed by step_key (a stable slug, not a
-- uuid, so a step can be reworded without a migration). So evidence gets the key.
--
-- NULLABLE on purpose. A file dropped in the client's thread that does not belong to any
-- particular step is still evidence worth keeping, and refusing it would teach people to
-- stop dropping things in the thread. Unattributed beats lost.
alter table public.client_docs
  add column if not exists delivery_step_key text;

-- Where it came from, so a file can be traced back to the message that carried it and so
-- the same Slack file is never filed twice.
alter table public.client_docs
  add column if not exists slack_file_id text;

alter table public.client_docs
  add column if not exists slack_thread_ts text;

-- Idempotency. The Slack events API redelivers, and handleFileShared can run more than once
-- for one upload. A unique index is the claim, the same doctrine client_messages uses on
-- (client_id, draft_key).
create unique index if not exists client_docs_slack_file_idx
  on public.client_docs (slack_file_id)
  where slack_file_id is not null;

create index if not exists client_docs_client_step_idx
  on public.client_docs (client_id, delivery_step_key);

comment on column public.client_docs.delivery_step_key is
  'client_delivery_steps.step_key this evidence belongs to. NULL means it was dropped in the '
  'client thread without a step context, which is still worth keeping.';

comment on column public.client_docs.storage_ref is
  'Object key in the PRIVATE onboarding storage bucket. Not a URL: the bucket is private, so '
  'a viewable link is a short-lived signed URL minted on request. The OneDrive driveItem '
  'meaning in the original migration is superseded.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. The bucket, and it is PRIVATE
-- ─────────────────────────────────────────────────────────────────────────────
--
-- ‼️ NOT public, and this is not a default worth accepting. The `reels` bucket is public
-- because it holds our own marketing renders. This one holds screenshots of a CLIENT's
-- Google, Yelp and Facebook listings, their address and phone as currently published,
-- and whatever else lands in the thread. A public bucket means guessable-key access to
-- another business's records, on our infrastructure, with no login.
--
-- So: private bucket, service-role writes only, and reads go through a signed URL that
-- expires. src/lib/clients/onboarding-docs.ts mints those.
insert into storage.buckets (id, name, public)
values ('onboarding', 'onboarding', false)
on conflict (id) do update set public = false;

-- No storage policies. Every access is service-role, exactly like the client_* tables,
-- which are RLS-enabled with zero policies for the same reason: nothing in this product
-- talks to Supabase from a browser.

-- ─────────────────────────────────────────────────────────────────────────────
-- What to expect
-- ─────────────────────────────────────────────────────────────────────────────
--
-- select c.legal_name, d.delivery_step_key, d.filename, d.uploaded_by, d.uploaded_at
--   from public.client_docs d
--   join public.clients c on c.id = d.client_id
--  order by d.uploaded_at desc limit 20;
--
-- select id, public from storage.buckets where id = 'onboarding';   -- public must be false
