-- iMessage transport migration (2026-05-30)
-- Makes the Mac iMessage bridge the inbound transport for the existing
-- sms_conversations / sms_messages model. LoopMessage send relay + auto-send
-- crons have been removed in code; outbound is now manual copy/paste from the
-- Mac's Messages app, so the auto_send_* columns on sms_pending_drafts are no
-- longer written (left in place for historical rows).
--
-- Apply manually in the Supabase SQL editor (same convention as
-- docs/2026-04-18-ai-intelligence-layer.sql). Safe to re-run.

-- 1) Idempotency key for the bridge + backfill. The Messages chat.db row GUID is
--    globally unique; we dedupe inbound/backfilled rows on it so re-runs and
--    overlapping polls never double-insert.
ALTER TABLE sms_messages
  ADD COLUMN IF NOT EXISTS imessage_guid TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS sms_messages_imessage_guid_idx
  ON sms_messages (imessage_guid)
  WHERE imessage_guid IS NOT NULL;

-- 2) Track how many times Matthew hit 🔄 Regenerate on a suggestion (telemetry +
--    lets the UI show "regenerated Nx"). sms_pending_drafts is now the live
--    "current suggestion" store, keyed one-per-conversation.
ALTER TABLE sms_pending_drafts
  ADD COLUMN IF NOT EXISTS regenerate_count INT NOT NULL DEFAULT 0;
