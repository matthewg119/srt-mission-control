-- The ad headline for a page, which is not the page's H1.
--
-- Matthew, 2026-10-07, looking at the headline options on a planned page: "im not sure how we are
-- currently getting the headlines, but i did some stuff in a project i have in claude code so I
-- basically just asked it to create headlines for this keywords based on X context from a project,
-- lets make sure the next time we ask for headlines we use those parameters". The favourites he
-- pasted were "Stop Paying Meta to Send You Ghosts" and "Agencies Sell You Clicks. ChatGPT Sends
-- You Patients. Only One of Them Gets Paid Whether You Grow or Not."
--
-- ‼️ THOSE ARE NOT H1s, AND THE PAGE LANE IS RIGHT TO REFUSE THEM. isQueryShaped in
-- client-headlines.ts rejects anything that is not a question or a first-person confession, and
-- that rule is his own: scripts/_probe-aeo-headlines.ts carries twenty of his headlines as the
-- GOOD fixture and his DON'T column as BAD, every one of which dies on exactly this shape. A page
-- H1 has to read like the thing a buyer types, because being the page an engine cites when she
-- types it is the whole mechanism the lane sells.
--
-- So this is a SECOND artifact per page rather than a replacement: the H1 brings her from an
-- engine, these bring her from an ad, an advertorial or a VSL. One page, two headlines, written
-- from the same picked angle so they argue one thing.
--
-- ‼️ NO NEW TABLE AND NO NEW COLUMN. client_headlines already carries `origin` and `used_page_id`,
-- and used_page_id already holds a page_plan row id (see docs/2026-09-12-client-headlines.sql and
-- page-batch.ts's writeHeadlinesFor). A separate origin is all that distinguishes the two kinds,
-- and it is what keeps them apart: optionsFor filters origin='keyword', so the H1 picker can never
-- offer an ad headline as a page title. A new table would have been a second place a headline
-- lives and a second unique index to keep in step.
--
-- Safe to run twice. Nothing is deleted and no row is rewritten.
--
-- Runner: bun run scripts/db.ts --file=docs/2026-10-07-dr-ad-headlines.sql [--dry]

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The origin list gains one value
-- ─────────────────────────────────────────────────────────────────────────────
--
-- ‼️ THE WHOLE LIST IS RE-DECLARED, NOT APPENDED TO, because a CHECK has no append. The five
-- values below are what the constraint holds today, read out of the database on 2026-10-07 rather
-- than copied from the migration that first created it: 'keyword' and 'framework' were both added
-- after docs/2026-09-12-client-headlines.sql wrote the original three, so that file is no longer
-- the authority on its own constraint. Read the CURRENT definition before editing this list again.
--
--   weekly     the Thursday run
--   pre_call   the thirty three written at the anchored rung, before a plan exists
--   manual     typed into a thread
--   keyword    the three options for one planned page, which become its H1
--   framework  written from the client's own attached headline framework
--   dr_ad      NEW. Twenty direct-response headlines for one planned page, for the ad that sends
--              a buyer to it. Never an H1. Written by src/lib/clients/page-dr-headlines.ts.

alter table public.client_headlines
  drop constraint if exists client_headlines_origin_check;

alter table public.client_headlines
  add constraint client_headlines_origin_check
  check (origin in ('weekly', 'pre_call', 'manual', 'keyword', 'framework', 'dr_ad'));

comment on column public.client_headlines.origin is
  'Which lane wrote this headline. weekly, pre_call, manual, keyword and framework are all page '
  'H1 candidates and are query shaped. dr_ad is the exception: twenty direct-response ad headlines '
  'per planned page, held against used_page_id, deliberately NOT query shaped, and never offered '
  'as a page title. optionsFor filters origin=''keyword'', which is what keeps the two apart.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. The index the ad lane reads through
-- ─────────────────────────────────────────────────────────────────────────────
--
-- drHeadlinesFor reads twenty rows per plan row, by (client_id, origin, used_page_id), on every
-- card that shows them. The existing indexes are on (client_id, iso_week, created_at) and the
-- partial open-headline one, and neither answers this.
--
-- Partial on the origin, so it costs nothing on the H1 rows, which are the overwhelming majority.

create index if not exists client_headlines_dr_page_idx
  on public.client_headlines (client_id, used_page_id, created_at)
  where origin = 'dr_ad';

-- ─────────────────────────────────────────────────────────────────────────────
-- ── Verify ──
-- ─────────────────────────────────────────────────────────────────────────────

-- The constraint now allows six values, dr_ad among them.
select pg_get_constraintdef(oid) as origin_check
from pg_constraint
where conrelid = 'public.client_headlines'::regclass
  and conname = 'client_headlines_origin_check';

-- The index exists.
select indexname
from pg_indexes
where schemaname = 'public'
  and tablename = 'client_headlines'
  and indexname = 'client_headlines_dr_page_idx';

-- What is on file per lane. dr_ad reads 0 until the first `page N ads` runs.
select origin, count(*) as rows, count(used_page_id) as held_against_a_page
from public.client_headlines
group by origin
order by origin;
