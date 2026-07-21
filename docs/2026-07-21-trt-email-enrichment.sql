-- Email enrichment for trt_leads (free website scrape -> Supabase -> Zoho Email).
-- See: src/lib/email-scrape.ts, scripts/enrich-trt-emails.ts,
--      src/app/api/cron/enrich-trt-emails/route.ts. Safe to re-run.

alter table trt_leads add column if not exists email text;
alter table trt_leads add column if not exists email_source text;      -- provenance, e.g. 'scrape:/contact:mailto'
alter table trt_leads add column if not exists email_checked_at timestamptz;  -- stamped on EVERY attempt so misses aren't re-crawled

-- Selection helper for the enrichment pass (candidates = unchecked rows with a site).
create index if not exists trt_leads_email_check_idx
  on trt_leads (email_checked_at) where email is null and website is not null;
