-- The tool lane: per-page magnet invention out, a deliberate tool page in.
-- Safe to run more than once.
--
-- ‼️ ORDER IS LOAD-BEARING AND IT IS THE ORDER OF THIS FILE. The house offers are written
-- FIRST, the invented rows are removed SECOND. The other way round leaves a live page with
-- a CTA that opens a bot holding nothing.
--
-- Measured against production on 2026-09-29, before writing this:
--   0 published client_pages anywhere
--   0 client_pages carrying a lead_magnet_key
--   12 lead_magnets rows, 11 active
--   concierge_configs: srt-agency-llc, enabled = true, audience = owner
--
-- So §10b's "no lead magnets are live in front of visitors" is true of PAGES and not quite
-- true of the widget: SRT's own concierge is switched on, and the hub index mounts it. The
-- offer it serves today is `visibility_scan`, which is one of the house offers -- so the
-- order above is not a formality here, it is the difference between a seamless change and
-- SRT's own widget having nothing to hand anybody.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The house offers, FIRST
-- ─────────────────────────────────────────────────────────────────────────────
--
-- ‼️ client_id AND vertical BOTH NULL, WHICH IS RUNG ZERO AND IS THE POINT. rungOf() treats
-- a NULL on the ROW as a wildcard that matches and adds no weight, so these sit below every
-- scoped row and catch whatever nothing else claims. That is only safe because step 2 below
-- removes everything that was sitting above them, and it is why the two halves are one file.
--
-- ‼️ EVERY LABEL HERE IS UNDER 28 CHARACTERS AND CARRIES NO DASH, because
-- _probe-concierge-lane.ts §9b reads `cta_label || title` across the WHOLE TABLE with no
-- client filter. One bad row turns the probe red for every client, so a house offer that
-- fails it is a house offer that breaks the check for everybody.

-- ‼️ DELETE THEN INSERT, NOT ON CONFLICT, AND THE FIRST ATTEMPT FAILED FOR A REASON WORTH
-- WRITING DOWN. lead_magnets_placement_key is a PARTIAL unique index --
-- `... where magnet_key is not null` (docs/2026-09-03-concierge-audience.sql:104-112). ON
-- CONFLICT infers its arbiter by matching key expressions AND the index predicate, so naming
-- the six columns without repeating `where magnet_key is not null` matches no index at all:
-- 42P10, at PLAN time, which aborts the whole file before anything runs.
--
-- Repeating the predicate would work and would tie this migration to the exact text of an
-- index defined in another file. These two keys are NEW and client-null, so nothing is
-- serving them and there is nothing to protect with an upsert: deleting them first makes the
-- insert unconditional and the file idempotent, with no inference involved.
--
-- Same family as the nap_discrepancies 42P10 this repo already records, one level deeper: that
-- one was a column list against an expression index, this one is a full match against a
-- PARTIAL index.
delete from public.lead_magnets
 where magnet_key in ('book_consult', 'referral_engine')
   and client_id is null
   and vertical is null
   and treatment is null
   and category is null;

insert into public.lead_magnets
  (magnet_key, audience, title, promise, cta_label, concierge_entry, category, client_id, vertical, treatment, active, sort_order)
values
  -- The patient default, decided 2026-09-29. It stands until a skin vendor is keyed, and
  -- that day it becomes a config value rather than a rewrite. See §10f.
  (
    'book_consult',
    'patient',
    'Book a consult',
    'Talk to somebody here about what you are actually after, before you book anything.',
    'Book a consult',
    'Want me to get you booked in?',
    null,
    null, null, null,
    true,
    90
  ),
  -- The owner lane. The Referral Engine is the free thing; the audit is the other door.
  (
    'referral_engine',
    'owner',
    'The AI Referral Engine',
    'The tool that turns a happy customer into a review an answer engine can actually read.',
    'Free AI Referral Engine',
    'Want the Referral Engine set up on your own domain?',
    null,
    null, null, null,
    true,
    91
  );

