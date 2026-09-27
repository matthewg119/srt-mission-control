-- raw_leads could never be written to, and the reason was one WHERE clause.
--
--   bun run scripts/db.ts --file=docs/2026-09-26-raw-leads-on-conflict.sql --dry
--   bun run scripts/db.ts --file=docs/2026-09-26-raw-leads-on-conflict.sql
--
-- WHAT WAS BROKEN. storeRawLeads in src/lib/scraper/pull.ts upserts with
-- `onConflict: "run_id,place_id"`, which PostgREST sends as ON CONFLICT (run_id, place_id). The only
-- matching index was PARTIAL:
--
--   create unique index raw_leads_run_place on raw_leads (run_id, place_id) where place_id is not null;
--
-- Postgres will not use a partial index for ON CONFLICT unless the statement repeats the same
-- predicate, and PostgREST's on_conflict parameter cannot express a predicate at all. So every call
-- returned "there is no unique or exclusion constraint matching the ON CONFLICT specification" and
-- inserted NOTHING.
--
-- ‼️ THIS BROKE BOTH ARMS, NOT ONLY THE NEW ONE. sweepPullCsv (the 3 CSV drop) and the 4 Maps webhook
-- both write through storeRawLeads, so neither could ever have produced a send list. raw_leads and
-- sendable_leads both holding zero rows in production was read as "workflow C has never run"; it was
-- also "workflow C could not have succeeded if it had". Found 2026-09-26 by driving the webhook route
-- with a synthetic payload, which is the first time that function had ever been called.
--
-- WHY DROPPING THE PREDICATE IS SAFE AND CHANGES NOTHING ELSE. In a Postgres unique index NULLs are
-- DISTINCT by default, so rows with a null place_id never conflict with each other with or without
-- the WHERE clause. The predicate was protecting against something the index already allowed. The
-- comment in storeRawLeads is still correct: a source that cannot identify a place cannot promise the
-- same place twice, so those rows are simply always inserted.
--
-- raw_leads holds 0 rows, so this is free.

drop index if exists public.raw_leads_run_place;

create unique index if not exists raw_leads_run_place
  on public.raw_leads (run_id, place_id);

comment on index public.raw_leads_run_place is
  'Idempotency for a re-entered webhook or a re-driven pull. NOT partial, on purpose: ON CONFLICT '
  'cannot target a partial index through PostgREST, and NULL place_ids are already distinct in a '
  'unique index, so the old WHERE place_id IS NOT NULL bought nothing and cost every insert.';

-- Verification. Expect matching_index 1 and is_partial 0.
select 'matching_index' as check, count(*)::text as n from pg_indexes
  where schemaname = 'public' and tablename = 'raw_leads' and indexname = 'raw_leads_run_place'
union all
select 'is_partial', count(*)::text from pg_indexes
  where schemaname = 'public' and tablename = 'raw_leads' and indexname = 'raw_leads_run_place'
    and indexdef like '%WHERE%';
