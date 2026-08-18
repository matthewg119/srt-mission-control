-- A2 D-P14 and D-P16: keep the audit's numbers away from the photographs'.
--
-- Safe to run more than once.
--
-- WHY THIS EXISTS. The audit bot and the onboarding runner describe the same business at two
-- different moments, with different questions and a different engine count. A2 §3: "Left
-- unjoined they duplicate work; joined carelessly they contaminate the case study."
--
-- ‼️ THE CONTAMINATION IS THE POINT, NOT THE JOIN. Integrity Laws 3 and 6 require sample
-- sizes stated and confounds disclosed. A single-engine run on a generated question set,
-- sitting next to a four-engine photograph on the same scorecard, is an undisclosed confound
-- in the one artifact that cannot afford one.
--
-- WHAT WAS ALREADY HERE, and why this is three columns rather than a new table:
-- audit_runs already stores the row-level facts A2 calls ai_baseline —
--   prompt      the question text AS RUN (v2.sql:37)
--   citations   the cited sources    (v2.sql:42)
--   recommended who was named instead (v2.sql:43)
--   engine, mentioned, status
-- What it cannot say is WHAT KIND OF RUN it was, which is the only thing the separation
-- needs. So: a label, and an explicit exclusion flag.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. What kind of run is this
-- ─────────────────────────────────────────────────────────────────────────────
--
--   prospect_audit  the bot's one-engine run on generated prompts. A PROSPECTING ASSET.
--                   Context only: "the audit you already saw" in findings §1, and nothing
--                   more. Never a baseline, never on a scorecard, never in a re-test, never
--                   in a case study, never combined with a photograph.
--   test_run        an internal run against a test tenant. Runner v3 §18 relabels the SRT
--                   test tenant's one-engine step-2 run to this.
--   photograph_1    the real baseline. universal_v1 across every keyed engine of the four.
--   photograph_2    Day 0. universal_v1 + custom_v1.
--   retest_30 / 60 / 90
--
-- DEFAULT 'prospect_audit' is deliberate and is the safe direction: every row that exists
-- today IS a prospect audit, and a row whose kind nobody set should be excluded from the
-- numbers rather than silently counted in them.
alter table public.audit_reports
  add column if not exists run_label text not null default 'prospect_audit';

alter table public.audit_reports
  drop constraint if exists audit_reports_run_label_check;
alter table public.audit_reports
  add constraint audit_reports_run_label_check
  check (run_label in (
    'prospect_audit', 'test_run', 'photograph_1', 'photograph_2',
    'retest_30', 'retest_60', 'retest_90'
  ));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. The exclusion, enforced rather than remembered
-- ─────────────────────────────────────────────────────────────────────────────
--
-- A2 §3: excluded_from_scorecard is "enforced in the scorecard query, not by convention".
-- A convention is a thing somebody has to know; a column is a thing a query has to mention.
--
-- Every existing row is a prospect audit, so every existing row is excluded. That is not a
-- loss: none of them was ever a baseline.
alter table public.audit_reports
  add column if not exists excluded_from_scorecard boolean not null default true;

update public.audit_reports
   set excluded_from_scorecard = (run_label in ('prospect_audit', 'test_run'));

comment on column public.audit_reports.excluded_from_scorecard is
  'A2 D-P14. TRUE for prospect_audit and test_run. Enforced in the scorecard query, never by '
  'convention. If you find a join that lets an excluded row into a scorecard, re-test or '
  'case study, that is a build stop.';

-- Which engines actually ran, so the fidelity footer can print N x M honestly. Today M is 1:
-- AuditEngine = "openai", Perplexity was dropped 2026-08-05, and there is no Gemini client.
alter table public.audit_reports
  add column if not exists engines text[] not null default array['chatgpt_web'];

comment on column public.audit_reports.engines is
  'A2 D-P16. What ACTUALLY ran, for the "N questions x M engines" fidelity footer. M is the '
  'number that ran, never the number the offer names.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. The bridge, on the join that already exists
-- ─────────────────────────────────────────────────────────────────────────────
--
-- A2 D-P14 matches "on place_id, else domain, else normalized NAP". In this repo place_id
-- exists only on the scrape tables, and audit_reports already carries contact_id while
-- clients carries contact_id and domain. So the join is contact_id first, domain second —
-- which the client board is ALREADY doing to surface a client's audit prompts.
--
-- This makes the link explicit rather than recomputed, so "which audit belongs to this
-- client" has one answer instead of one per query.
alter table public.clients
  add column if not exists audit_report_id uuid references public.audit_reports(id) on delete set null;

create index if not exists clients_audit_report_idx on public.clients (audit_report_id);

comment on column public.clients.audit_report_id is
  'The prospect audit this client came from, if any. Its numbers NEVER appear next to a '
  'photograph — it is excluded_from_scorecard. Findings §1 may say "the audit you already '
  'saw" and nothing more.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Question set versions, as rows rather than a code constant
-- ─────────────────────────────────────────────────────────────────────────────
--
-- A2 §6: universal_v1@med_spa and materialization_v1 "recorded as frozen entries in whatever
-- table v4 already uses for question_set_version; if none exists, add one — DO NOT STORE THEM
-- AS A CODE CONSTANT ONLY."
--
-- The reason is the whole reason the pilot exists. Two years from now, defending a case study
-- means showing the exact question text that ran. A constant in a file that has been edited
-- forty times since cannot do that; a frozen row can.
create table if not exists public.question_set_versions (
  version      text        primary key,
  vertical     text        not null,
  questions    jsonb       not null,
  -- The substitution table that turns the printed question into the one that runs.
  -- Versioned separately: changing a substitution rule is materialization_v2 and starts a
  -- new baseline for every question it touches. It is not a tidy-up.
  materialization text     not null default 'materialization_v1',
  frozen_at    timestamptz not null default now(),
  note         text
);

alter table public.question_set_versions enable row level security;

comment on table public.question_set_versions is
  'Frozen question sets. A row here is never edited in place — a change is a new version and '
  'a new baseline. universal_v1@med_spa is the 20 Questions PDF verbatim (A2 D-P15); the '
  'fallback list in docs/specs/SRT-Question-Sets-v1.md is RETIRED and must not seed anything.';

-- ─────────────────────────────────────────────────────────────────────────────
-- What to expect
-- ─────────────────────────────────────────────────────────────────────────────
--
-- select run_label, excluded_from_scorecard, count(*)
--   from public.audit_reports group by 1, 2 order by 3 desc;
-- Everything should be prospect_audit / true today. That is correct: no photograph has ever
-- been taken, because one engine is keyed and A2 D-P16 says a one-engine run is never a
-- photograph for a paying or pilot client.
