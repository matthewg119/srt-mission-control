-- Phase 1.2 + 1.3 of VeKtor Slack-native deal workflow.
-- Zoho becomes pipeline source of truth; every deal gets its own Slack thread.
--
-- Run this in: Supabase SQL Editor.
-- Safe to re-run (IF NOT EXISTS everywhere).

-- ────────────────────────────────────────────────────────────
-- deals: mirror Zoho stage + anchor Slack thread
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS zoho_stage              TEXT,
  ADD COLUMN IF NOT EXISTS zoho_stage_updated_at   timestamptz,
  ADD COLUMN IF NOT EXISTS slack_thread_ts         TEXT,
  ADD COLUMN IF NOT EXISTS slack_channel           TEXT;

CREATE INDEX IF NOT EXISTS idx_deals_zoho_stage
  ON public.deals(zoho_stage, zoho_stage_updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_deals_slack_thread
  ON public.deals(slack_thread_ts)
  WHERE slack_thread_ts IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- deal_events: first-class stage-transition rows for audit + cron queries
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.deal_events
  ADD COLUMN IF NOT EXISTS old_stage TEXT,
  ADD COLUMN IF NOT EXISTS new_stage TEXT,
  ADD COLUMN IF NOT EXISTS source    TEXT;

CREATE INDEX IF NOT EXISTS idx_deal_events_stage_change
  ON public.deal_events(deal_id, created_at DESC)
  WHERE event_type = 'stage_change';

-- ────────────────────────────────────────────────────────────
-- Note: the existing `deals.stage` column (Mission Control's own pipeline)
-- is intentionally NOT dropped here. The Kanban UI at /dashboard/pipeline
-- still reads it. When that UI is rewritten as a read-only Zoho mirror,
-- a follow-up migration will drop `stage` + `pipeline` columns.
-- ────────────────────────────────────────────────────────────
