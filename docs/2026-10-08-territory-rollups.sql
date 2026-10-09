-- 2026-10-08: the reads behind /dashboard/territory.
--
--   bun run scripts/db.ts --file=docs/2026-10-08-territory-rollups.sql --dry
--   bun run scripts/db.ts --file=docs/2026-10-08-territory-rollups.sql
--
-- Additive and idempotent: one column and four `create or replace function`s. No table is created,
-- because the page introduces NO new source of truth. It reads raw_leads, sendable_leads,
-- outreach_prospects and scraper_cells, and every number on it is derived at request time.
--
-- ‼️ WHY FUNCTIONS AND NOT QUERIES IN THE PAGE. PostgREST cannot express a GROUP BY, and this lane
-- reads through supabaseAdmin everywhere. The alternative is pulling every raw lead into the lambda
-- to count it in JavaScript, which works at 550 rows and falls over at the 4,000 a day the whole
-- territory system exists to support. `reachinbox_campaign_funnel` in
-- docs/2026-09-07-reachinbox-events.sql is the established shape and this follows it.
--
-- ‼️ AND THE STAGE LADDER IS SIX RUNGS, NOT FOUR. "pulled, qualified, sendable, emailed" hides the
-- two outcomes that matter most on a map of where to go next:
--
--   pulled     the row exists and nothing has judged it yet
--   dropped    judged and nobody there can buy: a chain location, a supplier, a duplicate
--   call       a real business with a front desk and no address this lane can reach. 130 of 550
--              stored rows, 108 of them with a phone number. These are DOORS, not leftovers.
--   qualified  routed to enrichment
--   sendable   an address that passes the shipping rule below
--   emailed    that address is on the outreach board and committed to a campaign. NOT proof a
--              message left a server: recordHandoff stamps first_sent_at at publish on purpose, so
--              suppression can never let a second sequence reach the same person. See section C.
--
-- A map that painted `call` the same colour as `dropped` would hide 108 phone numbers.


-- =====================================================================
-- A. the circle's own size, so "remaining" is a measurement
-- =====================================================================
--
-- ‼️ DataForSEO RETURNS total_count ON EVERY RESPONSE, FOR FREE, AND IT WAS BEING THROWN AWAY ON
-- NAMED METROS. The Dallas card said "`Dallas, Texas, United States` within 40km has 1,765 matching
-- these categories in total", and that number existed only in a Slack message. Without it the
-- territory table's "remaining" column cannot be anything but a guess, and the one decision the
-- whole page exists to support is "is this metro finished".
--
-- ‼️ AND IT IS NOT WRITTEN INTO scraper_cells, WHICH WAS THE OBVIOUS PLACE AND IS WRONG. That table's
-- contract is that WHICH CELLS EXIST is computed from the pure seedGrid()/childrenOf() geometry, and
-- a row is a receipt for a circle in that quadtree. A geocoded metro centre at whatever radius the
-- command named is not a cell in that tree, so inserting one would put a circle in front of the
-- coverage walk that its own geometry says cannot exist. The measurement belongs to the RUN that
-- bought it, beside raw_count and cost_usd.
alter table public.list_pipeline_runs
  add column if not exists metro_total_count integer check (metro_total_count >= 0);

comment on column public.list_pipeline_runs.metro_total_count is
  'How many businesses DataForSEO reports inside this pull''s circle for its category list, from the '
  'vendor''s own total_count. Free on every response. The denominator behind "days of supply left in '
  'this metro". Not written into scraper_cells: a geocoded metro centre is not a cell in the '
  'quadtree whose shape seedGrid()/childrenOf() compute.';


