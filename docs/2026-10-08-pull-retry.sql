-- 2026-10-08: a transient vendor 500 parks a pull, it does not kill it.
--
--   bun run scripts/db.ts --file=docs/2026-10-08-pull-retry.sql --dry
--   bun run scripts/db.ts --file=docs/2026-10-08-pull-retry.sql
--
-- Additive, idempotent, safe to run more than once. Nothing here narrows an existing check.
--
-- ‼️ WHAT WENT WRONG, MEASURED. Batch 7a472c40-0ef8-40ce-ac57-88950642a8df died on
-- "DataForSEO returned HTTP 500" with cost_usd 0 and raw_count 0. `error` is not in
-- ACTIVE_STATUSES (src/lib/scraper/store.ts), so the cron will never look at that batch again, and
-- the retry the operator would otherwise get for free is unreachable. One bad second from a vendor
-- threw away an approved pull of a whole metro.
--
-- ‼️ WHY A COUNTER AND NOT A FLAG. A boolean "retryable" has no terminal state, so a cell the
-- vendor refuses deterministically would be re-driven every five minutes forever: the exact spin
-- the cron is forbidden from. The count is what lets the refusal NAME how many attempts it used,
-- which is the difference between "it failed" and "it failed three times, stop asking".
--
-- ‼️ AND WHY IT LIVES ON THE RUN RATHER THAN THE BATCH. The thing being retried is the PURCHASE,
-- and the purchase is what list_pipeline_runs records: spend_approved_at, cost_usd,
-- pull_finished_at and pull_request_id are all here already. scraper_batches.status is the cron's
-- worklist, not the spend ledger, and a counter there would be a second place to look.

alter table public.list_pipeline_runs
  add column if not exists pull_attempts integer not null default 0;

comment on column public.list_pipeline_runs.pull_attempts is
  'How many times the vendor fetch for this pull has been driven. Raised before each attempt by '
  'pullFromDataForSeo in src/lib/scraper/lane.ts, read by sweepPullMaps to decide between another '
  'tick and a terminal refusal that names the attempts used. Not the number of HTTP calls: one '
  'attempt pages internally at 1,000 records a time.';

-- ‼️ THE RETRY IS ONLY REACHABLE WHILE THE BATCH IS IN ACTIVE_STATUSES, so a pull already parked
-- in `error` has to be brought back by hand. This does NOT do that: reviving a failed purchase is a
-- spend decision and a migration may not make one. The four chunked Dallas commands in
-- docs/prompts/2026-10-08-territory-and-vertical-pipeline.md are the intended route, because
-- `limit 3000` also asked for roughly twice the businesses Dallas contains.

-- Verification. A failing select can no longer undo the DDL above: scripts/db.ts autocommits each
-- statement, which is the whole reason that runner exists.
select
  count(*) filter (where pull_attempts = 0) as never_attempted,
  count(*) filter (where pull_attempts > 0) as attempted,
  count(*) as runs
from public.list_pipeline_runs;
