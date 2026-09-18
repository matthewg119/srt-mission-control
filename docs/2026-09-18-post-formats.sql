-- Post formats: the written-post shape axis, on the three tables that carry a page's decisions.
--
-- Runner: bun run scripts/db.ts --file=docs/2026-09-18-post-formats.sql [--dry]
--
-- ‼️ RUN THIS BEFORE THE DEPLOY THAT READS IT. page-angles.ts's ANGLE_COLUMNS names post_format, and
-- one unknown column fails a WHOLE PostgREST select, so a deploy landing first takes step twenty
-- one's card down until this runs.
--
-- ‼️ RUN IT THROUGH scripts/db.ts, NOT THE SUPABASE SQL EDITOR. The editor runs a pasted file as one
-- implicit transaction, so the verification SELECT at the foot failing would roll the whole thing
-- back and look exactly like "the migration did nothing". The runner sends one statement at a time
-- and each autocommits.
--
-- Nullable everywhere on purpose: every existing row predates the axis and must stay readable.
-- Measured 2026-09-18: page_plan 0 rows, page_angles 0, page_dataset 0, client_pages 0. Nothing to
-- backfill, so there is no backfill here and none is owed.

-- ── The axis ────────────────────────────────────────────────────────────────
--
-- ‼️ THE COLUMN IS post_format, NOT format. Two other format axes already exist in this schema and
-- both are the Reels engine: content_jobs.format_id (src/config/format-registry.ts) and
-- page_candidates.quotable_format, which is dead with no reader and no writer. Naming this one
-- `format` would make grep ambiguous on the day somebody has to find every reader of it.

alter table public.page_angles             add column if not exists post_format text;
alter table public.page_plan               add column if not exists post_format text;
alter table public.page_dataset            add column if not exists post_format text;
alter table public.page_magnet_candidates  add column if not exists post_format text;

-- What the shape extracted: { format, values, missing }. Defaulted rather than nullable so a reader
-- never has to tell "no dataset" from "not captured": an untouched row is an empty object.
alter table public.page_dataset add column if not exists format_dataset jsonb not null default '{}'::jsonb;

-- ‼️ NO CHECK CONSTRAINT ON post_format, DELIBERATELY. src/config/post-formats.ts is the authority,
-- and a database check would mean a migration every time a shape is added, which is exactly the
-- per-format island the registry pattern exists to avoid. angleFaults() validates it on the way in
-- and scripts/_probe-post-formats.ts asserts the registry and the catalogue agree.
--
-- ‼️ AND NOTHING IS ADDED TO client_pages. src/lib/hub/pages.ts builds its page read as ONE string
-- literal shared by every client's live site, and PostgREST fails a whole select on one unknown
-- name. A client_pages.post_format would five-hundred every hub page for every client in the window
-- between this file and the deploy. The category is resolved from page_plan through page_id instead,
-- in its own tolerant read that returns null on any failure.

create index if not exists page_angles_post_format_idx
  on public.page_angles (client_id, post_format);

create index if not exists page_dataset_post_format_idx
  on public.page_dataset (post_format, captured_at desc);

comment on column public.page_plan.post_format is
  'The written-post shape this page takes. Keys src/config/post-formats.ts. Nullable: rows predating the axis have none.';
comment on column public.page_dataset.format_dataset is
  'What this shape extracted: { format, values, missing }. `missing` names required fields nobody answered, never defaulted.';

-- ── Verify, and read it rather than assuming it ─────────────────────────────
--
-- Expect FIVE rows. Fewer means an alter above did not apply and the deploy must wait.

select
  table_name || '.' || column_name as col,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'page_angles'            and column_name = 'post_format') or
    (table_name = 'page_plan'              and column_name = 'post_format') or
    (table_name = 'page_dataset'           and column_name in ('post_format', 'format_dataset')) or
    (table_name = 'page_magnet_candidates' and column_name = 'post_format')
  )
order by col;

