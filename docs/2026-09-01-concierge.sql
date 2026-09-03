-- The AI Skin Concierge, part 1 of 1: the widget's config, its sessions, and the magnet library.
-- src/lib/concierge/*. Delivered by two new steps in src/config/delivery-steps.ts:
-- `concierge_preview` (before the call) and `concierge_live` (after it).
--
-- Safe to run more than once. Every statement is create-if-not-exists, add-column-if-not-exists,
-- or an insert guarded by a not-exists.
--
-- Run this BEFORE deploying the concierge lane. Nothing on main reads these tables, so it is
-- also safe to run against production today and deploy later.
--
-- ‼️ THIS LANE STORES A PHOTOGRAPH OF A PATIENT'S FACE AND PROMISES TO DELETE IT IN 24 HOURS.
-- That promise is kept by /api/cron/concierge-purge and by nothing else. There is no storage
-- lifecycle rule, no trigger, and no other deletion code anywhere in this repo -- `.remove(`
-- has zero hits on main. If the cron is not scheduled in vercel.json, the consent copy on every
-- live client's widget is false from the first scan. Ship the cron BEFORE the upload route.
--
-- ‼️ THE PURGE SWEEPS THE BUCKET, NOT JUST THIS TABLE. An upload that succeeds and whose session
-- insert then fails leaves a face on disk with no row pointing at it, and a table-driven purge
-- will never see it. concierge_sessions_purge_idx is the happy path; the orphan sweep is the one
-- that keeps the promise honest.
--
-- ‼️ NO TABLE HERE EVER STORES A MASK URL OR A DERIVED FACE IMAGE. The analysis provider returns
-- heat-map overlays; the browser composites them over the blob it is already holding and they are
-- gone when the tab closes. mask_count records that they arrived. A url column here would be a
-- second retention obligation on a third party's CDN whose expiry we do not control.


-- ─────────────────────────────────────────────────────────────────────
-- 1. The magnet library.
--
-- Resolved MOST-SPECIFIC-FIRST down a six-rung ladder, so no page can ever have a dead CTA:
--
--   1. (client_id, vertical, treatment, category)   this client, this page
--   2. (client_id, vertical, treatment, null)       this client, this treatment
--   3. (client_id, null,     null,      null)       this client, anything
--   4. (null,      vertical, treatment, category)   library, this page
--   5. (null,      vertical, null,      category)   library, this category
--   6. (null,      null,     null,      null)       the universal fallback, seeded at the bottom
--
-- ‼️ NULL MEANS "ANY", NOT "UNKNOWN", AND IT IS THE ONLY PLACE IN THIS SCHEMA WHERE THAT IS TRUE.
-- Everywhere else in this repo a null is an unmeasured tri-state. Here a null category is a
-- deliberate wildcard that makes the ladder terminate. Do not copy the reading elsewhere.
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.lead_magnets (
  id               uuid primary key default gen_random_uuid(),
  -- null = a library magnet available to every client. Set = this client's own asset, and it
  -- outranks anything in the library. "Your magnets, or ours" is a sentence in the pitch.
  client_id        uuid references public.clients(id) on delete cascade,
  vertical         text,
  treatment        text,
  -- ‼️ THE EIGHT STRINGS ARE themeOf()'s OUTPUT AND THEY ARE COPIED, NOT DERIVED. They live in
  -- src/lib/hub/page-theme.ts (extracted from artifacts/page-candidates.ts). deriveIdeas()
  -- clusters on these same literals, so neither list may be renamed without the other. Note
  -- Neighbourhood is spelled British, because that is how it is spelled in the code.
  category         text,
  title            text not null,
  promise          text not null,
  asset_url        text,
  -- The line the concierge opens with when the visitor takes this magnet instead of booking.
  -- Not a template with slots: a magnet whose entry line reads wrong is edited here, not in code.
  concierge_entry  text not null,
  active           boolean not null default true,
  -- ‼️ THE TIE-BREAK, AND IT IS NOT OPTIONAL. Two magnets at the same rung with no deterministic
  -- order means the CTA on a cached page changes between renders, which reads as a broken site.
  sort_order       integer not null default 100,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.lead_magnets drop constraint if exists lead_magnets_category_check;
alter table public.lead_magnets add constraint lead_magnets_category_check check (
  category is null or category in (
    'Objection','Comparison','Tool','Guide','Price','Neighbourhood','Booking','General'
  )
);

-- The resolver's only query shape: filter to active, then walk the ladder.
create index if not exists lead_magnets_resolve_idx
  on public.lead_magnets (vertical, treatment, category, sort_order) where active;
create index if not exists lead_magnets_client_idx
  on public.lead_magnets (client_id, sort_order) where client_id is not null and active;

alter table public.lead_magnets enable row level security;

comment on table public.lead_magnets is
  'What the concierge offers when a visitor will not book. Selected automatically from the '
  'category of the hub page they landed on, never chosen by a human at request time. The '
  'universal fallback row at the bottom of this migration is what guarantees the CTA is never '
  'dead, and it must not be deleted.';


-- ─────────────────────────────────────────────────────────────────────
-- 2. Per-client widget config.
--
-- One row per client, created by the `concierge_preview` delivery step and flipped live by
-- `concierge_live`. Served to the frame by /api/concierge/config behind an unstable_cache with
-- revalidate 300, mirroring src/lib/hub/resolve.ts.
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.concierge_configs (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null unique references public.clients(id) on delete cascade,
  -- ‼️ DEFAULT FALSE, AND ONLY THE concierge_live STEP FLIPS IT. A config row existing is not
  -- consent to put a camera on a clinic's website. concierge_preview creates this row so the
  -- widget can be demoed on the call; the client has not agreed to anything at that point.
  enabled           boolean not null default false,
  vertical          text not null default 'medspa',
  greeting          text,
  -- ‼️ THIS IS A BROWSER-ENFORCED CONTROL, NOT A LOG LINE. It renders into the frame response's
  -- Content-Security-Policy: frame-ancestors. It is what stops one client embedding a
  -- competitor's widget and harvesting their leads, and it is the only thing that does.
  -- Seeded by concierge_preview from clients.domain plus that client's rows in client_hosts.
  -- An EMPTY array must be read by the code as "this client's own hosts only", never rendered
  -- as frame-ancestors 'none', which would silently kill the widget everywhere.
  allowed_origins   text[] not null default '{}',
  -- 'link'     hand off to booking_url. The only mode that ships in MVP.
  -- 'calendly' real in-chat slot selection, reusing src/lib/calendly.ts.
  -- 'none'     capture only, a human calls back.
  booking_mode      text not null default 'none',
  booking_url       text,
  -- Overrides clients.phone for the widget only. Most clinics route the web to a different line.
  booking_phone     text,
  -- Which AnalysisProvider this client's scans go to. Per-client rather than global so one
  -- clinic whose counsel demands a named vendor does not force the whole book onto it.
  analysis_provider text not null default 'mock',
  -- ‼️ A HARD CEILING ON SPEND AND ON ABUSE, PER CLIENT PER DAY. The per-IP ledger stops one
  -- visitor; this stops one embedded widget on a page that gets scraped or linked somewhere bad.
  daily_scan_cap    integer not null default 200,
  -- Bumped when the consent copy changes. Stamped onto every session so a session recorded in
  -- March can be shown the exact words that were on screen in March.
  consent_version   text not null default 'v1',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.concierge_configs drop constraint if exists concierge_configs_booking_mode_check;
alter table public.concierge_configs add constraint concierge_configs_booking_mode_check
  check (booking_mode in ('link','calendly','none'));

alter table public.concierge_configs drop constraint if exists concierge_configs_provider_check;
alter table public.concierge_configs add constraint concierge_configs_provider_check
  check (analysis_provider in ('mock','dermiq','perfectcorp'));

-- ‼️ A BOOKING MODE THAT PROMISES A DESTINATION HAS TO CARRY ONE. The default is 'none' rather
-- than 'link' precisely so concierge_preview can create this row before anybody has asked the
-- clinic for their booking URL; concierge_live is where 'link' plus a url is written together.
alter table public.concierge_configs drop constraint if exists concierge_configs_booking_target;
alter table public.concierge_configs add constraint concierge_configs_booking_target
  check (booking_mode <> 'link' or booking_url is not null);

alter table public.concierge_configs enable row level security;

comment on table public.concierge_configs is
  'One row per client, everything the widget needs to boot. Created by the concierge_preview '
  'delivery step and enabled by concierge_live. allowed_origins is the multi-tenant boundary and '
  'is enforced by the browser as a frame-ancestors CSP, not by application code.';


-- ─────────────────────────────────────────────────────────────────────
-- 3. One session. One visitor, one scan, one conversation.
--
-- ‼️ THE PHOTO IS THE ONLY THING IN THIS PRODUCT THAT CAN HURT SOMEBODY. storage_ref,
-- photo_delete_after and photo_deleted_at are a three-column state machine and the cron reads
-- all three:
--   ref set,  deleted_at null  -> live on disk, purge at photo_delete_after
--   ref null, deleted_at set   -> purged. The terminal state.
--   ref null, deleted_at null  -> the scan never uploaded. Nothing to do.
-- A row must never sit in "ref set, deleted_at set". If that appears, the remove succeeded and
-- the ref was not cleared, and the next sweep will try to delete a key that is already gone.
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.concierge_sessions (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid not null references public.clients(id) on delete cascade,
  -- ‼️ THE BEARER, AND IT IS NOT THE ID. The frame holds this to append turns. Keeping it
  -- separate is what lets the id appear in a Slack card or a dashboard URL without that link
  -- granting write access to a stranger's conversation.
  session_token      text not null unique,

  -- Where they came in. entry_page_id is set only for hub arrivals; a scan from the client's own
  -- marketing site has a host and a path and no page row, which is correct and not an error.
  entry_host         text,
  entry_path         text,
  entry_page_id      uuid references public.client_pages(id) on delete set null,
  -- themeOf() frozen at session start, so a later tweak to the regex cannot re-point a magnet
  -- that has already been offered and recorded.
  page_category      text,
  -- The ancestor origin that framed us, read from the request. Attribution and abuse, both.
  embed_origin       text,

  -- Consent, and the exact words that were on screen when it was given.
  consent_at         timestamptz,
  consent_version    text,

  scan_status        text not null default 'pending',
  analysis_provider  text,
  -- The provider's structured output. Scores are what the concierge reasons over, every turn.
  -- The image is never re-read after the scan, so there are no vision tokens in the conversation.
  scores             jsonb,
  skin_age           integer,
  -- ‼️ A COUNT, NEVER URLS. See the header.
  mask_count         integer,

  storage_ref        text,
  photo_delete_after timestamptz,
  photo_deleted_at   timestamptz,

  -- The furthest rung reached, not a set of flags:
  --   open < captured < magnet < booked, and abandoned is written by nothing but time.
  outcome            text not null default 'open',
  magnet_id          uuid references public.lead_magnets(id) on delete set null,
  magnet_sent_at     timestamptz,
  booking_clicked_at timestamptz,

  -- ‼️ NO FOREIGN KEY, DELIBERATELY. `contacts` predates docs/ entirely -- it is only ever
  -- ALTERed in this folder, never created -- so no migration in this repo asserts its key type
  -- and a FK here would be a guess that fails at run time on somebody else's machine. It is also
  -- the wrong coupling: deleting a lead should not delete the scan that produced it.
  contact_id         uuid,
  first_name         text,
  email              text,
  phone              text,

  -- sha256(ip + SCAN_IP_SALT), via hashIp() in src/lib/scan/session.ts. Never the raw address.
  ip_hash            text,
  user_agent         text,

  turns              integer not null default 0,
  llm_input_tokens   integer not null default 0,
  llm_output_tokens  integer not null default 0,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  last_seen_at       timestamptz not null default now()
);

alter table public.concierge_sessions drop constraint if exists concierge_sessions_scan_status_check;
alter table public.concierge_sessions add constraint concierge_sessions_scan_status_check
  check (scan_status in ('pending','ok','failed','skipped'));

alter table public.concierge_sessions drop constraint if exists concierge_sessions_outcome_check;
alter table public.concierge_sessions add constraint concierge_sessions_outcome_check
  check (outcome in ('open','captured','magnet','booked','abandoned'));

alter table public.concierge_sessions drop constraint if exists concierge_sessions_category_check;
alter table public.concierge_sessions add constraint concierge_sessions_category_check check (
  page_category is null or page_category in (
    'Objection','Comparison','Tool','Guide','Price','Neighbourhood','Booking','General'
  )
);

-- ‼️ A STORED PHOTO WITHOUT A DEADLINE IS THE ONE ROW THIS SCHEMA MUST NOT ALLOW. The purge's
-- worklist is driven by photo_delete_after; a null one is invisible to it forever.
alter table public.concierge_sessions drop constraint if exists concierge_sessions_photo_deadline;
alter table public.concierge_sessions add constraint concierge_sessions_photo_deadline
  check (storage_ref is null or photo_delete_after is not null);

-- ‼️ THE CRON'S WORKLIST. A partial index's WHERE clause cannot be altered, so if the purge's
-- condition ever changes this is dropped and recreated, exactly like scraper_batches_active_idx.
create index if not exists concierge_sessions_purge_idx
  on public.concierge_sessions (photo_delete_after)
  where storage_ref is not null and photo_deleted_at is null;

create index if not exists concierge_sessions_client_idx
  on public.concierge_sessions (client_id, created_at desc);
create index if not exists concierge_sessions_page_idx
  on public.concierge_sessions (entry_page_id, created_at desc) where entry_page_id is not null;
-- The daily cap's count, per client per day.
create index if not exists concierge_sessions_cap_idx
  on public.concierge_sessions (client_id, created_at) where scan_status = 'ok';

alter table public.concierge_sessions enable row level security;

comment on table public.concierge_sessions is
  'One visitor, one scan, one conversation. Holds the SCORES, never the image bytes and never a '
  'mask url. The photo lives in the private concierge bucket for 24 hours and is deleted by '
  '/api/cron/concierge-purge, which is the only thing keeping the promise made in the consent copy.';


-- ─────────────────────────────────────────────────────────────────────
-- 4. The turns.
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.concierge_messages (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references public.concierge_sessions(id) on delete cascade,
  role         text not null,
  content      text not null,
  -- 0-based, and unique per session: a double-submit from a flaky mobile connection collides on
  -- the index instead of writing the same question into the transcript twice.
  ordinal      integer not null,
  created_at   timestamptz not null default now()
);

alter table public.concierge_messages drop constraint if exists concierge_messages_role_check;
alter table public.concierge_messages add constraint concierge_messages_role_check
  check (role in ('user','assistant','system'));

create unique index if not exists concierge_messages_ordinal_idx
  on public.concierge_messages (session_id, ordinal);

alter table public.concierge_messages enable row level security;

comment on table public.concierge_messages is
  'The transcript. Replayed to build each turn''s context, and read by a human when a lead looks '
  'wrong. The scan image is never a message; the concierge reasons over the scores.';


-- ─────────────────────────────────────────────────────────────────────
-- 5. The scan ledger. One row per PROVIDER CALL, not per session.
--
-- ‼️ A SESSION CAN BUY MORE THAN ONE SCAN. A failed provider call that the visitor retries, or a
-- second photo, is a second charge, and folding cost onto concierge_sessions would under-report
-- spend by exactly the amount that is most interesting: the retries. This table is how the
-- question "does $499 hold with the concierge in it" gets ANSWERED IN WEEK 4 rather than estimated
-- now, and how a provider swap stays auditable across the switch.
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.concierge_scan_ledger (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references public.concierge_sessions(id) on delete cascade,
  client_id    uuid not null references public.clients(id) on delete cascade,
  provider     text not null,
  ok           boolean not null,
  http_status  integer,
  latency_ms   integer,
  -- Written from the provider's own billing unit where it returns one, and from the plan's
  -- per-scan rate where it does not. Never estimated at read time.
  cost_usd     numeric(10,4) not null default 0,
  error_detail text,
  created_at   timestamptz not null default now()
);

create index if not exists concierge_scan_ledger_client_idx
  on public.concierge_scan_ledger (client_id, created_at desc);
create index if not exists concierge_scan_ledger_session_idx
  on public.concierge_scan_ledger (session_id);

alter table public.concierge_scan_ledger enable row level security;

comment on table public.concierge_scan_ledger is
  'One row per analysis-provider call, including the failures and the retries. The only honest '
  'source for concierge unit cost per client.';


-- ─────────────────────────────────────────────────────────────────────
-- 6. The bucket.
--
-- Private, service-role only, same shape and same reasoning as the `onboarding` bucket in
-- docs/2026-08-18-onboarding-docs.sql. Nothing in this product talks to Supabase from a browser;
-- the frame POSTs bytes to our route and the route uploads them.
--
-- `do update set public = false` rather than `do nothing`, so running this again REPAIRS a bucket
-- somebody flipped public in the dashboard instead of silently leaving faces world-readable.
-- ─────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('concierge', 'concierge', false)
on conflict (id) do update set public = false;


-- ─────────────────────────────────────────────────────────────────────
-- 7. The universal fallback magnet.
--
-- ‼️ DO NOT DELETE THIS ROW. It is rung 6 of the ladder and it is the only reason
-- resolveMagnet() cannot return null. Without it a page in a category nobody wrote a magnet for
-- renders a CTA that goes nowhere, on a client's own domain, under their name.
--
-- Guarded by a not-exists rather than on-conflict, because the row has no natural unique key and
-- inventing one would constrain the library for the sake of one seed.
-- ─────────────────────────────────────────────────────────────────────
insert into public.lead_magnets (client_id, vertical, treatment, category, title, promise, concierge_entry, sort_order)
select null, null, null, null,
  'Your Skin Report',
  'The full breakdown of your scan, written out, sent to you to keep.',
  'I can send you the full version of this, written out properly so you can read it later or take it to whoever you see. Where should it go?',
  9999
where not exists (
  select 1 from public.lead_magnets
  where client_id is null and vertical is null and treatment is null and category is null
);


-- Verify:
--   select id, public from storage.buckets where id = 'concierge';   -- public must be false
--   select count(*) from public.lead_magnets where client_id is null and category is null;  -- 1
--   select relname, relrowsecurity from pg_class
--     where relname like 'concierge%' or relname = 'lead_magnets';   -- all true
