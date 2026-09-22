-- A borrowed avatar is a fourth way an audience gets its vocabulary, and it has to be able to say so.
--
-- WHAT BORROWING IS, AND WHY IT IS NOT A COPY.
-- question_bank and avatar_briefs are keyed (vertical, avatar_slug) with NO client_id, deliberately:
-- "the whole value is that the second med spa aiming at laser hair removal gets the first one's
-- research" (2026-08-25-lane-2-avatar.sql). So borrowing another client's avatar is not moving any
-- rows. It is inserting one client_audiences row carrying that slug, after which the shared research
-- follows by key and the per-client documents in audience_documents stay separate because they key
-- on audience_id. reuseAvatarResearch already re-ingests the text through the one extractor rather
-- than copying rows, and that stays the only door.
--
-- ‼️ WHY THE CONSTRAINT HAS TO WIDEN AT ALL, WHICH IS THE PART THAT IS EASY TO MISS.
-- seedClientAudience is the PRESET door: it needs an AUDIENCE_PRESETS key, and resolve() REFUSES a
-- row missing any of the six vocabulary nouns. An avatar borrowed out of a vertical that has no
-- preset would therefore produce a row that every reader refuses, which would look like the borrow
-- silently failing. The borrow path copies the nouns and the stance from the SOURCE audience row
-- instead, and this value records that it did. Copying vocabulary is not copying client data: the
-- nouns are what a buyer of that kind is called, which is the same in both clients' mouths.
--
-- ‼️ 'borrowed' IS NOT 'preset' AND MUST NOT BE FILED AS ONE. vocabulary_source is the provenance
-- of those six nouns, and it is the thing somebody reads when a card says "patients" about a client
-- who says "clients". A borrowed row whose nouns came from another client's audience is a weaker
-- claim than a preset, and flattening it to 'preset' would make it unauditable.

alter table public.client_audiences
  drop constraint if exists client_audiences_vocabulary_source_check;

alter table public.client_audiences
  add constraint client_audiences_vocabulary_source_check
  check (vocabulary_source is null
      or vocabulary_source in ('preset', 'legacy_default', 'typed', 'borrowed'));

comment on column public.client_audiences.vocabulary_source is
  'Where the six vocabulary nouns came from. ''preset'' is AUDIENCE_PRESETS, ''typed'' is a person, '
  '''legacy_default'' predates the presets, and ''borrowed'' means they were copied from another '
  'client''s audience for the same avatar slug when that avatar was borrowed. Borrowed is the '
  'weakest of the four and is kept distinct from preset on purpose: it is the one a person should '
  'check before a card tells a client what their own buyers are called.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Verification. Expect: accepts_borrowed = 1, and the existing rows unchanged.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
select 'accepts_borrowed' as check, count(*)::text as n
  from pg_constraint
  where conname = 'client_audiences_vocabulary_source_check'
    and pg_get_constraintdef(oid) like '%borrowed%'
union all select 'rows by source: ' || coalesce(vocabulary_source, 'null'), count(*)::text
  from public.client_audiences group by vocabulary_source;
