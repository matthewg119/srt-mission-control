-- Phase 1.5: extend `lenders` to carry the full MCA Funder Reference CSV.
--
-- Existing columns (from /api/lenders/seed + 2026-04-18 AI layer migration):
--   name, tier (int 1/2/3), products[], notes,
--   min_credit_score, min_monthly_revenue, max_amount,
--   min_time_in_business_months, max_negative_days, response_time_days,
--   submission_method ('email'|'portal'), submission_email, portal_url,
--   is_active, blocked_industries[],
--   min_deal_size, max_deal_size, verticals[]
--
-- CSV adds: CC emails, rep contact, factor rate range, positions funded,
-- funding speed, repayment frequency, and CSV paper grade (A+/A/B/C).
--
-- Run in Supabase SQL Editor. Safe to re-run.

ALTER TABLE public.lenders
  ADD COLUMN IF NOT EXISTS cc_emails            TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS rep_name             TEXT,
  ADD COLUMN IF NOT EXISTS rep_email            TEXT,
  ADD COLUMN IF NOT EXISTS factor_rate_range    TEXT,
  ADD COLUMN IF NOT EXISTS positions_funded     TEXT,
  ADD COLUMN IF NOT EXISTS funding_speed        TEXT,
  ADD COLUMN IF NOT EXISTS repayment_frequency  TEXT,
  ADD COLUMN IF NOT EXISTS tier_label           TEXT;

CREATE INDEX IF NOT EXISTS idx_lenders_active_tier_label
  ON public.lenders(is_active, tier_label);