-- `visibility_scan` already exists exactly as a house offer wants it: owner, client-null,
-- vertical-null, with an asset behind it. It is left alone rather than deleted and rewritten,
-- because it is the row SRT's live widget is serving right now.
update public.lead_magnets
   set active = true, updated_at = now()
 where magnet_key in ('visibility_scan', 'talk_to_us')
   and client_id is null
   and vertical is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. The invented rows, SECOND
-- ─────────────────────────────────────────────────────────────────────────────
--
-- ‼️ THIS IS NOT "DELETE EVERY ROW", AND THE NARROWER VERSION IS THE HONEST ONE. §10b says
-- to wipe the table and re-seed the house offers. The end state it describes is "only house
-- offers remain", and four of the rows on file ALREADY ARE house offers by every test that
-- matters: client-null, vertical-null, one of the three lanes. Deleting and re-inserting
-- them would drop SRT's live widget offer for the length of the migration to arrive at the
-- same table.
--
-- What actually goes is what the per-page lane and the vertical seeds produced: anything
-- scoped to a client, and anything scoped to a vertical. Those are the rows that exist
-- because something invented them for a page or a niche.
delete from public.lead_magnets
 where client_id is not null
    or vertical is not null;

-- ‼️ AFTER the delete, never before. A page pointing at a key that no longer resolves gets
-- the ladder, which is the correct fallback; a page whose key was cleared first would have
-- lost the record of what it was written toward for no reason. Measured above: zero rows
-- carry one today, so this is a guard for a re-run rather than a repair.
update public.client_pages
   set lead_magnet_key = null, updated_at = now()
 where lead_magnet_key is not null
   and lead_magnet_key not in (select magnet_key from public.lead_magnets where magnet_key is not null);

-- The per-page candidate table goes entirely. Its whole purpose was minting five invented
-- offers per page, and approveMagnetCandidate was its only writer.
drop table if exists public.page_magnet_candidates;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2b. The orphans, AFTER the delete
-- ─────────────────────────────────────────────────────────────────────────────
--
-- ‼️ THREE COLUMNS POINT AT A magnet_key AND THE FIRST CUT OF THIS FILE CLEANED ONE. Found by
-- _probe-concierge-lane.ts on the run straight after the delete, which is exactly what that
-- check is for: "no chain points at a magnet that does not exist".
--
-- A dangling key is not a crash. magnetByKey returns null and every reader degrades to the
-- ladder, so the failure is a widget quietly offering the generic thing while a column still
-- says it offers something specific. That is the shape nobody notices.

-- The chain. `visibility_scan` chained to `city_rivals`, which was vertical-scoped and went.
-- Nulled rather than repointed: what comes after an offer is a decision somebody makes, and
-- guessing one here would put a second offer in front of a visitor that nobody chose.
update public.lead_magnets
   set chains_to_key = null, updated_at = now()
 where chains_to_key is not null
   and chains_to_key not in (select magnet_key from public.lead_magnets where magnet_key is not null);

-- The framing pointer, same rule.
update public.lead_magnets
   set frames_key = null, updated_at = now()
 where frames_key is not null
   and frames_key not in (select magnet_key from public.lead_magnets where magnet_key is not null);

-- ‼️ AND THE CLIENT'S ANCHOR, WHICH IS THE ONE THAT WOULD HAVE BEEN MISSED. client_offers
-- .magnet_key is what anchorFor() resolves, so a dangling one means the page studio's card
-- and every "what does this client hand over" read return null. SRT's pointed at
-- `srt-agency-llc-the-three-pillar-gap-check`, a client-scoped row that was already INACTIVE
-- before this migration and is now deleted.
--
-- Nulled, not repointed at a house offer. Which offer a client anchors on is a decision
-- setAnchorMagnet exists to record, and picking one on their behalf in a migration is the
-- same class of silent write this whole file is removing.
update public.client_offers
   set magnet_key = null, updated_at = now()
 where magnet_key is not null
   and magnet_key not in (select magnet_key from public.lead_magnets where magnet_key is not null);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. The tool lane
