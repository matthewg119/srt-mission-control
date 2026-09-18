-- What a gate verdict actually read, beyond the body.
--
-- Run it through the runner, NOT the Supabase SQL editor:
--   bun run scripts/db.ts --file=docs/2026-09-22-gate-meta-hash.sql --dry
--   bun run scripts/db.ts --file=docs/2026-09-22-gate-meta-hash.sql
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ‼️ WHY A SECOND HASH RATHER THAN A WIDER body_hash.
--
-- body_hash covers answer_md ONLY. That is already a LIVE hole rather than a future one:
-- checkHouseStyle (src/lib/hub/page-gate.ts) reads `title` and `meta_description` today, so a
-- house-style pass does not go stale when the title changes. The compliance checks added
-- 2026-09-22 read both as well, because a claim about credentials is usually made in the title.
--
-- Widening body_hash would have fixed that by invalidating EVERY stored verdict at once, and would
-- then have told somebody whose title never moved that "the page changed since the check", which
-- is false in the one place this system is most careful about not being. Backfilling a widened
-- hash would be worse: it would claim old verdicts read text they never read.
--
-- ‼️ SO THIS COLUMN IS NULLABLE AND IS NOT BACKFILLED, DELIBERATELY. NULL means "this run predates
-- the metadata half". assertGatePassed does NOT refuse on a null, because such a run carries no
-- compliance check and makes no claim about the metadata: there is nothing about it to be wrong.
-- A run that DOES carry a hash is held to it. An absence and a failure are different facts, which
-- is doctrine 1 in docs/DATA-AND-WORKFLOWS.md.
--
-- No CHECK constraint and no NOT NULL: adding either would require a backfill, which is the exact
-- thing being refused above.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

alter table public.page_gate_runs add column if not exists meta_hash text;

comment on column public.page_gate_runs.meta_hash is
  'sha256 of the title, meta description and slug at run time, each whitespace-normalised and '
  'joined with a newline. NULL means the run predates the metadata checks and is NOT refused: '
  'those runs read none of these fields and claim nothing about them.';

-- Verify. Expect one row: meta_hash, text, YES.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'page_gate_runs'
  and column_name = 'meta_hash';
