-- Colony lane, part 1 of 1: the fanout record, the market corpus, and the colony.
--
-- Safe to run against production before the code ships. Everything here is additive:
-- new tables plus additive columns on page_candidates. Nothing is dropped, nothing is
-- rewritten, and no existing reader changes behaviour.
--
-- Run this BEFORE deploying the colony branch. fanout-store.ts is written to survive
-- the tables being absent (it logs to system_logs and swallows), but until this runs
-- nothing is captured.

begin;

-- 1. The cache and spend ledger. Every provider pull in this lane goes through
--    getOrFetch() in src/lib/data/dataset-cache.ts, which reads this first and only
--    calls out on a miss or an expiry. client_id is nullable: a vertical-wide pull
--    belongs to no single client.
create table if not exists public.client_datasets (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid references public.clients(id) on delete cascade,
  kind          text not null,
  cache_key     text not null,
  params        jsonb not null default '{}'::jsonb,
  payload       jsonb,
  provider      text,
  cost_usd      numeric(10,4) not null default 0,
  hit_count     integer not null default 0,
  fetched_at    timestamptz not null default now(),
  expires_at    timestamptz,
  created_at    timestamptz not null default now()
);
-- NULLS NOT DISTINCT so two vertical-wide pulls of the same kind+key collide as intended.
create unique index if not exists client_datasets_key
  on public.client_datasets (client_id, kind, cache_key) nulls not distinct;
create index if not exists client_datasets_expiry on public.client_datasets (kind, expires_at);

-- 2. One row per seed prompt actually executed against an engine.
--    client_id is nullable AND USUALLY NULL: most reports on file are prospect audits
--    with no client row. Keyed by vertical this becomes a market-wide asset rather
--    than a per-client scratchpad.
create table if not exists public.fanout_runs (
  id            uuid primary key default gen_random_uuid(),
  report_id     uuid references public.audit_reports(id) on delete cascade,
  client_id     uuid references public.clients(id) on delete set null,
  vertical      text,
  seed_prompt   text not null,
  seed_source   text not null default 'audit_prompt'
                check (seed_source in ('audit_prompt','avatar_seed','manual_devtools')),
  seed_block    text,
  model         text,
  engine        text not null default 'openai',
  source        text not null default 'api' check (source in ('api','devtools_paste')),
  cost_usd      numeric(10,4),
  created_at    timestamptz not null default now()
);
create index if not exists fanout_runs_report on public.fanout_runs (report_id);
create index if not exists fanout_runs_client on public.fanout_runs (client_id, created_at desc);
create index if not exists fanout_runs_vertical on public.fanout_runs (vertical, created_at desc);

