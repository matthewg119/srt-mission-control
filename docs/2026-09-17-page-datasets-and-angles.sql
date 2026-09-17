-- 2026-09-17: a page becomes a set of datasets, and a rerun becomes a variation of them.
--
-- Matthew, 2026-09-17: "before we build this drafts, lets make sure we have all of the datasets
-- required to have a full page ready for production so we can focus on saving those datasets and
-- when we have a draft is just a bunch of different variation of all of the required datasets,
-- that being (Offer, avatar, stage of awareness, headline, narrative, Indoctrination story ...)
-- so we keep learning and at some point be able to create our own model."
--
-- And, on the step 21 card: "those are not the options for the headlines of the pillars are they?
-- because those headlines are not good at all ... we can get options for the raw Idea of the whole
-- page itself and based on the idea we can generate headlines and lead magnets for that page."
--
-- Four sections, every statement idempotent (re-running is safe):
--   A. page_dataset gets its CREATE TABLE, fifteen months after it got its first writer
--   B. page_angles: the raw idea of the page, three per page, one picked
--   C. page_plan learns which audience and which offer a page is for
--   D. page_plan_runs: a rerun snapshots what it is about to replace
--
-- ‼️ RUN THIS BEFORE THE DEPLOY THAT READS IT. page-angles.ts selects from page_angles by name and
-- capturePage selects the new page_dataset columns; one unknown column fails the WHOLE PostgREST
-- select and supabase-js RETURNS the error rather than throwing, so a try/catch never fires.
--
-- Runner: bun run scripts/db.ts --file=docs/2026-09-17-page-datasets-and-angles.sql [--dry]


-- =====================================================================
-- A. page_dataset, WHICH HAS EXISTED IN PRODUCTION WITH NO MIGRATION FILE
-- =====================================================================
--
-- ‼️ THIS IS A NO-OP ON PRODUCTION AND THAT IS THE POINT. Measured 2026-09-17: the table is there
-- with 26 columns and 0 rows, and NO file under docs/ ever created it. docs/2026-09-16-board-fixes
-- ALTERS it. A live table with no migration on the deployed branch is exactly how a second table
-- gets written for the same thing, which is the failure 2026-08-31-colony-and-fanout was written
-- up to stop. The create below matches the live shape column for column, so applying it changes
-- nothing and a fresh database finally gets one.
--
-- ‼️ APPEND ONLY, ONE ROW PER CAPTURE, NEVER UPDATED IN PLACE. The value of this table is the
-- DIFFERENCE between what the model drafted and what shipped. See src/lib/clients/page-dataset.ts.
create table if not exists public.page_dataset (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid not null references public.clients (id) on delete cascade,
  page_id             uuid,
  plan_id             uuid,
  batch_id            uuid,
  role                text,
  vertical_slug       text,

  slug                text,
  title               text,
  meta_description    text,

  headline            text,
  headline_candidates jsonb,

  primary_keyword     text,
  secondary_keywords  text[],
  section_keywords    jsonb,
  outline             jsonb,

  body_md             text,
  evidence_map        jsonb,
  source_count        integer,

  research_prompt     text,

  gate_verdict        text,
  gate_checks         jsonb,

  captured_reason     text not null,
  captured_at         timestamptz not null default now(),
  published_at        timestamptz,
  primary_keyword_id  uuid
);

-- ‼️ NO FOREIGN KEY ON page_id OR plan_id, DELIBERATELY. A capture is a record of what a page WAS.
-- A cascade from client_pages would delete the snapshot of a page at the moment somebody deleted
-- the page, which is the one moment the snapshot is most worth having. client_id keeps its cascade
-- because a deleted client is a deletion request, not an edit.

alter table public.page_dataset add column if not exists captured_reason text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'page_dataset_captured_reason_check') then
    alter table public.page_dataset add constraint page_dataset_captured_reason_check
      check (captured_reason in ('drafted', 'edited', 'published'));
  end if;
end $$;

-- The datasets a draft is a VARIATION OF. Every one of these was decided before the body was
-- written and none of them was recorded beside it, so the corpus could show what was produced and
-- never what it was produced from.
alter table public.page_dataset add column if not exists audience_id uuid;
alter table public.page_dataset add column if not exists offer_id uuid;
alter table public.page_dataset add column if not exists angle_id uuid;
alter table public.page_dataset add column if not exists angle text;
alter table public.page_dataset add column if not exists narrative text;
alter table public.page_dataset add column if not exists indoctrination text;
alter table public.page_dataset add column if not exists awareness_entry smallint;
alter table public.page_dataset add column if not exists awareness_target smallint;
alter table public.page_dataset add column if not exists lead_magnet_key text;
-- [{title, promise, ctaLabel, chosen}] for every magnet offered for this page, marking which won.
-- ‼️ THE REJECTS ARE THE POINT, same reasoning headline_candidates already carries: a corpus of
-- only winners shows what a good one looks like and says nothing about what made it better.
alter table public.page_dataset add column if not exists magnet_candidates jsonb;

