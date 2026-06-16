-- PDF funnel + statements-first portal — contacts backfill columns.
--
-- Supports Part E (the statement digestion pipeline): when the bank-statement
-- analyzer runs it backfills extracted business data onto the contacts row so the
-- portal can pre-fill the application and the processing overlay can poll status.
--
-- Adds (IF NOT EXISTS — safe to re-run):
--   bank_statement_analysis_status : 'processing' while the analyzer runs, then
--     'analyzed' on success (or 'error' on the failure path). Drives the portal
--     processing overlay + the "skip statements step" gate.
--   statement_months_covered       : JSONB array of "YYYY-MM" strings the analyzer
--     reports it covered (used for the stale-resubmit re-verification gate).
--   monthly_deposits               : avg monthly deposits (numeric) from the analyzer.
--
-- Already present on contacts (do NOT add): business_name, biz_address, biz_city,
-- biz_state, biz_zip, monthly_revenue, portal_statements_uploaded, plaid_verified,
-- statements_uploaded_at.
--
-- Run in: Supabase SQL Editor.

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS bank_statement_analysis_status text,
  ADD COLUMN IF NOT EXISTS statement_months_covered jsonb,
  ADD COLUMN IF NOT EXISTS monthly_deposits numeric;
