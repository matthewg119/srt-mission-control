-- 2026-09-12 — headline-first pages: the weekly headline bank, and what a page is aimed at
--
-- Matthew, 2026-09-12: "it all starts from the idea, then the headline, after that we create the
-- sub titles". "Ideally I want each client to generate 20 direct response headlines per week so we
-- can select as many as we want and create posts around those headlines."
--
-- Additive, idempotent, safe to run more than once. Requires docs/2026-09-11-page-plan.sql and
-- docs/2026-09-11-one-strategy.sql FIRST: page_plan is created by the first and given its role /
-- pillar_id / origin check by the second, and this file alters all of them.
-- Runner: bun run scripts/db.ts --file=docs/2026-09-12-client-headlines.sql [--dry]
--
-- ‼️ RUN IT BEFORE THE DEPLOY THAT READS IT. Every new read here is written to degrade on its own
-- (a separate select, never added to a shared COLUMNS string) because PostgREST fails a whole
-- select on one unknown column, but degrading means the headline lane says "not run yet" rather
-- than working.


-- =====================================================================
-- 1. THE HEADLINE BANK
-- =====================================================================
--
-- ‼️ A TABLE AND NOT A page_plan ROW, BECAUSE MOST OF THESE NEVER BECOME A PAGE. Twenty are
-- written a week and Matthew picks "as many as we want". A rejected headline is still worth
-- keeping: it is what stops next week's run proposing the same line again, and dropped_at is how
-- the generator learns what he does not want. Rows in page_plan are pages, and nineteen rows a
-- week that are not pages would make the plan map unreadable.
--
-- ‼️ THE ISO WEEK IS THE IDEMPOTENCY KEY. The weekly run rides followup-digest, which is a daily
-- cron, so it fires seven times a week and must write once. Same precedent as recurringDraftKey()
-- in content-digest.ts.
create table if not exists public.client_headlines (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients (id) on delete cascade,

  headline    text not null,
  -- Case-folded and punctuation-stripped, so the same question asked twice is one row.
  normalized  text not null,

  -- 'weekly'   the Thursday run
  -- 'pre_call' written for one of the nine pages drafted before the call
  -- 'manual'   typed into the thread
  origin      text not null default 'weekly' check (origin in ('weekly', 'pre_call', 'manual')),

  -- ISO year-week ("2026-W37"). Null for a manual row, which belongs to no run.
  iso_week    text,

  approved    boolean not null default false,
  approved_at timestamptz,
  approved_by text,
  dropped_at  timestamptz,

  -- Set when this headline became a page. A headline is used at most once.
  used_page_id uuid references public.page_plan (id) on delete set null,

  created_at  timestamptz not null default now()
);

-- One row per phrasing per client, forever. This is what stops week 6 re-proposing week 2's line.
create unique index if not exists client_headlines_unique
  on public.client_headlines (client_id, normalized);

-- The card reads "this week's, newest first"; the page lane reads "approved and not yet used".
create index if not exists client_headlines_week_idx
  on public.client_headlines (client_id, iso_week, created_at desc);

create index if not exists client_headlines_open_idx
  on public.client_headlines (client_id, created_at desc)
  where approved and dropped_at is null and used_page_id is null;

comment on table public.client_headlines is
  'AEO direct-response headlines for one client, 20 a week. Each becomes the H1 of a page when '
  'approved. Query-shaped and never carrying an outcome promise: the validators in '
  'src/lib/clients/client-headlines.ts enforce both, because a promise in an H1 is the one claim '
  'on a gated page that no source could ever back.';

alter table public.client_headlines enable row level security;


-- =====================================================================
-- 2. WHAT A PAGE IS AIMED AT
-- =====================================================================

-- The H1, verbatim from the headline bank. Kept apart from working_title because they are two
-- different artifacts with two different rules: working_title is what the plan map and the
-- internal link anchors show (it carries the KEYWORD, see plan-links.ts anchorFor), and headline
-- is what the reader sees at the top of the page (it carries the PAIN). Collapsing them would
-- either put the pain in the anchor text or the keyword in the H1.
alter table public.page_plan add column if not exists headline text;

-- 3 to 5 approved variations of the primary keyword. Every one is copied verbatim from
-- client_keywords: FRAME_SYSTEM rejects a batch containing a phrase that is not in the approved
-- list, the same rule target_keyword already lives under.
alter table public.page_plan add column if not exists secondary_keywords text[];

-- A plan row that started as an approved headline rather than as a keyword.
alter table public.page_plan drop constraint if exists page_plan_origin_check;
alter table public.page_plan add constraint page_plan_origin_check
  check (origin in ('harvested', 'derived', 'keyword', 'headline'));

comment on column public.page_plan.headline is
  'The direct-response H1, from client_headlines. Carries the buyer''s pain in her own words. '
  'Distinct from working_title, which carries the keyword and is used as internal-link anchor text.';

comment on column public.page_plan.secondary_keywords is
  '3 to 5 variations of target_keyword, each verbatim from an approved client_keywords row.';


-- =====================================================================
-- 3. THE LONG-TAIL BEHIND EVERY SUBHEAD
-- =====================================================================
--
-- Each H2 on a page is a long-tail question and owns its own phrase. Stored per page rather than
-- per plan row because the outline is a property of the drafted page: it is rewritten by
-- `outline` in the studio, and a plan row that was never drafted has none.
--
-- Shape: [{ "heading": "...", "keyword": "..." }], in the page's own section order. That order is
-- what keyword-placement.ts checks the primary keyword against.
alter table public.client_pages add column if not exists section_keywords jsonb;

comment on column public.client_pages.section_keywords is
  'Per-H2 long-tail keywords, as [{heading, keyword}] in section order. Written by the drafter '
  'alongside the outline and read by src/lib/hub/keyword-placement.ts.';
