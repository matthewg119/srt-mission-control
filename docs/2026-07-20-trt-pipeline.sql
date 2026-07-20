-- TRT-clinic prospecting pipeline (Outscraper -> Supabase -> Zoho -> Slack).
-- Metro x query rotation (unlike med spa's ZIP x single-query). See:
--   src/lib/trt.ts, src/app/api/cron/pull-trt/route.ts,
--   src/app/api/webhooks/outscraper-trt/route.ts, scripts/seed-trt-rotation.ts
-- Safe to run more than once (IF NOT EXISTS everywhere).

-- 1. Harvested TRT clinics ----------------------------------------------------
create table if not exists trt_leads (
  id                  uuid primary key default gen_random_uuid(),
  business_name       text not null,
  phone               text,                        -- dialer-ready "(AAA) EEE-NNNN", verified (null if invalid)
  phone_normalized    text,                        -- 10-digit digits-only, dedupe key
  website             text,
  full_address        text,
  city                text,
  state               text,
  postal_code         text,
  categories          text,
  primary_type        text,                        -- Google's primary type (drives the filter)
  rating              numeric,
  review_count        int,
  google_place_id     text,                        -- primary dedupe key
  google_maps_url     text,                        -- Outscraper location_link
  owner_name          text,                        -- owner/provider (website scrape, best-effort)
  hours               jsonb,
  days_open           int,
  multi_location_flag boolean default false,       -- suspected chain/franchise (kept, not dropped)
  lead_score          int,                         -- 1..10
  status              text default 'new',          -- new | contacted | booked | dead
  search_query        text,                        -- full query that surfaced this row
  search_metro        text,                        -- metro_key, e.g. 'dfw'
  source              text default 'outscraper',
  zoho_lead_id        text,
  zoho_synced_at      timestamptz,
  zoho_sync_error     text,
  created_at          timestamptz default now()    -- = scrape_date
);

create unique index if not exists trt_leads_place_id_uidx
  on trt_leads (google_place_id) where google_place_id is not null;
create unique index if not exists trt_leads_phone_uidx
  on trt_leads (phone_normalized) where phone_normalized is not null;
create index if not exists trt_leads_status_idx on trt_leads (status);
create index if not exists trt_leads_score_idx  on trt_leads (lead_score desc);
create index if not exists trt_leads_metro_idx  on trt_leads (search_metro);

-- 2. One row per nightly job (webhook correlation + Slack report) --------------
create table if not exists trt_runs (
  id                    uuid primary key default gen_random_uuid(),
  run_date              date default current_date,
  metros                text[],                    -- metro_keys covered this run
  queries               jsonb,                     -- ordered full query strings (matches result groups)
  rotation_ids          int[],                     -- trt_rotation.id per query, same order
  outscraper_request_id text,
  requested             int default 0,
  new_leads             int default 0,
  duplicates            int default 0,
  filtered_out          int default 0,
  invalid_phone         int default 0,             -- phones failing dialer verification
  flagged_chains        int default 0,             -- multi_location_flag rows inserted
  with_phone            int default 0,
  with_website          int default 0,
  with_owner            int default 0,
  status                text default 'submitted',  -- submitted | completed | failed
  error                 text,
  created_at            timestamptz default now()
);

create index if not exists trt_runs_request_idx on trt_runs (outscraper_request_id);

-- 3. Metro x query rotation queue ----------------------------------------------
-- Grain: one row per (metro anchor city x query). metro_key groups anchors
-- (dfw = Dallas + Fort Worth; phoenix = Phoenix + Scottsdale) so exhaustion and
-- expansion activation are computed per metro. Expansion rows seed active=false
-- and flip to active when every core row for their metro_key is exhausted.
create table if not exists trt_rotation (
  id                serial primary key,
  metro_key         text not null,                 -- 'dfw', 'houston', ...
  metro_label       text,                          -- 'Dallas-Fort Worth'
  anchor_city       text not null,                 -- 'Dallas' | 'Fort Worth' | ...
  state             text not null,
  metro_priority    int  not null default 100,     -- 1 = pulled first
  base_query        text not null,                 -- 'TRT clinic'
  query             text not null,                 -- 'TRT clinic Dallas TX' (submitted verbatim)
  tier              text not null default 'core',  -- 'core' | 'expansion'
  last_pulled_at    timestamptz,
  times_pulled      int  default 0,
  consecutive_empty int  default 0,
  exhausted         boolean default false,
  active            boolean default true,          -- expansion rows seeded false
  created_at        timestamptz default now(),
  unique (query)
);

create index if not exists trt_rotation_pick_idx
  on trt_rotation (active, exhausted, metro_priority, tier, id);