-- Which attempt this was. A rerun of step 21 writes a new row rather than replacing one, so a
-- reader can line up variant 1 against variant 3 and see what changed between them.
alter table public.page_dataset add column if not exists variant_no integer;
alter table public.page_dataset add column if not exists rerun_of uuid;

create index if not exists page_dataset_client_idx on public.page_dataset (client_id, captured_at desc);
create index if not exists page_dataset_page_idx on public.page_dataset (page_id, captured_at desc);
create index if not exists page_dataset_plan_idx on public.page_dataset (plan_id, variant_no);
alter table public.page_dataset enable row level security;

comment on table public.page_dataset is
  'One row per page capture: drafted, edited or published. Append-only, never updated in place, and '
  'the only place a page body has any history. Carries the datasets the draft was a variation of '
  '(audience, offer, angle, awareness, narrative, magnet) so the corpus shows what a page was made '
  'FROM and not only what it became. See src/lib/clients/page-dataset.ts.';


-- =====================================================================
-- B. page_angles: THE RAW IDEA OF THE PAGE
-- =====================================================================
--
-- ‼️ AN ANGLE IS NOT A HEADLINE AND NOT A KEYWORD, AND CONFLATING THEM IS THE BUG THIS FIXES.
-- Step 21 asks for a KEYWORD (`pillar: 7`, a client_keywords.rank) and then generates headlines
-- from that keyword plus an awareness stage. Nothing in between ever decided what the page
-- ARGUES. So the headline generator was asked to write a line about a phrase, which is why the
-- thirty-three candidates read as thirty-three ways of saying the keyword out loud.
--
-- An angle is: who this page is for, what it claims, the story it runs on, and which belief it has
-- to install to move the reader a stage. Three are generated per planned page, a person picks one,
-- and the headline AND the lead magnets are generated from the pick rather than from the phrase.
--
-- Shaped on page_magnet_candidates, which is the existing propose-then-a-person-decides pattern.
create table if not exists public.page_angles (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references public.clients (id) on delete cascade,
  plan_id          uuid not null references public.page_plan (id) on delete cascade,
  audience_id      uuid,
  offer_id         uuid,

  -- The idea itself, one or two sentences. What this page argues, in a person's words.
  idea             text not null,
  -- What the reader walks away able to do or decide.
  promise          text,
  -- The story spine: the shape the page runs on rather than the claims it makes.
  narrative        text,
  -- The belief this page has to install to move the reader from entry to target. Matthew's
  -- "indoctrination story". Free text, because a belief is a sentence and not an enum.
  indoctrination   text,

  -- 5 = problem unaware, 1 = most aware. Two numbers, not one: where the reader starts and where
  -- this page leaves them. Same pair page_plan and client_headlines already carry.
  awareness_entry  smallint,
  awareness_target smallint,

  -- ["what this angle obliges us to prove"]. Written at angle time so the ONE research pass for the
  -- batch can ask for it, rather than discovering at gate time that a claim has no source.
  proof_needed     jsonb not null default '[]'::jsonb,

  rationale        text,
  model            text,

  status           text not null default 'draft' check (status in ('draft', 'approved', 'rejected')),
  decided_at       timestamptz,
  decided_by       text,
  created_at       timestamptz not null default now(),

  constraint page_angles_awareness_entry_check
    check (awareness_entry is null or awareness_entry between 1 and 5),
  constraint page_angles_awareness_target_check
    check (awareness_target is null or awareness_target between 1 and 5),

  -- ‼️ COMPOSITE, SO AN ANGLE CANNOT POINT AT ANOTHER CLIENT'S AUDIENCE. Same shape client_offers
  -- already uses toward client_audiences. Cascade rather than set null, because the pair includes
  -- client_id, which is NOT NULL: a set-null would fail the constraint it was meant to relax.
  constraint page_angles_audience_fkey foreign key (audience_id, client_id)
    references public.client_audiences (id, client_id) on delete cascade
);

-- ‼️ ONE APPROVED ANGLE PER PLANNED PAGE. Three candidates are not a choice; folding the shortlist
-- and the pick into one status would let two approved ideas sit on one page and let whichever the
-- drafter read first decide what got written.
create unique index if not exists page_angles_one_approved
  on public.page_angles (plan_id) where status = 'approved';
create index if not exists page_angles_plan_idx on public.page_angles (plan_id, created_at);
create index if not exists page_angles_client_idx on public.page_angles (client_id, created_at desc);
alter table public.page_angles enable row level security;

comment on table public.page_angles is
  'Three candidate ideas per planned page: what it argues, the story it runs on, the belief it has '
  'to install, and the awareness stages it moves between. A person picks one and the headline and '
  'the lead magnets are generated from the pick. Rejected rows are kept: they are what teaches a '
  'preference. See src/lib/clients/page-angles.ts.';

-- The offer a magnet was framed from, and the plan row it belongs to, so three magnet ideas can be
-- drafted for a PLANNED page before any client_pages row exists.
alter table public.page_magnet_candidates add column if not exists plan_id uuid
  references public.page_plan (id) on delete cascade;
