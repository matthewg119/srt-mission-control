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


-- =====================================================================
-- B. question_bank KNOWS WHAT A PHRASE IS
-- =====================================================================
--
-- SRT's step 13 "Objection" bucket held a competitor's button ("Request the Governance Risk Audit"), an
-- article about talent-agency scams and two research headings, because "risk" appeared in them. A phrase
-- now carries what it IS and who said it (src/lib/clients/phrase-kind.ts). Nothing is deleted: this table
-- is shared by every client in a vertical and is training data. Headings get excluded_at; the rest are
-- labelled and simply stop counting as objections.

alter table public.question_bank add column if not exists kind text;
alter table public.question_bank add column if not exists speaker text;
alter table public.question_bank add column if not exists excluded_at timestamptz;
alter table public.question_bank add column if not exists excluded_reason text;
alter table public.question_bank add column if not exists belief_key text;
-- Where a mined objection was heard: "sms_messages:<id>,lead_activities:<id>", or a Slack author.
alter table public.question_bank add column if not exists source_ref text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'question_bank_kind_check') then
    alter table public.question_bank add constraint question_bank_kind_check
      check (kind is null or kind in ('question', 'objection', 'claim', 'heading', 'vendor_copy', 'research_prose'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'question_bank_speaker_check') then
    alter table public.question_bank add constraint question_bank_speaker_check
      check (speaker is null or speaker in ('buyer', 'vendor', 'researcher', 'unknown'));
  end if;
end $$;

-- Wider than before, so no existing row can fail it: 'seed' (config/objections) and 'sales_call' (mined
-- from our own prospect conversations, or typed as `objection:` in step 13's thread).
alter table public.question_bank drop constraint if exists question_bank_source_check;
alter table public.question_bank add constraint question_bank_source_check
  check (source in ('harvest', 'deep_research', 'intake', 'keywords', 'seed', 'sales_call'));

create index if not exists question_bank_vertical_kind on public.question_bank (vertical, kind) where excluded_at is null;


-- =====================================================================
-- C. THE AWARENESS LADDER AT STEP 21
-- =====================================================================
--
-- Matthew asked whether he was supposed to come up with the anchor offer himself. Step 21 now writes a
-- ladder for the locked offer (one claim, risk reversal and anchor per stage of awareness), a person picks
-- the rung, and the pillar and supports are picked from the approved keywords before a page is planned.

alter table public.client_offers add column if not exists guarantee text;
alter table public.client_offers add column if not exists guarantee_set_at timestamptz;
alter table public.client_offers add column if not exists anchor_stage smallint;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'client_offers_anchor_stage_check') then
    alter table public.client_offers add constraint client_offers_anchor_stage_check
      check (anchor_stage is null or anchor_stage between 1 and 5);
  end if;
end $$;

comment on column public.client_offers.guarantee is
  'The risk reversal as the client will honour it, `guarantee:` in the prep call or step 21 thread. The '
  'awareness ladder may restate this and nothing else; with it empty, no rung guarantees anything.';
comment on column public.client_offers.anchor_stage is
  'The awareness stage (5 unaware to 1 most aware) whose ladder rung the anchor was picked from at step 21.';

-- The ladder is an offer document. Both checks are replaced by strictly wider ones.
alter table public.audience_documents drop constraint if exists audience_documents_kind_check;
alter table public.audience_documents add constraint audience_documents_kind_check
  check (kind in ('sales_letter', 'deep_research', 'avatar_sheet', 'short_offer', 'necessary_beliefs', 'awareness_ladder'));
alter table public.audience_documents drop constraint if exists audience_documents_offer_kind;
alter table public.audience_documents add constraint audience_documents_offer_kind
  check ((kind in ('sales_letter', 'short_offer', 'necessary_beliefs', 'awareness_ladder')) = (offer_id is not null));
