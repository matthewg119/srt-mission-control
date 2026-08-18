-- A2 D-P13: a market is a 10-mile radius, checked by distance, and checkout blocks.
--
-- Safe to run more than once.
--
-- WHY THIS EXISTS. D-P13 was confirmed in writing on 18 Aug 2026 ("10 miles is fine"). The
-- repo had two market implementations and neither matched it:
--
--   src/lib/medspa/market.ts    normalized "city|state" STRING EQUALITY, flags only
--   provision.ts checkMarket()  haversine CIRCLE OVERLAP (d < r1 + r2), flags only
--
-- D-P13 forbids the first outright: "The check reads distance from centre, NEVER ZIP
-- equality." And circle-overlap is the wrong geometry: it flags two ten-mile markets whose
-- centres are nineteen miles apart, when neither clinic is inside the other's market. The
-- test is now point-in-circle, both directions, in isInsideMarket().

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Ten miles, and it is not a dial
-- ─────────────────────────────────────────────────────────────────────────────
--
-- D-P13: "Radius = tenants.market_radius_mi, NOT NULL DEFAULT 10... Changing a radius is an
-- admin action, logged, and only ever follows the agreement. The number is not a dial and it
-- is not a negotiating chip."
--
-- Backfill first, then the constraint: existing rows have NULL and would fail the NOT NULL.
update public.clients set market_radius_mi = 10 where market_radius_mi is null;

alter table public.clients alter column market_radius_mi set default 10;
alter table public.clients alter column market_radius_mi set not null;

comment on column public.clients.market_radius_mi is
  'A2 D-P13. Ten miles. Changing it is an admin action that follows the agreement, not a '
  'negotiating chip. The check is point-in-circle (isInsideMarket), never ZIP equality.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ZIP centroids, for the CHECKOUT side of the check
-- ─────────────────────────────────────────────────────────────────────────────
--
-- ‼️ THE CENSUS GEOCODER CANNOT GEOCODE A ZIP. Measured against the live service on
-- 2026-08-18:
--
--   "27403"                                  -> NO MATCH
--   "27403, NC"                              -> NO MATCH
--   "Greensboro, NC 27403"                   -> NO MATCH
--   "1200 W Market St, Greensboro, NC 27403" -> 36.0734, -79.8069
--
-- It geocodes STREET ADDRESSES. That serves intake, where we hold the clinic's canonical
-- address. It cannot serve checkout, where a stranger types five digits. This is exactly why
-- A2 §2 names two options: "the US Census geocoder OR a static ZIP-centroid dataset".
--
-- So the checkout side reads this table. Until it is loaded, findHeldMarketForZip returns
-- `unchecked` and the sale goes through WITH A SLACK ALERT — never a silent pass, because a
-- market check that always passes quietly is worse than none at all.

create table if not exists public.zip_centroids (
  zip   text primary key,
  lat   double precision not null,
  lng   double precision not null,
  state text
);

comment on table public.zip_centroids is
  'ZCTA centroids for the D-P13 checkout check. Load from the Census ZCTA Gazetteer '
  '(public domain, no key, no vendor): https://www.census.gov/geographies/reference-files/'
  'time-series/geo/gazetteer-files.html — the ZIP Code Tabulation Areas file. Columns needed '
  'are GEOID (zip), INTPTLAT (lat), INTPTLONG (lng).';

alter table public.zip_centroids enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Loading it
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Download the Gazetteer ZCTA file, then in the Supabase SQL editor use the table import,
-- or psql:
--
--   \copy public.zip_centroids (zip, lat, lng)
--     from 'zcta.csv' with (format csv, header true);
--
-- Sanity check afterwards — Greensboro NC 27403 should land near 36.07, -79.81:
--
--   select * from public.zip_centroids where zip = '27403';
--   select count(*) from public.zip_centroids;   -- expect roughly 33,000
--
-- Until then:
--   select count(*) from public.zip_centroids;   -- 0, and every checkout alerts

-- ─────────────────────────────────────────────────────────────────────────────
-- What to expect
-- ─────────────────────────────────────────────────────────────────────────────
--
-- select legal_name, market_center_lat, market_center_lng, market_radius_mi
--   from public.clients where billing_status in ('pilot','active');
--
-- A row with a NULL centre holds no market and blocks nobody: the check skips it rather
-- than guessing. Intake now geocodes the canonical address into it on the way in.
