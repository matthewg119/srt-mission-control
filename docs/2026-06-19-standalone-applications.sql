-- 2026-06-19 — Standalone /apply submissions (srtagency.com/apply)
--
-- The /apply link creates business funding applications on demand with NO
-- restrictions: no bank statements, no email-uniqueness. The SAME email may be
-- submitted many times and each submission is its own independent row. This is
-- intentionally DECOUPLED from `contacts` (which keys identity on a unique email
-- and is used by the portal/auth/Zoho-dedup flows) so /apply can never collide
-- with or overwrite a real lead.
--
-- Both the portal (insert) and Mission Control (read/update) point at the same
-- Supabase project, so this single table serves both repos.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS standalone_applications (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at      timestamptz DEFAULT now(),

  -- applicant (email is intentionally NON-unique)
  first_name      text,
  last_name       text,
  email           text,
  phone           text,
  dob             text,
  ssn_full        text,
  ssn4            text,

  -- business
  business_name   text,
  industry        text,
  biz_type        text,
  ein             text,
  inc_date        text,
  ownership       text,
  biz_address     text,
  biz_city        text,
  biz_state       text,
  biz_zip         text,

  -- financial (free-typed by the applicant)
  monthly_revenue text,
  amount_needed   text,
  use_of_funds    text,
  existing_loans  text,
  funding_urgency text,

  -- signature / consent
  signature_name  text,
  consent_at      timestamptz,

  -- ops linkage (filled by Mission Control after ingestion)
  onedrive_folder_url text,
  zoho_lead_id        text,
  slack_ts            text,
  source              text DEFAULT 'apply'
);

CREATE INDEX IF NOT EXISTS idx_standalone_apps_created
  ON standalone_applications (created_at DESC);

-- Fuzzy same-business lookups across prior /apply submits (dedup check).
CREATE INDEX IF NOT EXISTS idx_standalone_apps_bizname_trgm
  ON standalone_applications USING gin (business_name gin_trgm_ops);
