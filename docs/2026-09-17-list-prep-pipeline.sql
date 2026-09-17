-- 2026-09-17: the list-prep pipeline. Qualify before you enrich, and suppress against everything.
--
-- Matthew, 2026-09-17: "Every new list we build should run through the same 10-step layer before a
-- single email sends. The workflow is the standard, the tools inside each step are pluggable ...
-- Qualifying BEFORE enriching kills roughly half the enrichment spend on companies we were always
-- going to drop. That one reorder pays for the build."
--
-- ‼️ THE ORDER IS THE PRODUCT, NOT THE PROVIDERS. Clay, Outscraper, Prospeo and MillionVerifier are
-- all one step each and all swappable. What is not swappable is that qualification runs BEFORE any
-- money is spent, that drop reasons are read in bulk before enrichment, and that suppression asks
-- our own source of truth rather than a vendor's cache. This file stores the workflow; the vendors
-- live in env vars.
--
-- Three tables and one widened check:
--   A. raw_leads         one company as pulled, plus the qualify verdict written in place
--   B. list_pipeline_runs one pull walked through the stages, with the funnel counts
--   C. sendable_leads     the output, one row per deliverable address
--   D. scraper_batches.status gains the Workflow C stages
--
-- Runner: bun run scripts/db.ts --file=docs/2026-09-17-list-prep-pipeline.sql [--dry]


