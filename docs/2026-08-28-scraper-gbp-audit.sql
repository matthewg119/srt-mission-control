-- A SECOND score in workflow B of the scraper lane: the Google Business Profile optimization audit.
-- src/lib/scraper/{gbp-audit,dataforseo}.ts. Extends docs/2026-08-28-scraper-score-lane.sql.
--
-- ‼️ TWO NUMBERS, ONE RUN, AND THEY ANSWER DIFFERENT QUESTIONS. `dominance_score` measures the
-- OUTCOME: is this business visible right now. `optimization_score` measures the INPUT: did anybody
-- fill the profile in. They come apart constantly, which is the whole reason there are two columns
-- rather than one blend: a new clinic with a perfect profile is optimized and invisible, and a
-- fifteen-year-old spa with 2,000 reviews and an empty profile is the reverse.
--
-- ‼️ THE FILE IS STILL SORTED BY dominance_score ALONE, DESCENDING. `optimization_score` is a
-- COLUMN. It is never averaged in and never the sort key, because the sort decides who gets DELETED
-- and that question is "are they already winning", which is dominance and nothing else.
--
-- Three of the six components are FREE: they read the knowledge_graph off the SERP the scoring pass
-- has already bought and is already holding. The other three cost one profile lookup:
--
--   business_data/google/my_business_info   $0.0015   confirmed on the account 2026-08-28
--
-- So a business costs at most $0.0012 (SERP at depth 20) + $0.0015 = $0.0027, and less in practice,
-- because the profile call only fires for a row whose SERP handed back a cid.

-- ‼️ THE STATUS CHECK ALLOWS ONLY THE TEN EXISTING VALUES AND WILL REJECT `auditing`. Drop and
-- recreate it or the scoring sweep cannot hand off and every workflow-B batch dies at the handover.
alter table scraper_batches drop constraint if exists scraper_batches_status_check;
alter table scraper_batches add constraint scraper_batches_status_check check (status in (
  'awaiting_workflow','scoring','auditing','scored','awaiting_apollo_export',
  'parsing','mx','filtered','verifying','done','error'
));

alter table scraper_rows
  -- ‼️ THESE TWO NULLABLE COLUMNS ARE ONE TRI-STATE, AND THE PAIR IS THE STAGE'S EXIT CONDITION:
  --   score null, components null  -> not asked yet, the next tick asks again
  --   score null, components set   -> asked, nothing was measurable. Stop asking.
  --   score set                    -> done
  -- Without the middle state a row whose profile task failed and whose site refuses the crawl is
  -- re-collected on every tick for the rest of time, and the batch parks at `auditing` forever with
  -- nothing to show for it.
  --
  -- ‼️ NULL IS NEVER WRITTEN AS 0. Zero is the WORST optimization score, which on a pitch list is
  -- the most interesting business there is, so recording it for a business nobody could look at
  -- would put a fabricated finding on the card somebody reads down the phone. Same tri-state
  -- doctrine as mx_ok and dominance_score.
  add column if not exists optimization_score       integer,
  -- Per component: weight, attempted, earned, note. The note is ALSO the verdict printed in the
  -- opt_* column of scored.csv, so any cell of that file is auditable against the row weeks later
  -- without a second field that can drift out of sync with it.
  add column if not exists optimization_components  jsonb,
  -- my_business_info. Charged at task_post, so an id that never lands is money spent on a profile
  -- that never audits. Written immediately after the POST returns, guarded on null so a retried
  -- tick cannot buy the same profile twice. Same shape as dataforseo_task_id and mv_file_id.
  add column if not exists gbp_task_id              text,
  -- ‼️ THE EXACT-PROFILE KEY, AND THE LOOKUP USES IT INSTEAD OF THE COMPANY NAME. A name search
  -- silently returns a DIFFERENT business with a similar name in a nearby city and then scores
  -- somebody else's profile against this lead: nothing errors, every column fills in, and the card
  -- is about the wrong company. A row carrying neither key gets NO TASK AT ALL and its three
  -- profile components stay unmeasured. Never guess.
  add column if not exists gbp_cid                  text,
  add column if not exists gbp_place_id             text,
  -- Category, city, description and landing-page url, read off the knowledge_graph during the
  -- SCORING sweep on a payload it already holds. Free, no extra call, one UPDATE.
  --
  -- Stored rather than re-read: task_get is free but not eternal (30 days), and re-collecting the
  -- SERP on every audit tick would make the free half of this score depend on a retention window.
  -- It is also what makes the resolved cid eyeballable straight off the row.
  add column if not exists gbp_serp                 jsonb;

-- The audit sweep's worklist: rows with a company that have neither scored nor been written off.
-- The `optimization_components is null` half is what makes the stage terminate; see the tri-state
-- note above.
create index if not exists scraper_rows_audit_idx
  on scraper_rows (batch_id)
  where optimization_score is null and optimization_components is null and company is not null;

-- Collecting by the id we stored, the same shape and the same reason as scraper_rows_task_idx:
-- `tasks_ready` is an account-wide collect-once queue and is deliberately never used.
create index if not exists scraper_rows_gbp_task_idx
  on scraper_rows (gbp_task_id) where gbp_task_id is not null;

-- ‼️ THE CRON'S PARTIAL INDEX HAS TO LEARN `auditing` OR THE SWEEP ONLY EVER RUNS ON THE ONE TICK
-- THAT SCORING FINISHED ON, and a batch of 1,000 profiles never completes in one invocation. A
-- partial index's WHERE clause cannot be altered, so it is dropped and recreated.
-- `awaiting_apollo_export` stays out, unchanged: it waits on a human uploading a file, so there is
-- nothing to poll and listing it would make the cron's worklist dishonest.
drop index if exists scraper_batches_active_idx;
create index if not exists scraper_batches_active_idx
  on scraper_batches (created_at)
  where status in ('awaiting_workflow','scoring','auditing','scored','parsing','mx','filtered','verifying');
