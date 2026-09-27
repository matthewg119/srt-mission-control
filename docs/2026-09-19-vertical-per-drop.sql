-- Workflow C: which vertical a run is building a list for.
--
-- Run this alongside docs/2026-09-18-workflow-c-wiring.sql. Order between the two does not matter;
-- both are idempotent and neither depends on the other.
--
-- ‼️ scripts/db.ts --file=... autocommits per statement; the Supabase SQL editor wraps a paste in
-- ONE transaction, so a failing verification SELECT at the bottom rolls the whole thing back. The
-- verification here is a plain SELECT of counts, which cannot fail.

-- ---------------------------------------------------------------------------------------------
-- 1. The vertical, resolved once from the drop caption and then read back by every later stage.
--
--    It is stored rather than re-derived for the same reason `icp_text` is stored: the alias table
--    in src/lib/scraper/icp.ts is editable, the stage machine spans many five-minute ticks, and a
--    run whose rows were PULLED under one vertical and QUALIFIED under another is not something
--    the drop-review card could explain afterwards. `raw_leads.vertical_slug` is the per-row copy;
--    this is the run-level decision those copies came from.
--
--    ‼️ serviceKey() SHAPED, not classify.ts's kebab-case `vertical_slug`. serviceKey() lowercases
--    and strips every non-alphanumeric, so the values here are `medspa` and `dentist`, never
--    `med-spa` or `med_spa`. That spelling split is not hypothetical: question-sets.ts tested
--    `vertical === "med_spa"`, a spelling classify.ts is instructed never to emit, and every real
--    med spa missed all three branches of it.
--
--    Nullable with no default on purpose. A default here would be a fifth route to "this is a med
--    spa", which is the bug family this column exists to end. Rows written before this migration
--    legitimately have no answer, and the code reads `|| DEFAULT_VERTICAL` at exactly one site.
-- ---------------------------------------------------------------------------------------------
alter table public.list_pipeline_runs add column if not exists vertical_slug text;

comment on column public.list_pipeline_runs.vertical_slug is
  'Which buyer profile this run was judged against, serviceKey() shaped (medspa, dentist). '
  'Resolved ONCE from the drop caption at startRun and read back by every later stage, never '
  're-derived. Null on runs that predate the column.';

create index if not exists list_pipeline_runs_vertical_idx
  on public.list_pipeline_runs (vertical_slug);

-- ---------------------------------------------------------------------------------------------
-- Verification. Plain counts, so nothing here can roll the migration back.
-- Expect: runs_vertical_slug = 1, runs_vertical_idx = 1
-- ---------------------------------------------------------------------------------------------
select 'runs_vertical_slug' as check, count(*)::text as n
  from information_schema.columns
  where table_schema = 'public' and table_name = 'list_pipeline_runs'
    and column_name = 'vertical_slug'
union all select 'runs_vertical_idx', count(*)::text from pg_indexes
  where schemaname = 'public' and indexname = 'list_pipeline_runs_vertical_idx';
