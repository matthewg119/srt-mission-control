-- Lane 4 — writing and publishing the pages.
--
-- Two things, both add-only and both idempotent:
--
--   1. page_studio_sessions — the Slack page lane's thread state.
--   2. page_candidates gains origin + derived_from, so a page IDEA this system assembled can
--      never be mistaken for a phrase a real buyer typed.
--
-- Nothing here touches client_pages. A page-studio draft opens with an empty body, and
-- answer_md is `not null` with no CHECK, so '' already satisfies it.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. page_studio_sessions — one row per Slack thread in the page channel
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Keyed on thread_ts because that IS the session: `page <client>` opens the thread, a bare
-- digit claims a question in it, and everything typed or dictated afterwards belongs to the
-- page that digit claimed.
--
-- ‼️ page_id IS NULLABLE ON PURPOSE. The card is posted before anything is claimed — the
-- thread exists, the client is resolved, and no page has been chosen yet. A NOT NULL column
-- here would make the card unpostable, which is the whole first step of the lane.
--
-- ‼️ candidates FREEZES THE NUMBERED MENU, and it is not a cache. Re-deriving the order from
-- a `score desc` query at digit time would let a re-run of step 13 change what "2" means
-- between the card being posted and the digit being typed. Same hazard client_pages.question
-- is stored verbatim to avoid, and the same shape content_jobs.data.fit_menu already uses.
-- It also carries the DERIVED ideas, which have no page_candidates row until they are claimed.
create table if not exists public.page_studio_sessions (
  thread_ts   text        primary key,
  client_id   uuid        not null references public.clients(id) on delete cascade,
  page_id     uuid        references public.client_pages(id) on delete set null,
  candidates  jsonb       not null default '[]'::jsonb,
  claimed_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists page_studio_sessions_client_idx
  on public.page_studio_sessions (client_id, updated_at desc);

alter table public.page_studio_sessions enable row level security;

comment on table public.page_studio_sessions is
  'Slack page-studio threads. thread_ts is the session. page_id is null until a digit claims '
  'one of the frozen candidates; candidates is that frozen menu, harvested and derived alike.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. page_candidates — harvested versus derived
-- ─────────────────────────────────────────────────────────────────────────────
--
-- ‼️ A DERIVED IDEA IS NOT A HARVESTED PHRASE AND MUST NEVER READ AS ONE. Every row in this
-- table until now was a real phrase a real buyer typed somewhere, substituted per tenant.
-- The tools, guides and comparison pages the second pass proposes are assembled BY US out of
-- clusters in that corpus. They can be better pages. They are not evidence of demand, and a
-- ranked list that mixes the two without saying which is which is a list nobody can argue with.
--
-- Defaulting to 'harvested' is what makes this add-only: every existing row is already correct.
alter table public.page_candidates
  add column if not exists origin text not null default 'harvested';

alter table public.page_candidates
  add column if not exists derived_from text;

alter table public.page_candidates drop constraint if exists page_candidates_origin_check;
alter table public.page_candidates add constraint page_candidates_origin_check
  check (origin in ('harvested', 'derived'));

comment on column public.page_candidates.origin is
  'harvested = a phrase a buyer actually typed, from question_bank. derived = a page idea this '
  'system assembled from a cluster of them. Printed on the PDF and on the Slack card.';

comment on column public.page_candidates.derived_from is
  'For a derived row, what it was built out of, in words. Null on a harvested row.';

-- Sanity, after running:
--   select origin, count(*) from public.page_candidates group by origin;
--   select thread_ts, client_id, page_id is null as unclaimed from public.page_studio_sessions;
