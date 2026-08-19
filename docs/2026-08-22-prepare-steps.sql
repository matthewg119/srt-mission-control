-- The Prepare-phase steps: review audit, custom question set, page candidates, weekly reports.
--
-- Safe to run more than once.
--
-- WHY THIS EXISTS. Seven delivery steps carried `auto: true` with nothing behind them:
-- review_audit, custom_question_set, page_candidates, citation_cleanup_list,
-- review_tool_preview, time_log_entries and weekly_report. registry.ts's unreachableAutoSteps()
-- existed to WAIVE them as blockers, because otherwise findings_doc and call_sheet were in a
-- permanent deadlock and could never have generated for any client.
--
-- Five of the seven are now real runners and two are ticked by the routes that make them true.
-- Three of those need somewhere to write. Two do not, deliberately:
--
--   citation_cleanup_list  reads nap_discrepancies. A citation_cleanup_items table would be a
--                          SECOND copy of state the sweep already owns, and the first re-run
--                          would make the list and the sweep disagree about what is wrong.
--   review_tool_preview    reads clients.theme and client_hosts. It produces a URL, which goes
--                          in client_delivery_steps.output_ref like every other step's output.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. review_audit_rows — the review audit capture grid
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Runner v3 section 8: per platform, for the client AND each of the three competitors picked at
-- step 7. Read-only, official pages, never a scrape.
--
-- ‼️ EVERY MEASURE IS NULLABLE AND NOTHING DEFAULTS TO ZERO.
-- "Zero reviews" and "nobody has looked yet" are opposite claims about a business, and a
-- nullable integer defaulted to 0 is exactly how that distinction gets destroyed. checked_at is
-- what says a human read the listing; until then the artifacts print "not recorded".

