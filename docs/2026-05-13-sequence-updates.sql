-- ═══════════════════════════════════════════════════════════════
-- 2026-05-13: Sequence enrollment enhancements
-- Run in Supabase SQL Editor before deploying.
-- ═══════════════════════════════════════════════════════════════

-- 1. New table: nightly segmenter output — who is eligible for each sequence
CREATE TABLE IF NOT EXISTS sequence_eligibility_lists (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_id      uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  list_name       text NOT NULL,         -- 'eligible_fu_new' | 'eligible_awaiting_statements' | etc.
  computed_at     timestamptz NOT NULL DEFAULT now(),
  reason_snapshot jsonb,                 -- Zoho status, portal flags, days since created, etc.
  UNIQUE (contact_id, list_name)         -- upsert-safe; segmenter truncate-and-replaces per list
);
CREATE INDEX IF NOT EXISTS idx_seq_elig_list  ON sequence_eligibility_lists (list_name);
CREATE INDEX IF NOT EXISTS idx_seq_elig_cid   ON sequence_eligibility_lists (contact_id);
CREATE INDEX IF NOT EXISTS idx_seq_elig_time  ON sequence_eligibility_lists (computed_at);

-- 2. Extend sequence_enrollments with approval + stop tracking
ALTER TABLE sequence_enrollments
  ADD COLUMN IF NOT EXISTS enrolled_by       text,          -- 'zoho_button' | 'ui' | 'system'
  ADD COLUMN IF NOT EXISTS pending_action_id uuid,          -- set while a Slack approval card is live
  ADD COLUMN IF NOT EXISTS stopped_at        timestamptz,
  ADD COLUMN IF NOT EXISTS stop_reason       text;

-- 3. Widen the status CHECK constraint to include 'stopped'
--    (Postgres requires drop + recreate; IF NOT EXISTS not supported for constraints)
ALTER TABLE sequence_enrollments
  DROP CONSTRAINT IF EXISTS sequence_enrollments_status_check;
ALTER TABLE sequence_enrollments
  ADD CONSTRAINT sequence_enrollments_status_check
  CHECK (status IN ('active', 'completed', 'cancelled', 'stopped'));

-- 4. Partial index to speed up the "pending draft" skip check
CREATE INDEX IF NOT EXISTS idx_enrollments_due_no_pending
  ON sequence_enrollments (status, next_send_at)
  WHERE status = 'active' AND pending_action_id IS NULL;

-- 5. Add category column for SBA / LOC / CRE / MCA labeling on enrollments
ALTER TABLE sequence_enrollments
  ADD COLUMN IF NOT EXISTS category text DEFAULT 'mca'
  CHECK (category IN ('mca', 'sba', 'loc', 'cre'));

-- ═══════════════════════════════════════════════════════════════
-- ALSO RUN THIS BEFORE GOING LIVE (cancel old auto-blast drafts):
--
--   UPDATE pending_slack_actions
--   SET status = 'cancelled'
--   WHERE action_type = 'send_marketing_email' AND status = 'pending';
--
-- ═══════════════════════════════════════════════════════════════
