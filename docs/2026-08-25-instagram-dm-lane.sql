-- Instagram prospecting: the dedup key on contacts, and the run store for the DM lane.
--
-- Run this BEFORE deploying. PostgREST fails the WHOLE query on a single unknown column rather
-- than degrading, so the first press of the button 400s on a missing column instead of partially
-- working. See the comment above LEAD_COLS in src/lib/crm.ts.

alter table public.contacts
  add column if not exists instagram_handle text;

-- The dedup key for the extension's upsert. It is the only identifier an Instagram profile
-- reliably has: plenty of med spas publish no email and a shared front-desk number, so phone and
-- email are not keys here.
--
-- PARTIAL, so the existing rows with no handle do not all collide on null. Lowercased because
-- Instagram handles are case-insensitive and the extension normalizes to lower case.
create unique index if not exists contacts_instagram_handle_key
  on public.contacts (lower(instagram_handle))
  where instagram_handle is not null;

create table if not exists public.ig_dm_runs (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid,
  contact_id    uuid references public.contacts(id) on delete cascade,
  handle        text not null,
  website       text,

  -- 'running' | 'done' | 'failed'
  status        text not null default 'running',
  -- 'hook' (they have a site) | 'nowebsite'
  lane          text,
  angle         text,

  -- The HookCheck / MiniCheck JSON, stored BEFORE drafting.
  --
  -- This is what makes Regenerate free and what makes it safe. The scan is the expensive half (a
  -- crawl, a classify, four engine calls and an extractor pass) and its result is a value, not a
  -- process, so re-drafting off this copy costs one model call. It also means a redraft cannot
  -- drift onto different facts: there is exactly one scan behind a run, so every variant ever
  -- shown for this profile rests on the same measured answers.
  check_json    jsonb,

  -- [{ opener, body, lintOk, findings[], findingWarning, removedLinks[] }]
  variants      jsonb not null default '[]'::jsonb,

  error_detail  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- The claim guard reads by handle and recency: a double-click must not spend the scan twice.
create index if not exists ig_dm_runs_handle_idx  on public.ig_dm_runs (lower(handle), created_at desc);
create index if not exists ig_dm_runs_contact_idx on public.ig_dm_runs (contact_id, created_at desc);
create index if not exists ig_dm_runs_tenant_idx  on public.ig_dm_runs (tenant_id, created_at desc);
