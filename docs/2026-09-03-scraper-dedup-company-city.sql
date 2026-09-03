-- The fourth dedupe key: company + city, for rows that carry nothing else.
-- Extends docs/2026-09-03-scraper-dedup.sql, run the same day.
--
-- WHY, measured rather than assumed. After the first migration the ledger seeded EMPTY:
--
--   select count(*), count(website) filter (where trim(coalesce(website,'')) <> '')
--   from scraper_rows;   ->  613 rows, 0 with a website, 0 with an email, 0 with a phone
--
-- All 613 are the three `leads (1).csv` drops (226 / 161 / 226 rows, 226 distinct businesses),
-- scored on 2026-08-28 and 2026-08-29. That is an Outscraper company pull: company and city and
-- nothing else. So the domain/phone/email rule, on its own, would have reported all 226 as NEW on
-- the next drop and re-bought every SERP — the exact thing the feature was asked for.
--
-- ‼️ THIS KEY IS COMPUTED ONLY WHEN A ROW HAS NO DOMAIN, NO PHONE AND NO EMAIL, structurally, in
-- rowKeys(). A name is the weakest evidence this lane has: a chain with one domain and ten
-- locations would collide on it. It exists for rows whose alternative is never being deduped at all.

alter table scraper_seen drop constraint if exists scraper_seen_key_type_check;
alter table scraper_seen add constraint scraper_seen_key_type_check
  check (key_type in ('domain', 'phone', 'email', 'company_city'));

-- ── seed the businesses already scored ──────────────────────────────────────────────────────────
--
-- ‼️ THE NORMALIZATION HERE MUST MATCH companyCityKey() IN dedup.ts EXACTLY OR NOTHING EVER
-- MATCHES. Lowercase, drop everything that is not a-z0-9, join with a pipe. And note what it does
-- NOT do: it does not strip "spa" / "clinic" / "studio" the way normalizeCompanyName() does, because
-- here those words are often the only thing separating two businesses on one street.
--
-- ‼️ BOTH HALVES REQUIRED. "Skin Bar" in Charlotte and "Skin Bar" in Miami are two businesses, so a
-- row with no city is skipped rather than keyed on a name that collides across the country. 550 of
-- the 613 rows carry a city; the other 63 stay unkeyed, which is the safe direction.
insert into scraper_seen (key_type, key_value, first_batch_id, company, city, website)
select distinct on (key) 'company_city', key, r.batch_id, r.company, r.city, r.website
from (
  select
    batch_id, company, city, website, created_at,
    lower(regexp_replace(company, '[^a-zA-Z0-9]', '', 'g')) || '|' ||
    lower(regexp_replace(city,    '[^a-zA-Z0-9]', '', 'g')) as key
  from scraper_rows
  where company is not null and trim(company) <> ''
    and city    is not null and trim(city)    <> ''
    -- Only rows that would take this key in the app: a row with a stronger key never gets one.
    and coalesce(trim(website), '') = ''
    and coalesce(trim(email),   '') = ''
) r
where r.key <> '|'
  and r.key not like '|%'
  and r.key not like '%|'
order by r.key, r.created_at asc
on conflict (key_type, key_value) do nothing;

-- Read back. Expect ~226 company_city keys and nothing else, since no past row had a website,
-- a phone or an email.
select key_type, count(*) as keys from scraper_seen group by key_type order by key_type;
