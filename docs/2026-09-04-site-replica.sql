-- Site Replica: a generated shadow of a client's own site, for the onboarding call.
--
-- Matthew, 2026-09-04: "create a replica of the customer's website with all of the pages at
-- least visible to the internet, and add the virtual agent box at the bottom right side."
--
-- IT IS A SEPARATE TABLE AND THE SEPARATION IS THE ENFORCEMENT.
--
-- The obvious shape was columns on `client_pages`. It is the wrong one. page-gate.ts carries a
-- hole-check saying `grep -rn "setPublished" src/` must return exactly ONE caller, and putting
-- replica rows in client_pages means listPublished, sitemap.xml, llms.txt and every board query
-- has to learn to exclude them. One missed filter publishes a shadow of somebody's homepage on
-- their own domain, under their name, competing with their real pages. A separate table makes
-- that structurally impossible, the same way review_tool_submissions has no column for a name.
--
-- NOTE THE MISSING COLUMN: there is no `status`. Nothing can publish a replica page because
-- there is nowhere to record that it was published. The only renderer is
-- /preview/{token}?kind=site, which is on our own hostname and noindex.

create table if not exists client_replica_pages (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references clients(id) on delete cascade,

  -- The page on THEIR site this shadows. One replica row per source URL.
  source_url    text not null,
  -- The anchor text from their own nav. This is what makes it recognisable to them.
  nav_label     text not null,
  -- Their path, kept whole: 'services/botox'. A SLASH IS LEGAL HERE, and it is legal only
  -- because this table is never served on a client host. middleware.ts HUB_SLUG, which forbids
  -- a slash on client-controlled hostnames, is untouched and must stay that way.
  -- The homepage is the empty string.
  path          text not null,

  title         text not null,
  body_md       text not null,

  -- Same rule and same key space as client_pages.lead_magnet_key: lead_magnets.magnet_key.
  -- NOT a second mechanism. Null means the ladder in lib/concierge/magnets.ts decides, exactly
  -- as it does for a hub page written before that column existed.
  lead_magnet_key text,

  nav_order     int not null default 0,
  -- The page_sources row this was written from, so the evidence path is auditable.
  source_id     uuid references page_sources(id) on delete set null,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (client_id, path),
  unique (client_id, source_url)
);

create index if not exists client_replica_pages_client_idx
  on client_replica_pages (client_id, nav_order);

comment on table client_replica_pages is
  'A generated shadow of a client''s own site, for the onboarding call. NEVER published on a client host: it is rendered only by /preview/{token}?kind=site, which is noindex and on our own hostname. It has no status column on purpose, because there is no publish path to have a status for.';

comment on column client_replica_pages.path is
  'Their own path, slashes kept. Legal only because this table is never served on a client host; middleware.ts HUB_SLUG still forbids a slash there. Empty string is the homepage.';

comment on column client_replica_pages.lead_magnet_key is
  'lead_magnets.magnet_key, same key space and same rule as client_pages.lead_magnet_key. Null means the concierge ladder decides.';
