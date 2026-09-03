-- A city bucket on the dedupe ledger, so company names can be compared instead of only matched.
-- Extends docs/2026-09-03-scraper-dedup.sql and -company-city.sql. Same day.
--
-- WHY, measured. leads (3).csv reported 123 of 232 already seen. All 123 were real and traced to
-- leads (1).csv from 2026-08-28. But comparing the two files' keys directly, 39 MORE of the 90 rows
-- recorded as new are the same businesses, hidden by single-character differences:
--
--   annexusdermatologyaesthetics / annexusdermatology     one name contains the other  (24)
--   drsophieshotterteam          / drsophieshatterteam    one character different      (13)
--   bioconnectmedicalcentre      / bioconnectmedicalcenter  two characters             ( 2)
--
-- grey/gray, allete/allette, bclinic/bcinic, medigio/medigo, rejuviwell/rejuviwel. That is OCR:
-- both files were captured from a screenshot of an Apollo grid rather than exported, so the same
-- business is spelled differently in each pull. True overlap is ~162 of 232.
--
-- Exact key equality cannot see any of that, and a Set lookup cannot either: comparing needs the
-- CANDIDATES IN THE SAME CITY, and `key_value` is 'name|city', which no index can serve by city.

-- ‼️ GENERATED, NOT WRITTEN BY recordSeen, the same doctrine as contacts.phone_last10. A column the
-- database derives cannot drift from the value it is derived from, and there is no second code path
-- (a backfill, a retry, an older deploy) that can write it wrong.
--
-- Null on every non-company_city row on purpose: domain, phone and email keys have no city, and a
-- partial index over the nulls would be dead weight.
alter table scraper_seen
  add column if not exists city_key text
  generated always as (
    case when key_type = 'company_city' then split_part(key_value, '|', 2) end
  ) stored;

create index if not exists scraper_seen_city_key_idx
  on scraper_seen (city_key) where key_type = 'company_city';

-- Read back: city_key populated on company_city rows, null everywhere else.
select
  key_type,
  count(*)                                as keys,
  count(city_key)                         as with_city_key,
  count(distinct city_key)                as distinct_cities
from scraper_seen
group by key_type
order by key_type;
