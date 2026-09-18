-- A proposed new dataset field, and the observation that produced it.
--
-- Run it through the runner, NOT the Supabase SQL editor:
--   bun run scripts/db.ts --file=docs/2026-09-22-dataset-suggestions.sql --dry
--   bun run scripts/db.ts --file=docs/2026-09-22-dataset-suggestions.sql
--
-- Owed since the North Star build (docs/DATA-AND-WORKFLOWS.md, "C12a: dataset_suggestions, the one
-- SQL in the North Star build"). Nothing in src/ referenced it before 2026-09-22.
--
-- Matthew, 2026-09-22: "use the inteligence of the onboarding to always scan for new datasets
-- options in order to get smarter everyday".
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ‼️ A SUGGESTION, NOT A FIELD. src/lib/clients/dataset-spec.ts remains the ONLY authority on
-- which fields exist: 71 of them, each declaring what fills it and what needs it, and the rule
-- that file states is that "a field that matters is declared HERE or it does not exist as far as
-- the system is concerned". A row in this table is an ARGUMENT for adding one, carrying the count
-- it was argued from. A person promotes it by writing the FieldSpec. Nothing reads this table as
-- though it were declared, and nothing here ever fills a gap.
--
-- ‼️ D7, THE TOOL PROPOSES AND A PERSON CONFIRMS. This is why `status` exists and why there is no
-- path that sets it to 'accepted' automatically.
--
-- ‼️ client_id IS NULLABLE AND ITS ABSENCE IS THE ENFORCEMENT. A NULL means the observation is
-- about a VERTICAL or a SHAPE rather than about one client. The cross-client doctrine gathered
-- across roughly twenty comments in this repo: sharing is legitimate when the unit is a fact about
-- a vertical, an avatar, a domain or a public URL, and it is forbidden when the unit is a
-- measurement about one client. A per-client measurement must never be written into a shared
-- argument, because with no per-client key a wrong write there is not correctable.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

create table if not exists public.dataset_suggestions (
  id             uuid primary key default gen_random_uuid(),

  -- What would be declared in dataset-spec.ts if somebody accepted this.
  proposed_key   text not null,
  label          text not null,
  dataset        text not null check (dataset in ('avatar', 'audience', 'offer')),

  -- ‼️ WHAT WAS COUNTED. D9: a suggestion either names the rows it counted or says the thing is
  -- not measured. It never splits the difference. This column is that sentence.
  basis          text not null,
  observed_count integer,

  -- NULL means the observation is about the vertical or the shape, not about one client.
  client_id      uuid references public.clients (id) on delete cascade,
  vertical_slug  text,
  post_format    text,

  status         text not null default 'open' check (status in ('open', 'accepted', 'declined')),
  decided_at     timestamptz,
  decided_by     text,
  created_at     timestamptz not null default now()
);

-- ‼️ ONE OPEN SUGGESTION PER PROPOSED KEY. The weekly scan re-derives its arguments from the same
-- corpus every Thursday, so without this the same proposal would be filed again every week and the
-- card would become a list of duplicates by week three. A DECLINED one does not block a later
-- re-proposal, which is correct: the corpus may have changed the argument.
create unique index if not exists dataset_suggestions_open_key_idx
  on public.dataset_suggestions (proposed_key) where status = 'open';

create index if not exists dataset_suggestions_open_idx
  on public.dataset_suggestions (created_at desc) where status = 'open';

alter table public.dataset_suggestions enable row level security;

comment on table public.dataset_suggestions is
  'Proposed dataset fields, argued from a row count. src/lib/clients/dataset-spec.ts remains the '
  'only authority on which fields exist; a row here is an argument, never a declaration.';

comment on column public.dataset_suggestions.basis is
  'What was counted, in words. A suggestion with no basis is an opinion.';

comment on column public.dataset_suggestions.client_id is
  'NULL means the observation is about a vertical or a shape rather than one client. A per-client '
  'measurement must never be written into a shared argument.';

-- Verify. Expect one row, with 13 columns.
select table_name, count(*) as cols
from information_schema.columns
where table_schema = 'public' and table_name = 'dataset_suggestions'
group by table_name;