-- =====================================================================
-- B. the shipping rule, once
-- =====================================================================
--
-- ‼️ THIS IS A MIRROR OF `sendableRows` IN src/lib/scraper/listprep.ts AND IT SAYS SO OUT LOUD. That
-- function owns the rule; this is the only way to COUNT it without reading every address into a
-- lambda. A mirror is acceptable here for exactly one reason: scripts/_probe-territory.ts compares
-- this function's count against `sendableRows(runId).length` on a real run and fails if they
-- disagree. A mirror with no probe is a second copy, and the first thing a second copy does is
-- disagree.
--
-- ‼️ THE RULE IS PER SOURCE, NOT PER STATUS, and that asymmetry is the whole point. `catch_all` means
-- the server accepts every address, so it is evidence about the DOMAIN and none about the MAILBOX.
-- For an address the crawl FOUND that does not matter: somebody published it, so the mailbox exists.
-- For one the permutation rung INVENTED it is the entire question, and shipping it mails a mailbox
-- nobody has evidence exists. The bounce is charged to our sending domain, not to the guess.
create or replace function public.sendable_lead_ships(
  p_provider text,
  p_status text,
  p_suppressed text
)
returns boolean
language sql
immutable
as $$
  select
    p_suppressed is null
    and p_status in ('valid', 'catch_all')
    -- GUESSING_PROVIDERS in listprep.ts. A list rather than a boolean because the paid
    -- domain-people rung joins it the day it gets a key.
    and (p_provider is null or p_provider not in ('permute-guess', 'domain-people') or p_status = 'valid');
$$;

comment on function public.sendable_lead_ships(text, text, text) is
  'MIRROR of the per-source shipping rule in sendableRows (src/lib/scraper/listprep.ts). Kept honest '
  'by scripts/_probe-territory.ts, which compares a count through this against sendableRows itself '
  'on a real run. A found address may be catch_all; a guessed one must be valid.';


