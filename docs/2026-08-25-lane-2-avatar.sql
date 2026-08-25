-- LANE 2 — avatar first (2026-08-25)
--
-- clients.primary_avatar has had a column, a CHECK constraint and a verifier since it was
-- created, and NO WRITER ANYWHERE. Step 11's card said "the proposal is on the board" and there
-- was no such panel, so on the live client that step came out `skipped` because no human being
-- could have ticked it.
--
-- ‼️ THE FOUR COLUMNS THAT WRITER NEEDS ALREADY EXIST AND ARE NOT IN THIS FILE.
-- Verified against production before a line was written: clients.primary_avatar,
-- primary_avatar_label, primary_avatar_confirmed_at and primary_avatar_confirmed_by are all
-- there and all null. The CHECK constraint allowing only a1 / a2 / a3 stays exactly as it is:
-- the SLOT is a1/a2/a3 and the LABEL is free text, so "type a new one" means it occupies a slot
-- under his own label and needs no migration at all.
--
-- What this file adds is the half that makes research REUSABLE across clients.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. avatar_briefs — the same LHR research, reused by the next client in the vertical
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Matthew: "make sure we save the data for each avatar, this way if another client has the same
-- LHR client, we can use the same prompt saved in the databse and make it optional to run deep
-- research again."
--
-- Keyed (vertical, avatar_slug) and NOT by client. That is the point: two med spas both aiming at
-- laser hair removal are researching the same buyer, and the second one should be offered what
-- the first one produced rather than spending the run again.

create table if not exists public.avatar_briefs (
  vertical         text not null,
  avatar_slug      text not null,
  avatar_label     text not null,
  prompt_text      text,
  research_text    text,
  research_doc_id  uuid,
  first_client_id  uuid,
  times_reused     int  not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (vertical, avatar_slug)
);

comment on table public.avatar_briefs is
  'Deep-research output per (vertical, avatar), reused across clients. prompt_text is the rendered '
  'message 3 of the three-message framework; research_text is what came back. times_reused counts '
  'clients that took the cached version rather than running it again. NOT keyed by client on '
  'purpose: the whole value is that the second med spa aiming at laser hair removal gets the '
  'first one''s research.';

alter table public.clients
  add column if not exists primary_avatar_slug text;

comment on column public.clients.primary_avatar_slug is
  'The avatar''s stable slug, derived from its label. primary_avatar is the SLOT (a1/a2/a3) and is '
  'only meaningful next to the niche brief it came from; this is what joins to avatar_briefs and '
  'to question_bank.avatar, and it survives a niche brief being regenerated with the three in a '
  'different order.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. client_avatar_runs — every avatar this client has been aimed at, in order
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Matthew: "if this step is already done allow me to come back and run it once again but with a
-- new avatar". A change is a NEW ROW and the old one is superseded rather than overwritten,
-- because the question set frozen at Day 0 was built against whichever avatar was live at the
-- time and the case study has to be able to say which.

create table if not exists public.client_avatar_runs (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null,
  slot          text not null,
  avatar_slug   text not null,
  avatar_label  text not null,
  confirmed_at  timestamptz not null default now(),
  confirmed_by  text,
  superseded_at timestamptz
);

create index if not exists client_avatar_runs_client_idx
  on public.client_avatar_runs (client_id, confirmed_at desc);

comment on table public.client_avatar_runs is
  'Append-only history of which avatar a client was aimed at. superseded_at is set when a later '
  'row replaces this one. Never updated in place: the Day-0 question set was built against the '
  'row that was live when it froze.';

alter table public.avatar_briefs enable row level security;
alter table public.client_avatar_runs enable row level security;

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. question_bank: the key moves to (vertical, avatar, normalized)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- The same phrase legitimately belongs to two different avatars in one vertical: "how much does
-- laser hair removal cost" and "how much does filler cost" are different rows, but so is one
-- phrase harvested once for the LHR avatar and once for the filler avatar, with different
-- provenance behind each. Under the old (vertical, normalized) key the second one silently
-- overwrote the first.
--
-- ‼️ NULLS NOT DISTINCT IS LOAD-BEARING AND IS NOT OPTIONAL.
--
-- Every one of the 63 rows in production carries a NULL avatar. Under Postgres's default, nulls
-- compare DISTINCT, so a plain unique index on these three columns would constrain none of those
-- rows and every re-run of the harvest would insert 63 fresh duplicates. NULLS NOT DISTINCT makes
-- two nulls collide, which is the semantics the old two-column key had.
--
-- It is also what makes the key INFERRABLE FROM A BARE COLUMN LIST, which PostgREST's on_conflict
-- parameter requires because it takes column NAMES only. docs/2026-08-24-step-board-fixes.sql
-- records the same thing for nap_discrepancies, and the reason it is written down twice is that
-- getting it wrong is not a data collision: a conflict target that matches no index is 42P10 at
-- PLAN time, so it fails on every single run. That has now happened twice in this repo.

drop index if exists public.question_bank_phrase_key;

create unique index if not exists question_bank_phrase_avatar_key
  on public.question_bank (vertical, avatar, normalized) nulls not distinct;

-- ‼️ question_bank.avatar HOLDS THE SLUG NOW, NOT THE SLOT, AND THE CHECK HAD TO WIDEN FOR IT.
--
-- The old constraint allowed only 'a1' / 'a2' / 'a3'. That is the right vocabulary for
-- clients.primary_avatar, where a slot is read against the niche brief that offered it, and it is
-- the wrong vocabulary here: question_bank has NO client_id and is shared across every client in
-- a vertical forever, and "a1" means whatever that client's niche brief had in position one on
-- the day they confirmed. Two clients would file two different buyers under one tag.
--
-- The slug is the same string in every client's mouth, which is what makes the corpus joinable to
-- avatar_briefs and reusable at all. It still refuses junk, and 'a1' still passes, so nothing
-- already written can violate it.

alter table public.question_bank drop constraint if exists question_bank_avatar_check;
alter table public.question_bank add constraint question_bank_avatar_check
  check (avatar is null or avatar ~ '^[a-z0-9][a-z0-9-]{0,59}$');

comment on column public.question_bank.avatar is
  'The avatar SLUG this phrase was harvested for, matching avatar_briefs.avatar_slug and '
  'clients.primary_avatar_slug. NOT the a1/a2/a3 slot: this table is shared across every client '
  'in the vertical and a slot only means something next to one client''s niche brief. NULL means '
  'the phrase predates the avatar being confirmed first, which is every row written before '
  '2026-08-25.';

-- ─────────────────────────────────────────────────────────────────────────────
-- After running this
-- ─────────────────────────────────────────────────────────────────────────────
--
-- select vertical, avatar, count(*) from public.question_bank group by 1, 2 order by 3 desc;
--
-- Expect the 63 existing rows to come back as (aeo-agency, null, 63). They are NOT backfilled to
-- an avatar: they were harvested before anybody had confirmed one, and writing a slug onto them
-- would be inventing which buyer they were collected for. The next harvest tags its own rows.
