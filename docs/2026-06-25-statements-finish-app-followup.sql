-- 2026-06-25 — Statements-received → finish-application follow-up
--
-- Adds the clock + dedupe columns the 30-minute "finish your application"
-- follow-up cron reads (src/lib/statements-finish-app-followup.ts):
--   statements_analyzed_at                 — stamped when the bank-statement
--                                            analyzer flips status → "analyzed"
--                                            (src/app/api/agent/bank-statements/route.ts)
--   statements_finish_app_followup_sent_at — dedupe; stamped before send so
--                                            overlapping ticks can't double-send

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS statements_analyzed_at timestamptz,
  ADD COLUMN IF NOT EXISTS statements_finish_app_followup_sent_at timestamptz;

-- Partial index for the cron's hot path: rows with statements analyzed and the
-- follow-up not yet sent.
CREATE INDEX IF NOT EXISTS idx_contacts_statements_finish_app_due
  ON contacts (statements_analyzed_at)
  WHERE statements_finish_app_followup_sent_at IS NULL
    AND bank_statement_analysis_status = 'analyzed';
