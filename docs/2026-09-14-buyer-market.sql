-- 2026-09-14 — the market an audience is about, so a second avatar can accumulate its own data
--
-- Matthew, 2026-09-14: he wants to run different avatars for different types of client, and every
-- ad set and post generated against an avatar should feed the same context layer, so the data
-- compounds while it is being used rather than after.
--
-- ‼️ THE COLUMN HAS TO EXIST BEFORE THE LOOP CAN ACCUMULATE ANYTHING, WHICH IS WHY THIS IS NOT A
-- PATCH FOR ONE LOOKUP. Everything the market layer holds is keyed on a market slug:
-- market_mentions.service and .service_key, the synonym clusters in market/service-synonyms.ts, and
-- competitorAmmo's "no engine has named anyone in this city and service yet". Until now the only
-- thing that supplied that key on the concierge path was a hardcoded `|| "medspa"` in engine.ts.
-- A second avatar pointed at a different market had nowhere to record which market it was about, so
-- every post it produced would have accumulated under the first one.
--
-- ‼️ THIS WAS THE FOURTH AND LAST ROUTE TO "THIS CLIENT IS A MED SPA". The other three were closed
-- on 2026-09-14: concierge_configs.vertical lost its `default 'medspa'`, config.ts lost its
-- `?? "medspa"` coalesce, and concierge-setup.ts lost its `|| "medspa"`. This one was left in place
-- deliberately and documented, because the audience row had no noun for the market and inventing
-- one by stripping " owner" off the buyer noun would have been string surgery on copy a person
-- typed. This file is the noun.
--
-- Additive, idempotent, safe to run more than once.
-- Runner: bun run scripts/db.ts --file=docs/2026-09-14-buyer-market.sql [--dry]
--
-- ‼️ RUN IT BEFORE THE DEPLOY THAT READS IT. One unknown column fails the WHOLE PostgREST select.


-- =====================================================================
-- 1. THE MARKET THIS AUDIENCE IS ABOUT
-- =====================================================================
--
-- ‼️ ONE MEANING, AND IT IS THE SAME ONE FOR BOTH STANCES: the market whose competitor data,
-- questions and content belong to this audience.
--
--   owner stance    the market the BUYER'S OWN BUSINESS competes in. SRT sells to med spa owners,
--                   so its audience is about med-spa, even though SRT itself is an agency.
--   patient stance  the market the buyer is SHOPPING IN, which is the client's own market. A
--                   clinic's patient audience is about med-spa; a restaurant's diner audience is
--                   about restaurant.
--
-- Both reduce to "what is this audience's content and competitor data about", which is why it is
-- one column rather than two.
--
-- ‼️ IT IS NOT clients.vertical_slug AND MUST NEVER BE BACKFILLED FROM IT. SRT's vertical_slug is
-- `aeo-agency-med-spa`, which is the market SRT operates in. Its buyer_market is `med-spa`, which is
-- the market its buyers operate in. Conflating the two is precisely how an agency's own pages got
-- aimed at other agencies.
alter table public.client_audiences add column if not exists buyer_market text;
alter table public.avatar_briefs   add column if not exists buyer_market text;

comment on column public.client_audiences.buyer_market is
  'The market this audience is ABOUT, as a kebab-case slug matching market_mentions.service '
  '(med-spa, mexican-restaurant, family-dentistry). For an owner audience it is the market the '
  'BUYER''S business competes in; for an end-customer audience it is the market they are shopping '
  'in. ‼️ NOT clients.vertical_slug: SRT''s vertical is aeo-agency-med-spa and its buyer_market is '
  'med-spa. serviceKey() normalises it and marketKeys() expands it to its synonym cluster, so the '
  'spelling only has to be recognisable, not exact. NULL means nobody has said, and competitorAmmo '
  'already answers that honestly with "we do not know what this business sells yet".';

comment on column public.avatar_briefs.buyer_market is
  'The default buyer_market for a client audience seeded from this shared preset. Read ONCE at seed '
  'time, like every other preset value.';


-- =====================================================================
-- 2. THE BACKFILL
-- =====================================================================
--
-- ‼️ `med-spa`, NOT `medspa`, AND THE DATA DECIDED IT. Measured 2026-09-14 across every
-- market_mentions row: `med-spa` holds 138 rows and `medspa` holds 49, and serviceKey() folds both
-- to `medspa` before marketKeys() expands that into the curated cluster
-- (medspa, medicalaesthetics, bhrtmedspa, skincarespa, dermatologyclinic). So either spelling
-- resolves, and the kebab-case one is what classify.ts writes and what the market data mostly says.
--
-- Resolved by the preset the audience was seeded from, never by a slug literal or a pinned id.
update public.client_audiences
set buyer_market = 'med-spa', updated_at = now()
where buyer_market is null
  and seeded_from in ('aeo_agency_owner', 'med_spa_patient');

-- ‼️ THIS UPDATE IS SUPERSEDED, and it is left as a comment rather than deleted so a re-run of this
-- file does not fail on a column that no longer exists. It keyed on avatar_briefs.preset_key, which
-- was dropped by docs/2026-09-25-drop-preset-key.sql for having no reader anywhere. Its effect is
-- already on the rows: the statement above it seeds buyer_market from client_audiences.seeded_from,
-- which is the per-client answer and the one every reader selects.
--
-- update public.avatar_briefs
-- set buyer_market = 'med-spa', updated_at = now()
-- where buyer_market is null
--   and preset_key in ('aeo_agency_owner', 'med_spa_patient');


-- =====================================================================
-- VERIFICATION
-- =====================================================================

-- Expect srt-agency-llc: research_vertical aeo-agency-med-spa, buyer_market med-spa. The two being
-- DIFFERENT is the whole point of the column.
select c.slug, a.slug as audience, a.stance, a.research_vertical, a.buyer_market
from public.client_audiences a
join public.clients c on c.id = a.client_id
order by c.slug;

-- The shared preset carries the default a new client in this namespace will be seeded with.
select vertical, avatar_slug, default_stance, buyer_market
from public.avatar_briefs
order by vertical;

-- ‼️ THE MARKET DATA THIS NOW KEYS INTO. Expect med-spa at the top with its cluster siblings
-- beneath it. If buyer_market named a market with no rows, competitorAmmo would return nothing and
-- say so, which is the honest failure rather than a wrong one.
select service, count(*) as mentions
from public.market_mentions
where service is not null
group by 1
order by 2 desc
limit 10;