-- =====================================================================
-- A. raw_leads
-- =====================================================================
--
-- ‼️ ONE TABLE FOR EVERY SOURCE, AND THAT IS WHY INSTAGRAM IS NOT A SECOND PIPELINE. Matthew,
-- 2026-09-17: "a lot of med spa owners do live on instagram as well ... maybe even another
-- workflow?" It is another SOURCE. A parallel workflow would fork qualification, suppression and
-- the spend gate, which are the three parts that must never diverge. Google Maps lands here with
-- source='outscraper' and an Instagram pull lands here with source='socialscraper', and everything
-- after stage 1 is identical.
--
-- ‼️ THE QUALIFY VERDICT LIVES ON THE ROW, NOT IN A SIDE TABLE. The drop REASON is the thing that
-- has to be readable in bulk before any money is spent ("a few thousand rows cut for one reason is
-- a signal the ICP is wrong"), and a join makes that a query nobody writes.
create table if not exists public.raw_leads (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null,

  -- Where it came from and what was asked for, so a pull can be reproduced or blamed.
  source        text not null check (source in ('outscraper', 'dataforseo', 'socialscraper', 'csv', 'apollo')),
  source_query  text,
  source_metro  text,

  -- Identity. place_id is Google's, and is the only stable key across two pulls of one metro.
  place_id      text,
  business_name text not null,
  domain        text,
  website       text,
  phone         text,
  phone_normalized text,
  full_address  text,
  city          text,
  state         text,
  postal_code   text,
  categories    text,
  primary_type  text,
  rating        numeric,
  review_count  integer,
  instagram_handle text,
  owner_name    text,

  -- ‼️ THE SAME TAXONOMY adoptAuditClassification WRITES, not a parallel one. A qualified company
  -- has to be matchable to an avatar exactly the way an onboarded client is, or campaigns cannot be
  -- built per avatar and the scraped row is a dead end.
  vertical_slug text,
  business_type text,
  avatar_slug   text,

  -- Both sources found it. Stronger, not a duplicate to discard.
  found_in_sources text[] not null default '{}',

  -- Stage 2, written BEFORE any enrichment call.
  qualify_keep   boolean,
  qualify_reason text,
  qualify_model  text,
  qualified_at   timestamptz,

  raw           jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

-- One row per place per pull. A cron re-entry re-reads and inserts nothing twice.
create unique index if not exists raw_leads_run_place
  on public.raw_leads (run_id, place_id) where place_id is not null;
create index if not exists raw_leads_run on public.raw_leads (run_id, created_at);
-- The bulk drop-reason read, which is the human checkpoint before the money goes.
create index if not exists raw_leads_verdict on public.raw_leads (run_id, qualify_keep);
create index if not exists raw_leads_domain on public.raw_leads (domain) where domain is not null;
alter table public.raw_leads enable row level security;


-- =====================================================================
-- B. list_pipeline_runs
-- =====================================================================
--
-- The funnel, so "roughly 0.7 of the raw pull survives" is a measured number rather than a slogan.
create table if not exists public.list_pipeline_runs (
  id            uuid primary key default gen_random_uuid(),
  batch_id      uuid references public.scraper_batches (id) on delete set null,

  label         text,
  source        text not null,
  source_queries text[] not null default '{}',

  -- ‼️ THE ICP IS STORED VERBATIM WITH THE RUN. It is the prompt every keep/drop verdict was made
  -- against, so a run whose ICP is not on file cannot be argued with afterwards, and the next run
  -- cannot be compared to it. Same reason keyword_runs stores its prompts.
  icp_text      text,

  stage         text not null default 'pulling'
                check (stage in ('pulling', 'qualifying', 'qualified', 'enriching', 'verifying',
                                 'catchall_recheck', 'suppressing', 'done', 'error')),

  -- The funnel. Every one is a count of rows, never a rate: a rate hides the denominator.
  raw_count       integer not null default 0,
  qualified_count integer not null default 0,
  enriched_count  integer not null default 0,
  verified_count  integer not null default 0,
  sendable_count  integer not null default 0,

  -- What each provider was asked for and what it cost, so a swap can be argued from numbers.
  provider_spend  jsonb not null default '{}'::jsonb,
  cost_usd        numeric not null default 0,

  -- The standing spend gate. Nothing that costs money runs unattended, at any size.
  spend_approved_at timestamptz,
  spend_approved_by text,
  drop_review_ts    text,

  slack_channel_id text,
  slack_thread_ts  text,
  error         text,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz
);

create index if not exists list_pipeline_runs_active
  on public.list_pipeline_runs (started_at)
  where stage not in ('done', 'error');
alter table public.list_pipeline_runs enable row level security;


-- =====================================================================
-- C. sendable_leads
-- =====================================================================
--
-- ‼️ A SEPARATE TABLE RATHER THAN A FLAG ON raw_leads, because the grain is different: one company
-- can yield two named people, and one person can be found by two providers. A boolean on the
-- company row cannot say which address survived, who it belongs to, or what was paid for it.
create table if not exists public.sendable_leads (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null,
  raw_lead_id   uuid not null references public.raw_leads (id) on delete cascade,

  email         text not null,
  first_name    text,
  last_name     text,
  title         text,

  -- Which provider found it, and what that cost. A waterfall is only swappable if every rung
  -- records its own attempt: otherwise a later swap loses the trail it would be argued from.
  provider      text,
  provider_cost_usd numeric,
  attempts      jsonb not null default '[]'::jsonb,

  -- ‼️ TRI-STATE, COPIED FROM mx.ts's MxVerdict AND FOR THE SAME REASON. A catch-all domain reports
  -- "valid" and then bounces, and a recheck that fails to RESOLVE is "still unknown". Writing that
  -- as either valid or bouncing is the failure the third value exists to prevent.
  email_status  text check (email_status in ('valid', 'catch_all', 'unknown', 'invalid')),
  catchall_rechecked_at timestamptz,
  verified_at   timestamptz,

  -- Why it is NOT sendable, when it is not. Null means it is.
  suppressed_reason text,
  suppressed_at timestamptz,

  created_at    timestamptz not null default now()
);

-- One address per run. A retried tick cannot double-insert, and two providers returning the same
-- address collapse to the row that already records both attempts.
create unique index if not exists sendable_leads_run_email
  on public.sendable_leads (run_id, lower(email));
create index if not exists sendable_leads_run on public.sendable_leads (run_id, suppressed_reason);
alter table public.sendable_leads enable row level security;

comment on table public.sendable_leads is
  'The output of the list-prep pipeline: one row per deliverable address, carrying which provider '
  'found it, what it cost, its tri-state verification and, when it is held back, why. '
  'suppressed_reason null is the sendable set.';


-- =====================================================================
-- D. THE STAGE MACHINE LEARNS WORKFLOW C
-- =====================================================================
--
-- ‼️ WIDENED, NEVER NARROWED. Every existing value stays legal, so no in-flight batch can fail its
-- own check constraint mid-run.
alter table public.scraper_batches drop constraint if exists scraper_batches_status_check;
alter table public.scraper_batches add constraint scraper_batches_status_check
  check (status in (
    'awaiting_workflow', 'scoring', 'auditing', 'scored', 'awaiting_apollo_export',
    'parsing', 'mx', 'filtered', 'verifying', 'done', 'error',
    -- Workflow C, in order. qualifying is the FIRST stage after a pull and has no skip path.
    'pulling', 'qualifying', 'qualified', 'enriching', 'catchall_recheck', 'suppressing'
  ));

alter table public.scraper_batches add column if not exists list_run_id uuid
  references public.list_pipeline_runs (id) on delete set null;

comment on column public.scraper_batches.list_run_id is
  'The list-prep run this batch is walking, when the picker resolved it to Workflow C.';


-- ── Verify ──────────────────────────────────────────────────────────────────
select 'raw_leads' as t, count(*)::text as cols from information_schema.columns
  where table_schema='public' and table_name='raw_leads'
union all select 'list_pipeline_runs', count(*)::text from information_schema.columns
  where table_schema='public' and table_name='list_pipeline_runs'
union all select 'sendable_leads', count(*)::text from information_schema.columns
  where table_schema='public' and table_name='sendable_leads'
union all select 'scraper_batches.list_run_id', count(*)::text from information_schema.columns
  where table_schema='public' and table_name='scraper_batches' and column_name='list_run_id';
