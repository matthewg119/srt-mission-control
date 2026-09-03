-- The identity spine backfill. Data only: every column this file writes was created by
-- docs/2026-09-02-market-dataset.sql, which must be run first.
--
-- Safe to run more than once. Every UPDATE is guarded by "is null" on the column it sets, so a
-- second run is a no-op and nothing already linked is re-linked or overwritten.
--
-- ‼️ THE JOIN KEY IS phone_last10, NOT website AND NOT place_id, AND THAT WAS MEASURED.
--   contacts.website is populated on 45 of 8,420 rows, so a domain join matches nothing.
--   contacts has no place id at all until this file writes one.
--   contacts.phone_last10 is a GENERATED column (docs/2026-06-04-contacts-phone-last10.sql) and is
--   populated on 8,255 of 8,420 rows.
-- Joining trt_leads, prospect_leads and med_spa_leads to contacts on it yields 1,973 matches, and
-- every single one resolves to exactly ONE contact whose normalized business name also agrees.
-- Zero ambiguous, zero disagreements. These businesses are already in the CRM; this file is
-- recording a link that was always true, not inventing one.
--
-- ‼️ TWO GUARDS, AND NEITHER IS OPTIONAL.
--   1. EXACTLY ONE contact for that phone. 8,255 contacts carry a phone_last10 but only 8,109 are
--      distinct, so about 146 contacts share a number with another contact. A shared number is a
--      switchboard or a duplicate, and picking either row would be a coin flip recorded as a fact.
--   2. THE NORMALIZED BUSINESS NAME MUST AGREE. Two different businesses in one office share a
--      phone. The name is the independent evidence that turns a phone collision into an identity,
--      and without it this file would merge them.
-- A row that fails either guard is left with a null contact_id. Unlinked is a state we can fix
-- later; wrongly linked is a stranger's competitor named in someone else's email.

-- ── 1. Link the three lead tables to contacts ───────────────────────────────────────────────

update public.trt_leads l
set contact_id = c.id
from public.contacts c
where l.contact_id is null
  and l.phone_normalized is not null
  and length(regexp_replace(l.phone_normalized, '[^0-9]', '', 'g')) >= 10
  and c.phone_last10 = right(regexp_replace(l.phone_normalized, '[^0-9]', '', 'g'), 10)
  and lower(regexp_replace(coalesce(c.business_name, ''), '[^a-z0-9]', '', 'gi'))
      = lower(regexp_replace(l.business_name, '[^a-z0-9]', '', 'gi'))
  and (
    select count(*) from public.contacts c2
    where c2.phone_last10 = right(regexp_replace(l.phone_normalized, '[^0-9]', '', 'g'), 10)
  ) = 1;

update public.prospect_leads l
set contact_id = c.id
from public.contacts c
where l.contact_id is null
  and l.phone_normalized is not null
  and length(regexp_replace(l.phone_normalized, '[^0-9]', '', 'g')) >= 10
  and c.phone_last10 = right(regexp_replace(l.phone_normalized, '[^0-9]', '', 'g'), 10)
  and lower(regexp_replace(coalesce(c.business_name, ''), '[^a-z0-9]', '', 'gi'))
      = lower(regexp_replace(l.business_name, '[^a-z0-9]', '', 'gi'))
  and (
    select count(*) from public.contacts c2
    where c2.phone_last10 = right(regexp_replace(l.phone_normalized, '[^0-9]', '', 'g'), 10)
  ) = 1;

update public.med_spa_leads l
set contact_id = c.id
from public.contacts c
where l.contact_id is null
  and l.phone_normalized is not null
  and length(regexp_replace(l.phone_normalized, '[^0-9]', '', 'g')) >= 10
  and c.phone_last10 = right(regexp_replace(l.phone_normalized, '[^0-9]', '', 'g'), 10)
  and lower(regexp_replace(coalesce(c.business_name, ''), '[^a-z0-9]', '', 'gi'))
      = lower(regexp_replace(l.business_name, '[^a-z0-9]', '', 'gi'))
  and (
    select count(*) from public.contacts c2
    where c2.phone_last10 = right(regexp_replace(l.phone_normalized, '[^0-9]', '', 'g'), 10)
  ) = 1;

