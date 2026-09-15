-- 2026-09-16: the board fixes from Matthew's walk of SRT's re-onboarding (2026-09-15).
--
-- One file, four sections, every statement idempotent (re-running is safe):
--   A. Keywords kept for good: keyword_runs, keyword_decisions, keyword ids on the plan and dataset
--   B. question_bank knows what a phrase IS (a buyer's objection vs a heading vs a vendor's copy)
--   C. The offer ladder: a guarantee on the offer, the anchor's stage, the ladder document
--   D. The concierge as an add-on: addon_status, quick actions, the mascot
--
-- ‼️ RUN THIS BEFORE THE DEPLOY THAT READS IT. loadKeywords selects evidence_ids and role, and one
-- unknown column fails the whole PostgREST select.
--
-- Runner: bun run scripts/db.ts --file=docs/2026-09-16-board-fixes.sql [--dry]


-- =====================================================================
-- A. KEYWORDS KEPT FOR GOOD
-- =====================================================================
--
-- Matthew: "make sure the keywords that we generate here are saved for future strategies, page
-- drafting, keyword positioning ... to train our own model in the future." client_keywords is the
-- CURRENT set. These two tables are the history, append-only, and nothing deletes from them.

create table if not exists public.keyword_runs (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references public.clients (id) on delete cascade,
  reason           text not null check (reason in ('expansion', 'more', 'reset', 'measurement', 'rerun')),
  offer_fingerprint text,
  offer_id         uuid references public.client_offers (id) on delete set null,
  audience_id      uuid references public.client_audiences (id) on delete set null,
  model            text,
  prompt_version   text,
  -- [{system, user, rows, error, ms}] for every model call the run made. The raw rows, before any rule.
  model_calls      jsonb not null default '[]'::jsonb,
  -- [{phrase, category, reason}] for every proposed row the rules refused.
  rejected         jsonb not null default '[]'::jsonb,
  evidence_count   integer,
  expansion_count  integer,
  -- The whole set as it stood after the run: every row, approved and dropped alike.
  rows_snapshot    jsonb not null default '[]'::jsonb,
  row_count        integer,
  csv_doc_id       uuid references public.client_docs (id) on delete set null,
  notes            text[] not null default '{}',
  context          jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);
create index if not exists keyword_runs_client on public.keyword_runs (client_id, created_at desc);
alter table public.keyword_runs enable row level security;

create table if not exists public.keyword_decisions (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients (id) on delete cascade,
  -- SET NULL: the keyword row can be rebuilt by an offer change, and the decision is still a fact.
  keyword_id  uuid references public.client_keywords (id) on delete set null,
  action      text not null check (action in ('approve', 'drop', 'add', 'restore', 'pick_pillar', 'pick_support', 'unpick')),
  actor       text,
  -- The phrase as it was when decided, so the decision reads without the row.
  phrase      text not null,
  category    text,
  use         text,
  origin      text,
  rank        integer,
  score       numeric,
  context     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists keyword_decisions_client on public.keyword_decisions (client_id, created_at desc);
alter table public.keyword_decisions enable row level security;

alter table public.client_keywords add column if not exists evidence_ids uuid[] not null default '{}';
alter table public.client_keywords add column if not exists role text;
alter table public.client_keywords add column if not exists picked_at timestamptz;
alter table public.client_keywords add column if not exists picked_by text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'client_keywords_role_check') then
    alter table public.client_keywords
      add constraint client_keywords_role_check check (role is null or role in ('pillar', 'support'));
  end if;
end $$;

-- The plan and the dataset point at the keyword row, not only at a copy of its words.
alter table public.page_plan
  add column if not exists target_keyword_id uuid references public.client_keywords (id) on delete set null;
alter table public.page_plan add column if not exists secondary_keyword_ids uuid[];
alter table public.client_headlines
  add column if not exists keyword_id uuid references public.client_keywords (id) on delete set null;
alter table public.page_dataset add column if not exists primary_keyword_id uuid;

comment on table public.keyword_runs is
  'One row per keyword expansion, `keywords more`, offer-change reset or measurement: the prompts, the raw '
  'model rows, the rows the rules refused with the reason, and the whole set after. Append-only. See '
  'src/lib/clients/keyword-dataset.ts.';
comment on table public.keyword_decisions is
  'Every approve, drop, add, restore and step 21 pick on a client keyword, with the phrase as it was. Append-only.';
