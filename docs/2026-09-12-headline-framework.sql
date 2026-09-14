-- 2026-09-12 — clients.headline_framework: the per-client direct-response headline generator
--
-- Matthew, 2026-09-12: "whenever I get a new client I need to attach the direct response
-- generator for that specific customer / avatar so ideally while we systemize this we can add a
-- step (the one where we do the deep research) ask me to attach the documents for the direct
-- response headline generator so each headline has an emotional delta and is made specifically
-- to attract the click and to be quoted."
--
-- ‼️ A COLUMN ON clients, NOT A ROW ON verticals. The generator he attached is written for ONE
-- avatar ("the one I'm going to attach is ONLY for AEO Services for med spas"). verticals already
-- carries the shared per-avatar material (voc_quotes, approved_numbers) and two clients in the
-- same vertical legitimately share that. A generator is a client's own brief and must not become
-- every other client's the moment a second med spa signs.
--
-- ‼️ THE TEXT IS STORED, NOT JUST THE FILE. The document lands in client_docs like every other
-- upload, but a prompt cannot read a storage ref: it needs the words. So the extracted text lives
-- here and the doc id points back at what it was extracted from, for the case where somebody asks
-- which PDF this came from.
--
-- Add-only. Safe to re-run.
-- Runner: bun run scripts/db.ts --file=docs/2026-09-12-headline-framework.sql [--dry]

alter table public.clients
  add column if not exists headline_framework text;

alter table public.clients
  add column if not exists headline_framework_doc_id uuid references public.client_docs (id) on delete set null;

comment on column public.clients.headline_framework is
  'Extracted text of the direct-response headline generator attached for THIS client''s avatar, '
  'dropped into the avatar_harvest thread. Sits ABOVE the AEO engine in the prompt and wins where '
  'the two disagree, but never overrides the query shape or the ban on outcome promises, which '
  'apply to every page on every client. Null means generate from src/data/reel/aeo-headline-engine.ts '
  'alone, which is the seeded med spa default.';

comment on column public.clients.headline_framework_doc_id is
  'The client_docs row headline_framework was extracted from, so the source PDF is traceable.';
