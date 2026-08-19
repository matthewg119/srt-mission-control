-- What actually reached the pages we built.
--
-- Safe to run more than once.
--
-- WHY THIS EXISTS. The hub has been able to publish a client's pages on their own domain
-- since 2026-08-18 and has never recorded a single request against one. A client is paying
-- for pages whose traffic nobody can see, and the fact the whole offer rests on -- did an
-- AI engine actually fetch this page in order to answer somebody -- was not merely
-- unreported, it was not collected.
--
-- WHY NOT A BEACON. src/app/api/marketing/page-visit/route.ts is the existing pattern and
-- it is the wrong one here: it is client-side JavaScript, and GPTBot, OAI-SearchBot and
-- PerplexityBot do not run JavaScript. A beacon would have measured the one audience this
-- product is not sold on. Collection happens in middleware instead, which is the only place
-- that sees every request, and it has to be middleware rather than the page because the hub
-- routes are ISR (revalidate = 300) and a server component therefore runs on regeneration
-- rather than on request.

-- ─────────────────────────────────────────────────────────────────────────────
-- One table, raw rows, no rollup
-- ─────────────────────────────────────────────────────────────────────────────
--
-- A daily rollup would need a cron, and vercel.json already carries 14 entries against a
-- Hobby plan that documents 2 -- src/lib/clients/report-reminders.ts refuses to add a 15th
-- and this refuses for the same reason. At pilot volume the read is a .gte on an indexed
-- date plus a reduce in JS, which is exactly what src/app/api/bot/stats/route.ts already
-- does and the only time-series precedent in this repo. If volume ever justifies a rollup
-- it rides /api/cron/followup-digest like every other recurring job here.

create extension if not exists pgcrypto;

create table if not exists public.hub_hits (
  id           uuid        primary key default gen_random_uuid(),
  client_id    uuid        not null references public.clients(id) on delete cascade,

  -- The hostname as it arrived, so learn. and reviews. stay separable after the fact and a
  -- client who changes convention later does not retroactively rewrite their own history.
  host         text        not null,
  kind         text        not null,

  -- The path as requested, and the slug derived from it. Both, because they answer
  -- different questions: path is what happened, slug is what it joins to.
  --
  -- ‼️ NOT a foreign key to client_pages. The index page has no row, the generated files
  -- have no row, and a page deleted next year must not take its own traffic history with
  -- it. The per-page view joins on slug at READ time, which also keeps ingest to exactly
  -- one INSERT and no lookup.
  path         text        not null,
  slug         text        not null default '',

  bot_class    text        not null,
  -- Null means "automated, but not one we have a name for". See bot-classify.ts.
  bot_name     text,

  -- ‼️ THIS ROTATES DAILY AND IS NOT A VISITOR ID.
  -- sha256(ip + ua + client_id + YYYY-MM-DD + SCAN_IP_SALT), truncated. The date inside the
  -- hash is the point: yesterday's key cannot be computed from today's, so daily uniques
  -- are honest and no cross-day profile of a person can exist even in principle. Do NOT
  -- compute weekly or monthly uniques from this column -- the answer would be wrong, not
  -- merely imprecise. Same doctrine as scan_sessions.ip_hash, which is a rate-limit ledger
  -- and not a visitor log, and the same reason review_tool_submissions has no such column
  -- at all.
  visitor_key  text,

  -- Hostname only, never the full referring URL, which routinely carries a query string
  -- somebody typed into a search box.
  referrer_host text,

  created_at   timestamptz not null default now(),

  -- Generated rather than written, so a row can never disagree with its own timestamp.
  day          date        not null generated always as ((created_at at time zone 'UTC')::date) stored
);

alter table public.hub_hits drop constraint if exists hub_hits_kind_check;
alter table public.hub_hits add constraint hub_hits_kind_check
  check (kind in ('hub', 'reviews'));

alter table public.hub_hits drop constraint if exists hub_hits_bot_class_check;
alter table public.hub_hits add constraint hub_hits_bot_class_check
  check (bot_class in ('human', 'ai_answer', 'ai_training', 'search', 'bot'));

-- The two reads the metrics page makes, and nothing else reads this table.
create index if not exists hub_hits_client_day_idx  on public.hub_hits (client_id, day);
create index if not exists hub_hits_client_slug_idx on public.hub_hits (client_id, slug, day);

comment on table public.hub_hits is
  'One row per request served on a client hub host. Written by /api/hub/hit, which is fed '
  'by src/middleware.ts via waitUntil. Never written from a browser: AI crawlers do not run '
  'JavaScript and they are the audience this table exists to count.';

