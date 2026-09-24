-- The weekly self-review's one suggestion, so a second run on the same Thursday is silent.
--
-- Additive, idempotent, safe to run more than once.
-- Runner: bun run scripts/db.ts --file=docs/2026-09-26-code-suggestions.sql [--dry]
--
-- ‼️ SHAPED ON dataset_suggestions, AND FOR THE REASON runWeeklyCorpusScan GIVES: the unique index
-- makes a re-run file nothing, so a second Thursday run is silent BY CONSTRUCTION rather than by a
-- week stamp somebody has to remember to check. A weekly card that repeats itself stops being read
-- by week three, which is the same argument stepDigest's 48 hour filter rests on.
--
-- ‼️ IT PROPOSES. IT NEVER CHANGES CODE. Code Guardian is the only thing in this repo that may open
-- a pull request, and it does that from a failing workflow with a human in the loop. This posts one
-- message to #alerts-infra and stops.

create table if not exists public.code_suggestions (
  id            uuid primary key default gen_random_uuid(),

  -- ISO week, e.g. '2026-W39'. Text, so the unique index reads without a date function.
  iso_week      text not null,

  -- ‼️ THE CATEGORY IS REQUIRED, because Matthew asked for it by name: "each proposal I want to make
  -- sure it has the category of the fix and the bulletpoints of what needs to be fixed and why."
  -- No default: a proposal whose author could not say what KIND of fix it is has not been thought
  -- through, and 'simplify' as a fallback would quietly become the most common category.
  category      text not null check (category in (
    'simplify',         -- fewer moving parts for the same outcome
    'one-ui',           -- moves Mission Control closer to running the workflows from one page
    'data-collection',  -- captures something the system currently forgets
    'reliability',      -- a failure that is silent today
    'security',         -- an exposure
    'cost'              -- money spent for no decision
  )),

  title         text not null,
  -- What was observed, in numbers, from the system's own behaviour.
  observation   text not null,
  -- The bullets: what needs fixing and why, one per line.
  bullets       text[] not null default '{}',
  -- Paths it read, so the proposal can be checked against the code it is about.
  files         text[] not null default '{}',
  -- The ready prompt. It ends by requiring a preview, which is a rule, not a nicety.
  claude_prompt text not null,

  -- The numbers behind the observation, so next week can compare.
  evidence      jsonb not null default '{}'::jsonb,
  model         text,

  -- ‼️ THE DECISION IS RECORDED, AND THAT IS WHAT MAKES NEXT WEEK BETTER. A proposal nobody acted on
  -- and a proposal nobody saw look identical without this.
  status        text not null default 'open' check (status in ('open', 'accepted', 'rejected', 'done')),
  decided_at    timestamptz,
  decided_by    text,

  slack_ts      text,
  created_at    timestamptz not null default now()
);

-- ‼️ ONE PER WEEK, ENFORCED HERE RATHER THAN IN CODE. A cap in TypeScript is a cap somebody can
-- bypass by calling the function twice; a unique index is one the database keeps.
create unique index if not exists code_suggestions_one_a_week
  on public.code_suggestions (iso_week);

create index if not exists code_suggestions_recent
  on public.code_suggestions (created_at desc);

comment on table public.code_suggestions is
  'One proposal a week toward the north star: Mission Control running the workflows from one page. '
  'Carries a category and why-bullets. Proposes only; it never changes code.';

alter table public.code_suggestions enable row level security;

-- ── Verify. Expect ONE row. ────────────────────────────────────────────────
select table_name, count(*) as columns
from information_schema.columns
where table_schema = 'public' and table_name = 'code_suggestions'
group by table_name;

select iso_week, category, status, title from public.code_suggestions order by created_at desc limit 10;