-- ── 2. Push the place id and the website back onto contacts ─────────────────────────────────
--
-- This is the half of the spine that pays for itself immediately. contacts.website is populated on
-- 45 of 8,420 rows while the lead tables carry a website on roughly 1,850 of the businesses those
-- rows describe, and contacts has no place id at all. Both travel along the link just established.
--
-- DISTINCT ON picks one row per contact deterministically. Ordering by the id makes a second run
-- choose the same source row as the first, so this cannot oscillate between two spellings of a URL.

update public.contacts c
set google_place_id = src.google_place_id
from (
  select distinct on (contact_id) contact_id, google_place_id
  from (
    select contact_id, google_place_id from public.trt_leads
      where contact_id is not null and google_place_id is not null and google_place_id <> ''
    union all
    select contact_id, google_place_id from public.prospect_leads
      where contact_id is not null and google_place_id is not null and google_place_id <> ''
    union all
    select contact_id, google_place_id from public.med_spa_leads
      where contact_id is not null and google_place_id is not null and google_place_id <> ''
  ) all_leads
  order by contact_id, google_place_id
) src
where c.id = src.contact_id
  and c.google_place_id is null;

update public.contacts c
set website = src.website
from (
  select distinct on (contact_id) contact_id, website
  from (
    select contact_id, website from public.trt_leads
      where contact_id is not null and website is not null and website <> ''
    union all
    select contact_id, website from public.prospect_leads
      where contact_id is not null and website is not null and website <> ''
    union all
    select contact_id, website from public.med_spa_leads
      where contact_id is not null and website is not null and website <> ''
  ) all_leads
  order by contact_id, website
) src
where c.id = src.contact_id
  and (c.website is null or c.website = '');

-- ── 3. Link scraper rows, place id only ─────────────────────────────────────────────────────
--
-- ‼️ STRICTER THAN THE LEAD TABLES ON PURPOSE. scraper_rows has no phone column and, measured, no
-- email on any of its 613 rows, so neither of the guards above is available. A company-name-plus-
-- city match was considered and rejected: name collisions across cities are exactly what the name
-- guard exists to catch elsewhere, and here there would be nothing independent to check it against.
-- A Google place id is an identifier rather than a description, so it needs no corroboration.
-- This links very few rows today and that is the honest outcome, not a bug to widen the rule for.

update public.scraper_rows s
set contact_id = c.id
from public.contacts c
where s.contact_id is null
  and s.gbp_place_id is not null and s.gbp_place_id <> ''
  and c.google_place_id = s.gbp_place_id
  and (
    select count(*) from public.contacts c2 where c2.google_place_id = s.gbp_place_id
  ) = 1;

-- ── 4. Carry the scraper scores onto the linked contact ─────────────────────────────────────
--
-- The scores exist on 613 scraper rows and have never reached a business record. Only rows that
-- actually got a link above can carry, so this moves whatever the previous statement earned.

update public.contacts c
set dominance_score         = s.dominance_score,
    score_components        = s.score_components,
    optimization_score      = s.optimization_score,
    optimization_components = s.optimization_components,
    scores_updated_at       = now()
from public.scraper_rows s
where s.contact_id = c.id
  and c.scores_updated_at is null
  and s.dominance_score is not null;

-- ── 5. Verification ─────────────────────────────────────────────────────────────────────────

select
  (select count(*) from public.trt_leads      where contact_id is not null) as trt_linked,
  (select count(*) from public.prospect_leads where contact_id is not null) as prospect_linked,
  (select count(*) from public.med_spa_leads  where contact_id is not null) as medspa_linked,
  (select count(*) from public.scraper_rows   where contact_id is not null) as scraper_linked,
  (select count(*) from public.contacts where google_place_id is not null)  as contacts_with_place_id,
  (select count(*) from public.contacts where website is not null and website <> '') as contacts_with_website;
