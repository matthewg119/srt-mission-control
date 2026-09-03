-- Match a market on a NORMALIZED service key, not on the raw slug.
--
-- Additive and re-runnable. Requires docs/2026-09-02-market-dataset.sql.
--
-- ‼️ WHY. audit_reports.vertical_slug is free text typed per report, so the same market arrives
-- spelled several ways and an exact match splits it. Measured on the live dataset:
--
--   St Johns, FL     "med-spa"              5 ammo lines
--   St Johns, FL     "medspa"               0          <- same market, same city, no match
--   Ocala, FL        "med-spa"              0          <- Ocala holds 26 businesses under "medspa"
--
-- Three of five realistic med spa lookups returned nothing for no reason but punctuation. A lookup
-- that silently returns empty is the worst shape this can fail in, because empty is also the honest
-- answer for a city we never audited, so the bug is indistinguishable from correct behaviour.
--
-- ‼️ THIS NORMALIZES SPELLING ONLY. IT DOES NOT MERGE MEANINGS. "med-spa", "medspa" and "med spa"
-- become one key because they are one word written three ways. "medical-aesthetics", "day-spa" and
-- "bhrt-med-spa" are left ALONE and still do not match "medspa", because deciding those are the
-- same market is a judgment about the business, not about the string, and making it here would
-- quietly start naming a day spa's rivals to a med spa. That call is Matthew's, and if he wants it
-- the right shape is an explicit curated synonym table, not a looser regex.

alter table public.market_mentions
  add column if not exists service_key text
  generated always as (lower(regexp_replace(service, '[^a-zA-Z0-9]+', '', 'g'))) stored;

comment on column public.market_mentions.service_key is
  'service with every non-alphanumeric character removed and lowercased, so "med-spa", "medspa" and
   "med spa" are one market. Generated, so it cannot drift from service. Spelling only: it never
   merges two different services, and "medical-aesthetics" still does not match "medspa".';

create index if not exists market_mentions_market_key_idx
  on public.market_mentions (city, state, service_key);

-- The view gains the key and keeps `service` for display, so a card can still print the slug the
-- report actually used rather than the squashed form.
--
-- ‼️ DROP THEN CREATE, NOT `create or replace`. Replace can only APPEND columns: adding service_key
-- next to service shifts every column after it and Postgres refuses the whole statement. Dropping
-- is safe here only because nothing but this lane reads the view. If anything else ever selects
-- from it, add new columns at the END and keep the replace form.
drop view if exists public.market_competitors;

create view public.market_competitors as
select
  m.city,
  m.state,
  m.service,
  m.service_key,
  m.normalized_name,
  min(m.display_name)                          as display_name,
  count(*)::int                                as times_named,
  count(distinct m.run_id)::int                as run_count,
  count(distinct m.report_id)::int             as report_count,
  array_agg(distinct m.engine)                 as engines,
  (array_agg(distinct m.prompt))[1:3]          as sample_prompts,
  array_remove(array_agg(distinct d.domain), null) as cited_domains,
  min(m.seen_at)                               as first_seen,
  max(m.seen_at)                               as last_seen
from public.market_mentions m
left join lateral unnest(m.cited_domains) as d(domain) on true
group by m.city, m.state, m.service, m.service_key, m.normalized_name;

-- Verification: every spa-ish slug and the key it now collapses to.
select service, service_key, count(*) as rows
from public.market_mentions
where service ~ 'spa|aesthet|wellness|skin'
group by 1, 2
order by 2, 1;
