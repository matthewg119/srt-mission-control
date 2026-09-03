-- Dedupe at the drop, before the workflow picker. src/lib/scraper/{dedup,lane,store}.ts.
-- Extends docs/2026-08-27-scraper-lane.sql and docs/2026-08-28-scraper-score-lane.sql.
--
-- A CSV dropped in #srt-scraper used to go straight to the picker. Nothing was deduped until AFTER
-- a workflow was chosen, and then only on email, and only for workflow 1. Workflow 2 deduped on
-- nothing at all, so a company scored last week got its DataForSEO SERP bought a second time.
--
-- Now the drop splits the file first: duplicates.csv + new.csv, then the picker, scoped to the new
-- rows. Both workflows step over the duplicates.

-- ── the ledger ──────────────────────────────────────────────────────────────────────────────────
--
-- ONE ROW PER KEY, NOT PER LEAD. "domain or phone or email, any hit" is a set-membership question:
-- three narrow rows make the read one `.in()` per key type and the write an ignoreDuplicates
-- upsert. A lead-shaped table would need three OR'd predicates per row instead.
--
-- ‼️ THE UNIQUE INDEX IS ON PLAIN COLUMNS, NEVER AN EXPRESSION. PostgREST cannot name an expression
-- index in `onConflict`, which is why `outreach_prospects (lower(email))` has a read-then-write
-- upsert bolted on instead of a real one (src/lib/followup-operator/prospects.ts:74). Normalization
-- happens in TypeScript before the write, so the stored value IS the key.
create table if not exists scraper_seen (
  id             uuid primary key default gen_random_uuid(),

  -- 'domain' | 'phone' | 'email'. Phone is the LAST TEN DIGITS, matching contacts.phone_last10.
  key_type       text not null,
  key_value      text not null,

  -- Which drop first recorded it. Nullable and ON DELETE SET NULL: deleting a batch must not
  -- resurrect its leads as new.
  first_batch_id uuid references scraper_batches(id) on delete set null,

  -- Provenance, so a hit in duplicates.csv can say WHAT it matched rather than just that it did.
  company        text,
  city           text,
  website        text,
  email          text,
  phone          text,

  first_seen_at  timestamptz not null default now(),

  constraint scraper_seen_key_type_check check (key_type in ('domain', 'phone', 'email')),
  unique (key_type, key_value)
);

create index if not exists scraper_seen_batch_idx on scraper_seen (first_batch_id);

-- Service role only. Nothing client-side reads it.
alter table scraper_seen enable row level security;

-- ── what the drop records on the batch ──────────────────────────────────────────────────────────
alter table scraper_batches
  -- The 0-based indexes into the ORIGINAL parsed file that were already seen. Carried rather than
  -- re-slicing parsed.rows: scraper_rows.row_index is documented as the index into the original
  -- file, and handing a workflow a shortened array renumbers every row and breaks that silently.
  add column if not exists dedupe_dupe_indexes jsonb,
  add column if not exists dedupe_dupe_count   integer not null default 0,
  add column if not exists dedupe_new_count    integer not null default 0,
  -- The guard, same shape as csv_posted_at and the four *_ts gate columns: set once the split has
  -- been posted, so a cron re-entry re-reads one row and uploads nothing a second time.
  add column if not exists dedupe_ran_at       timestamptz;

-- ── the new junk reason ─────────────────────────────────────────────────────────────────────────
--
-- ‼️ THE OLD CHECK ALLOWS ONLY SEVEN VALUES AND WILL REJECT EVERY duplicate_prior_batch ROW. Drop
-- and recreate it or workflow 1 cannot write its junk rows at all.
alter table scraper_rows drop constraint if exists scraper_rows_reason_check;
alter table scraper_rows add constraint scraper_rows_reason_check check (
  reason is null or reason in (
    'no_email', 'duplicate_in_file', 'duplicate_prior_batch', 'already_in_crm',
    'bad_syntax', 'role_account', 'disposable_domain', 'no_mx'
  )
);

-- ── the one-time seed ───────────────────────────────────────────────────────────────────────────
--
-- Every row the lane has already processed, so the first drop after this migration already knows
-- them. scraper_rows carries no phone column, so phone keys start empty and fill from the next
-- drop. Re-runnable: on conflict do nothing.
--
-- ‼️ THE HOST NORMALIZATION HERE MUST MATCH normalizeHost() IN TypeScript OR THE SEEDED KEYS NEVER
-- MATCH ANYTHING. Same three steps: drop the scheme, drop a leading www., drop the path. The
-- NOT IN list mirrors NON_IDENTIFYING_HOSTS in src/lib/scraper/dedup.ts: keyed on facebook.com,
-- the SECOND business with a Facebook page is deleted as a duplicate of the first.
insert into scraper_seen (key_type, key_value, first_batch_id, company, city, website)
select distinct on (host) 'domain', host, r.batch_id, r.company, r.city, r.website
from (
  select
    id, batch_id, company, city, website, created_at,
    split_part(
      lower(regexp_replace(regexp_replace(trim(website), '^https?://', '', 'i'), '^www\.', '', 'i')),
      '/', 1
    ) as host
  from scraper_rows
  where website is not null and trim(website) <> ''
) r
where r.host <> ''
  and r.host like '%.%'
  and r.host not in (
    'facebook.com', 'm.facebook.com', 'instagram.com', 'linkedin.com', 'twitter.com', 'x.com',
    'yelp.com', 'google.com', 'sites.google.com', 'business.site', 'wixsite.com', 'wix.com',
    'squarespace.com', 'godaddysites.com', 'weebly.com', 'wordpress.com', 'blogspot.com',
    'mystrikingly.com', 'webflow.io', 'square.site', 'youtube.com', 'tiktok.com', 'booksy.com',
    'vagaro.com', 'setmore.com', 'schedulicity.com', 'yahoo.com', 'gmail.com'
  )
order by r.host, r.created_at asc
on conflict (key_type, key_value) do nothing;

insert into scraper_seen (key_type, key_value, first_batch_id, company, city, website, email)
select distinct on (addr) 'email', addr, r.batch_id, r.company, r.city, r.website, addr
from (
  select id, batch_id, company, city, website, created_at, lower(trim(email)) as addr
  from scraper_rows
  where email is not null and trim(email) <> ''
) r
where r.addr like '%@%.%'
order by r.addr, r.created_at asc
on conflict (key_type, key_value) do nothing;

-- Read back: how many keys of each kind the seed produced.
select key_type, count(*) from scraper_seen group by key_type order by key_type;
