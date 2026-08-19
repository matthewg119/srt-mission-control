-- The avatar phrase harvest — question_bank, harvest_runs, page_candidates.
--
-- Safe to run more than once.
--
-- WHY THIS EXISTS. Runner v3 section 9 and Amendment A1 D-P11/D-P12. The point of the harvest is
-- to find what this clinic's actual avatar TYPES, in their words, so those phrases are tracked
-- from day zero rather than discovered in month two.
--
-- ‼️ REDDIT IS NOT PART OF THIS, AND THAT IS RECORDED HERE RATHER THAN DISCOVERED LATER.
-- Runner v3 section 9 names Reddit first. There is no REDDIT_CLIENT_ID in this environment, and
-- A2 section 9 records that commercial use of the Data API needs Reddit's approval, unverified.
-- A2 also names the fallback explicitly: "build 4c to run on RealSelf + citation_sources alone
-- if Reddit says no". So the automated half runs on audit_runs.citations, which already holds
-- every URL every engine has cited across every audit ever run, and the human half is a
-- deep-research brief a person runs and pastes back. Nothing scrapes Reddit, and no posting
-- path exists to any forum — that ban is canon and predates this table.
--
-- ‼️ THE HARD SEPARATION, RESTATED IN SQL. A1 section 5 is a build stop:
--
--   harvest -> custom question set -> approved on the call -> Day 0   =>  question_set_versions
--   harvest -> page candidates -> weekly selection -> pages           =>  page_candidates
--
-- NOTHING in this migration references question_set_versions, and nothing may. That table is
-- frozen by definition and freezeUniversalV1() is its only writer. If a code path ever appears
-- where the harvest could edit a frozen tracked set, that is a build stop, not a bug to patch.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. One run of the harvest
-- ─────────────────────────────────────────────────────────────────────────────
--
-- tenant_id is nullable because A1 D-P11 describes two runs with two purposes: a PRE-CALL run
-- for one client, and a WEEKLY run during rhythm. A vertical-wide harvest that belongs to no
-- single client is a legitimate row.
create table if not exists public.harvest_runs (
  id            uuid        primary key default gen_random_uuid(),
  client_id     uuid        references public.clients(id) on delete cascade,
  vertical      text        not null,

  -- What was actually read, so a phrase can be traced back to where it came from. Today this is
  -- {"citations": n, "reddit": false, "deep_research": false} and the false values are the
  -- honest record of what did not run.
  sources       jsonb       not null default '{}',
  seed_terms    text[]      not null default '{}',

  run_at        timestamptz not null default now(),
  results_count integer     not null default 0,
  error         text
);

create index if not exists harvest_runs_client_idx on public.harvest_runs (client_id, run_at desc);

alter table public.harvest_runs enable row level security;

comment on table public.harvest_runs is
  'A1 section 6. One execution of the avatar phrase harvest. sources records what was actually '
  'read INCLUDING what was not, so a thin run is visibly thin rather than silently thin.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. The phrases themselves — GLOBAL, not per client
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Global by vertical, per v4 section 1 and A1 section 6. The phrases a med spa avatar types are
-- the same phrases in Greensboro and in Raleigh; only the substituted city differs, and
-- substitution happens later, per tenant, in page_candidates. Keeping the bank global is what
-- makes client number two cost nothing.
create table if not exists public.question_bank (
  id            uuid        primary key default gen_random_uuid(),
  vertical      text        not null,

  -- The phrase AS THE MARKET SAID IT. Not cleaned up, not made grammatical, not turned into a
  -- keyword. The whole value of a harvest is the market's own wording; normalising it into
  -- marketing English throws away the only thing that could not have been written at a desk.
  phrase        text        not null,
  normalized    text        not null,

  source        text        not null,
  harvest_run_id uuid       references public.harvest_runs(id) on delete set null,
  -- Where it was found, so a phrase on a call sheet can be defended.
  source_url    text,

  frequency_score        integer not null default 1,
  commercial_intent_score smallint not null default 0,

  -- ‼️ NULL UNTIL A HUMAN CONFIRMS AN AVATAR AT STEP 11, and that ordering is deliberate.
  -- The harvest is step 9; the avatar is confirmed at step 11. Tagging a phrase a1/a2/a3 two
  -- steps before anybody has decided what a1 IS would be inventing the tag and then treating it
  -- as evidence.
  avatar        text,
  objection_phrase boolean not null default false,

  created_at    timestamptz not null default now()
);

