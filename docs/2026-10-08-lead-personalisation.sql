-- 2026-10-08: four facts we already paid for, lifted out of the blob and into columns.
--
--   bun run scripts/db.ts --file=docs/2026-10-08-lead-personalisation.sql --dry
--   bun run scripts/db.ts --file=docs/2026-10-08-lead-personalisation.sql
--
-- Additive, idempotent, safe to run more than once. Nothing here narrows an existing check.
--
-- ‼️ NONE OF THIS IS NEW DATA. Every value below is already inside raw_leads.raw on all 550 stored
-- rows, bought and paid for on 2026-09-28, and never read by anything. DataForSEO returns 37 fields
-- per row and the mapper lifted 11 of them. This lifts four more: the ones that write an opening
-- line and the ones that put a business on a map.
--
--   is_claimed         429 true, 71 false on the Dallas 500. An unclaimed Google listing is the
--                      strongest "nobody is managing this" signal in the whole payload.
--   latitude/longitude present on all 500. Dallas spans 32.51 to 33.04 N, -97.12 to -96.52 W.
--                      Real dots on a real map, from data already in hand.
--   competitor_*       the highest-reviewed entry of `people_also_search`, which carries about five
--                      nearby competitors with title and rating. This is the "you have 23 reviews,
--                      the clinic down the road has 310" line, free, with no extra research.
--
-- ‼️ WHY COLUMNS RATHER THAN READING raw AT USE TIME. Two reasons, and the second is the real one.
-- A jsonb path cannot be indexed usefully for "every lead inside this bounding box", so the map
-- would table-scan. And a value read out of the blob at every call site is a parse rule copied to
-- every call site: the mapper in src/lib/scraper/pull.ts is the one place allowed to decide what
-- `is_claimed` means, exactly as it already decides what `review_count` means.
--
-- ‼️ WHY THREE FLAT COMPETITOR COLUMNS AND NOT ONE jsonb. The consumer is a prompt and a table
-- cell, both of which want "name, rating, reviews" and neither of which wants to destructure. A
-- jsonb column would also re-open the question this migration is closing: who parses it.
--
-- ‼️ AND THERE IS NO permanently_closed COLUMN, DELIBERATELY. Measured over the Dallas 500: exactly
-- 1 row mentions "permanently closed" anywhere in its raw blob. It is not a field and it is not a
-- flag, so a column for it would be 549 nulls that read as "open". Do not build a rule on it.


-- =====================================================================
-- A. the columns
-- =====================================================================

alter table public.raw_leads
  add column if not exists is_claimed boolean;

-- ‼️ numeric(9,6), WHICH IS ABOUT 11 CENTIMETRES AND DELIBERATELY NOT A float. scraper_cells.lat is
-- numeric(8,4) because a CELL KEY has to be byte-stable: a float radius is a key that can be
-- written two ways. A lead's coordinate is not a key, so it keeps the vendor's full precision; what
-- it must not be is a float, because a map that re-renders must put the dot in the same pixel.
alter table public.raw_leads
  add column if not exists latitude numeric(9,6) check (latitude between -90 and 90);
alter table public.raw_leads
  add column if not exists longitude numeric(9,6) check (longitude between -180 and 180);

alter table public.raw_leads
  add column if not exists competitor_name text;
alter table public.raw_leads
  add column if not exists competitor_rating numeric(2,1) check (competitor_rating between 0 and 5);
alter table public.raw_leads
  add column if not exists competitor_reviews integer check (competitor_reviews >= 0);

comment on column public.raw_leads.is_claimed is
  'Whether the owner has verified the Google listing, straight from DataForSEO''s is_claimed. False '
  'is the strongest "nobody is managing this" signal in the payload; NULL means the source did not '
  'say, which is not the same thing and must never be read as false.';

comment on column public.raw_leads.latitude is
  'The business pin, lifted from raw.latitude at pull time. Required by /dashboard/territory: a row '
  'without it cannot be a dot. NULL means the source gave none, never 0,0.';

