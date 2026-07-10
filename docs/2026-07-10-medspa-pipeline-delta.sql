-- Med-spa pipeline DELTA — run AFTER docs/2026-07-10-medspa-pipeline.sql.
-- Adds owner + Zoho columns, run-report columns, and the ZIP rotation queue so the
-- med-spa pipeline runs exactly like the old pest one (ZIP-by-ZIP, ~500/day) with
-- silent Zoho sync + owner enrichment. Safe to run more than once.

-- 1. med_spa_leads: owner name, search ZIP, Zoho sync bookkeeping ---------------
alter table med_spa_leads
  add column if not exists owner_name      text,
  add column if not exists search_zip      text,
  add column if not exists zoho_lead_id    text,
  add column if not exists zoho_synced_at  timestamptz,
  add column if not exists zoho_sync_error text;

-- 2. med_spa_runs: ZIP-batch attribution + richer report counts ----------------
alter table med_spa_runs
  add column if not exists zips_covered text[],
  add column if not exists states       text[],
  add column if not exists with_phone   int default 0,
  add column if not exists with_website int default 0,
  add column if not exists with_owner   int default 0;

-- 3. The ZIP-by-ZIP rotation queue (clone of the pest rotation) -----------------
create table if not exists med_spa_rotation (
  id                serial primary key,
  zip               text not null,
  city              text,
  state             text,
  state_priority    int  default 100,          -- density states = low number = pulled first
  query             text not null default 'med spa',
  last_pulled_at    timestamptz,
  times_pulled      int  default 0,
  consecutive_empty int  default 0,
  exhausted         boolean default false,      -- true once we've got everything in this ZIP
  active            boolean default true,
  created_at        timestamptz default now(),
  unique (zip)
);

create index if not exists med_spa_rotation_pick_idx
  on med_spa_rotation (active, exhausted, state_priority, zip);