-- =====================================================================
-- C. the furthest stage each mappable lead reached
-- =====================================================================
--
-- ‼️ ONE VIEW, SO THE THREE ROLLUPS CANNOT DISAGREE WITH EACH OTHER. The dots, the metro table and
-- the state layer all answer "how far did this lead get", and three copies of that CASE expression
-- is three chances for the map to contradict the table underneath it.
--
-- ‼️ THE ADDRESS SIDE IS AGGREGATED PER LEAD BEFORE IT IS JOINED. A lead can carry several addresses
-- (info@ and the owner's), and joining them row-to-row would count that lead once per address: a
-- metro's "sendable" would exceed its "pulled". bool_or collapses them to "does this lead have at
-- least one shippable address", which is the question.
create or replace view public.territory_lead_stage as
with addr as (
  select
    s.raw_lead_id,
    bool_or(public.sendable_lead_ships(s.provider, s.email_status, s.suppressed_reason)) as ships,
    -- ‼️ THIS IS "HANDED OFF TO SEND", NOT "A MESSAGE LEFT A SERVER", AND THE PAGE SAYS SO. It is
    -- read off the outreach board because sendable_leads has no concept of a send at all:
    -- `recordHandoff` writes outreach_prospects and THAT is what suppression asks "have we mailed
    -- this person". But recordHandoff stamps first_sent_at AT PUBLISH, deliberately, and its own
    -- header gives the reason: a row wrongly marked handed off costs one lead we never mail, while a
    -- row wrongly left unmarked costs that person a second cold sequence from a second domain, which
    -- is how sending domains get burned at volume. The cheaper mistake is made on purpose.
    --
    -- So this rung means "committed to a campaign", and the legend on /dashboard/territory reads
    -- "handed off to send" rather than "emailed". The true per-message signal is reachinbox_events,
    -- which is a different question (did it deliver, did it open) and a different page.
    bool_or(op.first_sent_at is not null) as emailed
  from public.sendable_leads s
  left join public.outreach_prospects op on lower(op.email) = lower(s.email)
  group by s.raw_lead_id
)
select
  l.id,
  l.vertical_slug,
  l.source_metro,
  l.state,
  l.latitude,
  l.longitude,
  l.tier,
  l.route,
  l.judged_vertical,
  l.is_claimed,
  l.created_at,
  case
    when coalesce(a.emailed, false) then 'emailed'
    when coalesce(a.ships, false) then 'sendable'
    when l.route = 'email' then 'qualified'
    when l.route = 'call' then 'call'
    when l.route = 'drop' then 'dropped'
    else 'pulled'
  end as stage
from public.raw_leads l
left join addr a on a.raw_lead_id = l.id;

comment on view public.territory_lead_stage is
  'One row per raw lead with the furthest stage it reached, for /dashboard/territory. The single '
  'definition of that ladder: the dots, the metro table and the state layer all read it, so the map '
  'cannot contradict the table under it.';


-- =====================================================================
-- D. the dots
-- =====================================================================
--
-- ‼️ GRID-AGGREGATED AT REQUEST TIME, WITH THE GRID SIZE PASSED IN, which is what makes one function
-- serve both zoom levels. At national zoom 960 pixels span 58 degrees of longitude, so anything
-- under about 0.06 degrees is sub-pixel and 4,000 individual circles would be 4,000 SVG nodes
-- drawing one blob. At metro zoom the operator is asking "which part of this city is unworked" and
-- needs the actual pins. p_round = 0 means no rounding.
--
-- ‼️ AND THE CAP IS ON ROWS RETURNED, NOT ON LEADS COUNTED. `n` is a true count of every lead in
-- that grid square whatever the cap does, so a capped response under-reports the number of DOTS and
-- never the number of leads. The page says when it capped.
create or replace function public.territory_dots(
  p_vertical text default null,
  p_round numeric default 0,
  p_limit integer default 4000
)
returns table (lat numeric, lon numeric, stage text, n bigint)
language sql
stable
as $$
  select
    case when p_round > 0 then round(s.latitude / p_round) * p_round else s.latitude end as lat,
    case when p_round > 0 then round(s.longitude / p_round) * p_round else s.longitude end as lon,
    s.stage,
    count(*) as n
  from public.territory_lead_stage s
  where s.latitude is not null
    and s.longitude is not null
    and (p_vertical is null or s.vertical_slug = p_vertical)
  group by 1, 2, 3
  -- Biggest clusters first, so a cap drops the dots that matter least rather than an arbitrary slice.
  order by count(*) desc, 1, 2
  limit greatest(p_limit, 1);
$$;


-- =====================================================================
-- E. the table under the map: one row per (metro, vertical)
-- =====================================================================
--
-- ‼️ `untiered` IS A COLUMN AND NOT A ROUNDING ERROR. All 256 kept rows on the Dallas run were judged
-- before tiering existed, and no honest backfill can invent a tier for them. Folding them into
-- Tier A would overstate supply on the only data there is; leaving them out would make the row's own
-- numbers fail to sum, with nothing to say why.
--
-- ‼️ AND `remaining` IS NULL RATHER THAN ZERO WHEN THE CIRCLE WAS NEVER MEASURED. A metro pulled
-- before metro_total_count existed has no denominator, and reporting that as "0 left" would mark it
-- finished. Null renders as "not measured" and the plan view says which command measures it.
create or replace function public.territory_metro_rollup(p_vertical text default null)
returns table (
  vertical_slug text,
  source_metro text,
  pulled bigint,
  judged bigint,
  tier_a bigint,
  tier_b bigint,
  tier_c bigint,
  untiered bigint,
  callable bigint,
  qualified bigint,
  sendable bigint,
  emailed bigint,
  last_pulled_at timestamptz,
  metro_total integer,
  remaining integer
)
language sql
stable
as $$
with totals as (
  -- The biggest total any run of this metro observed. A maximum for the reason scraper_cells takes
  -- one: the vendor's index is live, an upward drift must be followed, and a downward one must never
  -- make a finished metro look unfinished.
  select l.vertical_slug, l.source_metro, max(r.metro_total_count) as metro_total
  from public.raw_leads l
  join public.list_pipeline_runs r on r.id = l.run_id
  where r.metro_total_count is not null
  group by 1, 2
)
select
  s.vertical_slug,
  s.source_metro,
  count(*) as pulled,
  count(*) filter (where s.route is not null) as judged,
  count(*) filter (where s.tier = 'A') as tier_a,
  count(*) filter (where s.tier = 'B') as tier_b,
  count(*) filter (where s.tier = 'C') as tier_c,
  count(*) filter (where s.route = 'email' and s.tier is null) as untiered,
  count(*) filter (where s.route = 'call') as callable,
  count(*) filter (where s.route = 'email') as qualified,
  count(*) filter (where s.stage in ('sendable', 'emailed')) as sendable,
  count(*) filter (where s.stage = 'emailed') as emailed,
  max(s.created_at) as last_pulled_at,
  t.metro_total,
  case when t.metro_total is null then null
       else greatest(t.metro_total - count(*), 0)::integer end as remaining
from public.territory_lead_stage s
left join totals t
  on t.vertical_slug is not distinct from s.vertical_slug
 and t.source_metro is not distinct from s.source_metro
where (p_vertical is null or s.vertical_slug = p_vertical)
group by s.vertical_slug, s.source_metro, t.metro_total
order by count(*) desc;
$$;


-- =====================================================================
-- F. the state layer
-- =====================================================================
--
-- ‼️ IT GROUPS ON THE RAW COLUMN AND LETS THE PAGE CANONICALISE, ON PURPOSE. raw_leads.state holds
-- "Texas" on 520 of the stored 550 rows, "TX" on 10 and nothing on 20, and the one correct mapping
-- of code to name is `canonicalStateName` in src/lib/scraper/geo.ts, which also refuses "Ontario"
-- and "Chihuahua" that a reverse geocoder returns for cells just over the border. Writing a 50 row
-- VALUES list here would be a second copy of that, and there are at most a few dozen distinct raw
-- values nationally, so merging them in TypeScript costs nothing.
--
-- ‼️ AND NOT zip_centroids. It has 33,791 points and its `state` column is 100% NULL.
create or replace function public.territory_state_rollup(p_vertical text default null)
returns table (
  state_raw text,
  pulled bigint,
  qualified bigint,
  callable bigint,
  sendable bigint,
  emailed bigint
)
language sql
stable
as $$
  select
    s.state as state_raw,
    count(*) as pulled,
    count(*) filter (where s.route = 'email') as qualified,
    count(*) filter (where s.route = 'call') as callable,
    count(*) filter (where s.stage in ('sendable', 'emailed')) as sendable,
    count(*) filter (where s.stage = 'emailed') as emailed
  from public.territory_lead_stage s
  where (p_vertical is null or s.vertical_slug = p_vertical)
  group by s.state
  order by count(*) desc;
$$;


-- =====================================================================
-- G. the one circle already measured
-- =====================================================================
--
-- The Dallas pull reported its own total on its Slack card on 2026-09-28: "`Dallas, Texas, United
-- States` within 40km has *1765* matching these categories in total". That is the vendor's answer
-- for that circle and those five categories, and it is the only measurement that exists today.
-- Written here so the territory table opens with a real "remaining" rather than "not measured" on
-- the one metro that has been worked.
--
-- ‼️ ONLY WHERE IT IS NULL, so a later pull's own observation always wins over this transcription.
-- The next chunk of Dallas will write its own number through pullFromDataForSeo and this line will
-- never fire again.
--
-- ‼️ AND ONLY ON THE RUNS THAT ACTUALLY BOUGHT THAT CIRCLE. Matched on the two Dallas run ids
-- rather than on a label pattern: `source_queries` and `label` are operator prose, and a LIKE over
-- them would eventually stamp 1,765 onto a run of a different radius, where it is simply wrong.
update public.list_pipeline_runs
set metro_total_count = 1765
where id in (
    'c74a895d-4ea0-4d1b-9904-33fb4ace00b4',
    '9f9302c1-2223-4f3a-ae74-24462d2bdd6f'
  )
  and metro_total_count is null;


-- =====================================================================
-- Verification
-- =====================================================================
--
-- ‼️ THESE ARE WRITTEN TO BE ABLE TO FAIL. A verification select that cannot report a bad number is
-- decoration. `stage_ladder_sums` must equal `rows_total`, and `sendable_vs_pipeline` must match the
-- 46 that docs/prompts/2026-10-08-territory-and-vertical-pipeline.md records as shippable on run
-- c74a895d. If either is off, something in section C is wrong.
select
  (select count(*) from public.raw_leads) as rows_total,
  (select sum(n) from public.territory_dots('medspa', 0, 100000)) as dots_total,
  (select count(*) from public.territory_lead_stage
    where stage in ('pulled', 'dropped', 'call', 'qualified', 'sendable', 'emailed')) as stage_ladder_sums,
  (select count(*) from public.territory_lead_stage where stage in ('sendable', 'emailed'))
    as sendable_vs_pipeline,
  (select count(*) from public.territory_metro_rollup('medspa')) as metro_rows,
  (select count(*) from public.territory_state_rollup('medspa')) as state_rows,
  (select count(*) from public.scraper_cells) as cells_measured;
