-- 2026-10-09: the Dallas circle is 1,990, not 1,765, and the radius in the last file was invented.
--
--   bun run scripts/db.ts --file=docs/2026-10-09-dallas-circle-correction.sql --dry
--   bun run scripts/db.ts --file=docs/2026-10-09-dallas-circle-correction.sql
--
-- Additive, idempotent, safe to run more than once.
--
-- ‼️ TWO MISTAKES, ONE OF THEM MINE AND ONE OF THEM THE WORLD'S.
--
-- Mine: docs/2026-10-08-territory-rollups.sql transcribed the Dallas total as 1,765 and described
-- the circle as "within 40km". There is no 40km anywhere. MAPS_RADIUS_KM_DEFAULT is 30 and the
-- original command (`pull maps medspa | Dallas TX | med spa | limit 500`) named no radius, so it
-- was always a 30km circle. The number was right for its day; the radius beside it was invented,
-- which is worse than leaving it out, because it makes two readings of the SAME circle look like
-- readings of two different ones.
--
-- The world's: DataForSEO's index is LIVE. The same 30km circle and the same five categories read
-- 1,765 on 2026-09-28 and 1,990 on 2026-10-08, reported identically on all four chunk cards. It
-- grew by 225 businesses in ten days, which is 12.7%.
--
-- ‼️ THIS IS WHY THE COLUMN IS RAISED BY max() AND NEVER ASSIGNED. The same rule scraper_cells
-- already states: follow an upward drift so no row is lost, and never write a downward one, because
-- that would make a finished metro look unfinished and buy it again. Once the merged code is live
-- every pull re-measures the circle for free and this file never needs a sibling.
--
-- ‼️ AND IT CHANGES A PLANNING NUMBER BY A LOT, WHICH IS THE POINT OF CORRECTING IT RATHER THAN
-- LETTING THE NEXT PULL FIX IT QUIETLY:
--
--     circle          1,990
--     pulled          1,750   (550 + 4 x 300)
--     LEFT IN DALLAS    240   not the 1,215 the page said this morning
--
-- One more 300-row chunk at offset 1750 finishes the metro. The plan view was about to send
-- somebody to buy four.

-- ‼️ `greatest(...)` RATHER THAN A PLAIN ASSIGNMENT, so running this after a later, larger reading
-- has landed cannot lower it. The literal is a transcription from a card; a value the pipeline
-- measured itself always wins.
update public.list_pipeline_runs
set metro_total_count = greatest(coalesce(metro_total_count, 0), 1990)
where id in (
  -- The two 2026-09-28 runs, already carrying the stale 1,765.
  'c74a895d-4ea0-4d1b-9904-33fb4ace00b4',
  '9f9302c1-2223-4f3a-ae74-24462d2bdd6f',
  -- The four 2026-10-08 chunks, which carry nothing: they ran on `main`, which has no
  -- metro_total_count write at all. Each of their cards reported 1990 for this circle.
  'c3eb8520-6812-44db-b829-79b761588bb9',
  'c8fc8ffa-3229-4c4f-8684-c0d0a677c610',
  '3ac004f6-fa3f-4bf2-b373-b169536d9cb5',
  'faec76a1-5e20-469e-8d36-9d9aac298cb0'
);

-- Verification. `remaining` is what the territory table will now show for Dallas.
select
  max(r.metro_total_count) as circle,
  (select count(*) from public.raw_leads where source_metro = 'Dallas TX') as pulled,
  max(r.metro_total_count) - (select count(*) from public.raw_leads where source_metro = 'Dallas TX')
    as remaining
from public.list_pipeline_runs r
where r.metro_total_count is not null;
