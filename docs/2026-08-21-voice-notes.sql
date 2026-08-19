-- The client's own words, kept next to the audio they came from.
--
-- Safe to run more than once.
--
-- WHY THIS EXISTS. The twice-weekly content ask (src/lib/clients/content-digest.ts) tells a
-- client to answer by voice note, because a business owner between appointments will not
-- type three paragraphs and asking them to is how the rhythm goes quiet in week two. The
-- note is forwarded into that client's ops thread, where captureOnboardingFile already
-- files it like any other evidence. What was missing was anywhere to put the words.
--
-- ON client_docs RATHER THAN A NEW TABLE. A voice note IS a client doc: it has a filename,
-- a mimetype, bytes in the bucket and a thread it arrived on, and client_docs.source
-- already separates evidence that arrived from artefacts we generated. A separate table
-- would duplicate all of that to hold one column.
--
-- ‼️ THE AUDIO IS THE RECORD, THE TRANSCRIPT IS A CONVENIENCE. Transcription runs through
-- OPENAI_API_KEY, which has run out of credits before and took the audit engine down with
-- it. So this column is NULLABLE and stays null on a failure, the thread says plainly that
-- it failed and asks for a paste, and the page gets written from the audio either way. A
-- partial or invented transcript is never written. Same doctrine as the Loom transcript,
-- which has always been pasted rather than fetched.
alter table public.client_docs
  add column if not exists transcript text;

comment on column public.client_docs.transcript is
  'Verbatim transcription of an audio client_doc, written by src/lib/clients/voice-notes.ts. '
  'NULL means it was never transcribed or transcription failed, which are both normal states '
  'and neither means the note was empty. Never summarised: the owner''s own phrasing about '
  'their own trade is the entire reason to ask them rather than write it ourselves.';

-- Answers "which voice notes still need a transcript pasted", which is the one query this
-- column creates.
create index if not exists client_docs_untranscribed_idx
  on public.client_docs (client_id, uploaded_at desc)
  where transcript is null and content_type like 'audio/%';

-- ─────────────────────────────────────────────────────────────────────────────
-- What to expect
-- ─────────────────────────────────────────────────────────────────────────────
--
-- select count(*) from public.client_docs where transcript is not null;   -- 0 until the
--   first voice note is dropped into a client ops thread.