create table if not exists public.review_audit_rows (
  id             uuid        primary key default gen_random_uuid(),
  client_id      uuid        not null references public.clients(id) on delete cascade,

  subject_type   text        not null,
  -- Null for the client's own rows. See competitor_key below for why that is awkward.
  competitor_id  uuid        references public.competitor_candidates(id) on delete cascade,
  -- Denormalised on purpose: the search string is composed from it, and a competitor removed
  -- from the shortlist should not blank out a reading somebody already took.
  subject_name   text        not null,

  platform       text        not null,

  review_count          integer,
  average_rating        numeric(2,1),
  most_recent_review_at date,
  -- 0.0 to 1.0, from "how many of the last 10 got an owner reply".
  owner_response_rate   numeric(3,2),
  -- In the reviewers' words. NEVER model-written: this lands verbatim in a client-facing PDF.
  negative_themes       text[]      not null default '{}',

  source         text        not null default 'manual',
  listing_url    text,
  screenshot_ref uuid        references public.client_docs(id) on delete set null,

  checked_by     text,
  checked_at     timestamptz,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.review_audit_rows drop constraint if exists review_audit_rows_subject_check;
alter table public.review_audit_rows add constraint review_audit_rows_subject_check
  check (subject_type in ('client', 'competitor'));

alter table public.review_audit_rows drop constraint if exists review_audit_rows_source_check;
alter table public.review_audit_rows add constraint review_audit_rows_source_check
  check (source in ('api', 'manual'));

-- A competitor row must name its competitor; a client row must not.
alter table public.review_audit_rows drop constraint if exists review_audit_rows_competitor_check;
alter table public.review_audit_rows add constraint review_audit_rows_competitor_check
  check (
    (subject_type = 'client'     and competitor_id is null) or
    (subject_type = 'competitor' and competitor_id is not null)
  );

-- ‼️ competitor_key EXISTS BECAUSE NULLS DO NOT UNIFY IN A UNIQUE INDEX.
-- Postgres treats every NULL as distinct, so a unique index on (client_id, subject_type,
-- competitor_id, platform) would happily accept the SAME client row four times -- and the
-- seeder upserts on exactly that key on every re-run. A generated column collapses the null to
-- a fixed uuid so the client's own rows conflict with each other the way they must.
alter table public.review_audit_rows
  add column if not exists competitor_key uuid
  generated always as (coalesce(competitor_id, '00000000-0000-0000-0000-000000000000'::uuid)) stored;

create unique index if not exists review_audit_rows_unique
  on public.review_audit_rows (client_id, subject_type, competitor_key, platform);

create index if not exists review_audit_rows_client_idx
  on public.review_audit_rows (client_id, subject_type);

alter table public.review_audit_rows enable row level security;

comment on table public.review_audit_rows is
  'Runner v3 section 8. The review audit capture grid, one row per subject per platform. Every '
  'measure is NULLABLE: no review provider is keyed, so a row is unread until checked_at is set, '
  'and "not recorded" must never render as zero reviews.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. client_question_sets — the custom set, as a DRAFT
-- ─────────────────────────────────────────────────────────────────────────────
--
-- ‼️ THIS IS NOT question_set_versions AND MUST NEVER WRITE TO IT.
-- docs/2026-08-19-harvest.sql calls a second writer of that table a BUILD STOP, and
-- freezeUniversalV1() is its only one. A frozen set is frozen; this is the thing that exists
-- BEFORE the freeze, gets read out loud on the call, and gets corrected there. Freezing
-- custom_v1 on approval hangs off call_held and is separate work.

create table if not exists public.client_question_sets (
  id           uuid        primary key default gen_random_uuid(),
  client_id    uuid        not null references public.clients(id) on delete cascade,
  version      text        not null default 'custom_v1',

  status       text        not null default 'draft',
  questions    jsonb       not null default '[]'::jsonb,
  -- Counts per bucket, so the composition can be checked against the target without re-deriving it.
  composition  jsonb       not null default '{}'::jsonb,
  -- Provenance: how many phrases came from the harvest, the deep-research brief, and the
  -- owner's own intake words, plus which buckets ran short. A thin run has to LOOK thin.
  sources      jsonb       not null default '{}'::jsonb,

  approved_at  timestamptz,
  approved_by  text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.client_question_sets drop constraint if exists client_question_sets_status_check;
alter table public.client_question_sets add constraint client_question_sets_status_check
  check (status in ('draft', 'approved'));

create unique index if not exists client_question_sets_unique
  on public.client_question_sets (client_id, version);

alter table public.client_question_sets enable row level security;

comment on table public.client_question_sets is
  'Runner v3 section 11. The DRAFT custom question set, per client. Approved on the call. It is '
  'not question_set_versions and must never write to it -- that table is frozen by definition '
  'and freezeUniversalV1() is its only writer.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. page_candidates — the unique key its writer needs
-- ─────────────────────────────────────────────────────────────────────────────
--
-- The table has existed since docs/2026-08-19-harvest.sql and content-digest.ts has been
-- READING it all along; nothing ever wrote a row, so the weekly rhythm silently fell through to
-- the audit's twenty every time. generatePageCandidates is the missing writer, and Runner v3
-- section 2 names this table specifically: a step that re-runs must never duplicate rows.
--
-- ‼️ The upsert deliberately does NOT touch selected_for_month / selected_at / selected_by.
-- Re-scoring must never discard a page somebody already picked for the month.

create unique index if not exists page_candidates_client_question_key
  on public.page_candidates (client_id, question);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. client_weekly_reports — the archive, and the idempotency key
-- ─────────────────────────────────────────────────────────────────────────────
--
-- The unique (client_id, week_stamp) is what makes a cron that runs twice on a Thursday post
-- one report, exactly as client_messages' unique (client_id, draft_key) does for the content
-- digest. The stored body is also what the day-90 results package reads back.

create table if not exists public.client_weekly_reports (
  id         uuid        primary key default gen_random_uuid(),
  client_id  uuid        not null references public.clients(id) on delete cascade,
  -- ISO week, e.g. '2026-W34'.
  week_stamp text        not null,
  body       text        not null,
  posted_at  timestamptz not null default now()
);

create unique index if not exists client_weekly_reports_unique
  on public.client_weekly_reports (client_id, week_stamp);

alter table public.client_weekly_reports enable row level security;

comment on table public.client_weekly_reports is
  'Artifact Templates section 4. One row per client per ISO week. The unique key is the '
  'idempotency guarantee for a cron that can run twice; the body is the day-90 archive.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. clients.primary_avatar — the hole this work found
-- ─────────────────────────────────────────────────────────────────────────────
--
-- ‼️ THIS IS A GAP IN THE GRAPH, NOT A GAP IN THE RUNNERS, AND THE COLUMN IS ADDED SO IT IS
-- VISIBLE RATHER THAN INFERRED.
--
-- `avatar_confirmed` is a manual step whose instructions tell Matthew to "map one to a1/a2/a3",
-- and NOTHING STORES THE ANSWER. Both custom_question_set and page_candidates are specced as
-- being built against the confirmed avatar, so today they are blocked by a step whose output is
-- discarded. Until there is a capture UI, page_candidates groups by THEME and says on the
-- artifact that avatar grouping is absent and why -- rather than writing a guessed a1/a2/a3 and
-- then treating it as evidence, which question_bank.avatar's own comment forbids one table over.

alter table public.clients
  add column if not exists primary_avatar text,
  add column if not exists primary_avatar_label text,
  add column if not exists primary_avatar_confirmed_at timestamptz,
  add column if not exists primary_avatar_confirmed_by text;

alter table public.clients drop constraint if exists clients_primary_avatar_check;
alter table public.clients add constraint clients_primary_avatar_check
  check (primary_avatar is null or primary_avatar in ('a1', 'a2', 'a3'));

-- ─────────────────────────────────────────────────────────────────────────────
-- What to expect
-- ─────────────────────────────────────────────────────────────────────────────
--
-- select subject_type, count(*), count(checked_at) as read_so_far
--   from public.review_audit_rows group by 1;
--   After review_audit runs: 4 platforms x (1 client + N competitors) rows, read_so_far = 0.
--   read_so_far staying 0 is the normal state until somebody does the manual read, and the
--   findings PDF says so rather than printing zeros.
--
-- select status, jsonb_array_length(questions), sources from public.client_question_sets;
--   Expect status 'draft'. sources carries {harvest, deepResearch, ownerIntake, shortfall}.
--   A high ownerIntake with a low harvest means the set was composed from three sentences typed
--   at intake, which is a real and visible state and worth a second harvest pass.
--
-- select count(*), count(currently_named) from public.page_candidates where client_id = '...';
--   The gap between the two counts is how many candidates were never put to an engine. Those
--   are scored WITHOUT the visibility-gap bonus rather than assumed to be gaps.
--
-- select count(*) from public.clients where primary_avatar is not null;
--   Expect 0. There is no capture UI yet. That is the point of adding the column.
