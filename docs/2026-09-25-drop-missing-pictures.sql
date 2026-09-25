-- Drop keyword_clusters.missing_pictures: a cache nothing ever read.
--
-- Requires docs/2026-09-26-keyword-strategy.sql to have run first (it is the file that added it).
-- Idempotent, safe to run more than once.
-- Runner: bun run scripts/db.ts --file=docs/2026-09-25-drop-missing-pictures.sql [--dry]
--
-- ‼️ WHY DROP RATHER THAN WIRE. Its own comment called it "a CACHE for the card only", and the card
-- never read it. Three things are true of it at once:
--
--   1. It was written on INSERT and never updated, so it was stale the moment a screenshot landed.
--   2. persistClusters deletes and re-inserts the proposed/derived rows anyway, so even the insert
--      value described a moment that had already passed.
--   3. gateClusters() in keyword-strategy-rules.ts recomputes the number honestly on every call, and
--      the card already prints that live count.
--
-- ‼️ THE PRECEDENT IS THIS LANE'S OWN. scripts/_probe-serp-gate.ts asserts "the device column is gone
-- rather than always null", on the stated grounds that "a dead column that looks like provenance is
-- worse than no column". missing_pictures is the same object: a number that looks like a measurement
-- and is nobody's measurement. The shape of this migration follows
-- docs/2026-08-07-medspa-stripe.sql, which drops a column on the same reasoning: safe unconditionally,
-- because its only writer is gone.
--
-- ‼️ SAFE UNCONDITIONALLY. Its only writer was persistClusters in src/lib/clients/keyword-strategy.ts
-- and that line is removed in the same commit as this file. Nothing selects it: verified by
-- scripts/_probe-dead-wires.ts, which fails if any column in avatar_briefs, client_audiences or
-- keyword_clusters is written and never read.
--
-- NOTHING IS LOST THAT WAS EVER TRUSTED. The column holds a count of keywords that were owed a
-- picture at the moment a cluster row was inserted. serp-gate.ts has always re-read
-- keyword_serp_reads before refusing anything, so no decision has ever been made from this value.

alter table public.keyword_clusters drop column if exists missing_pictures;

-- ── Verify. Expect ZERO rows. One row means the drop did not apply. ─────────
select table_name || '.' || column_name as col
from information_schema.columns
where table_schema = 'public'
  and table_name = 'keyword_clusters'
  and column_name = 'missing_pictures';

-- ── And the columns that STAY are still there. Expect THREE rows. ───────────
-- A drop migration that took a neighbour with it is the failure worth checking for, and the three
-- below are the ones the card and the gate actually read.
select table_name || '.' || column_name as col, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'keyword_clusters'
  and column_name in ('label', 'card_ts', 'origin')
order by col;
