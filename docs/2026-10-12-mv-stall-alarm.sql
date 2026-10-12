-- 2026-10-12: a MillionVerifier upload that stalls says so, instead of polling in silence forever.
--
--   bun run scripts/db.ts --file=docs/2026-10-12-mv-stall-alarm.sql --dry
--   bun run scripts/db.ts --file=docs/2026-10-12-mv-stall-alarm.sql
--
-- Additive and idempotent: two nullable columns on a table that already exists. No data is changed.
--
-- ‼️ THE GAP THIS CLOSES WAS MEASURED, NOT IMAGINED. `pollVerification` ends with
-- `if (info.status !== "finished") return;` and there is no timeout anywhere behind it. On
-- 2026-10-08 batch 8d166a8b uploaded 129 addresses as file 32277475 and sat at `in_progress` for 29
-- hours. Nothing was broken: MillionVerifier was simply slow, and our cron drained it 83 seconds
-- after they finished. But for 29 hours NOTHING ANYWHERE SAID SO, and the only way anybody found
-- out was by asking why a pull plan had not moved.
--
-- ‼️ AND IT IS AN ALARM, NOT A TIMEOUT. A timeout cannot finish a verification; all it can do is
-- abandon work that has already been paid for. These addresses cost credits and the uploaded file
-- is the receipt, so the honest behaviour is to keep polling forever AND to say, once, that this one
-- is taking longer than any that came before it. Deciding to give up is a person's call, and
-- `mv_stall_alerted_at` exists so they are asked rather than surprised.
--
-- ‼️ WHY A SEPARATE `mv_uploaded_at` RATHER THAN READING `sendable_leads.created_at`. The addresses
-- are written in an earlier stage than the upload, sometimes a tick or two earlier, so the address
-- timestamp answers "when was this enriched" and not "when did MillionVerifier get it". At a four
-- hour threshold that difference does not matter today; it would matter the first time an enrich
-- stage ran long, and a column that is nearly the right one is how a quiet alarm gets written.

alter table public.scraper_batches
  add column if not exists mv_uploaded_at timestamptz,
  add column if not exists mv_stall_alerted_at timestamptz;

comment on column public.scraper_batches.mv_uploaded_at is
  'When this batch handed its addresses to MillionVerifier. The clock the stall alarm measures '
  'against. Null for every batch that has not uploaded, and for the ones that uploaded before '
  'docs/2026-10-12-mv-stall-alarm.sql existed, which simply never alarm.';

comment on column public.scraper_batches.mv_stall_alerted_at is
  'When the lane said out loud that this verification was taking unusually long. Set once, so a '
  'five minute cron reports a slow file one time instead of 350 times. Never a reason to stop '
  'polling: the credits are already spent and the file is the receipt.';


-- =====================================================================
-- Verification
-- =====================================================================
--
-- ‼️ WRITTEN TO BE ABLE TO FAIL. Both columns must exist or the alarm has nowhere to record itself
-- and silently never fires, which is the exact failure this file exists to end. The batch count is
-- printed so a reader can see the columns landed on the table they meant.
select
  (select count(*) = 2 from information_schema.columns
    where table_schema = 'public' and table_name = 'scraper_batches'
      and column_name in ('mv_uploaded_at', 'mv_stall_alerted_at')) as both_columns_exist,
  (select count(*) from public.scraper_batches) as batches,
  (select count(*) from public.scraper_batches where mv_file_id is not null) as have_uploaded,
  (select count(*) from public.scraper_batches where status = 'verifying') as verifying_now;
