-- Where this audience's emotional language last came from, and when somebody last confirmed it.
--
-- Run it through the runner, NOT the Supabase SQL editor:
--   bun run scripts/db.ts --file=docs/2026-09-21-emotional-layer.sql --dry
--   bun run scripts/db.ts --file=docs/2026-09-21-emotional-layer.sql
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ‼️ NOTHING IS ADDED TO question_bank, AND THAT IS THE WHOLE SHAPE OF THIS MIGRATION.
-- It has no client_id, four migration comments defend that, and it is shared by every client in a
-- vertical for ever. A per-client column there would be read by every future client in that
-- vertical, and with no per-client key a wrong write is NOT CORRECTABLE. So the record of what a
-- particular client's emotional layer rests on goes on client_audiences, which is per-client by
-- construction.
--
-- ‼️ NO COUNT IS STORED, DELIBERATELY. emotionalLayer() derives the number from three tiers at read
-- time. The same reasoning presence_score gives for having no column: there is nowhere for a stored
-- number to drift away from the rows it claims to summarise. These two columns record an EVENT
-- (somebody filled this, on this date), which derivation cannot recover.
--
-- ‼️ AND THEY HAVE A REAL WRITER. ingestEmotional() stamps both on every accepted `emotional:`
-- paste. A column with no writer is the "reader with no writer" bug this repo records five other
-- instances of, and adding one here to satisfy a prompt would have been a sixth.
--
-- WHAT EACH VALUE MEANS, and why 'preset' is not the same as NULL:
--   research   a deep-research answer filled it
--   pasted     somebody typed `emotional:` with the buyer's own phrases
--   reviews    it came from this client's own CUSTOMER_REVIEW rows
--   preset     the vertical's inherited bank, never confirmed for this client
--   NULL       nobody has ever looked, which is a different fact from 'preset'
-- ─────────────────────────────────────────────────────────────────────────────────────────────

alter table public.client_audiences
  add column if not exists emotional_source text;

alter table public.client_audiences
  drop constraint if exists client_audiences_emotional_source_check;

alter table public.client_audiences
  add constraint client_audiences_emotional_source_check
  check (emotional_source is null or emotional_source in ('research', 'pasted', 'reviews', 'preset'));

alter table public.client_audiences
  add column if not exists emotional_checked_at timestamptz;

comment on column public.client_audiences.emotional_source is
  'Where this audience''s objection phrases last came from. NULL means nobody has ever looked, '
  'which is a different fact from ''preset'' (the vertical''s inherited bank, never confirmed). '
  'No count is stored: emotionalLayer() derives it from three tiers at read time.';

comment on column public.client_audiences.emotional_checked_at is
  'When the emotional layer was last filled or confirmed for this audience. Written by '
  'ingestEmotional() on an accepted `emotional:` paste.';

-- Verify. Expect two rows.
select table_name || '.' || column_name as col, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'client_audiences'
  and column_name in ('emotional_source', 'emotional_checked_at')
order by col;
