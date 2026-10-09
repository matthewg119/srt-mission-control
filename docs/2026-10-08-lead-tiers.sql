-- 2026-10-08: qualification stops being a boolean.
--
--   bun run scripts/db.ts --file=docs/2026-10-08-lead-tiers.sql --dry
--   bun run scripts/db.ts --file=docs/2026-10-08-lead-tiers.sql
--
-- Additive, idempotent, safe to run more than once. Nothing here narrows an existing check and
-- `qualify_keep` keeps its meaning, because everything downstream of qualification still reads it.
--
-- ‼️ WHY keep/drop WAS NOT ENOUGH, MEASURED. The front-desk ICP widened the keep rate from 101/500
-- to 256/500, which was the right call and had one side effect nobody could see: the kept file is
-- now a mixture. 24 of the 155 re-qualified leads carry 300+ reviews, mostly the salons and nail
-- bars the widened profile admitted. A boolean cannot say "keep this, and email it last", so the
-- whole list gets emailed at one priority and the 46 sendable addresses out of 500 are spread
-- across businesses worth very different amounts.
--
-- ‼️ AND WHY THE FREE FILTER IS NOT ALLOWED TO REPLACE HAIKU. Measured 2026-10-06 over the same
-- 500: the free rules (core category AND website) kept 255 and Haiku kept 256, and the two lists
-- DISAGREE ON 165 ROWS. 82 free-yes/Haiku-no, 83 free-no/Haiku-yes. Identical counts, different
-- businesses. A free filter is not a cheaper Haiku, it is a DIFFERENT filter passing the same
-- volume, and Haiku costs about four cents a batch so there was never a cost argument. The free
-- rules TIER and ROUTE; the model JUDGES.


-- =====================================================================
-- A. the columns
-- =====================================================================

-- What the business is worth to us.
--
--   A  med spa, aesthetics, TRT and men's health, weight loss, IV therapy, cosmetic dental
--   B  high-end salon, lash and brow, chiropractor, wellness
--   C  nail bar, barber, budget salon, tattoo
--
-- ‼️ NULL IS A REAL AND COMMON VALUE: "judged before tiering existed". All 256 kept rows on the
-- Dallas run were judged on 2026-10-06 under a boolean prompt, and there is no honest way to invent
-- a tier for them after the fact. The territory table reports them as `kept, untiered` rather than
-- folding them into Tier A, which would overstate supply on the only data we have.
alter table public.raw_leads
  add column if not exists tier text check (tier in ('A', 'B', 'C'));

-- What the business ACTUALLY is, as judged, which is not what the pull asked for.
--
-- ‼️ IT IS NOT `vertical_slug` AND THE NAMES ARE DELIBERATELY NOT INTERCHANGEABLE. `vertical_slug`
-- is what the RUN was for, copied onto every row at pull time and used to look up the ICP and the
-- DataForSEO categories; it is an input. This is the model's answer about one business, and the two
-- differ constantly: a `medspa` pull returns nail bars. Naming this column `vertical` next to
-- `vertical_slug` would be a pair of near-identical names meaning input and output, which is how a
-- join gets written against the wrong one and nothing ever says so.
alter table public.raw_leads
  add column if not exists judged_vertical text;

-- Where the lead goes. THE COLUMN THAT STOPS TIER C FROM BEING A DELETION.
--
-- ‼️ STORED, NOT DERIVED, AND THAT IS THE POINT. "Tier C, or no website, or no MX, therefore do not
-- email but do call" is a rule with four inputs, and every place that re-derived it would be free
-- to drift from the others. One column, written once by the free rules and the model together, and
-- read verbatim by the export scripts and the territory map.
--
-- ‼️ 'drop' IS STILL NOT A DELETION EITHER. Every row stays in raw_leads with its reason. The
-- difference between 'drop' and 'call' is whether there is anybody worth ringing: a national chain
-- location has a front desk and no budget, and no phone call fixes that.
alter table public.raw_leads
  add column if not exists route text check (route in ('email', 'call', 'drop'));

comment on column public.raw_leads.tier is
  'What the business is worth: A med spa / aesthetics / TRT / weight loss / IV / cosmetic dental, '
  'B high-end salon / lash / chiropractor / wellness, C nail bar / barber / budget salon / tattoo. '
  'NULL means judged before tiering existed, which is a real value and must not be read as A.';

comment on column public.raw_leads.judged_vertical is
  'What the business actually is, as judged. NOT vertical_slug, which is what the run asked for. A '
  'medspa pull returns nail bars; this is the column that says so, and off-vertical rows are kept '
  'and tagged so a later run for that vertical already has them.';

comment on column public.raw_leads.route is
  'email | call | drop. Written by the free rules and the model, read verbatim by the exports and '
  'by /dashboard/territory. Tier C and no-website rows are ''call'', never ''drop'': for a '
  'three-person clinic a phone call often beats a cold email, and a lead with no address is not a '
  'lead with no value.';


-- =====================================================================
-- B. the backfill
-- =====================================================================
--
-- ‼️ IT BACKFILLS `route` AND NOT `tier`, AND THE ASYMMETRY IS THE HONEST PART. Route is DERIVABLE
-- from verdicts already on the row: a business with no website cannot be emailed by the only
-- enrichment rung there is, and a kept row was kept. A tier is a judgement no stored column
-- contains, so inventing one here would put 256 businesses into Tier A on no evidence and every
-- "days of supply" number downstream would be computed from it.
--
-- ‼️ AND IT IS ROUTED ON THE WEBSITE COLUMN, NEVER ON THE DROP REASON TEXT. The reasons are model
-- prose: the stored 500 carry "no website domain, Instagram only", "No own domain, only Instagram,
-- cannot verify contact", "website is Instagram, not own domain or phone" and six more spellings of
-- one judgement. groupDrops() in qualify.ts normalises them for COUNTING and even that is fuzzy. A
-- regex over prose deciding where a lead gets sent would be wrong in both directions silently.
-- The aggregator-only domains are re-routed by scripts/backfill-lead-routes.ts instead, which
-- imports the one copy of NON_IDENTIFYING_HOSTS rather than spelling the list again here.

update public.raw_leads
set route = case
  -- No website at all. The call list, and the best prospects in the pull for an AEO pitch: a clinic
  -- with no website has the most to gain and the least to defend.
  when website is null or website = '' then 'call'
  when qualify_keep is true then 'email'
  when qualify_keep is false then 'drop'
  else null
end
where route is null;

-- Verification reads BOTH halves, because the interesting number is the one that would be a silent
-- zero: rows that are kept but have no route, or routed but not judged.
select
  count(*) as rows_total,
  count(*) filter (where route = 'email') as route_email,
  count(*) filter (where route = 'call') as route_call,
  count(*) filter (where route = 'drop') as route_drop,
  count(*) filter (where route is null) as route_unset,
  count(tier) as tiered,
  count(*) filter (where qualify_keep is true and route is distinct from 'email') as kept_but_not_emailable,
  count(*) filter (where route = 'call' and phone is not null) as callable_now
from public.raw_leads;


-- =====================================================================
-- C. the indexes the territory map needs
-- =====================================================================
--
-- The per-metro table counts Tier A per (vertical, metro), and the plan view counts route='email'
-- per metro. Partial on "has a route", which after the backfill is every judged row.
create index if not exists raw_leads_tier
  on public.raw_leads (vertical_slug, source_metro, tier)
  where route is not null;

create index if not exists raw_leads_route
  on public.raw_leads (route, vertical_slug)
  where route is not null;
