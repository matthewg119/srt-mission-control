-- Workflow C wiring: the two things 2026-09-17 left behind.
--
-- Run this BEFORE deploying the code. Piece 1 is blocking: without it every 3️⃣ pick is refused
-- by Postgres and the batch lands in `error` with a constraint violation nobody will read as
-- "you forgot a migration".
--
-- ‼️ scripts/db.ts --file=... autocommits per statement; the Supabase SQL editor wraps a paste in
-- ONE transaction, so a failing verification SELECT at the bottom rolls the whole thing back.
-- The verification here is a plain SELECT of counts, which cannot fail.

-- ---------------------------------------------------------------------------------------------
-- 1. BLOCKING. The status check was widened on 2026-09-17. The WORKFLOW check was not, and it
--    still dates from 2026-08-28-scraper-score-lane.sql:38-40. Every `workflow = 'listprep'`
--    write is refused today.
--
--    Widened, never narrowed: both existing values stay legal, so this is safe to run while
--    workflow 1 and 2 batches are mid-flight.
-- ---------------------------------------------------------------------------------------------
alter table public.scraper_batches drop constraint if exists scraper_batches_workflow_check;
alter table public.scraper_batches add constraint scraper_batches_workflow_check
  check (workflow is null or workflow in ('filter', 'score', 'listprep'));

-- ---------------------------------------------------------------------------------------------
-- 2. An enrichment MISS has nowhere to live.
--
--    `sendable_leads.email` is NOT NULL, so a site that was crawled and yielded nothing cannot be
--    a row there, and `raw_leads` has no enrichment columns at all. Without these two the
--    `enriching` worklist can never shrink: the batch parks forever and the cron re-crawls the
--    same misses every five minutes, against other people's servers, with no error anywhere.
--    That is worse than a silent truncation, because it is an unbounded outbound crawl.
--
--    `enriched_at` is the exit marker. `enrich_attempts` is the per-rung trail that enrich.ts
--    requires so a waterfall stays swappable ("Prospeo covers 55%" has to be a thing the database
--    says, not a thing somebody remembers).
--
--    ‼️ NOT stuffed into `raw_leads.raw`. That column's contract is WHAT THE SOURCE SAID, and
--    writing our own verdicts into it makes a re-run un-auditable against the original pull.
-- ---------------------------------------------------------------------------------------------
alter table public.raw_leads add column if not exists enrich_attempts jsonb not null default '[]'::jsonb;
alter table public.raw_leads add column if not exists enriched_at timestamptz;

comment on column public.raw_leads.enriched_at is
  'Stamped once the enrichment waterfall has been walked for this lead, HIT OR MISS. It is the '
  'worklist exit condition, not a success flag: a null email with a set enriched_at means we '
  'looked and found nothing, and asking again would just re-crawl a site that has no address on it.';

comment on column public.raw_leads.enrich_attempts is
  'One entry per rung asked, including the misses. Append-only within a run.';

-- ---------------------------------------------------------------------------------------------
-- 3. `suppressed_at` gets a widened MEANING, not a widened type. It is now stamped on every row
--    the suppression sweep checked, including the clean ones, because otherwise "checked and
--    clean" and "not yet checked" are indistinguishable and the sweep never terminates.
--    `suppressed_reason is null` remains the sendable set, exactly as before.
-- ---------------------------------------------------------------------------------------------
comment on column public.sendable_leads.suppressed_at is
  'When the suppression sweep CHECKED this row, not when it suppressed it. Stamped on clean rows '
  'too: it is the worklist marker. Read `suppressed_reason is null` for the sendable set.';

-- ---------------------------------------------------------------------------------------------
-- Verification. Plain counts, so nothing here can roll the migration back.
-- Expect: workflow_check_has_listprep = 1, raw_leads_enriched_at = 1, raw_leads_enrich_attempts = 1
-- ---------------------------------------------------------------------------------------------
select 'workflow_check_has_listprep' as check, count(*)::text as n
  from pg_constraint
  where conname = 'scraper_batches_workflow_check'
    and pg_get_constraintdef(oid) like '%listprep%'
union all select 'raw_leads_enriched_at', count(*)::text from information_schema.columns
  where table_schema = 'public' and table_name = 'raw_leads' and column_name = 'enriched_at'
union all select 'raw_leads_enrich_attempts', count(*)::text from information_schema.columns
  where table_schema = 'public' and table_name = 'raw_leads' and column_name = 'enrich_attempts';