-- ─────────────────────────────────────────────────────────────────────────────
--
-- ‼️ TWO TABLES BECAUSE A TOOL IS REUSED AND AN INSTANCE IS NOT. vertical_assets is the
-- library: what a med spa calculator IS, once, for every med spa. client_assets is this
-- client's instance of it, themed and pointed at their own page. Collapsing them would mean
-- either every client re-invents the same calculator or two clients share one live page.
create table if not exists public.vertical_assets (
  id            uuid primary key default gen_random_uuid(),
  vertical      text not null,
  slug          text not null,
  kind          text not null,
  title         text not null,
  what_it_does  text not null,
  inputs        jsonb not null default '[]'::jsonb,
  output        text not null,

  -- ‼️ THE KEY OF A REVIEWED, DEPLOYED REACT COMPONENT. Definitions are code, runs are rows,
  -- the same doctrine the workflow registries state. It is NOT a URL and must never become
  -- one: an iframe to an outside artifact is an outside dependency on a page we are asking
  -- engines to trust, and it cannot be themed per client.
  component_key text not null,

  -- Which keyword this asset was invented for, so the library can say why it exists.
  source_keyword text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.vertical_assets drop constraint if exists vertical_assets_kind_check;
alter table public.vertical_assets add constraint vertical_assets_kind_check
  -- Mirrors AssetKind in src/lib/clients/asset-ideas.ts. There is deliberately no 'guide',
  -- no 'article' and no 'post': every kind here is a thing with a door on it, and the
  -- absence of those three IS the enforcement.
  check (kind in ('tool', 'template', 'calculator', 'checklist', 'script', 'teardown'));

create unique index if not exists vertical_assets_vertical_slug_key
  on public.vertical_assets (vertical, lower(slug));

create table if not exists public.client_assets (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references public.clients(id) on delete cascade,
  vertical_asset_id uuid not null references public.vertical_assets(id) on delete restrict,

  status            text not null default 'picked',

  -- The page the tool renders inside. Null until the page is drafted.
  page_id           uuid references public.client_pages(id) on delete set null,

  -- Per-client look. The component reads these; it never reads clients.theme directly, so a
  -- reused asset is RESTYLED rather than served as another client's live page.
  theme_overrides   jsonb not null default '{}'::jsonb,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.client_assets drop constraint if exists client_assets_status_check;
alter table public.client_assets add constraint client_assets_status_check
  check (status in ('picked', 'building', 'ready', 'live', 'dropped'));

-- ‼️ ONE TOOL PER CLIENT AT A TIME. The tool is the EIGHTH page and its own slot, not a
-- category a client collects. Two live tools would make "the tool page" ambiguous on the
-- call and in step 21's verifier.
create unique index if not exists client_assets_one_live_key
  on public.client_assets (client_id) where status <> 'dropped';

create index if not exists client_assets_page_idx
  on public.client_assets (page_id) where page_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. A page can name the component that renders inside it
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Null for every ordinary page, which is all of them. A tool page carries the key of a
-- reviewed component; hub-bodies renders it above the body.
--
-- ‼️ IT IS A KEY INTO A CODE REGISTRY, NOT A PATH AND NOT A URL. The registry is the list of
-- components that have been read by a person. A column holding anything a renderer would
-- resolve at runtime is a column that can name something nobody reviewed.
alter table public.client_pages
  add column if not exists component_key text;

alter table public.client_pages drop constraint if exists client_pages_component_key_check;
alter table public.client_pages add constraint client_pages_component_key_check
  check (component_key is null or component_key ~ '^[a-z][a-z0-9-]{1,62}$');

comment on column public.client_pages.component_key is
  'Key of a reviewed React component rendered inside this page. Null on every ordinary page. Never a path or a URL.';
comment on table public.vertical_assets is
  'The tool library: what an asset IS, once per vertical. Reused across clients and restyled per client.';
comment on table public.client_assets is
  'One client instance of a vertical_asset. At most one not-dropped row per client: the tool is the eighth page, not a collection.';
