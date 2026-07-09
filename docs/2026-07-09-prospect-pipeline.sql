-- Daily pest-control prospecting pipeline (Outscraper -> Supabase -> Slack).
-- Cold OUTREACH list of pest-control businesses to sell funding to. This is a
-- DIFFERENT concept from Mission Control's inbound "leads" (Zoho funding
-- applicants), so every table is prefixed `prospect_` to avoid overloading the term.
--
-- See src/app/api/cron/pull-prospects/route.ts (Route A, daily submit),
--     src/app/api/webhooks/outscraper/route.ts (Route B, results + report),
--     scripts/seed-prospect-rotation.ts (ZIP rotation seed),
--     docs/prospect-pipeline.md (full runbook).
--
-- Safe to run more than once (IF NOT EXISTS everywhere).

-- 1. The harvested businesses -------------------------------------------------
create table if not exists prospect_leads (
  id               uuid primary key default gen_random_uuid(),
  business_name    text not null,
  phone            text,
  phone_normalized text,                       -- digits only, for dedupe (nullable)
  email            text,                        -- reserved for a future free 2nd-pass enrich
  website          text,
  full_address     text,
  city             text,
  state            text,
  postal_code      text,
  categories       text,
  rating           numeric,
  review_count     int,
  google_place_id  text,                        -- primary dedupe key (always present from Maps)
  source           text default 'outscraper',
  search_zip       text,                        -- which rotation ZIP produced this row
  call_status      text default 'new',          -- new | called | no_answer | booked | dead
  called_at        timestamptz,
  dnc_checked      boolean default false,       -- future national + state DNC scrub gate
  created_at       timestamptz default now()
);

-- Dedupe guards. Postgres treats NULLs as distinct, so phone-less records still
-- insert; google_place_id catches those.
create unique index if not exists prospect_leads_place_id_uidx
  on prospect_leads (google_place_id) where google_place_id is not null;
create unique index if not exists prospect_leads_phone_uidx
  on prospect_leads (phone_normalized) where phone_normalized is not null;
create index if not exists prospect_leads_call_status_idx on prospect_leads (call_status);

-- 2. The ZIP-by-ZIP rotation queue -------------------------------------------
create table if not exists prospect_rotation (
  id                serial primary key,
  zip               text not null,
  city              text,
  state             text,
  state_priority    int  default 100,           -- Sun Belt = low number = pulled first
  query             text not null default 'pest control',
  last_pulled_at    timestamptz,
  times_pulled      int  default 0,
  consecutive_empty int  default 0,
  exhausted         boolean default false,       -- true once we've got everything in this ZIP
  active            boolean default true,
  created_at        timestamptz default now(),
  unique (zip)
);

-- Picker index for Route A: next active + uncovered ZIP, Sun Belt first.
create index if not exists prospect_rotation_pick_idx
  on prospect_rotation (active, exhausted, state_priority, zip);

-- 3. One row per daily run (Slack report + audit) ----------------------------
create table if not exists prospect_runs (
  id                      uuid primary key default gen_random_uuid(),
  run_date                date default current_date,
  zips_covered            text[],                -- ZIPs pulled this run, in query order
  states                  text[],
  outscraper_request_id   text,
  requested               int default 0,
  new_leads               int default 0,
  duplicates              int default 0,
  with_phone              int default 0,
  with_website            int default 0,
  status                  text default 'submitted', -- submitted | completed | failed
  error                   text,
  created_at              timestamptz default now()
);

create index if not exists prospect_runs_request_idx on prospect_runs (outscraper_request_id);
