-- The evidence layer and the content quality gate.
--
-- Add-only and idempotent. Nothing here drops, renames or rewrites an existing column, and
-- every existing client_pages row stays valid: evidence_map is nullable and a page with no
-- gate run has no row in page_gate_runs.
--
-- WHY IT EXISTS. client_pages holds answer_md and nothing else, so the system could not say
-- where any sentence came from. draft-page.ts fetches the client's website live and throws the
-- crawl away, so a page written from it has no record of what it was written from. And there
-- was no check between a draft and a live page on a domain the CLIENT controls beyond one
-- person reading it.
--
-- !! THE GATE IS THE SECOND HARD RAIL IN THIS CODEBASE AND THAT IS DELIBERATE.
-- CLAUDE.md recorded that Approve was dropped because a second rail conflicted with the stated
-- doctrine that Day 0 is the one place this system blocks. Matthew reversed that on 2026-08-26,
-- choosing block-on-evidence and warn-on-style. The narrow half of the original objection is
-- still honoured: NO NEW client_pages.status VALUE. The status enum stays draft/published/
-- archived and the gate is a recorded verdict that page_publish consults, not a fourth
-- workflow state somebody has to move a page through.

-- ---------------------------------------------------------------------------
-- 1. page_sources, the provenance layer
-- ---------------------------------------------------------------------------
--
-- !! page_id IS NULL IS THE CLIENT LIBRARY, NOT AN ORPHAN ROW.
-- A null here is meaningful state: the source belongs to the client and is available to every
-- page they will ever have. Pricing philosophy, policies, qualifications and the terminology
-- their customers actually use get dictated once and feed every page after that. Nothing may
-- ever "clean up" rows with a null page_id.
--
-- !! AI_DERIVED IS NOT EVIDENCE AND MUST NEVER BE COUNTED AS IT.
-- It exists so a passage with no first-party backing can be RECORDED as having none, which is
-- the only way the gate can count them. isFirstParty() in src/lib/clients/page-evidence.ts is
-- the single place that decides which types are first-party; every consumer imports it rather
-- than writing its own list, so the distinction cannot drift.
create table if not exists public.page_sources (
  id             uuid        primary key default gen_random_uuid(),
  client_id      uuid        not null references public.clients(id) on delete cascade,
  page_id        uuid        references public.client_pages(id) on delete cascade,

  source_type    text        not null,
  -- VERBATIM. What he dictated or the client wrote, unedited. The drafter reads it as prose
  -- and a parser that guessed wrong would silently lose the half worth keeping. Same rule
  -- audit_reports.intake_answers already follows.
  source_content text        not null,
  -- What this source is ABOUT. Required in practice on a client-level row, because topic is
  -- the only thing that makes one retrievable when a later page needs it.
  topic          text,

  source_url     text,
  source_date    date,

  collected_by   text,
  collected_via  text,
  -- The Slack message this came from, so a source can be traced back to the thread it was
  -- said in months later.
  slack_ts       text,

  -- A person read this source and confirmed it is true. Separate from collected_by on purpose:
  -- collecting is transcription, verifying is a claim about the world.
  verified_by    text,
  verified_at    timestamptz,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.page_sources drop constraint if exists page_sources_type_check;
alter table public.page_sources add constraint page_sources_type_check
  check (source_type in (
    'CLIENT_VOICE',
    'CLIENT_DOCUMENT',
    'CLIENT_WEBSITE',
    'FIRST_PARTY_DATA',
    'EXTERNAL_RESEARCH',
    'AI_DERIVED'
  ));

alter table public.page_sources drop constraint if exists page_sources_via_check;
alter table public.page_sources add constraint page_sources_via_check
  check (collected_via is null or collected_via in (
    'slack_voice', 'slack_typed', 'board', 'crawl', 'audit'
  ));

create index if not exists page_sources_page_idx
  on public.page_sources (client_id, page_id, created_at desc);

create index if not exists page_sources_type_idx
  on public.page_sources (client_id, source_type);

-- The client library, read on every draft: page_id null, newest first.
create index if not exists page_sources_library_idx
  on public.page_sources (client_id, created_at desc)
  where page_id is null;

alter table public.page_sources enable row level security;

comment on table public.page_sources is
  'Provenance for hub pages. page_id null means the source belongs to the CLIENT and is '
  'available to every one of their pages. AI_DERIVED records the ABSENCE of first-party '
  'backing and is never counted as evidence.';

comment on column public.page_sources.source_content is
  'Verbatim. Never normalized, never summarized. The drafter reads it as prose.';

-- ---------------------------------------------------------------------------
-- 2. page_gate_runs, every quality-gate verdict, kept
-- ---------------------------------------------------------------------------
--
-- !! body_hash IS THE WHOLE RELIABILITY OF THIS TABLE.
-- A verdict is a statement about the body it read. Edit answer_md after a pass and that pass
-- describes text that no longer exists. page_publish hashes the CURRENT body and compares; a
-- mismatch refuses with "the page changed since the check" and is never honoured. Without it
-- the gate is worse than no gate, because it puts a green light on unread text.
--
-- Runs are kept rather than upserted. "It passed, then he edited it, then it blocked" is the
-- history somebody needs when a published page turns out to be wrong.
create table if not exists public.page_gate_runs (
  id         uuid        primary key default gen_random_uuid(),
  page_id    uuid        not null references public.client_pages(id) on delete cascade,
  client_id  uuid        not null references public.clients(id) on delete cascade,

  verdict    text        not null,
  -- [{ key, tier, status, detail }]. The full run, not just the failures: a check that passed
  -- is evidence the check ran at all.
  checks     jsonb       not null default '[]'::jsonb,

  body_hash  text        not null,
  model      text,
  run_by     text,

  created_at timestamptz not null default now()
);

alter table public.page_gate_runs drop constraint if exists page_gate_runs_verdict_check;
alter table public.page_gate_runs add constraint page_gate_runs_verdict_check
  check (verdict in ('pass', 'warn', 'block'));

create index if not exists page_gate_runs_latest_idx
  on public.page_gate_runs (page_id, created_at desc);

alter table public.page_gate_runs enable row level security;

comment on table public.page_gate_runs is
  'Content quality gate verdicts. The LATEST row for a page is what page_publish consults, and '
  'only when its body_hash matches the current answer_md.';

comment on column public.page_gate_runs.body_hash is
  'sha256 of answer_md at run time. A verdict whose hash no longer matches is stale and is '
  'refused, never honoured.';

-- ---------------------------------------------------------------------------
-- 3. client_pages.evidence_map, what each claim rests on
-- ---------------------------------------------------------------------------
--
-- [{ "claim": "...", "sourceRef": "S3" | null }] written by the drafter.
--
-- CLAIM-LEVEL, NOT SENTENCE-LEVEL, and that is a decision rather than a shortcut. Sentence-level
-- provenance survives exactly one hand edit before it is lying, and nobody re-tags a paragraph
-- they just reworded. A sourceRef of null is the drafter saying out loud that a claim rests on
-- nothing, which is what the unbacked_claims check reads.
alter table public.client_pages add column if not exists evidence_map jsonb;

comment on column public.client_pages.evidence_map is
  'Claim-level provenance from the drafter. sourceRef null means the claim has no source '
  'behind it, which blocks the publish gate.';

-- ---------------------------------------------------------------------------
-- 4. page_studio_sessions, the thread knows which mode it is in
-- ---------------------------------------------------------------------------
--
-- !! THE COLUMN IS studio_mode AND IT MUST NOT BE CALLED `mode`.
-- `mode` is a built-in ordered-set aggregate in Postgres. A PostgREST select naming a bare
-- `mode` on a table that does not have that column resolves to the AGGREGATE and comes back
-- with "WITHIN GROUP is required for ordered-set aggregate mode", which reads like a broken
-- query rather than a missing column. That was observed on this very table before the column
-- existed. Shadowing would probably work; a name nobody has to reason about definitely does.
--
-- !! WITHOUT IT, TYPED TEXT MEANS TWO DIFFERENT THINGS IN ONE THREAD.
-- Today everything typed after a claim appends to answer_md verbatim. The interview needs the
-- same typing to file a source instead. Stored state is what decides, exactly as it already
-- decides whether a bare digit is a claim or a sentence about the page.
--
-- Defaulting to 'body' is what makes this add-only: a thread that never types `ask` behaves
-- precisely as it does today.
alter table public.page_studio_sessions add column if not exists studio_mode text not null default 'body';
alter table public.page_studio_sessions add column if not exists evidence_topic text;

alter table public.page_studio_sessions drop constraint if exists page_studio_sessions_mode_check;
alter table public.page_studio_sessions add constraint page_studio_sessions_mode_check
  check (studio_mode in ('body', 'evidence'));

comment on column public.page_studio_sessions.studio_mode is
  'body = typed text appends to answer_md verbatim (the original behaviour). evidence = typed '
  'text files a page_sources row and answer_md is not touched.';

-- Sanity, after running:
--   select source_type, count(*), count(page_id) as page_scoped from public.page_sources group by 1;
--   select verdict, count(*) from public.page_gate_runs group by 1;
--   select studio_mode, count(*) from public.page_studio_sessions group by 1;
