-- 2026-09-15: a client can be archived and re-onboarded from its archive
--
-- Matthew, 2026-09-15: "delete the whole onboarding ... create a copy of it with all of the stuff that we
-- have from offer etc and when we do the onboarding give it the option of Import data from Duplicate (this
-- is a warning that must appear to avoid onboarding duplicates) if someone cancels and we sell them again we
-- need to reonboard but we will already have most of the data so is more of a reactivation".
--
-- ‼️ ONE ROW PER ARCHIVED CLIENT, THE WHOLE CLIENT IN ONE SNAPSHOT. Every table with a client_id is copied
-- into `snapshot` before the client row is deleted, so the delete loses nothing: the audits, fanout runs and
-- signings that survive with client_id nulled are relinked on import from the ids kept here.
--
-- ‼️ NO FOREIGN KEY ON source_client_id. The client it points at is deleted right after the archive is
-- written, which is the point of the archive.
--
-- Runner: bun run scripts/db.ts --file=docs/2026-09-15-client-archives.sql

create table if not exists public.client_archives (
  id                        uuid primary key default gen_random_uuid(),
  source_client_id          uuid not null,
  slug                      text not null,

  -- Identity, copied out of the snapshot so the duplicate check can match without reading jsonb.
  legal_name                text,
  dba_name                  text,
  domain                    text,
  website                   text,
  email                     text,
  phone                     text,
  contact_id                uuid,
  -- legal or public name, lowercased, punctuation and LLC/Inc/Co removed ("srt agency").
  name_key                  text,

  -- { version, client: {...}, tables: { <table>: [rows] }, files: [{ docId, filename, text }], errors }
  snapshot                  jsonb not null,
  row_counts                jsonb not null default '{}'::jsonb,

  reason                    text,
  archived_by               text,
  archived_at               timestamptz not null default now(),

  -- Set once the archive has been imported into a new onboarding. An imported archive stops matching.
  imported_into_client_id   uuid references public.clients (id) on delete set null,
  imported_at               timestamptz,
  imported_by               text
);

create index if not exists client_archives_domain on public.client_archives (domain) where domain is not null;
create index if not exists client_archives_email on public.client_archives (lower(email)) where email is not null;
create index if not exists client_archives_name_key on public.client_archives (name_key) where name_key is not null;

alter table public.client_archives enable row level security;

comment on table public.client_archives is
  'A deleted client, whole: every row of every client_id table at the moment it was archived, plus the text '
  'of its uploaded documents. Starting an onboarding that matches one (domain, email, phone or name) warns '
  'and offers "Import data from duplicate", which restores the client''s knowledge (intake, audiences, the '
  'offer as a proposal, the framework documents, evidence) into the new client. src/lib/clients/archive.ts.';

-- VERIFICATION: expect the table, empty.
select to_regclass('public.client_archives') as client_archives,
       (select count(*) from public.client_archives) as rows;