-- 3. The raw observation log: what the engine searched, in the order it searched it.
--    Deliberately append-only and un-deduped. fanout_queries is evidence; query_index
--    below is the opinion derived from it.
create table if not exists public.fanout_queries (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references public.fanout_runs(id) on delete cascade,
  report_id     uuid references public.audit_reports(id) on delete cascade,
  client_id     uuid references public.clients(id) on delete set null,
  vertical      text,
  query         text not null,
  normalized    text not null,
  ordinal       integer not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists fanout_queries_run on public.fanout_queries (run_id);
create index if not exists fanout_queries_norm on public.fanout_queries (vertical, normalized);
create index if not exists fanout_queries_client on public.fanout_queries (client_id);

-- 4. What the engine cited. This is the table that answers "what actually gets quoted",
--    which is the only honest basis for a recommendation that claims to earn a citation.
--    is_client is TRI-STATE: null means we had no website on file to compare against,
--    which is not the same as a confirmed absence. Never read null as false.
create table if not exists public.fanout_citations (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references public.fanout_runs(id) on delete cascade,
  report_id     uuid references public.audit_reports(id) on delete cascade,
  client_id     uuid references public.clients(id) on delete set null,
  vertical      text,
  url           text not null,
  domain        text,
  title         text,
  is_client     boolean,
  is_competitor boolean,
  ordinal       integer not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists fanout_citations_run on public.fanout_citations (run_id);
create index if not exists fanout_citations_domain on public.fanout_citations (vertical, domain);
create index if not exists fanout_citations_report on public.fanout_citations (report_id);

-- 5. The market corpus: one opinion per (vertical, query). Shared across every client
--    in a vertical, exactly like question_bank, and for the same reason: 101 businesses
--    across a handful of verticals should not each pay to rediscover the same market.
--    difficulty is derived from distinct_domains + volume, NOT from a rank tracker,
--    because there is no position data anywhere in this system.
create table if not exists public.query_index (
  id                 uuid primary key default gen_random_uuid(),
  vertical           text not null,
  normalized         text not null,
  phrase             text not null,
  fanout_count       integer not null default 0,
  run_count          integer not null default 0,
  distinct_domains   integer,
  top_domains        text[],
  search_volume      integer,
  cpc                numeric(10,2),
  volume_checked_at  timestamptz,
  commercial_intent  smallint,
  difficulty         numeric(6,2),
  first_seen         timestamptz not null default now(),
  last_seen          timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index if not exists query_index_key on public.query_index (vertical, normalized);
create index if not exists query_index_rank on public.query_index (vertical, fanout_count desc);

-- 6. Per-client facts about a market query: the gap map. Split from query_index so the
--    corpus stays shared and only the client-specific judgement is duplicated.
--    matched_url / title_match are the video's layer 1 and layer 2.
create table if not exists public.client_query_state (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients(id) on delete cascade,
  query_id      uuid not null references public.query_index(id) on delete cascade,
  client_cited  boolean,
  matched_url   text,
  title_match   boolean,
  page_status   text not null default 'none'
                check (page_status in ('none','candidate','selected','drafted','published')),
  source_step   integer,
  updated_at    timestamptz not null default now()
);
create unique index if not exists client_query_state_key
  on public.client_query_state (client_id, query_id);

-- 7. The client's own pages, so a fanout query can be matched against what already exists.
create table if not exists public.client_url_inventory (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients(id) on delete cascade,
  url           text not null,
  path          text,
  title         text,
  h1            text,
  status_code   integer,
  fetched_at    timestamptz not null default now()
);
create unique index if not exists client_url_inventory_key
  on public.client_url_inventory (client_id, url);

-- 8. The colony. One hard target per colony; a client may run more than one over time.
create table if not exists public.colonies (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid not null references public.clients(id) on delete cascade,
  target_query       text not null,
  target_query_id    uuid references public.query_index(id) on delete set null,
  target_page_id     uuid references public.client_pages(id) on delete set null,
  status             text not null default 'building'
                     check (status in ('building','pointing','live')),
  difficulty_signals jsonb,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists colonies_client on public.colonies (client_id, created_at desc);

-- 9. The chain. position is the order a page joined; the forward link is DERIVED from
--    it at render time and is never written into client_pages.answer_md, because
--    page_gate_runs stores a body_hash and mutating a body would invalidate every
--    prior gate verdict for every page on every new publish.
create table if not exists public.colony_members (
  id               uuid primary key default gen_random_uuid(),
  colony_id        uuid not null references public.colonies(id) on delete cascade,
  page_id          uuid not null references public.client_pages(id) on delete cascade,
  position         integer not null,
  satisfied_clicks integer not null default 0,
  promoted_at      timestamptz,
  added_at         timestamptz not null default now()
);
create unique index if not exists colony_members_page on public.colony_members (colony_id, page_id);
create index if not exists colony_members_order on public.colony_members (colony_id, position);

-- 10. page_candidates keeps its job as the SELECTION table. Additive only.
alter table public.page_candidates add column if not exists query_id uuid references public.query_index(id) on delete set null;
alter table public.page_candidates add column if not exists colony_id uuid references public.colonies(id) on delete set null;
alter table public.page_candidates add column if not exists source_step integer;
alter table public.page_candidates add column if not exists quotable_format text;

commit;