alter table public.hub_hits enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- The aggregates, in Postgres rather than in JS
-- ─────────────────────────────────────────────────────────────────────────────
--
-- ‼️ THIS BREAKS THE HOUSE PATTERN ON PURPOSE. Every other time-series read in this repo
-- pulls rows and reduces them in JS (src/app/api/bot/stats/route.ts is the only one). That
-- is wrong here for a reason that has already shipped as a bug in this codebase once:
-- PostgREST applies a server-side row ceiling, and a read that quietly returns the newest N
-- rows produces a chart that looks perfectly plausible and is an undercount. CLAUDE.md
-- records the same failure in findReport -- "at 51 the oldest silently stops matching".
--
-- count(distinct visitor_key) is also not computable from a truncated page, and it would be
-- wrong in a direction nobody can bound.
--
-- So: aggregate here, return at most one row per day, and fold the rest in JS where the
-- house pattern is right.

create or replace function public.hub_hits_by_day(
  p_client_id uuid, p_from date, p_to date
) returns table (
  day date, human bigint, ai_answer bigint, ai_training bigint,
  search bigint, bot bigint, uniques bigint
) language sql stable as $fn$
  select h.day,
         count(*) filter (where h.bot_class = 'human')::bigint,
         count(*) filter (where h.bot_class = 'ai_answer')::bigint,
         count(*) filter (where h.bot_class = 'ai_training')::bigint,
         count(*) filter (where h.bot_class = 'search')::bigint,
         count(*) filter (where h.bot_class = 'bot')::bigint,
         count(distinct h.visitor_key)::bigint
    from public.hub_hits h
   where h.client_id = p_client_id
     and h.day between p_from and p_to
   group by h.day
   order by h.day;
$fn$;

-- ‼️ uniques ARE NOT SUMMABLE ACROSS PATHS. One person reading three pages is one unique
-- for the hub and three here. That is why this is a separate function rather than a
-- GROUP BY somebody could roll up: hub_hits_by_day is the ONLY source of a hub-level
-- unique count, and adding this column across rows produces a number that means nothing.
create or replace function public.hub_hits_by_day_slug(
  p_client_id uuid, p_from date, p_to date
) returns table (
  day date, slug text, human bigint, ai_answer bigint, ai_training bigint,
  search bigint, bot bigint, page_uniques bigint, last_ai_answer_at timestamptz
) language sql stable as $fn$
  select h.day, h.slug,
         count(*) filter (where h.bot_class = 'human')::bigint,
         count(*) filter (where h.bot_class = 'ai_answer')::bigint,
         count(*) filter (where h.bot_class = 'ai_training')::bigint,
         count(*) filter (where h.bot_class = 'search')::bigint,
         count(*) filter (where h.bot_class = 'bot')::bigint,
         count(distinct h.visitor_key)::bigint,
         max(h.created_at) filter (where h.bot_class = 'ai_answer')
    from public.hub_hits h
   where h.client_id = p_client_id
     and h.day between p_from and p_to
   group by h.day, h.slug
   order by h.day, h.slug;
$fn$;

-- Which named crawler, how often, how recently. The money table.
create or replace function public.hub_hits_by_agent(
  p_client_id uuid, p_from date, p_to date
) returns table (
  bot_class text, bot_name text, hits bigint, days_seen bigint, last_seen timestamptz
) language sql stable as $fn$
  select h.bot_class, h.bot_name,
         count(*)::bigint,
         count(distinct h.day)::bigint,
         max(h.created_at)
    from public.hub_hits h
   where h.client_id = p_client_id
     and h.day between p_from and p_to
     and h.bot_class <> 'human'
   group by h.bot_class, h.bot_name
   order by count(*) desc;
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- ‼️ THE GRANTS. Without this block the table's RLS is decorative.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- PostgREST exposes every function in `public` to `anon` by default, and a function READS
-- THROUGH RLS regardless of the policies on the table underneath it. NEXT_PUBLIC_SUPABASE
-- _ANON_KEY is, by its own name, public. Without the revoke, anyone holding it could read
-- any client's traffic by passing a uuid.
do $grants$
declare fn text;
begin
  foreach fn in array array[
    'public.hub_hits_by_day(uuid, date, date)',
    'public.hub_hits_by_day_slug(uuid, date, date)',
    'public.hub_hits_by_agent(uuid, date, date)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $grants$;

-- ─────────────────────────────────────────────────────────────────────────────
-- What to expect
-- ─────────────────────────────────────────────────────────────────────────────
--
-- select bot_class, count(*) from public.hub_hits group by 1 order by 2 desc;
--   Empty until the branch is deployed and a hub host resolves. Nothing is backfilled:
--   no request against a hub host has ever been recorded, so the series starts at deploy
--   and any earlier-looking number would be invented.
