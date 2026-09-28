-- The country, measured instead of guessed: one row per circle we have paid to count.
--
--   bun run scripts/db.ts --file=docs/2026-09-28-national-coverage-cells.sql --dry
--   bun run scripts/db.ts --file=docs/2026-09-28-national-coverage-cells.sql
--
-- Additive, idempotent, safe to run more than once. Nothing here narrows an existing check.
--
-- ‼️ WHY A TABLE AT ALL, IN A LANE THAT DELIBERATELY HAS NO QUEUE TABLE. nextTarget() in
-- src/lib/scraper/maps-command.ts answered "what is next" by re-parsing scraper_batches.batch_label,
-- and the note above it is right: a second copy of the intent is a second thing to drift. That
-- worked because the plan's SHAPE was a constant in code, US_METROS, fifty strings, knowable
-- without asking anybody. A quadtree's shape is not. It is decided by DataForSEO's total_count,
-- which costs $0.0124 to learn, cannot be recovered from any label (a label says what was ASKED
-- FOR, never how many are there), and for a circle holding zero businesses leaves behind no batch,
-- no run and no lead row to derive it from. Roughly 25 of the 75 seed circles are ocean. Those are
-- exactly the cells the progress card most needs to call finished, and exactly the ones nothing
-- else can remember for us.
--
-- ‼️ SO THE MEASUREMENT IS STORED AND NOTHING ELSE IS. The split of authority is the design:
--
--   stored here     total_count for one circle and one category list, plus what it cost
--   still derived   how deep a cell has been paged: offset + limit of its deepest LANDED pull,
--                   re-parsed out of batch_label, the same arithmetic nextTarget used and for the
--                   same reason (summing rows delivered drifts below the frontier the moment a
--                   page comes back short, and re-buys ground already covered)
--   still derived   leaf or interior: total_count against the budget, or the existence of a child
--                   row, computed in src/lib/scraper/coverage.ts, pure and offline-provable
--   still derived   which cells exist: seedGrid() and childrenOf() are pure, so an unmeasured cell
--                   is COMPUTED and never a row
--
-- A row here is a RECEIPT FOR A PURCHASE, never a status. There is no status column, no
-- pulled_rows column and no offset_done column on purpose: each would be a second copy of
-- something batch_label already knows, and the first thing a second copy does is disagree.
--
-- ‼️ WHY NOT client_datasets. Its own header forbids exactly this: the write is an upsert that
-- REPLACES on conflict, so "any lane storing a measurement rather than a fact cannot get that from
-- this table". total_count IS a measurement: it read 159,075 then 159,074 seconds apart on
-- 2026-09-28, and when a crawl stalls the earlier reading is what the argument is made from.
--
-- ‼️ WHY categories_key IS PART OF THE IDENTITY. A count is the answer to a question, and the
-- question is (circle, category list). DFS_CATEGORIES['medspa'] is three keys today; adding
-- 'day_spa' would turn every stored count into the answer to a question nobody asked any more, and
-- nothing would say so. In the key, a changed list starts a FRESH tree and the old rows survive to
-- be compared against. Paging depth cannot be protected the same way, because a batch label does
-- not name its categories: changing the list for a live vertical invalidates every paged offset for
-- it, and the remedy is A NEW VERTICAL SLUG, not an edit. The coverage card prints the list it is
-- walking so the change is at least visible.
--
-- ‼️ NOTHING HERE IS WRITTEN BY THE CRON. Every row costs $0.0124 and every one is bought by a
-- check mark on a card, behind the same gate a record pull goes through.

