-- Three headline artifacts per page: the title tag, the H1, and the ad hook.
--
-- Matthew, 2026-10-07, reading the headline card for SRT's own eleven planned pages: "'Why have I
-- spent thousands on ads and still can't figure out how to get my med spa on ChatGPT?' nobody
-- would actually google this, or search it like that, this sounds too ai".
--
-- The diagnosis and the decision are in docs/prompts/2026-10-07-three-headline-formats.md. Every
-- headline run now returns THREE artifacts per page, "stored and tracked separately so each
-- accumulates its own traffic data over time":
--
--   the TITLE TAG   50 to 60 characters, keyword in the first few words. What Google PRINTS in a
--                   results list. New in this migration, origin 'seo_title'.
--   the H1          a 4 to 12 word question somebody would type. What an answer engine MATCHES.
--                   Already stored as origin 'keyword' and unchanged by this file.
--   the AD HOOK     12 to 45 words. What stops a scroll on Meta, in a cold email, in a VSL.
--                   origin 'dr_ad', which arrived with the file this one supersedes.
--
-- ‼️ THIS FILE SUPERSEDES AND REPLACES docs/2026-10-07-dr-ad-headlines.sql, WHICH WAS NEVER RUN.
-- That file declared 'dr_ad' and its index, and it is deleted in the same commit as this one. The
-- reason is an ordering trap rather than tidiness: a CHECK constraint has no append, so EVERY
-- migration that touches this one re-declares the entire list, and whichever file runs LAST wins.
-- Two unrun files each declaring a different six or seven values meant that running them in the
-- wrong order would silently DROP the other's value, and every insert of that kind would then fail
-- on a constraint nobody had touched that day. One file cannot disagree with itself.
--
-- So if docs/2026-10-07-dr-ad-headlines.sql has ALREADY been run somewhere, this file is still
-- correct and still safe: it re-declares the same constraint with one more value and recreates the
-- same index with `if not exists`.
--
-- ‼️ NO NEW TABLE AND NO NEW COLUMN, which is the precedent the dr_ad file set and the reason the
-- separate tracking works. client_headlines already carries `origin`, `used_page_id` (a page_plan
-- row id), `approved`, `keyword_id` and `audience_id`. Three origins is three sets of ROWS, each
-- with its own id, which is exactly what a per-artifact traffic number has to hang off. Three
-- columns on one row would have been one artifact wearing three hats and nothing to join to.
--
-- ‼️ AND 'keyword' IS NOT RENAMED TO 'aeo_h1' EVEN THOUGH THAT WOULD READ BETTER. Renaming an
-- origin orphans every row already carrying it, which is the rule CLAUDE.md states about step keys
-- for the same reason, and `optionsFor` filters origin='keyword' in code. A better name is not
-- worth a silent orphan.
--
-- Safe to run twice. Nothing is deleted and no row is rewritten.
--
-- Runner: bun run scripts/db.ts --file=docs/2026-10-08-page-headline-formats.sql [--dry]

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The origin list gains two values
-- ─────────────────────────────────────────────────────────────────────────────
--
-- ‼️ THE WHOLE LIST IS RE-DECLARED, NOT APPENDED TO, because a CHECK has no append. The five
-- values live in the database today: 'keyword' and 'framework' were added by
-- docs/2026-09-15-offers-and-framework.sql, after docs/2026-09-12-client-headlines.sql wrote the
-- original three, so neither of those files is the authority on its own constraint. Read the
-- CURRENT definition before editing this list again, and put the whole list in one file.
--
--   weekly     the Thursday run
--   pre_call   the thirty three written at the anchored rung, before a plan exists
--   manual     typed into a thread
--   keyword    the H1 candidates for one planned page. Query shaped, 4 to 12 words in the core.
--   framework  written from the client's own attached headline framework
--   dr_ad      twenty direct-response hooks for one planned page, for the ad that sends a buyer
--              to it. Never an H1. Written by src/lib/clients/page-dr-headlines.ts.
--   seo_title  NEW. Six title tag candidates for one planned page, 50 to 60 characters, measured
--              in characters rather than words. Never an H1. One is approved per page and lands
--              on client_pages.title. Written by src/lib/clients/page-seo-titles.ts.

alter table public.client_headlines
  drop constraint if exists client_headlines_origin_check;

alter table public.client_headlines
  add constraint client_headlines_origin_check
  check (origin in ('weekly', 'pre_call', 'manual', 'keyword', 'framework', 'dr_ad', 'seo_title'));

comment on column public.client_headlines.origin is
  'Which lane wrote this headline, and WHICH OF THE THREE PAGE ARTIFACTS it is. weekly, pre_call, '
  'manual, keyword and framework are all page H1 candidates: query shaped, 4 to 12 words in the '
  'query core, matched by an answer engine against what somebody typed. dr_ad is the ad hook, 12 '
  'to 45 words, deliberately NOT query shaped, held against used_page_id, a bank of twenty used '
  'across ads. seo_title is the title tag, 50 to 60 CHARACTERS, held against used_page_id, and the '
  'one approved per page is copied onto client_pages.title. optionsFor filters origin=''keyword'', '
  'which is what keeps all three apart and stops a title tag or an ad hook being offered as an H1.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. The two indexes the other two artifacts are read through
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Both lanes read rows per plan row, by (client_id, origin, used_page_id), on every card that
-- shows them: drHeadlinesFor reads twenty, seoTitlesFor reads six, and readBatch's formatsOnPlan
-- reads both for every page in a batch on every single card. The existing indexes are on
-- (client_id, iso_week, created_at) and the partial open-headline one, and neither answers this.
--
-- Partial on the origin, so they cost nothing on the H1 rows, which are the overwhelming majority.

create index if not exists client_headlines_dr_page_idx
  on public.client_headlines (client_id, used_page_id, created_at)
  where origin = 'dr_ad';

create index if not exists client_headlines_seo_page_idx
  on public.client_headlines (client_id, used_page_id, created_at)
  where origin = 'seo_title';

-- ─────────────────────────────────────────────────────────────────────────────
-- ── Verify ──
-- ─────────────────────────────────────────────────────────────────────────────

-- The constraint now allows seven values, dr_ad and seo_title among them.
select pg_get_constraintdef(oid) as origin_check
from pg_constraint
where conrelid = 'public.client_headlines'::regclass
  and conname = 'client_headlines_origin_check';

-- Both indexes exist. Expect TWO rows.
select indexname
from pg_indexes
where schemaname = 'public'
  and tablename = 'client_headlines'
  and indexname in ('client_headlines_dr_page_idx', 'client_headlines_seo_page_idx')
order by indexname;

-- What is on file per lane. dr_ad and seo_title both read 0 until the first headline run after
-- this migration; the five H1 origins are untouched and their counts must not change.
select origin, count(*) as rows, count(used_page_id) as held_against_a_page, count(*) filter (where approved) as approved
from public.client_headlines
group by origin
order by origin;
