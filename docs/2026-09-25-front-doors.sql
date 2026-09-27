-- The front doors: a Maps pull that has no file, and the attribution that closes the loop.
--
-- Run it with:
--   bun run scripts/db.ts --file=docs/2026-09-25-front-doors.sql --dry
--   bun run scripts/db.ts --file=docs/2026-09-25-front-doors.sql
--
-- NOT the Supabase SQL editor. scripts/db.ts autocommits per statement; the editor wraps a paste in
-- ONE transaction, so a failing verification SELECT at the bottom rolls the whole thing back. The
-- verification here is a plain SELECT of counts, which cannot fail.
--
-- Everything from docs/2026-09-17, -09-18 and -09-19 is ALREADY APPLIED on this database, verified
-- by reading the columns and constraints back on 2026-09-25, and is not repeated. The two CHECK
-- constraints below are dropped and re-added rather than altered, and both restate every value that
-- was already legal: widened, never narrowed, or an in-flight batch fails its own check mid-run.

-- ------------------------------------------------------------------------------------------------
-- 1. Attribution, and this is the one thing in the build that cannot be recovered later.
--
--    list_pipeline_runs -> outreach_prospects.run_id -> contacts -> clients is what answers "what
--    fraction of the Instagram list converted versus the Maps list", which is the question the two
--    front doors exist to make answerable. A run that has already been mailed cannot be attributed
--    afterwards, so this lands before the first send rather than after it.
--
--    on delete set null, matching list_pipeline_runs.batch_id and scraper_batches.list_run_id. A run
--    row is never deleted in practice, and attribution is not worth blocking a delete over.
--
--    THE UNIQUE INDEX ON THIS TABLE IS ON lower(email), AN EXPRESSION INDEX, so PostgREST
--    on_conflict=email cannot target it. recordHandoff reads then inserts, in chunks, for exactly
--    that reason. Do not "simplify" it into an upsert.
-- ------------------------------------------------------------------------------------------------
alter table public.outreach_prospects
  add column if not exists run_id uuid
  references public.list_pipeline_runs (id) on delete set null;

comment on column public.outreach_prospects.run_id is
  'Which list-prep run handed this address off for sending. Written by recordHandoff at publish. '
  'Null on rows minted by a reply (createCampaignProspect) and on rows predating the column.';

create index if not exists outreach_prospects_run_idx
  on public.outreach_prospects (run_id);

-- ------------------------------------------------------------------------------------------------
-- 2. The Maps pull is submit-then-webhook, so its pulling stage is a POLL, and a poll needs a
--    terminal marker.
--
--    A LEGITIMATELY EMPTY PULL IS A REAL ANSWER. Polling on raw_count > 0 would leave a batch inside
--    ACTIVE_STATUSES forever on a metro with no results, and the cron would re-read that row every
--    five minutes with nothing to say. pull_finished_at is the marker. pull_request_id is so a
--    dropped or replayed webhook can be named in the failure message instead of guessed at.
--
--    ON THE RUN, NOT ON scraper_batches, for the reason store.ts gives over GATE_COLUMNS: this is a
--    property of the pipeline run, and there is no dropped file for it to belong to.
-- ------------------------------------------------------------------------------------------------
alter table public.list_pipeline_runs add column if not exists pull_request_id text;
alter table public.list_pipeline_runs add column if not exists pull_finished_at timestamptz;

comment on column public.list_pipeline_runs.pull_request_id is
  'Outscraper request id for a Maps run. Null for a csv run. Lets a replayed or orphaned webhook be '
  'matched, and lets a timed out pull name what it was waiting on.';
comment on column public.list_pipeline_runs.pull_finished_at is
  'When the pull webhook landed. THE MARKER the pulling stage polls on. Zero rows is a real answer, '
  'so a row count can never serve as this.';

create index if not exists list_pipeline_runs_pull_request_idx
  on public.list_pipeline_runs (pull_request_id)
  where pull_request_id is not null;

-- ------------------------------------------------------------------------------------------------
-- 3. The sixth gate card. Outscraper bills per record, so the submit sits behind a check mark.
--
--    ON list_pipeline_runs BECAUSE scraper_batches MAY NOT GROW A FIFTH *_ts. The GATE_COLUMNS
--    comment in store.ts says so, and drop_review_ts already set the precedent. batchByGateTs is
--    already generic over the runs table, so this column is the whole change.
--
--    spend_approved_at and spend_approved_by already exist from docs/2026-09-17 and have had NO
--    WRITER since. This gate is their first one, which is why no new approval column is added here.
-- ------------------------------------------------------------------------------------------------
alter table public.list_pipeline_runs add column if not exists pull_approval_ts text;

