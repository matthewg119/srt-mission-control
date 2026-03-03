-- ═══════════════════════════════════════════════════════════════
-- SRT Mission Control — Email Sequence Tables
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor)
-- ═══════════════════════════════════════════════════════════════

-- 1. Email Sequences (defines each drip campaign)
CREATE TABLE IF NOT EXISTS email_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  trigger_tag TEXT,          -- Tag that auto-enrolls (null = manual enrollment only)
  cancel_tag TEXT,           -- Tag that cancels active enrollments
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Email Sequence Steps (individual emails in a sequence)
CREATE TABLE IF NOT EXISTS email_sequence_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id UUID NOT NULL REFERENCES email_sequences(id) ON DELETE CASCADE,
  step_number INT NOT NULL,
  delay_minutes INT NOT NULL DEFAULT 0,  -- Minutes from enrollment to send
  subject TEXT NOT NULL,
  body TEXT NOT NULL,                      -- HTML email body, supports {{variables}}
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(sequence_id, step_number)
);

-- 3. Sequence Enrollments (tracks each contact's progress)
CREATE TABLE IF NOT EXISTS sequence_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id UUID NOT NULL REFERENCES email_sequences(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL,               -- GHL contact ID
  contact_email TEXT,
  contact_name TEXT,
  current_step INT DEFAULT 0,             -- 0 = not started yet
  next_send_at TIMESTAMPTZ,               -- When the next email should go out
  status TEXT DEFAULT 'active'            -- active | completed | cancelled
    CHECK (status IN ('active', 'completed', 'cancelled')),
  enrolled_at TIMESTAMPTZ DEFAULT now(),
  cancelled_at TIMESTAMPTZ,
  metadata JSONB,                          -- Extra context (businessName, amountNeeded, etc.)
  UNIQUE(sequence_id, contact_id, status)  -- Prevent duplicate active enrollments
);

-- Indexes for the cron job query performance
CREATE INDEX IF NOT EXISTS idx_enrollments_due
  ON sequence_enrollments (status, next_send_at)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_enrollments_contact
  ON sequence_enrollments (contact_id, status);

CREATE INDEX IF NOT EXISTS idx_sequence_steps_lookup
  ON email_sequence_steps (sequence_id, step_number);

-- ═══════════════════════════════════════════════════════════════
-- After running this SQL:
-- 1. Deploy the code to Vercel
-- 2. Hit POST /api/sequences/seed to populate the 4 sequences
--    (54 total emails across all sequences)
-- 3. The cron job at /api/cron/process-sequences runs every 5 min
--    (requires Vercel Pro for sub-hourly crons)
-- ═══════════════════════════════════════════════════════════════
