-- Destinations: a page's URL stops being implied by the client's one hub subdomain.
-- Safe to run more than once.
--
-- ‼️ THE MODEL IS DESTINATIONS, NOT MODES. There is no delivery_mode enum on clients. A
-- destination is a client_hosts row, a client may hold several, and Export is NOT a row --
-- it is always available and writes nothing. clients.default_destination_id only
-- pre-selects the picker; it never decides anything on its own.

-- ─────────────────────────────────────────────────────────────────────────────
-- client_hosts gains HOW a destination is delivered, and where it lives
-- ─────────────────────────────────────────────────────────────────────────────
--
-- ‼️ `kind` IS WHAT IS SERVED. `delivery` IS HOW IT GETS THERE. They are two axes and
-- collapsing them is the mistake this migration exists to avoid.
--
-- The prompt asked to widen kind to carry 'subfolder', and to relax
-- client_hosts_client_kind_key so one client can hold a subdomain hub row and a subfolder
-- hub row. Widening `kind` would do it, and it would also break resolveHost(): HubKind is
-- 'hub' | 'reviews' and the /hub/[host] tree branches on it to decide whether to render
-- pages or the referral engine. A 'subfolder' kind is not a third THING to serve, it is
-- the hub served somewhere else, so the branch would have to map it back to 'hub'
-- everywhere and the union would stop meaning what it says.
--
-- So kind is untouched and `delivery` is the new axis. One hub-subdomain, one
-- hub-subfolder, one reviews-subdomain per client all coexist under a three-column key.
alter table public.client_hosts
  add column if not exists delivery text not null default 'subdomain';

alter table public.client_hosts drop constraint if exists client_hosts_delivery_check;
alter table public.client_hosts add constraint client_hosts_delivery_check
  check (delivery in ('subdomain', 'subfolder', 'cms'));

-- The path the destination lives under on the public origin, with a leading slash and no
-- trailing one: '/learn'. NULL on a subdomain, where the site IS the root.
--
-- ‼️ STORED THE WAY IT IS WRITTEN IN A PROXY RULE, because that is where it gets pasted.
-- The mirror of client_dns_records.host storing a LABEL because a registrar's Host box
-- wants a label.
alter table public.client_hosts
  add column if not exists base_path text;

alter table public.client_hosts drop constraint if exists client_hosts_base_path_check;
alter table public.client_hosts add constraint client_hosts_base_path_check
  check (
    base_path is null
    or (base_path ~ '^/[A-Za-z0-9][A-Za-z0-9/_-]*$' and base_path not like '%/')
  );

-- The scheme and host the PUBLIC sees, no trailing slash: 'https://srtagency.com'. NULL on
-- a subdomain, where it is derived from `host`.
--
-- ‼️ THIS IS NOT `host`. On a subfolder, `host` records the hostname whose owner agreed to
-- proxy to us, and public_origin records what a canonical tag must say. On a subdomain they
-- are the same fact and only one of them is stored, so a reader must go through siteUrl()
-- rather than reaching for either column.
alter table public.client_hosts
  add column if not exists public_origin text;

alter table public.client_hosts drop constraint if exists client_hosts_public_origin_check;
alter table public.client_hosts add constraint client_hosts_public_origin_check
  check (public_origin is null or (public_origin ~ '^https://[a-z0-9.-]+$'));

-- A subfolder destination is reached internally at /s/{site_key}, because the client's own
-- server proxies to us and the Host header that arrives is ours, not theirs. NULL on a
-- subdomain, which is routed by hostname and needs no key.
alter table public.client_hosts
  add column if not exists site_key text;

alter table public.client_hosts drop constraint if exists client_hosts_site_key_check;
alter table public.client_hosts add constraint client_hosts_site_key_check
  check (site_key is null or site_key ~ '^[a-z0-9][a-z0-9-]{0,62}$');