alter table public.question_bank drop constraint if exists question_bank_source_check;
alter table public.question_bank add constraint question_bank_source_check
  check (source in ('harvest', 'deep_research', 'intake'));

alter table public.question_bank drop constraint if exists question_bank_intent_check;
alter table public.question_bank add constraint question_bank_intent_check
  check (commercial_intent_score between 0 and 3);

alter table public.question_bank drop constraint if exists question_bank_avatar_check;
alter table public.question_bank add constraint question_bank_avatar_check
  check (avatar is null or avatar in ('a1', 'a2', 'a3'));

-- One row per distinct phrase per vertical. A repeat sighting raises frequency_score rather
-- than adding a row, so "how often the shape recurs" means something.
create unique index if not exists question_bank_phrase_key
  on public.question_bank (vertical, normalized);

create index if not exists question_bank_rank_idx
  on public.question_bank (vertical, commercial_intent_score desc, frequency_score desc);

alter table public.question_bank enable row level security;

comment on table public.question_bank is
  'A1 section 6, Runner v3 section 9. GLOBAL phrase bank keyed by vertical. source ''harvest'' '
  'is the automated cited-source pass; ''deep_research'' is pasted back from a brief a human ran. '
  '‼️ NEVER writes to question_set_versions. A1 section 5 makes that a build stop.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Page candidates — per tenant, regenerated freely, NEVER frozen
-- ─────────────────────────────────────────────────────────────────────────────
--
-- The other side of the hard separation. These are substituted per client and regenerated every
-- month; the tracked set is frozen once and never edited. Two tables because they have opposite
-- lifecycles, and one table with a flag would eventually get the flag wrong.
create table if not exists public.page_candidates (
  id            uuid        primary key default gen_random_uuid(),
  client_id     uuid        not null references public.clients(id) on delete cascade,
  question_bank_id uuid     references public.question_bank(id) on delete set null,

  -- The substituted text, e.g. {city} filled in. Stored rather than derived so a page published
  -- from it can always be traced to the exact question it answered.
  question      text        not null,
  avatar        text,
  score         numeric     not null default 0,

  -- Does any engine currently name the client for this question? Answered from the baseline
  -- run, so the call can lead with the gaps.
  currently_named boolean,
  -- Does this phrase appear in the clinic's own reviews? A phrase patients already use is a
  -- stronger page than one we think they might.
  in_own_reviews  boolean   not null default false,

  selected_for_month date,
  selected_at   timestamptz,
  selected_by   text,

  created_at    timestamptz not null default now()
);

alter table public.page_candidates drop constraint if exists page_candidates_avatar_check;
alter table public.page_candidates add constraint page_candidates_avatar_check
  check (avatar is null or avatar in ('a1', 'a2', 'a3'));

create index if not exists page_candidates_client_idx
  on public.page_candidates (client_id, selected_for_month, score desc);

alter table public.page_candidates enable row level security;

comment on table public.page_candidates is
  'A1 section 5. Per-tenant substituted copies of question_bank phrases. Regenerated monthly and '
  'NEVER frozen. Publishing volume is governed by A1 D-P5a (measured vs over_delivery), not by '
  'how many rows are here.';

-- ─────────────────────────────────────────────────────────────────────────────
-- What to expect
-- ─────────────────────────────────────────────────────────────────────────────
--
-- select source, count(*) from public.question_bank group by 1;
--   'harvest' rows appear after step 9 runs. 'deep_research' rows appear only after somebody
--   runs the generated brief and pastes the result back. Zero deep_research rows means nobody
--   has run it yet, which is a real and visible state.
--
-- select sources from public.harvest_runs order by run_at desc limit 1;
--   Expect {"citations": N, "reddit": false, "deep_research": false}. The two falses are the
--   point: the record says what did not run.