alter table public.page_magnet_candidates add column if not exists angle_id uuid
  references public.page_angles (id) on delete set null;
create index if not exists page_magnet_candidates_plan_idx
  on public.page_magnet_candidates (plan_id, created_at);

comment on column public.page_magnet_candidates.plan_id is
  'The planned page this offer was drafted for, set before the page row exists. page_id is still '
  'filled once it does, and is what the widget resolves through.';


-- =====================================================================
-- C. A PAGE KNOWS WHICH AUDIENCE AND WHICH OFFER IT IS FOR
-- =====================================================================
--
-- ‼️ A CLIENT HAS MANY AUDIENCES AND AN OFFER HANGS UNDER ONE, so "the client's offer" stopped
-- being a single answer on 2026-09-15. page_plan carried neither, which meant a drafted page could
-- not say which of a client's offers it was selling, and page_dataset could not record it.

-- client_offers needs this before anything can composite-FK to it. client_audiences already has
-- the equivalent; this is the same guarantee one level down.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'client_offers_id_client_uq') then
    alter table public.client_offers add constraint client_offers_id_client_uq unique (id, client_id);
  end if;
end $$;

alter table public.page_plan add column if not exists audience_id uuid;
alter table public.page_plan add column if not exists offer_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'page_plan_audience_fkey') then
    alter table public.page_plan add constraint page_plan_audience_fkey
      foreign key (audience_id, client_id) references public.client_audiences (id, client_id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'page_plan_offer_fkey') then
    alter table public.page_plan add constraint page_plan_offer_fkey
      foreign key (offer_id, client_id) references public.client_offers (id, client_id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'page_angles_offer_fkey') then
    alter table public.page_angles add constraint page_angles_offer_fkey
      foreign key (offer_id, client_id) references public.client_offers (id, client_id) on delete cascade;
  end if;
end $$;

-- The angle a page was written from, once one is picked.
alter table public.page_plan add column if not exists angle_id uuid
  references public.page_angles (id) on delete set null;

comment on column public.page_plan.angle is
  'The picked angle''s idea, copied onto the plan row so every existing reader keeps working. '
  'angle_id is the row it came from, and page_angles is where the rejected two live.';


-- =====================================================================
-- D. page_plan_runs: A RERUN SNAPSHOTS WHAT IT REPLACES
-- =====================================================================
--
-- ‼️ proposePreCallPlan DELETES EVERY status='proposed' ROW BEFORE INSERTING FRESH ONES
-- (pre-call-pages.ts). That is correct behaviour and stays: a re-run is how "I changed the offer,
-- do it again" works, and it already refuses to touch anything approved or claimed. What was wrong
-- is that the replaced rows went nowhere, so the PLAN had no history even though the BODY did.
--
-- Modelled on keyword_runs, which solved the identical problem for the keyword set: snapshot the
-- whole set into jsonb before replacing it. One insert before the delete. No read path changes,
-- which is why this rather than a superseded_at column on page_plan itself.
create table if not exists public.page_plan_runs (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients (id) on delete cascade,
  reason        text not null check (reason in ('rerun', 'plan_new', 'offer_change', 'first_run')),
  offer_id      uuid references public.client_offers (id) on delete set null,
  audience_id   uuid references public.client_audiences (id) on delete set null,
  -- The plan as it stood BEFORE this run replaced it: every row, whatever its status.
  rows_snapshot jsonb not null default '[]'::jsonb,
  -- The angles that had been generated for those rows, and which one was picked.
  angles_snapshot jsonb not null default '[]'::jsonb,
  row_count     integer,
  kept_count    integer,
  replaced_count integer,
  notes         text[] not null default '{}',
  created_at    timestamptz not null default now(),
  created_by    text
);

create index if not exists page_plan_runs_client_idx on public.page_plan_runs (client_id, created_at desc);
alter table public.page_plan_runs enable row level security;

comment on table public.page_plan_runs is
  'One row per step 21 run: the plan and its angles as they stood BEFORE the run replaced them. '
  'Append-only. The plan''s equivalent of keyword_runs, and the reason a rerun adds to the record '
  'rather than erasing it.';


-- ── Verify ──────────────────────────────────────────────────────────────────
select 'page_dataset cols' as t, count(*)::text as v from information_schema.columns
  where table_schema='public' and table_name='page_dataset'
union all select 'page_angles cols', count(*)::text from information_schema.columns
  where table_schema='public' and table_name='page_angles'
union all select 'page_plan_runs cols', count(*)::text from information_schema.columns
  where table_schema='public' and table_name='page_plan_runs'
union all select 'page_plan.audience_id', count(*)::text from information_schema.columns
  where table_schema='public' and table_name='page_plan' and column_name='audience_id'
union all select 'page_plan.offer_id', count(*)::text from information_schema.columns
  where table_schema='public' and table_name='page_plan' and column_name='offer_id'
union all select 'magnet_candidates.plan_id', count(*)::text from information_schema.columns
  where table_schema='public' and table_name='page_magnet_candidates' and column_name='plan_id'
union all select 'page_dataset rows', count(*)::text from public.page_dataset;
