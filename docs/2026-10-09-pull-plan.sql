-- 2026-10-09: `pull 2000 medspa`. One command says how many records; the lane works out where.
--
--   bun run scripts/db.ts --file=docs/2026-10-09-pull-plan.sql --dry
--   bun run scripts/db.ts --file=docs/2026-10-09-pull-plan.sql
--
-- Additive and idempotent. Three tables, no changes to anything that already exists.
--
-- ‼️ WHY A QUEUE TABLE AT ALL, WHEN mapsPullHistory IS DELIBERATELY NOT ONE. store.ts says it out
-- loud: "THIS IS THE CAMPAIGN'S ONLY MEMORY, AND IT IS DELIBERATELY NOT A QUEUE TABLE", because a
-- campaign asks "which metros has this vertical had" and answers it by re-parsing the commands
-- themselves. That is still true and nothing here changes it. What this stores is a different fact:
-- an INTENT A HUMAN APPROVED. "Matthew asked for 2,000 records and ticked a card that said what that
-- would cost" cannot be re-derived from what has been pulled, because it has not been pulled yet.
-- The walk still reads history to decide depth; the plan only says how much more was authorised.
--
-- ‼️ AND THE PLAN IS NOT A BATCH, WHICH IS WHY IT IS NOT scraper_batches. A batch is one purchase
-- with one gate. A plan is a list of purchases, outlives every one of them, and spawns batches as it
-- walks. Folding it in would need a sixth gate *_ts on a table whose own comment says it may not
-- grow a fifth, and `activeMapsPull` would then see the plan itself as a running pull and refuse to
-- start the pull it is trying to start.