create table if not exists public.scraper_cells (
  id uuid primary key default gen_random_uuid(),

  -- Which buyer profile's categories were counted. A circle has a different answer per vertical.
  vertical_slug  text not null,

  -- The sorted DataForSEO category list, joined with '+'. Part of the identity: see the header.
  categories_key text not null,

  -- ‼️ THE IDENTITY, AND IT IS BYTE-IDENTICAL TO DataForSEO'S location_coordinate PARAMETER.
  -- "lat,lon,radiusKm" at four decimal places, about 11 metres. One string is the cell's identity,
  -- the coordinate triple in scraper_batches.batch_label, the API's geo filter and
  -- raw_leads.source_metro. Nothing is converted, so nothing can be converted wrongly.
  -- cellKey() in src/lib/scraper/cells.ts is the ONLY thing allowed to write this.
  cell_key       text not null,

  -- The same three numbers, parsed, so the card and the state roll-up can be queried in SQL.
  -- Written from the same object cell_key is built from, never re-derived by hand.
  lat            numeric(8,4) not null check (lat between -90 and 90),
  lon            numeric(9,4) not null check (lon between -180 and 180),

  -- ‼️ AN INTEGER, BECAUSE A KEY HOLDING A FLOAT RADIUS IS A KEY THAT CAN BE WRITTEN TWO WAYS, and a
  -- key that can be written two ways is a key that can be missed: two probes bought, two rows stored,
  -- and a paging depth that joins to neither. cells.ts rounds UP to the whole kilometre for this.
  --
  -- ‼️ AND THE RADII ARE NOT CLEAN HALVINGS, WHICH IS A CORRECTION WORTH RECORDING. The obvious rule
  -- is "a child's radius is half its parent's", giving 384, 192, 96, 48, 24, 12. It leaves a sliver of
  -- the parent UNCOVERED, because half the parent's box measured in DEGREES OF LONGITUDE is wider than
  -- a box of half its kilometre half-side placed at the child's own latitude. Measured for a 384km
  -- parent: 1.32km uncovered at 25N, 1.64km at 30N, 2.39km at 40N, 3.29km at 49N, recurring at EVERY
  -- level of the tree and widest exactly where the country is widest. So radiusCovering() in cells.ts
  -- DERIVES each child's radius from the box it has to cover and rounds up, which yields 192 for the
  -- poleward children of a 384km cell and 195 for the equatorward ones. A few extra kilometres of
  -- overlap is the price of not silently skipping clinics, and the overlap is deduped downstream.
  radius_km      integer not null check (radius_km between 1 and 3000),

  -- ‼️ THE MEASUREMENT. How many businesses DataForSEO reports inside the CIRCLE of radius_km. The
  -- cell's own extent is the inscribed square of half-side radius_km/sqrt(2), so this over-counts
  -- the cell by the corners, deliberately: over-counting splits early and never leaves a cell too
  -- big to page. Do NOT "correct" it by area ratio. Paging to this number is what guarantees the
  -- square is exhausted.
  --
  -- ‼️ RAISED BY max(), NEVER OVERWRITTEN. Every record pull returns total_count for free and the
  -- index is live. A maximum follows an upward drift, so no row is lost, and can never lower the
  -- number a finished cell was finished against, so nothing already done comes undone.
  --
  -- A parent's total_count is NOT the sum of its children's: their circles overlap each other and
  -- spill outside the parent's square. Never present it as one.
  total_count    integer not null check (total_count >= 0),

  -- Nominatim on the CENTRE, cached for a year, free. Null means not looked up or not resolvable,
  -- reported as 'unplaced' and never guessed. A 384km circle spans four states, so this is a bucket
  -- LABEL for the progress card, not a boundary claim: exact enough at the 12km floor, which is
  -- where the records are. How many LEADS are in each state is a DIFFERENT question, answered by
  -- raw_leads.state off address_info.region, and the card prints both, labelled.
  state_name     text,

  -- ‼️ PROVENANCE ONLY. THE WALK MUST NEVER READ THESE. They are here so the card can say "this one
  -- split into four". Keeping them out of every decision is what stops a wrong value changing what
  -- gets bought. Leaf-or-interior is computed in coverage.ts; depth is implied by radius_km.
  parent_key     text,
  depth          integer not null default 0 check (depth between 0 and 8),

  -- What was actually charged, from DataForSEO's own response. Never estimated.
  cost_usd       numeric not null default 0,

  probed_at      timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

-- One measurement per question. A probe step re-driven after a crash inserts nothing twice.
create unique index if not exists scraper_cells_identity
  on public.scraper_cells (vertical_slug, categories_key, cell_key);

-- The walk reads every cell for one vertical at once: a few hundred rows, one index.
create index if not exists scraper_cells_walk
  on public.scraper_cells (vertical_slug, categories_key, radius_km);

create index if not exists scraper_cells_state
  on public.scraper_cells (vertical_slug, state_name);

-- The free backfill worklist. Partial, so it indexes only the handful still unplaced.
create index if not exists scraper_cells_unplaced
  on public.scraper_cells (vertical_slug)
  where state_name is null;

comment on table public.scraper_cells is
  'One circle we have paid DataForSEO to count, per vertical and per category list. A RECEIPT, not '
  'a status: total_count cannot be derived from anything else and a zero cell leaves no other '
  'trace, so it is stored. Paging depth, leaf-vs-interior and which cells exist are all still '
  'DERIVED, from batch_label, from the budget, and from the pure seedGrid()/childrenOf() geometry. '
  'Never written by the cron; every row is bought by a check mark.';

comment on column public.scraper_cells.cell_key is
  '"lat,lon,radiusKm" at 4dp, written only by cellKey() in src/lib/scraper/cells.ts. Byte-identical '
  'to DataForSEO''s location_coordinate parameter and to the coordinate triple in batch_label, '
  'which is what lets the label, the identity, the API filter and raw_leads.source_metro be one '
  'string.';

comment on column public.scraper_cells.total_count is
  'Businesses inside the CIRCLE of radius_km. Raised by max() on every later observation, never '
  'overwritten: the index is live, an upward drift must be followed, and a downward one must not '
  'un-finish a finished cell. Not the sum of its children.';

comment on column public.scraper_cells.parent_key is
  'Provenance for the progress card. The walk must never read it; leaf-vs-interior is computed.';

alter table public.scraper_cells enable row level security;


-- ------------------------------------------------------------------------------------------------
-- The cross-run duplicate check, which is the gap overlapping circles open.
--
-- raw_leads is unique on (run_id, place_id) only WITHIN a run, and circles cannot tile a plane, so
-- the same clinic arrives under several runs. The record cost is trivial; the Claude qualification
-- sweep over every duplicate is not. dropCrossRunDuplicates() in src/lib/scraper/listprep.ts asks
-- "has this place_id been seen in a row created before this run started", which needs place_id
-- indexed on its own. raw_leads_domain does not serve it.
--
-- ‼️ DEDUPING ON domain WAS CONSIDERED AND REJECTED. A twelve-location chain shares one domain, so
-- a domain rule drops eleven real clinics. place_id is per location.
-- ------------------------------------------------------------------------------------------------
create index if not exists raw_leads_place_created
  on public.raw_leads (place_id, created_at)
  where place_id is not null;

comment on index public.raw_leads_place_created is
  'The pre-qualification cross-run duplicate check. Overlapping cells re-deliver the same business '
  'under a new run_id, where the (run_id, place_id) unique index cannot see it, and every duplicate '
  'would otherwise be paid for by the model sweep.';


-- ------------------------------------------------------------------------------------------------
-- The workflow union learns the measurement step.
--
-- WIDENED, NEVER NARROWED. Every existing value stays legal, so no in-flight batch can fail its own
-- check mid-run.
--
-- ‼️ WHY A FIFTH ARM RATHER THAN REUSING mapspull, AND IT IS FOR CORRECTNESS, NOT TIDINESS.
-- mapsPullHistory() filters workflow = 'mapspull' and re-parses batch_label into an offset and a
-- limit. A measurement step's label is not a page of records; read as one it would credit paging
-- depth to a cell that was only counted, and the walk would skip 500 real businesses believing they
-- had been bought. A distinct workflow value is what makes a probe INVISIBLE to that query.
--
-- ‼️ AND NO NEW STATUS AND NO NEW GATE COLUMN. A measurement step reuses awaiting_pull_approval,
-- pulling, and list_pipeline_runs.pull_approval_ts / spend_approved_at / cost_usd, which already
-- mean exactly "the card, the check mark, and what it cost". scraper_batches MAY NOT GROW A FIFTH
-- *_ts: GATE_COLUMNS in src/lib/scraper/store.ts says so and docs/2026-09-25-front-doors.sql
-- repeats it. So a batch-level probe gate was not available, and inventing one would duplicate a
-- column that already exists.
-- ------------------------------------------------------------------------------------------------
alter table public.scraper_batches drop constraint if exists scraper_batches_workflow_check;
alter table public.scraper_batches add constraint scraper_batches_workflow_check
  check (workflow is null or workflow in ('filter', 'score', 'listprep', 'mapspull', 'mapsprobe'));


-- Verify. Plain counts, so nothing here can roll the migration back. Expect 1 on every row, 0 cells.
select 'scraper_cells_table'      as check, count(*)::text as n from information_schema.tables
  where table_schema='public' and table_name='scraper_cells'
union all select 'cells_identity_index', count(*)::text from pg_indexes
  where schemaname='public' and indexname='scraper_cells_identity'
union all select 'cells_state_index', count(*)::text from pg_indexes
  where schemaname='public' and indexname='scraper_cells_state'
union all select 'cells_unplaced_is_partial', count(*)::text from pg_indexes
  where schemaname='public' and indexname='scraper_cells_unplaced' and indexdef like '%WHERE%'
union all select 'cells_rls_enabled', count(*)::text from pg_class
  where relname='scraper_cells' and relrowsecurity
union all select 'raw_leads_place_created', count(*)::text from pg_indexes
  where schemaname='public' and indexname='raw_leads_place_created'
union all select 'workflow_has_mapsprobe', count(*)::text from pg_constraint
  where conname='scraper_batches_workflow_check' and pg_get_constraintdef(oid) like '%mapsprobe%'
union all select 'workflow_still_has_mapspull', count(*)::text from pg_constraint
  where conname='scraper_batches_workflow_check' and pg_get_constraintdef(oid) like '%mapspull%'
union all select 'cells_rows_expect_0', count(*)::text from public.scraper_cells;