comment on column public.raw_leads.competitor_name is
  'The highest-reviewed entry of raw.people_also_search, which is Google''s own list of about five '
  'businesses people also looked at. Chosen on votes_count, so it is the competitor with the most '
  'reviews rather than the best rated: the opener compares review COUNTS.';


-- =====================================================================
-- B. the backfill
-- =====================================================================
--
-- ‼️ IT RUNS OVER STORED JSON AND COSTS NOTHING. The 550 rows already hold every value. Without
-- this the map opens empty and the first tiered campaign has no competitor line, which would make
-- both look broken on the day they ship.
--
-- ‼️ `is not distinct from null` RATHER THAN `is null`, SO A RE-RUN IS A NO-OP AND A FIX IS NOT.
-- The guard is "only fill what is empty", which means running this twice writes nothing the second
-- time, and a row whose coordinate was genuinely absent is retried for free if the vendor later
-- backfills it.

update public.raw_leads
set
  is_claimed = coalesce(is_claimed, (raw->>'is_claimed')::boolean),
  latitude = coalesce(latitude, nullif(raw->>'latitude', '')::numeric),
  longitude = coalesce(longitude, nullif(raw->>'longitude', '')::numeric)
where raw ? 'is_claimed' or raw ? 'latitude' or raw ? 'longitude';

-- The competitor, picked per row by review count.
--
-- ‼️ `votes_count desc nulls last`, AND THE `nulls last` IS LOAD-BEARING. Measured on the stored
-- payload: plenty of people_also_search entries carry `"votes_count": null`, and in Postgres a
-- descending sort puts NULL FIRST by default. Without this the "top competitor" would usually be
-- whichever neighbour has no reviews at all, which is the opposite of the line it exists to write.
--
-- ‼️ AND THE ROW IS LEFT ALONE WHEN EVERY ENTRY IS NULL-VOTED. `where c.votes_count is not null`
-- means a lead whose neighbours all lack counts keeps three nulls rather than being given a
-- competitor with an empty number, which would print as "the clinic down the road has  reviews".
with top_competitor as (
  select distinct on (l.id)
    l.id,
    c.title,
    c.value as rating,
    c.votes_count
  from public.raw_leads l
  cross join lateral jsonb_to_recordset(
    case when jsonb_typeof(l.raw->'people_also_search') = 'array'
         then l.raw->'people_also_search'
         else '[]'::jsonb end
  ) as e(title text, rating jsonb)
  cross join lateral (
    select
      e.title as title,
      nullif(e.rating->>'value', '')::numeric as value,
      nullif(e.rating->>'votes_count', '')::integer as votes_count
  ) c
  where l.competitor_name is null
    and c.title is not null
    and c.votes_count is not null
  order by l.id, c.votes_count desc nulls last
)
update public.raw_leads l
set
  competitor_name = t.title,
  competitor_rating = t.rating,
  competitor_reviews = t.votes_count
from top_competitor t
where t.id = l.id;


-- =====================================================================
-- C. the index the map needs
-- =====================================================================
--
-- ‼️ PARTIAL ON "HAS A COORDINATE", because that is the only population the map ever asks for and
-- a row without one can never be a dot. The same shape as scraper_cells_unplaced.
create index if not exists raw_leads_mapped
  on public.raw_leads (vertical_slug, latitude, longitude)
  where latitude is not null and longitude is not null;

-- The per-metro table under the map reads one row per (metro, vertical), which is this index.
create index if not exists raw_leads_territory
  on public.raw_leads (vertical_slug, source_metro, created_at);


-- =====================================================================
-- Verification. Counts, never rates: a rate hides the denominator.
-- =====================================================================
select
  count(*) as rows_total,
  count(latitude) as with_coordinate,
  count(is_claimed) as with_claim_flag,
  count(*) filter (where is_claimed is false) as unclaimed_listings,
  count(competitor_name) as with_competitor,
  count(*) filter (where competitor_reviews is not null and competitor_reviews > coalesce(review_count, 0))
    as out_reviewed_by_their_competitor
from public.raw_leads;
