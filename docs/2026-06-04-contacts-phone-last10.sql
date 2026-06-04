-- Contact phone matching for the iMessage bridge (2026-06-04)
-- Contacts store phones in mixed formats ("7865909616", "(684) 984-6516", etc.) —
-- NONE in E.164. The iMessage handle normalizes to +1XXXXXXXXXX, so an exact match
-- found nobody and every inbound message was discarded.
--
-- Fix: maintain last-10-digit columns (format-agnostic) so the inbound route can
-- match on `phone_last10` / `mobile_last10`. STORED generated columns auto-backfill
-- existing rows and stay in sync on every insert/update.
--
-- Apply manually in the Supabase SQL editor. Safe to re-run.

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS phone_last10 text
  GENERATED ALWAYS AS (right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10)) STORED;

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS mobile_last10 text
  GENERATED ALWAYS AS (right(regexp_replace(coalesce(mobile_phone, ''), '[^0-9]', '', 'g'), 10)) STORED;

CREATE INDEX IF NOT EXISTS contacts_phone_last10_idx ON contacts (phone_last10);
CREATE INDEX IF NOT EXISTS contacts_mobile_last10_idx ON contacts (mobile_last10);
