-- The owner lane stops assuming SRT is the seller.
--
-- ownerPrompt() in src/lib/concierge/tools.ts hardcoded a paragraph beginning "WHAT SRT DOES", so
-- an owner-stance widget could only ever be run by SRT: a client selling their own product got a
-- bot that described somebody else's business as its own. The sentence moves onto the audience row,
-- which is what makes "a sales bot for the client's own product" a data change rather than a code
-- change. This is the same move client_audiences already made for the nouns and the hard lines on
-- 2026-09-14.
--
-- ‼️ SECTION 2 IS NOT OPTIONAL AND MUST RUN WITH SECTION 1. The column is nullable, a null omits
-- the paragraph, and SRT's own audience row already exists. Adding the column without the backfill
-- would deploy a live owner concierge that has been told to say NOTHING about what SRT does, which
-- is a silent regression on the one lane that is actually running.

-- ---------------------------------------------------------------------------------------------
-- 1. The column.
--
--    Nullable with no default, on purpose and for the fifth time in this codebase's history: a
--    default here would be a sentence about SRT appearing under somebody else's name. Null means
--    nobody has written this down, and ownerPrompt turns that into "say nothing about the seller"
--    rather than into a guess.
-- ---------------------------------------------------------------------------------------------
alter table public.client_audiences add column if not exists owner_pitch text;

comment on column public.client_audiences.owner_pitch is
  'What the SELLER does, one sentence, for a stance=owner audience only. The prompt frames it as '
  '"the whole of what you may say about it", so it is a boundary as much as a pitch: anything '
  'absent from it is something the bot must not volunteer. NULL is a real answer and omits the '
  'paragraph entirely. Null on every patient-stance row, which has no third party to describe.';

-- ---------------------------------------------------------------------------------------------
-- 2. Backfill the rows that were seeded from the agency preset, with the exact words that were
--    previously compiled into ownerPrompt. Same sentence, so the live lane is unchanged by this
--    deploy.
--
--    Scoped on seeded_from AND stance, not on stance alone: a future owner-stance audience for a
--    different seller must NOT inherit SRT's pitch, which is the entire defect being fixed here.
-- ---------------------------------------------------------------------------------------------
update public.client_audiences
set owner_pitch = 'we measure what AI engines like ChatGPT say when somebody asks for a business like theirs, and we do the work that gets them named',
    updated_at = now()
where stance = 'owner'
  and seeded_from = 'aeo_agency_owner'
  and owner_pitch is null;

-- ---------------------------------------------------------------------------------------------
-- Verification. Plain counts, so nothing here can roll the migration back.
--
-- Expect: owner_pitch_column = 1, and owner_rows_without_pitch = 0. A non-zero second row means
-- some owner audience will serve a widget that cannot describe its own seller. That is legitimate
-- for a seller nobody has written a pitch for yet, but it should be a deliberate answer rather
-- than a surprise, so check WHICH row it is before ignoring it.
-- ---------------------------------------------------------------------------------------------
select 'owner_pitch_column' as check, count(*)::text as n
  from information_schema.columns
  where table_schema = 'public' and table_name = 'client_audiences' and column_name = 'owner_pitch'
union all select 'owner_rows_without_pitch', count(*)::text
  from public.client_audiences where stance = 'owner' and owner_pitch is null
union all select 'owner_rows_total', count(*)::text
  from public.client_audiences where stance = 'owner';
