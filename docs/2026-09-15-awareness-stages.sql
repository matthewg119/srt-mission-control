-- 2026-09-15 — where a reader starts and where a page leaves them, on the three artifacts
--
-- W4 of docs/prompts/2026-09-14-foundation-datasets-and-audiences.md. Matthew numbers the stages of
-- awareness 5 (problem unaware) to 1 (most aware) and wants every page and post to move a reader
-- from 5 toward 3 and 4. The audit questions already carry a stage in audit_reports.prompts (no
-- migration: it is jsonb). This file gives the three things built FROM those questions a place to
-- say the same thing.
--
-- ‼️ TWO NUMBERS PER PAGE, NOT ONE. awareness_entry is where the reader is when they arrive;
-- awareness_target is where the page leaves them. Lower is closer to buying, so a page that did its
-- job has a target LOWER than its entry. src/lib/audit-engine/awareness.ts holds that arithmetic.
--
-- ‼️ EVERY COLUMN HAS A WRITER IN THE SAME DEPLOY. A column with no writer is the reader-with-no-
-- writer class this repo keeps finding. client_keywords and page_plan are labelled on insert by the
-- deterministic rule (awarenessOf); client_headlines copies its page's two numbers when it is
-- approved as that page's H1. All three tables held ZERO rows on 2026-09-15 (SRT's board was reset),
-- so there is nothing to backfill.
--
-- Additive, idempotent, safe to run more than once.
-- Runner: bun run scripts/db.ts --file=docs/2026-09-15-awareness-stages.sql [--dry]
--
-- ‼️ RUN IT BEFORE THE DEPLOY THAT WRITES IT. The inserts name these columns, and one unknown column
-- fails the WHOLE insert: no keyword set, no plan.


-- =====================================================================
-- 1. client_keywords: the stage of the person typing the phrase
-- =====================================================================
alter table public.client_keywords add column if not exists awareness_stage smallint;

alter table public.client_keywords drop constraint if exists client_keywords_awareness_stage_check;
alter table public.client_keywords add constraint client_keywords_awareness_stage_check
  check (awareness_stage is null or awareness_stage between 1 and 5);

comment on column public.client_keywords.awareness_stage is
  'Where the person typing this phrase sits: 5 problem unaware, 4 problem aware, 3 solution aware, '
  '2 product aware, 1 most aware. LOWER IS CLOSER TO BUYING. Written on insert by awarenessOf() in '
  'src/lib/audit-engine/awareness.ts, a deterministic rule from the phrase''s block and wording, so '
  'it never says 5 (only the classifier, reading the whole business, may). NULL on a row written '
  'before 2026-09-15.';


-- =====================================================================
-- 2. page_plan: where the reader arrives and where the page leaves them
-- =====================================================================
alter table public.page_plan add column if not exists awareness_entry smallint;
alter table public.page_plan add column if not exists awareness_target smallint;

alter table public.page_plan drop constraint if exists page_plan_awareness_entry_check;
alter table public.page_plan add constraint page_plan_awareness_entry_check
  check (awareness_entry is null or awareness_entry between 1 and 5);

alter table public.page_plan drop constraint if exists page_plan_awareness_target_check;
alter table public.page_plan add constraint page_plan_awareness_target_check
  check (awareness_target is null or awareness_target between 1 and 5);

comment on column public.page_plan.awareness_entry is
  'The awareness stage of the reader this page is written for when they arrive, 5 (unaware) to 1 '
  '(most aware), from the question the page answers. Written on insert. See client_keywords.awareness_stage.';

comment on column public.page_plan.awareness_target is
  'Where the page leaves that reader. LOWER THAN awareness_entry means the page moves them toward '
  'buying. Defaults to one stage closer (awarenessTarget), which is the smallest move that counts '
  'and is a default, not a measurement. A page for a reader already at 1 stays at 1.';


-- =====================================================================
-- 3. client_headlines: the same two numbers, once a headline heads a page
-- =====================================================================
alter table public.client_headlines add column if not exists awareness_entry smallint;
alter table public.client_headlines add column if not exists awareness_target smallint;

alter table public.client_headlines drop constraint if exists client_headlines_awareness_entry_check;
alter table public.client_headlines add constraint client_headlines_awareness_entry_check
  check (awareness_entry is null or awareness_entry between 1 and 5);

alter table public.client_headlines drop constraint if exists client_headlines_awareness_target_check;
alter table public.client_headlines add constraint client_headlines_awareness_target_check
  check (awareness_target is null or awareness_target between 1 and 5);

comment on column public.client_headlines.awareness_entry is
  'Copied from the page_plan row when this headline is approved as that page''s H1 '
  '(approveHeadlineForPage). NULL for a headline still in the bank: a headline heads a reader only '
  'once it heads a page.';

comment on column public.client_headlines.awareness_target is
  'Copied with awareness_entry. See page_plan.awareness_target.';


-- =====================================================================
-- VERIFICATION
-- =====================================================================

-- Expect five rows: the three tables' new columns, all smallint and nullable.
select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and column_name in ('awareness_stage', 'awareness_entry', 'awareness_target')
order by table_name, column_name;

-- Expect five check constraints, one per column.
select conrelid::regclass as table_name, conname
from pg_constraint
where conname like '%awareness%'
order by 1, 2;