comment on column public.list_pipeline_runs.pull_approval_ts is
  'Slack ts of the spend-estimate card for a Maps pull. The check mark on it writes '
  'spend_approved_at and spend_approved_by, and only then is submitMapsSearch called. '
  'Resolved by batchByGateTs, the same as every other gate.';

-- ------------------------------------------------------------------------------------------------
-- 4. The workflow union learns the fourth arm.
--
--    WIDENED, NEVER NARROWED. filter, score and listprep all stay legal, so no in-flight batch can
--    fail its own check mid-run.
--
--    mapspull is NOT reachable from the picker. It has no file, so it has no columns and no keycap,
--    and PICK and KEYCAPS in lane.ts deliberately stop at three: a PICK[4] entry would let a 4
--    reaction on a CSV picker card start a paid Maps pull against that file.
-- ------------------------------------------------------------------------------------------------
alter table public.scraper_batches drop constraint if exists scraper_batches_workflow_check;
alter table public.scraper_batches add constraint scraper_batches_workflow_check
  check (workflow is null or workflow in ('filter', 'score', 'listprep', 'mapspull'));

-- ------------------------------------------------------------------------------------------------
-- 5. One new status: the spend gate's wait.
--
--    EVERY EXISTING VALUE IS RESTATED. Same rule as above.
--
--    Its arm in advanceBatch contains ONLY the guarded card post and a return, exactly like
--    'qualified'. That is what makes it safe to list in ACTIVE_STATUSES: the cron may poll it
--    forever and the only effect is re-reading one row. It is NOT in IN_FLIGHT, because nothing is
--    in flight, no row has been inserted, and nothing has been bought.
-- ------------------------------------------------------------------------------------------------
alter table public.scraper_batches drop constraint if exists scraper_batches_status_check;
alter table public.scraper_batches add constraint scraper_batches_status_check
  check (status in (
    'awaiting_workflow', 'scoring', 'auditing', 'scored', 'awaiting_apollo_export',
    'parsing', 'mx', 'filtered', 'verifying', 'done', 'error',
    -- Workflow C, in order. qualifying is the FIRST stage after a pull and has no skip path.
    'pulling', 'qualifying', 'qualified', 'enriching', 'catchall_recheck', 'suppressing',
    -- The Maps door's spend gate, before a single record is bought.
    'awaiting_pull_approval'
  ));

-- ------------------------------------------------------------------------------------------------
-- Verification. Plain counts, so nothing here can roll the migration back. Expect 1 on every row.
-- ------------------------------------------------------------------------------------------------
select 'prospects_run_id' as check, count(*)::text as n from information_schema.columns
  where table_schema='public' and table_name='outreach_prospects' and column_name='run_id'
union all select 'prospects_run_idx', count(*)::text from pg_indexes
  where schemaname='public' and indexname='outreach_prospects_run_idx'
union all select 'runs_pull_request_id', count(*)::text from information_schema.columns
  where table_schema='public' and table_name='list_pipeline_runs' and column_name='pull_request_id'
union all select 'runs_pull_finished_at', count(*)::text from information_schema.columns
  where table_schema='public' and table_name='list_pipeline_runs' and column_name='pull_finished_at'
union all select 'runs_pull_approval_ts', count(*)::text from information_schema.columns
  where table_schema='public' and table_name='list_pipeline_runs' and column_name='pull_approval_ts'
union all select 'workflow_check_has_mapspull', count(*)::text from pg_constraint
  where conname='scraper_batches_workflow_check' and pg_get_constraintdef(oid) like '%mapspull%'
union all select 'status_check_has_pull_approval', count(*)::text from pg_constraint
  where conname='scraper_batches_status_check' and pg_get_constraintdef(oid) like '%awaiting_pull_approval%'
union all select 'status_check_still_has_listprep_stages', count(*)::text from pg_constraint
  where conname='scraper_batches_status_check' and pg_get_constraintdef(oid) like '%catchall_recheck%';