-- =====================================================================
-- A. the receipt for a measured metro circle
-- =====================================================================
--
-- ‼️ 15 OF THE 16 PLANNED METROS HAVE NEVER HAD THEIR CIRCLE COUNTED, AND THAT IS THE WHOLE REASON
-- THIS TABLE EXISTS. `territory_metro_rollup` derives `remaining` from
-- list_pipeline_runs.metro_total_count, joined through raw_leads.run_id. That join needs LEADS, so a
-- metro nobody has pulled from has no row, no denominator and no remainder. An auto-planner reading
-- that cannot tell "Houston is empty" from "nobody has looked at Houston", and the difference is
-- whether a budget may be spent there.
--
-- ‼️ IT IS NOT scraper_cells AND IT IS NOT A SECOND COPY OF ONE. docs/2026-10-08-territory-rollups.sql
-- already states the rule and it is right: that table's contract is that WHICH CELLS EXIST is
-- computed from the pure seedGrid()/childrenOf() quadtree, and a geocoded metro centre at whatever
-- radius a command named is not a circle in that tree. Inserting one would put a cell in front of the
-- coverage walk that its own geometry says cannot exist. This is the metro layer's own receipt,
-- keyed the way the metro layer is keyed.
--
-- ‼️ AND IT IS NOT A SECOND SOURCE OF TRUTH FOR A METRO THAT HAS BEEN PULLED. `metroPlan` takes the
-- GREATEST of this and whatever the runs observed, for the reason both of those take a maximum
-- already: the vendor's index is live (the same Dallas circle read 1,765 on 2026-09-28 and 1,990 ten
-- days later, 12.7% growth), so an upward drift must be followed and a downward one must never make
-- a finished metro look unfinished and buy it again.
create table if not exists public.scraper_metro_circles (
  id uuid primary key default gen_random_uuid(),
  vertical_slug text not null,
  -- The METROS key from src/lib/trt.ts, e.g. 'houston'. Not the operator's prose.
  metro_key text not null,
  -- What was actually asked for, kept so a reader can see the circle rather than infer it.
  metro_label text not null,
  location_name text not null,
  latitude double precision not null,
  longitude double precision not null,
  radius_km integer not null check (radius_km between 1 and 500),
  -- ‼️ KEYED ON THE CATEGORY LIST, FOR THE REASON scraper_cells IS. A count is the answer to
  -- "how many businesses match THESE categories inside this circle". Change the list and every
  -- stored count becomes the answer to a question nobody asked, with nothing to say so.
  categories_key text not null,
  total_count integer not null check (total_count >= 0),
  cost_usd numeric(10, 6) not null default 0,
  measured_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- ‼️ ONE ROW PER CIRCLE, SO A RE-MEASURE RAISES RATHER THAN DUPLICATES. Without this a plan that
-- measured Houston twice would leave two counts and `greatest()` over them would still be right,
-- but the table would stop being a statement about circles and become a log. The upsert in
-- recordMetroCircle takes a maximum on conflict.
create unique index if not exists scraper_metro_circles_circle
  on public.scraper_metro_circles (vertical_slug, categories_key, metro_key, radius_km);

-- ‼️ A COLUMN THIS FILE USED TO CREATE AND NO LONGER DOES, DROPPED RATHER THAN LEFT. The first
-- version carried `run_id` as provenance for which run bought a count, and nothing ever read it.
-- scripts/_probe-dead-wires.ts caught it by name, which is exactly what that probe is for, and the
-- honest answer to a write-only column is to remove it rather than to raise the baseline or write a
-- sentence excusing it. The spend is already recorded twice over, on scraper_pull_plan_steps.cost_usd
-- and on the plan's own running total. `if exists` so this file stays safe to run on a database that
-- never saw the first version.
alter table public.scraper_metro_circles drop column if exists run_id;

comment on table public.scraper_metro_circles is
  'How many businesses the vendor reports inside one named metro''s circle for one category list. '
  'Bought for one task fee plus one record ($0.0124) with limit 1, before any records are. The '
  'denominator behind "may a budget be spent in this metro", for metros that have never been pulled '
  'and therefore have no list_pipeline_runs.metro_total_count to read. NOT a scraper_cells row: a '
  'geocoded metro centre is not a circle in the quadtree seedGrid()/childrenOf() compute.';


-- =====================================================================
-- B. the plan
-- =====================================================================
--
-- ‼️ ONE APPROVAL, MANY PURCHASES, AND THE CARD HAS TO SAY SO. Every other gate in this lane is one
-- check mark for one spend. This one authorises a list, which is a genuinely bigger thing to tick, so
-- `approved_cost_usd` records the number that was ON THE CARD at the moment it was ticked. If the
-- walk later costs more than that (the vendor's index grew, a metro held more than its measurement
-- said), the difference is visible rather than inferred.
create table if not exists public.scraper_pull_plans (
  id uuid primary key default gen_random_uuid(),
  vertical_slug text not null,
  requested_records integer not null check (requested_records > 0),
  status text not null default 'awaiting_approval'
    check (status in ('awaiting_approval', 'approved', 'running', 'done', 'cancelled', 'error')),
  slack_channel_id text not null,
  slack_thread_ts text,
  -- ‼️ THE GATE. A reaction on this ts approves the whole plan. It is the plan's own column rather
  -- than a sixth scraper_batches.*_ts for the reason the header gives.
  approval_ts text,
  approved_at timestamptz,
  approved_by text,
  -- What the card said it would cost, at the moment it said it.
  estimated_cost_usd numeric(10, 6) not null default 0,
  -- What it has actually cost so far, added to as each step lands.
  spent_usd numeric(10, 6) not null default 0,
  records_pulled integer not null default 0,
  error text,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ‼️ ONE LIVE PLAN PER VERTICAL, ENFORCED BY THE DATABASE RATHER THAN BY A READ-THEN-WRITE. Two
-- plans walking one vertical would interleave their chunks and each would compute its offsets from a
-- frontier the other was moving. A partial unique index is the only way to say "at most one row in
-- these states" in Postgres, and saying it here means a racing second `pull 2000 medspa` fails loudly
-- instead of quietly doubling the spend.
create unique index if not exists scraper_pull_plans_one_live
  on public.scraper_pull_plans (vertical_slug)
  where status in ('awaiting_approval', 'approved', 'running');

create index if not exists scraper_pull_plans_approval_ts
  on public.scraper_pull_plans (approval_ts) where approval_ts is not null;

comment on table public.scraper_pull_plans is
  'One operator ask ("pull 2000 medspa") and the check mark that authorised it. Walked one step at a '
  'time by cron/scraper-tick. Not a scraper_batches row: a plan outlives the batches it spawns and '
  'would otherwise make activeMapsPull() see itself as the pull it is trying to start.';


-- =====================================================================
-- C. its steps
-- =====================================================================
--
-- ‼️ THREE KINDS, AND `pull_budget` IS THE ONE THAT MAKES AN HONEST PLAN POSSIBLE. A metro whose
-- circle has never been counted cannot be given a chunk list, because nobody knows whether it holds
-- 40 businesses or 4,000. So the plan carries a MEASURE step and, behind it, a reservation: "up to N
-- records here, once we know what here is". The walker expands that into real chunks after the
-- measurement lands, and the card says that is what will happen rather than quoting a chunk count
-- that was invented.
--
--   measure       buy the circle's size. 1 record, 1 task fee, $0.0124.
--   pull_budget   a reservation against a metro being measured in this same plan. Free. Expands.
--   pull          one concrete `pull maps ... | limit N | offset M`. The only kind that buys records.
create table if not exists public.scraper_pull_plan_steps (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.scraper_pull_plans(id) on delete cascade,
  -- Walk order. Gaps are fine and expected: expanding a pull_budget inserts between two seqs.
  seq numeric not null,
  kind text not null check (kind in ('measure', 'pull_budget', 'pull')),
  metro_key text not null,
  metro_label text not null,
  -- "Houston TX", the string the command names. Resolved once, here, so the walker never re-derives it.
  where_text text not null,
  -- Null on measure and pull_budget.
  pull_limit integer check (pull_limit is null or pull_limit > 0),
  pull_offset integer check (pull_offset is null or pull_offset >= 0),
  -- pull_budget only: how many records are reserved for this metro.
  budget_records integer check (budget_records is null or budget_records > 0),
  -- The exact command text, for a `pull` step. Stored so the batch label and the plan agree byte for
  -- byte, the same discipline cellPullCommand already follows: the label is what cellDepthFrom joins
  -- on, so a label the plan cannot reproduce is a paging depth of zero forever.
  command_text text,
  estimated_cost_usd numeric(10, 6) not null default 0,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'done', 'skipped', 'error')),
  -- The batch this step spawned, for a `pull`. Null until it starts.
  batch_id uuid references public.scraper_batches(id) on delete set null,
  records_pulled integer,
  cost_usd numeric(10, 6),
  note text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists scraper_pull_plan_steps_walk
  on public.scraper_pull_plan_steps (plan_id, status, seq);

comment on table public.scraper_pull_plan_steps is
  'The chunks of one pull plan, in walk order. Claimed one at a time by cron/scraper-tick with a '
  'conditional update, so two ticks cannot run the same step. A `pull` step is the only kind that '
  'buys records; `measure` buys a count for $0.0124 and `pull_budget` is a free reservation that '
  'expands into `pull` steps once its metro has been measured.';


-- =====================================================================
-- D. the one circle already measured, transcribed
-- =====================================================================
--
-- Dallas has been read twice against the same 30km circle and the same five categories: 1,765 on
-- 2026-09-28 and 1,990 on 2026-10-08. docs/2026-10-09-dallas-circle-correction.sql already raised
-- list_pipeline_runs.metro_total_count to 1,990 on all six runs. This writes the same fact into the
-- metro layer so a planner reading ONLY this table still knows Dallas has 240 left rather than
-- proposing to measure a circle that has been measured six times.
--
-- ‼️ `greatest(...)` ON CONFLICT, NEVER A PLAIN ASSIGNMENT, for the third time in this lane and for
-- the same reason: the vendor's index is live, so follow an upward drift and never write a downward
-- one. Running this file after a larger reading has landed cannot lower the number.
--
-- ‼️ THE COORDINATE IS THE ONE THE PULLS ACTUALLY USED. 32.7767,-96.7970 is the Dallas centre that
-- appears in MAPS_GRAMMAR's own worked example and in every Dallas card. Inventing a different
-- centre here would make this row describe a circle nothing has ever pulled.
insert into public.scraper_metro_circles
  (vertical_slug, metro_key, metro_label, location_name, latitude, longitude, radius_km,
   categories_key, total_count, cost_usd, measured_at)
values
  ('medspa', 'dfw', 'Dallas-Fort Worth', 'Dallas,Texas,United States',
   32.7767, -96.7970, 30,
   -- categoriesKey() in src/lib/scraper/cells.ts: lowercased, sorted, joined on '+'. Typed out
   -- rather than described, because a key that does not match byte for byte is a circle the
   -- planner cannot find and will pay to measure again.
   'facial_spa+laser_hair_removal_service+medical_spa+permanent_make_up_clinic+skin_care_clinic',
   1990, 0, '2026-10-08T00:00:00Z')
on conflict (vertical_slug, categories_key, metro_key, radius_km) do update
  set total_count = greatest(public.scraper_metro_circles.total_count, excluded.total_count),
      measured_at = greatest(public.scraper_metro_circles.measured_at, excluded.measured_at);


-- =====================================================================
-- Verification
-- =====================================================================
--
-- ‼️ WRITTEN TO BE ABLE TO FAIL. `dallas_remaining` must be 240: the 1,990 circle less the 1,750
-- already pulled. If it is not, either the correction file has not been run or the categories_key
-- above does not match the one categoriesKey() produces, and the planner would then measure a circle
-- that is already measured and allocate against the wrong denominator.
select
  (select count(*) from public.scraper_metro_circles) as circles,
  (select total_count from public.scraper_metro_circles
    where vertical_slug = 'medspa' and metro_key = 'dfw') as dallas_circle,
  (select count(*) from public.raw_leads where source_metro = 'Dallas TX') as dallas_pulled,
  (select total_count from public.scraper_metro_circles
    where vertical_slug = 'medspa' and metro_key = 'dfw')
    - (select count(*) from public.raw_leads where source_metro = 'Dallas TX') as dallas_remaining,
  (select count(*) from public.scraper_pull_plans) as plans,
  (select count(*) from public.scraper_pull_plan_steps) as steps;