-- Global, like client_hosts_host_key and for the same reason: one key resolves to one
-- client, and two claimants is a write that must fail rather than an ambiguity to resolve
-- at read time.
create unique index if not exists client_hosts_site_key_uidx
  on public.client_hosts (site_key) where site_key is not null;

-- ‼️ A DESTINATION MUST CARRY WHAT ITS DELIVERY NEEDS, and the database is where that is
-- said. A subfolder with no base_path, no public_origin or no site_key is a row that every
-- reader downstream has to defend against; refused here, none of them do.
alter table public.client_hosts drop constraint if exists client_hosts_delivery_shape_check;
alter table public.client_hosts add constraint client_hosts_delivery_shape_check
  check (
    (delivery = 'subdomain' and base_path is null and public_origin is null and site_key is null)
    or (delivery in ('subfolder', 'cms') and base_path is not null and public_origin is not null and site_key is not null)
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- The uniqueness key gains the second axis
-- ─────────────────────────────────────────────────────────────────────────────
--
-- ‼️ THIS INDEX HAS EXACTLY ONE CODE DEPENDENCY AND IT MUST BE CHANGED WITH IT.
-- registerClientHosts() in src/lib/hub/vercel-domains.ts upserts client_hosts with
-- onConflict "client_id,kind". ON CONFLICT infers an arbiter by matching key expressions,
-- so the moment this index becomes three columns that upsert is 42P10 at PLAN time -- not a
-- data collision, a statement that cannot run at all. It is updated to name all three and
-- to write delivery 'subdomain' in the same commit.
--
-- A PLAIN three-column index would be wrong for the same reason the nap_discrepancies index
-- was: nulls compare distinct, so it would constrain nothing. delivery is NOT NULL with a
-- default, so there are no nulls to be distinct and no NULLS NOT DISTINCT needed here.
drop index if exists public.client_hosts_client_kind_key;
create unique index if not exists client_hosts_client_kind_delivery_key
  on public.client_hosts (client_id, kind, delivery);

-- ─────────────────────────────────────────────────────────────────────────────
-- Which destination a page went to, and which one the picker starts on
-- ─────────────────────────────────────────────────────────────────────────────
--
-- ‼️ ONE PAGE GETS ONE HOME. Publishing the same page to a subdomain and a subfolder is
-- duplicate content on two hosts we control, which is the one SEO mistake this whole
-- product exists to avoid making on a client's behalf.
--
-- NULL means the page has never been published to a destination. It does NOT mean Export:
-- an export writes nothing at all, because a file is not a publication.
--
-- on delete set null, never cascade: unwiring a destination must not delete the page that
-- went to it. The page is the asset; the destination is plumbing.
alter table public.client_pages
  add column if not exists destination_id uuid references public.client_hosts(id) on delete set null;

create index if not exists client_pages_destination_idx
  on public.client_pages (destination_id) where destination_id is not null;

-- Pre-selects the picker and nothing else. There is deliberately no fallback read of this
-- at publish time: when a client holds more than one destination the picker ticks nothing
-- and a human chooses, because a default that silently picks a host is how a page lands on
-- the wrong domain with nobody having decided it should.
alter table public.clients
  add column if not exists default_destination_id uuid references public.client_hosts(id) on delete set null;

comment on column public.client_hosts.delivery is
  'How the destination is served: subdomain (we answer the hostname), subfolder (their server proxies a path to us), cms (they paste our export in). Orthogonal to kind, which is WHAT is served.';
comment on column public.client_hosts.base_path is
  'Path prefix on the public origin, leading slash, no trailing slash. NULL on a subdomain.';
comment on column public.client_hosts.public_origin is
  'Scheme and host the public sees, no trailing slash. NULL on a subdomain, where it is derived from host.';
comment on column public.client_hosts.site_key is
  'Internal routing key for /s/{site_key}. NULL on a subdomain, which routes by hostname.';
comment on column public.client_pages.destination_id is
  'Which destination this page was published to. NULL means never published. Never means Export.';
comment on column public.clients.default_destination_id is
  'Pre-selects the destination picker. Never consulted as a fallback at publish time.';
