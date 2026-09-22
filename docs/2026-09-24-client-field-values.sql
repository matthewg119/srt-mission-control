-- W0: where a research answer lives once a person has confirmed it.
--
-- ‼️ THIS IS THE DECISION W0 TURNS ON, AND IT IS MADE HERE BEFORE ANY OF IT IS BUILT.
--
-- Today there is no per-field storage for research answers at all. The document IS the storage,
-- and `present()` for a research field resolves to sectionAnswered() in avatar-profile.ts:169:
--
--     const body = section.body.replace(/could not verify\.?/gi, "").replace(/\s+/g, " ").trim();
--     return body.length >= SECTION_MIN_CHARS;   // 150
--
-- A field is "present" when 150 characters sit under its heading. Nothing extracts a value and
-- nothing stores one. Measured on srt-agency-llc: a 16,272 character research document, parsed to
-- {"answered": 9}, and zero field values anywhere in the system. The completeness card can report
-- `fears` as filled while nobody, human or machine, can say what the fears are.
--
-- ‼️ NOT 43 COLUMNS ON A TABLE. dataset-spec.ts is a REGISTRY and it stays the only authority on
-- which fields exist. A column per field would make adding a field a migration, which is exactly
-- the coupling dataset_suggestions was built on 2026-09-22 to avoid.
--
-- ‼️ APPEND ONLY. A value is never updated in place: a new confirmation supersedes the old row and
-- both stay. Two reasons, and the second is the one that matters. First, "what did we believe about
-- this client's fears in October" is a question somebody will ask the day a page argues from it.
-- Second, an UPDATE would silently rewrite the provenance: the section number and the document id
-- on the row would then describe a paste that is not where the current value came from, and there
-- would be no way to tell from the row that this had happened.

create table if not exists public.client_field_values (
  id uuid primary key default gen_random_uuid(),

  client_id uuid not null references public.clients (id) on delete cascade,

  -- ‼️ NULLABLE, AND PART OF THE KEY. Most fields belong to an audience, because the avatar and
  -- offer datasets are per audience and a client may have several. A few (compliance, market) are
  -- facts about the client whichever buyer is in front of them. A null here means "this client,
  -- any audience", and the unique index below treats two nulls as the SAME key rather than as two
  -- distinct ones, which is what stops a second null-audience row for the same field.
  audience_id uuid references public.client_audiences (id) on delete cascade,

  dataset text not null check (dataset in ('avatar', 'audience', 'offer')),

  -- ‼️ NOT A FOREIGN KEY, AND NOT A CHECK CONSTRAINT EITHER. The set of legal field_keys lives in
  -- DATASET_FIELDS in dataset-spec.ts. Mirroring it here would be a second list that drifts, and
  -- the drift would be discovered as a failed insert on the day somebody adds a field. The
  -- registry refuses an unknown key before the write; the database stores what it is given.
  field_key text not null,

  value text not null,

  -- ── Provenance. Every one of these answers "why do we believe this". ──────────────────────
  --
  -- ‼️ THE SECTION NUMBER IS THE KEY THE ASKER USED, not a position in the file. buildGapPrompt
  -- keeps each section's ORIGINAL number precisely because a subset renumbered from 1 files
  -- section twelve's answer under section one, silently and permanently. The twenty-page prompt
  -- replaces the per-batch one (decided 2026-09-21), so there is only ever one numbering scheme
  -- in play, and a round-trip probe proves the parser maps to the same key the asker used.
  source_document_id uuid references public.audience_documents (id) on delete set null,
  source_section integer,

  -- What the extraction thought before a person looked. Kept for the argument, never for the gate:
  -- a stored row is confirmed by definition, because a low-confidence extraction is shown as a
  -- QUESTION and never as a proposed value.
  extracted_confidence text check (extracted_confidence in ('high', 'medium', 'low')),

  origin text not null default 'extraction' check (origin in ('extraction', 'manual')),

  -- ── The confirmation, which is the thing that makes the row exist at all. ─────────────────
  --
  -- ‼️ NOT NULLABLE. There is no such thing as an unconfirmed value in this table. An absence and
  -- a guess are different facts, and this is the one place the whole system could be poisoned in a
  -- single paste: a field filled with a plausible invention is worse than an empty one, because
  -- every later page argues from it and nothing downstream can tell it was never really answered.
  confirmed_by text not null,
  confirmed_at timestamptz not null default now(),

  superseded_at timestamptz,
  superseded_by uuid references public.client_field_values (id) on delete set null,

  created_at timestamptz not null default now(),

  -- A superseded row must say what replaced it, and a live row must not claim a replacement.
  constraint client_field_values_supersede_pair
    check ((superseded_at is null) = (superseded_by is null))
);

