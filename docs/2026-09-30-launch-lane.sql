-- The Launch Lane: a second onboarding path, for a client with no website, in any niche.
-- Safe to run more than once.
--
-- ‼️ THIS ADDS A SECOND LANE. IT DOES NOT CHANGE THE FIRST ONE.
-- Nothing here touches `client_delivery_steps`, and nothing in src/lib/launch/ may import the
-- Slack board's registry or engine (scripts/_probe-launch-isolation.ts enforces that half).
-- The two lanes share the DATA -- clients, client_audiences, client_offers, audience_documents,
-- page_sources, client_pages, client_hosts, concierge_configs -- and share nothing else. A client
-- onboarded here is an ordinary `clients` row, so every existing panel, metric and report keeps
-- working without knowing this lane exists.
--
-- WHY A SECOND TABLE RATHER THAN A `track` COLUMN ON THE FIRST.
-- `STEP_VERIFIERS` in step-verify.ts is `Record<StepKey, Verifier>` and exhaustive by type, and
-- `seedDeliverySteps()` re-seeds whenever a client holds fewer rows than DELIVERY_STEPS.length.
-- A lane that shared that registry could not drop a step without either breaking the build or
-- making every Slack client re-seed the steps it had deliberately skipped.

create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. client_launch_steps -- the 16-step board, with no Slack in it
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Deliberately mirrors client_delivery_steps MINUS every Slack column. There is no
-- slack_anchor_ts and no slack_message_ts, because this lane has no channel: a step is worked
-- on a dashboard page, not in a thread. Adding one later would be the moment this lane stopped
-- being a separate lane.
--
-- The same two honest tiers the Slack board uses are kept, because the reasoning survives the
-- change of surface: `system` means the app observed real state (a row, an HTTP 200), `filed`
-- means a person filed an artifact and the app read it back. There is no third value and no
-- override, so "mark done anyway" would need a migration and would have to read this first.
create table if not exists public.client_launch_steps (
  id            uuid        primary key default gen_random_uuid(),
  client_id     uuid        not null references public.clients(id) on delete cascade,

  -- Stable key, not a position. Order lives in src/config/launch-steps.ts so a step can be
  -- reworded or reordered without a migration, and an existing row keeps its meaning.
  -- No enum, for the reason delivery-steps.ts states twice: renaming a key orphans every row
  -- already carrying it.
  step_key      text        not null,

  status        text        not null default 'pending',
  completed_at  timestamptz,
  completed_by  text,
  note          text,

  started_at     timestamptz,
  error_detail   text,
  skipped_reason text,
  output_ref     text,

  verified_source text,
  verified_detail text,
  verified_at     timestamptz,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.client_launch_steps
  drop constraint if exists client_launch_steps_status_check;
alter table public.client_launch_steps
  add constraint client_launch_steps_status_check
  check (status in (
    'pending', 'blocked', 'ready', 'running', 'awaiting_me', 'complete', 'skipped', 'error'
  ));

alter table public.client_launch_steps
  drop constraint if exists client_launch_steps_verified_source_check;
alter table public.client_launch_steps
  add constraint client_launch_steps_verified_source_check
  check (verified_source is null or verified_source in ('system', 'filed'));

-- A verdict has a time or it is not a verdict. Same pairing the Slack board enforces.
alter table public.client_launch_steps
  drop constraint if exists client_launch_steps_verified_pair_check;
alter table public.client_launch_steps
  add constraint client_launch_steps_verified_pair_check
  check ((verified_at is null) = (verified_source is null));

create unique index if not exists client_launch_steps_client_key_uidx
  on public.client_launch_steps (client_id, step_key);
create index if not exists client_launch_steps_client_idx
  on public.client_launch_steps (client_id);

alter table public.client_launch_steps enable row level security;

comment on column public.client_launch_steps.verified_source is
  'system = the app observed real state. filed = a person filed an artifact and the app read it back. There is no third value, and there is no override.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. clients.onboarding_lane -- which board this client is worked on
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Defaults to 'slack' so every existing client keeps the board it already has, and so a row
-- created by any of the existing doors is unchanged by this migration.
alter table public.clients
  add column if not exists onboarding_lane text not null default 'slack';

alter table public.clients drop constraint if exists clients_onboarding_lane_check;
alter table public.clients add constraint clients_onboarding_lane_check
  check (onboarding_lane in ('slack', 'launch'));

comment on column public.clients.onboarding_lane is
  'slack = the 41-step delivery board in the client ops channel. launch = the 16-step Launch Lane on the dashboard. It selects a BOARD, not a product: both lanes publish through publishPage().';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. client_audiences.vocabulary_source gains 'documents'
-- ─────────────────────────────────────────────────────────────────────────────
--
-- ‼️ A NEW VALUE RATHER THAN REUSING 'typed', BECAUSE THIS COLUMN IS A PROVENANCE COLUMN.
-- The existing values say: 'preset' a code preset seeded it, 'legacy_default' it records the
-- status quo rather than a decision, 'typed' a person wrote it. A Launch Lane audience is none
-- of those: a model read the client's four foundation documents and PROPOSED the words, and a
-- person confirmed them. Filing that as 'typed' would put a model's wording behind a value that
-- means a human wrote it, in the one column whose entire job is to say where the words came
-- from. The whole reason to record provenance is to be able to distrust it later.
--
-- It does NOT weaken the read-once rule in src/config/audience-presets.ts: the proposal is read
-- once, confirmed by a person, and written to this row. Nothing reads documents at request time.
-- ‼️ ALL FIVE VALUES ARE LISTED, AND 'borrowed' IS THE ONE THAT ALMOST WENT MISSING.
-- The CREATE TABLE in docs/2026-09-14-client-audiences.sql declares three, and reading only that
-- file makes four look like the complete set. docs/2026-09-24-borrowed-audience.sql added a
-- fourth ten days later. A re-declared CHECK is a REPLACEMENT, not an addition, so dropping
-- 'borrowed' here would either fail this ALTER outright against a database that already holds a
-- borrowed row, or pass today and refuse the next borrowAvatar() write with a constraint
-- violation nobody would connect to this migration.
--
-- The rule: a constraint being re-declared is a constraint whose CURRENT definition has to be
-- read out of the database or out of the LAST migration that touched it, never the first.
alter table public.client_audiences drop constraint if exists client_audiences_vocabulary_source_check;
alter table public.client_audiences
  add constraint client_audiences_vocabulary_source_check
  check (vocabulary_source is null
         or vocabulary_source in ('preset', 'legacy_default', 'typed', 'borrowed', 'documents'));

comment on column public.client_audiences.vocabulary_source is
  '''preset'' a code preset seeded it; ''legacy_default'' inherited from the old two-lane defaults, recording the status quo rather than a decision; ''typed'' a person wrote it; ''borrowed'' copied from another client''s audience for the same avatar slug, the weakest of the five; ''documents'' proposed from this client''s own foundation documents and confirmed by a person. A null vocabulary_confirmed_at with source legacy_default is the case the card must ask about.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. client_hosts.kind gains 'site'
-- ─────────────────────────────────────────────────────────────────────────────
--
-- 'hub' is learn.{theirdomain}: an index plus one level of answer slugs, on a hostname their
-- registrar points at us. 'site' is the whole website on a domain SRT bought and holds, where
-- the apex serves the marketing pages and /answers/* serves the same answer pages the hub
-- renderer has always served.
--
-- ‼️ THE APEX GETS THE ROW; www DOES NOT, AND THAT IS WHY THE UNIQUE INDEX IS UNTOUCHED.
-- client_hosts is already unique on (client_id, kind), so a second 'site' row for www would be
-- rejected. www is attached to the Vercel project with `redirect` set to the apex
-- (POST /v10/projects/{id}/domains accepts redirect + redirectStatusCode), so it never reaches
-- this application and never needs a row. That also keeps this migration off the same index
-- that the in-flight destinations work re-keys to (client_id, kind, delivery).
alter table public.client_hosts drop constraint if exists client_hosts_kind_check;
alter table public.client_hosts add constraint client_hosts_kind_check
  check (kind in ('hub', 'reviews', 'site'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 4b. hub_hits.kind gains 'site' TOO, and forgetting this would have been invisible
-- ─────────────────────────────────────────────────────────────────────────────
--
-- ‼️ THIS IS THE ONE IN THIS FILE THAT WOULD HAVE FAILED SILENTLY AND STAYED THAT WAY.
-- hub_hits is where crawler evidence lands, and crawler evidence is what this product is sold
-- on. The insert happens in recordHit(), called from /api/internal/hub-hit, which is called from
-- a middleware waitUntil on a response that has ALREADY GONE OUT, and whose catch deliberately
-- swallows everything so a database blip cannot break a page. Correct, and it means a CHECK
-- violation here produces no error anybody sees.
--
-- So a Launch Lane client would have served perfectly, been crawled perfectly, and reported
-- zero hits forever, while every other client's numbers looked healthy. Nobody goes looking for
-- a number that is absent rather than wrong.
alter table public.hub_hits drop constraint if exists hub_hits_kind_check;
alter table public.hub_hits add constraint hub_hits_kind_check
  check (kind in ('hub', 'reviews', 'site'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. client_site_pages -- the pasted marketing site
-- ─────────────────────────────────────────────────────────────────────────────
--
-- ‼️ RAW HTML LIVES HERE AND ONLY HERE. src/lib/hub/skin.ts states the rule this table is
-- built to respect: the hub's markup is not themable and must never become themable, because
-- the JSON-LD, the heading order and the canonical NAP block in hub-bodies.tsx are the thing
-- the client is paying for. A skin that could carry its own HTML could silently delete it.
-- So the pasted site sits BESIDE the answer pages on the same domain, never inside their
-- renderer, and client_pages is untouched.
--
-- ‼️ THE HTML STORED HERE IS ALREADY SANITISED. Sanitising happens on WRITE, in
-- src/lib/launch/site-pages.ts, not at render time -- one door, so a second render surface
-- cannot forget. This is HTML a person pasted, served on a domain we own, on a page carrying a
-- widget that takes visitor input.
create table if not exists public.client_site_pages (
  id           uuid        primary key default gen_random_uuid(),
  client_id    uuid        not null references public.clients(id) on delete cascade,

  -- The public path, leading slash included: '/' for the home page, '/about' for a page.
  path         text        not null,
  title        text        not null,
  html         text        not null,
  meta_description text,

  nav_label    text,
  nav_order    smallint,

  status       text        not null default 'draft',
  published_at timestamptz,

  -- What the sanitiser took out, so a stripped <script> is visible rather than silent.
  sanitized_note text,

  created_at   timestamptz not null default now(),
  created_by   text,
  updated_at   timestamptz not null default now()
);

-- ‼️ THE DATABASE REFUSES A PATH THE MIDDLEWARE WOULD REFUSE.
-- This is HUB_SLUG from src/middleware.ts, written again in SQL on purpose: a row that can be
-- stored but can never be served is a page somebody will spend an afternoon looking for. One
-- segment, no dot, no slash, no encoded traversal -- so nothing under /api or /dashboard can
-- ever be claimed by a site page, and neither can /foo.php.
alter table public.client_site_pages drop constraint if exists client_site_pages_path_check;
alter table public.client_site_pages add constraint client_site_pages_path_check
  check (path = '/' or path ~ '^/[a-z0-9]([a-z0-9-]{0,78}[a-z0-9])?$');

-- ‼️ /answers AND /api ARE RESERVED, AND THE DATABASE IS WHERE THAT IS SAID.
-- /answers because a static route segment beats a dynamic one in Next, so a site page stored
-- there would be shadowed by the answer index and would render as a 404 nobody could explain.
-- /api because the bare word is shape-legal above (the middleware allowlist refuses anything
-- starting '/api/', but a single segment carries no slash), so it would quietly serve a client's
-- marketing page at their own /api. Not dangerous, just inexplicable at 2am.
-- Kept in step with RESERVED_PATHS in src/lib/launch/site-pages.ts.
alter table public.client_site_pages drop constraint if exists client_site_pages_reserved_check;
alter table public.client_site_pages add constraint client_site_pages_reserved_check
  check (path not in ('/answers', '/api'));

alter table public.client_site_pages drop constraint if exists client_site_pages_status_check;
alter table public.client_site_pages add constraint client_site_pages_status_check
  check (status in ('draft', 'published', 'archived'));

-- A published page has a time. Nothing is said about the other two states, on purpose.
--
-- ‼️ NOT `(status = 'published') = (published_at is not null)`, WHICH IS THE OBVIOUS VERSION AND
-- IS WRONG IN ONE DIRECTION. That biconditional also forbids an ARCHIVED page from carrying a
-- published_at, so taking a live page down would mean erasing the date it went live: the one fact
-- most worth keeping about a page that is no longer up, and the one a crawler-visibility argument
-- is later made from. A draft that has never been published simply has null, and a draft that was
-- published once and reverted keeps its history rather than being forced to lie about it.
alter table public.client_site_pages drop constraint if exists client_site_pages_published_check;
alter table public.client_site_pages add constraint client_site_pages_published_check
  check (status <> 'published' or published_at is not null);

create unique index if not exists client_site_pages_client_path_uidx
  on public.client_site_pages (client_id, lower(path));
create index if not exists client_site_pages_client_idx
  on public.client_site_pages (client_id);

alter table public.client_site_pages enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. client_domain_orders -- the money ledger
-- ─────────────────────────────────────────────────────────────────────────────
--
-- ‼️ THIS LANE SPENDS REAL MONEY, WHICH NOTHING ELSE IN THIS REPO DOES.
-- POST /v1/registrar/domains/{domain}/buy is a purchase. A row is written BEFORE the call with
-- status 'requested' and updated after it, so a purchase that succeeded at Vercel and failed to
-- return to us leaves evidence rather than a silent second charge on the retry. Same "record
-- what HAPPENED, not what was intended" split as client_hosts against client_dns_records.
create table if not exists public.client_domain_orders (
  id            uuid        primary key default gen_random_uuid(),
  client_id     uuid        not null references public.clients(id) on delete cascade,

  domain        text        not null,
  years         smallint    not null default 1,
  auto_renew    boolean     not null default true,

  -- The price shown to the person who pressed the button, in USD cents. An integer, because a
  -- float here is a rounding bug on an invoice. See feedback on Zoho currency fields: a
  -- formatted "$X,XXX" string is how a whole write gets dropped.
  expected_price_cents integer,
  charged_price_cents  integer,

  status        text        not null default 'requested',
  vercel_order_id text,
  vercel_error  text,

  requested_by  text,
  requested_at  timestamptz not null default now(),
  completed_at  timestamptz
);

alter table public.client_domain_orders drop constraint if exists client_domain_orders_status_check;
alter table public.client_domain_orders add constraint client_domain_orders_status_check
  check (status in ('requested', 'bought', 'failed'));

-- One live order per domain. A retry after a failure is allowed; a second purchase of a domain
-- we already bought is not.
create unique index if not exists client_domain_orders_domain_uidx
  on public.client_domain_orders (lower(domain)) where status <> 'failed';
create index if not exists client_domain_orders_client_idx
  on public.client_domain_orders (client_id);

alter table public.client_domain_orders enable row level security;
