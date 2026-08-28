-- Workflow B of the scraper lane: score a company list before anybody pays to reveal contacts.
-- src/lib/scraper/{score,dataforseo}.ts. Extends docs/2026-08-27-scraper-lane.sql.
--
-- A CSV dropped in #srt-scraper no longer starts anything. It creates the batch in
-- `awaiting_workflow` and posts a picker: 1 filter and verify (the old lane, unchanged),
-- 2 score first. Column requirements are checked AFTER the pick, never before, or a company list
-- dies at the drop on "no email column" before anybody can choose.

-- ‼️ THE OLD CHECK ALLOWS ONLY SIX VALUES AND WILL REJECT EVERY NEW STATUS. Drop and recreate it
-- or nothing in this feature can write a row.
alter table scraper_batches drop constraint if exists scraper_batches_status_check;
alter table scraper_batches add constraint scraper_batches_status_check check (status in (
  'awaiting_workflow','scoring','scored','awaiting_apollo_export',
  'parsing','mx','filtered','verifying','done','error'
));

alter table scraper_batches
  add column if not exists workflow                text,
  -- The drop caption, verbatim, so a thread read a week later says what the file was.
  add column if not exists batch_label             text,
  -- An Apollo export creates a CHILD batch sharing its parent's thread rather than reusing the
  -- parent's rows: scraper_rows is keyed (batch_id, row_index) and the export's indices collide
  -- with the scored companies', so reuse would either overwrite the score audit trail or need an
  -- offset nobody could read later. Two rows in the table, one thread on screen.
  add column if not exists parent_batch_id         uuid references scraper_batches(id) on delete set null,
  add column if not exists apollo_export_file_id   text,
  add column if not exists score_query_template    text,
  add column if not exists score_cutoff            text,
  -- DataForSEO returns a per-task cost. Summed here so the spend is RECORDED rather than estimated.
  add column if not exists score_cost_usd          numeric(10,4) not null default 0,
  -- ‼️ ONE ts COLUMN PER GATE CARD. handleScraperReaction resolved a batch from mv_approval_ts
  -- alone; with four gate cards in one thread it has to know WHICH card was reacted to, or a
  -- reaction meant for the picker releases a MillionVerifier upload.
  add column if not exists workflow_pick_ts        text,
  add column if not exists scoring_approval_ts     text,
  add column if not exists cutoff_confirm_ts       text;

alter table scraper_batches drop constraint if exists scraper_batches_workflow_check;
alter table scraper_batches add constraint scraper_batches_workflow_check
  check (workflow is null or workflow in ('filter','score'));

alter table scraper_rows
  add column if not exists company             text,
  add column if not exists city                text,
  add column if not exists website             text,
  -- ‼️ NULL MEANS NOT ONE COMPONENT COULD BE MEASURED, AND IT IS NEVER WRITTEN AS 0. Zero is the
  -- most invisible score on the list, which is the top of the scrape pile. A null row is retried
  -- by the next tick and reported as "not measured". Same tri-state doctrine as mx_ok.
  add column if not exists dominance_score     integer,
  -- Per component: weight, attempted, earned, note. So any number in scored.csv is auditable
  -- weeks later rather than being a bare integer nobody can argue with.
  add column if not exists score_components    jsonb,
  -- DataForSEO charges at task_post, so an id that never lands is money spent on a company that
  -- never scores. Written immediately after the POST returns.
  add column if not exists dataforseo_task_id  text,
  add column if not exists queued_for_apollo   boolean not null default false;

-- Each gate card resolves its own batch by the ts that was reacted to.
create index if not exists scraper_batches_workflow_pick_idx
  on scraper_batches (slack_channel_id, workflow_pick_ts) where workflow_pick_ts is not null;
create index if not exists scraper_batches_scoring_approval_idx
  on scraper_batches (slack_channel_id, scoring_approval_ts) where scoring_approval_ts is not null;
create index if not exists scraper_batches_cutoff_confirm_idx
  on scraper_batches (slack_channel_id, cutoff_confirm_ts) where cutoff_confirm_ts is not null;

-- A CSV or a cutoff typed into a thread belongs to the NEWEST batch on that thread.
create index if not exists scraper_batches_thread_idx
  on scraper_batches (slack_channel_id, slack_thread_ts, created_at desc);

-- The scoring sweep's worklist, and the task_get poll's.
create index if not exists scraper_rows_scoring_idx
  on scraper_rows (batch_id) where dominance_score is null and company is not null;
create index if not exists scraper_rows_task_idx
  on scraper_rows (dataforseo_task_id) where dataforseo_task_id is not null;

-- ‼️ THE CRON'S PARTIAL INDEX HAS TO LEARN THE NEW ACTIVE STATUSES. A partial index's WHERE clause
-- cannot be altered, so it is dropped and recreated. `awaiting_apollo_export` is deliberately NOT
-- in the list: it waits on a human uploading a file, so there is nothing to poll and listing it
-- would make the cron's worklist dishonest.
drop index if exists scraper_batches_active_idx;
create index if not exists scraper_batches_active_idx
  on scraper_batches (created_at)
  where status in ('awaiting_workflow','scoring','scored','parsing','mx','filtered','verifying');