-- ‼️ ONE LIVE VALUE PER FIELD, ENFORCED BY THE DATABASE RATHER THAN BY THE WRITER.
--
-- NULLS NOT DISTINCT is load-bearing and is why this needs PG15 or later (production is 17.6,
-- checked 2026-09-21). Without it two rows with a null audience_id would both be legal, because
-- Postgres treats nulls as distinct in a unique index by default, and "this client, any audience"
-- would silently become a list.
create unique index if not exists client_field_values_live_idx
  on public.client_field_values (client_id, audience_id, field_key)
  nulls not distinct
  where superseded_at is null;

-- The read path: every live value for a client, which is what present() and the completeness card
-- both want. Ordered by field_key so a card renders the same way twice.
create index if not exists client_field_values_client_idx
  on public.client_field_values (client_id, field_key)
  where superseded_at is null;

-- The history path: "what did this field say before", and the audit of one paste.
create index if not exists client_field_values_doc_idx
  on public.client_field_values (source_document_id)
  where source_document_id is not null;

alter table public.client_field_values enable row level security;

comment on table public.client_field_values is
  'One confirmed value per dataset field per client audience, extracted from research and then '
  'CONFIRMED by a person. Append only: a new confirmation supersedes rather than updates, so the '
  'provenance on a row always describes the paste that value actually came from. '
  'src/lib/clients/dataset-spec.ts remains the only authority on which field_keys exist.';

comment on column public.client_field_values.audience_id is
  'NULL means the value is true of the client whichever buyer is in front of them (compliance, '
  'market). The live unique index uses NULLS NOT DISTINCT so two nulls are the same key. '
  'NOTHING PRODUCES NULL YET, as of 2026-09-22: no FieldSpec in dataset-spec.ts marks a field '
  'client-wide, and the one writer (commit_field_values, via field-values.ts) always passes the '
  'primary audience. So the NULLS NOT DISTINCT half of client_field_values_live_idx and the '
  'audienceId === null arm of dataset-completeness.ts describe a case that cannot yet arise. '
  'Both are correct and both are unexercised. Do not delete either to tidy up: the alternative '
  'is discovering, on the first client-wide field, that two nulls were separate keys all along.';

comment on column public.client_field_values.source_section is
  'The section number THE ASKER USED, not a position in the file. A subset renumbered from 1 '
  'files section twelve under section one, silently and permanently.';

comment on column public.client_field_values.confirmed_by is
  'Never null. There is no unconfirmed value in this table: a low-confidence extraction is shown '
  'as a question on the proposal card and is never written as a value.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Verification. Plain counts, so nothing here can roll the migration back.
-- Expect: table = 1, live_idx = 1, client_idx = 1, doc_idx = 1, rows = 0.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
select 'table' as check, count(*)::text as n
  from information_schema.tables
  where table_schema = 'public' and table_name = 'client_field_values'
union all select 'live_idx', count(*)::text from pg_indexes
  where schemaname = 'public' and indexname = 'client_field_values_live_idx'
union all select 'client_idx', count(*)::text from pg_indexes
  where schemaname = 'public' and indexname = 'client_field_values_client_idx'
union all select 'doc_idx', count(*)::text from pg_indexes
  where schemaname = 'public' and indexname = 'client_field_values_doc_idx'
union all select 'rows', count(*)::text from public.client_field_values;
