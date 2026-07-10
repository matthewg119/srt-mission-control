-- Med-spa prospecting pipeline (Outscraper -> Supabase -> Slack).
-- A cold OUTREACH list of owner-operated med spas to sell funding to. Parallel to
-- the pest-control pipeline (docs/2026-07-09-prospect-pipeline.sql) but a separate
-- vertical: its own table, richer enrichment, a lead_score, and a static 10-city
-- target list instead of a 33k-ZIP rotation. See:
--     src/lib/medspa.ts                                (config + mappers + scorer)
--     src/app/api/cron/pull-medspa/route.ts            (Route A, per-city submit)
--     src/app/api/webhooks/outscraper-medspa/route.ts  (Route B, results + report)
--     scripts/test-medspa-charlotte.ts                 (synchronous Charlotte test)
--
-- Safe to run more than once (IF NOT EXISTS everywhere).

-- 1. The harvested med spas --------------------------------------------------
create table if not exists med_spa_leads (
  id                uuid primary key default gen_random_uuid(),
  business_name     text not null,
  phone             text,
  phone_normalized  text,                       -- digits only, for dedupe (nullable)
  website           text,
  full_address      text,
  city              text,
  state             text,
  postal_code       text,
  categories        text,                        -- full "type + subtypes" string
  primary_type      text,                        -- Google's primary type (drives the filter)
  rating            numeric,
  review_count      int,
  google_place_id   text,                        -- primary dedupe key (always present from Maps)

  -- Enrichment (requirement #3)
  instagram_handle  text,                        -- @handle, no url
  photo_count       int,                         -- # of photos on the GBP listing
  hours             jsonb,                        -- raw working_hours object
  days_open         int,                         -- # of days/week open (size signal)
  has_booking_link  boolean default false,       -- booking link present on GBP

  -- Scoring + outreach state (requirements #4 and #6)
  lead_score        int,                         -- 1..10 (see scoreLead in src/lib/medspa.ts)
  status            text default 'new',          -- new | contacted | booked | dead
  contacted_at      timestamptz,                 -- nullable, set when we reach out

  -- Bookkeeping
  search_term       text,                        -- which of the 7 terms surfaced this row
  search_city       text,                        -- which target city was queried
  source            text default 'outscraper',
  created_at        timestamptz default now()
);

-- Dedupe guards (requirement #7). Postgres treats NULLs as distinct, so phone-less
-- records still insert; google_place_id catches those.
create unique index if not exists med_spa_leads_place_id_uidx
  on med_spa_leads (google_place_id) where google_place_id is not null;
create unique index if not exists med_spa_leads_phone_uidx
  on med_spa_leads (phone_normalized) where phone_normalized is not null;
create index if not exists med_spa_leads_status_idx on med_spa_leads (status);
create index if not exists med_spa_leads_score_idx  on med_spa_leads (lead_score desc);

-- 2. One row per city job (Slack report + webhook correlation) ----------------
create table if not exists med_spa_runs (
  id                      uuid primary key default gen_random_uuid(),
  run_date                date default current_date,
  city                    text,
  state                   text,
  queries                 jsonb,                  -- ordered list of terms, matches result groups
  outscraper_request_id   text,
  requested               int default 0,          -- total records returned (all terms)
  new_leads               int default 0,          -- rows actually inserted
  duplicates              int default 0,          -- deduped out (across terms + DB)
  filtered_out            int default 0,          -- dropped by the derm/plastic/hospital filter
  status                  text default 'submitted', -- submitted | completed | failed
  error                   text,
  created_at              timestamptz default now()
);

create index if not exists med_spa_runs_request_idx on med_spa_runs (outscraper_request_id);
