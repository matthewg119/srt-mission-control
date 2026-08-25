-- Step-board fix pass, 2026-08-24. Safe to run more than once.
--
-- Requires Postgres 15 or later for NULLS NOT DISTINCT. Check first:
--   select current_setting('server_version_num')::int >= 150000 as ok;
-- On 14 the statement below is a syntax error and this file aborts BEFORE the drop, which is
-- the safe failure: the old index survives and nothing is left unprotected.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. nap_discrepancies: from an EXPRESSION key to a COLUMN key
-- ─────────────────────────────────────────────────────────────────────────────
--
-- ‼️ THIS FUNCTION HAS FAILED TWO DIFFERENT WAYS AND THE FIX FOR THE FIRST CAUSED THE SECOND.
--
-- FAILURE ONE, every run from ship day to 2026-08-22: 42P10 at PLAN time.
--   there is no unique or exclusion constraint matching the ON CONFLICT specification
-- seedPresenceSweep passed onConflict "client_id,platform,listing_url" against an index keyed on
-- the EXPRESSION coalesce(listing_url, ''). ON CONFLICT infers an arbiter by matching the
-- inference spec against the index's key expressions, and a bare column name never matches an
-- expression. Not a data collision: the statement could not be planned, so it could not succeed
-- even once. Production had zero rows.
--
-- FAILURE TWO, introduced by the fix for failure one, and it is what is live today:
--   duplicate key value violates unique constraint "nap_discrepancies_platform_listing_key"
-- Dropping the onConflict option leaves PostgREST with no conflict target. With no target there
-- is no arbiter to skip on, so the second seed for a client was a plain INSERT of eighteen rows
-- that already existed. nap_sweep went to a terminal 'error' and stayed there.
--
-- ‼️ NULLS NOT DISTINCT IS LOAD-BEARING AND IS NOT OPTIONAL.
-- Every seeded row has a null listing_url. Under Postgres's default, nulls compare distinct, so
-- a plain unique index on these three columns would constrain NONE of these rows and every
-- re-seed would insert eighteen fresh duplicates. The old comment in presence-sweep.ts warned
-- about exactly that and was right about a PLAIN index, wrong only about there being no way to
-- write one. NULLS NOT DISTINCT makes two nulls collide, which is precisely the semantics
-- coalesce(listing_url,'') had, spelled as COLUMNS so ON CONFLICT can infer it and so
-- PostgREST's on_conflict parameter, which takes column names only and can never spell a
-- coalesce, can name it.
--
-- Create BEFORE dropping, so there is never a window with no protection. Both indexes coexist
-- for two statements; inference picks the column one and either honours the constraint.
create unique index if not exists nap_discrepancies_client_platform_url_key
  on public.nap_discrepancies (client_id, platform, listing_url) nulls not distinct;

-- The only behavioural difference from the expression index: a row whose listing_url is the
-- literal empty string no longer collides with a null one. Nothing writes an empty string.
drop index if exists public.nap_discrepancies_platform_listing_key;

comment on index public.nap_discrepancies_client_platform_url_key is
  'One row per platform per listing. NULLS NOT DISTINCT is load-bearing: seeded rows carry a '
  'null listing_url and the default nulls-distinct rule would constrain none of them, so every '
  're-seed would insert eighteen duplicates. Spelled as columns rather than '
  'coalesce(listing_url, '''') so ON CONFLICT can infer it and PostgREST can name it.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. client_docs: which presence platform a screenshot is of
-- ─────────────────────────────────────────────────────────────────────────────
--
-- presence_sweep_manual used to gate on a bare COUNT of files in the step's thread, which counted
-- four files all named image.png as four platforms swept. The person now posts one platform per
-- message and names it in the message text; that text is matched against the keys, labels and
-- aliases in src/config/presence-platforms.ts and the resolved key lands here.
--
-- NULLABLE, and null is a real answer meaning "the message named no platform, or named more than
-- one". Same doctrine as delivery_step_key one migration earlier: unattributed beats lost, and a
-- capture that REFUSED an unnamed screenshot would teach people to stop dropping things in the
-- thread at all.
--
-- ‼️ NO CHECK CONSTRAINT AND NO ENUM, same reasoning as client_delivery_steps.step_key. The
-- platform list lives in config; a constraint here would be a second copy of it, and renaming a
-- key would orphan every row already carrying it. The config is the authority.
alter table public.client_docs
  add column if not exists presence_platform text;

comment on column public.client_docs.presence_platform is
  'presence-platforms.ts key (google, apple, bing, yelp, realself, facebook, and the twelve '
  'extended) this screenshot is evidence for, resolved from the Slack message text that carried '
  'it. NULL means the message named no platform or named more than one, which is not a failure: '
  'the file is still filed and the thread says what is missing.';

create index if not exists client_docs_presence_platform_idx
  on public.client_docs (client_id, delivery_step_key, presence_platform)
  where presence_platform is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- What to expect afterwards
-- ─────────────────────────────────────────────────────────────────────────────
--
-- select indexname from pg_indexes
--  where tablename = 'nap_discrepancies' and indexname like '%platform%';
--    Exactly one row: nap_discrepancies_client_platform_url_key.
--
-- select count(*) from public.nap_discrepancies
--  where client_id = '50ab028c-7bad-423f-b7a3-cfc9e3cf8e38';
--    18, unchanged. Those rows are 18 distinct platforms with a null listing_url, so they
--    already satisfy the new index and CREATE succeeds without touching data.
--
-- select delivery_step_key, presence_platform, count(*) from public.client_docs
--  group by 1, 2 order by 1, 2;
--    Every existing row reads null. Backfilling is not possible and is not attempted: the
--    message text those files arrived with was never stored.
