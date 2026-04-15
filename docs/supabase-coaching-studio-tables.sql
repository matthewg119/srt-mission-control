-- ═══════════════════════════════════════════════════════════════
-- SRT Mission Control — Coaching Studio Tables
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor)
-- ═══════════════════════════════════════════════════════════════

-- 1. Coaching Categories (organize playbook entries)
CREATE TABLE IF NOT EXISTS coaching_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  color TEXT DEFAULT '#1B65A7',
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Seed the existing categories already used in the legacy srt_playbook blob.
INSERT INTO coaching_categories (name, description, color, sort_order) VALUES
  ('pattern_interrupt', 'Break the merchant out of their autopilot response', '#9C27B0', 10),
  ('objection_discovery', 'Dig into the real reason behind an objection', '#E74C3C', 20),
  ('sales_psychology', 'Psychological levers — reciprocity, scarcity, etc.', '#F5A623', 30),
  ('credibility', 'Build trust with stories, numbers, and proof', '#00BCD4', 40),
  ('redirect', 'Reframe the conversation back on track', '#1B65A7', 50),
  ('discovery', 'Qualifying questions to uncover info', '#00C9A7', 60),
  ('reframe', 'Change the merchant''s perspective on an issue', '#FF9800', 70),
  ('empathy', 'Acknowledge without validating the objection', '#4CAF50', 80),
  ('close', 'Ask for the commitment', '#f97316', 90),
  ('urgency', 'Create reasons to act now', '#ec4899', 100),
  ('educate', 'Teach something new that reframes the decision', '#06b6d4', 110)
ON CONFLICT (name) DO NOTHING;

-- 2. Coaching Playbook Entries (normalized version of srt_playbook)
CREATE TABLE IF NOT EXISTS coaching_playbook_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger TEXT NOT NULL,
  category TEXT NOT NULL,
  suggestions JSONB NOT NULL DEFAULT '[]'::jsonb,
  context TEXT,
  source TEXT DEFAULT 'manual',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_coaching_playbook_category
  ON coaching_playbook_entries (category);

CREATE INDEX IF NOT EXISTS idx_coaching_playbook_active
  ON coaching_playbook_entries (is_active, updated_at DESC);

-- 3. Sync function — rebuilds the legacy srt_playbook JSONB blob from the
-- normalized table. Called after any mutation so the Chrome extension
-- (which reads from srt_playbook) keeps working without changes.
CREATE OR REPLACE FUNCTION sync_playbook_to_legacy()
RETURNS INTEGER AS $$
DECLARE
  new_playbook JSONB;
  current_version INTEGER;
BEGIN
  -- Build the JSONB array from active entries in the normalized table.
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'trigger', trigger,
        'category', category,
        'suggestions', suggestions,
        'context', COALESCE(context, ''),
        'source', COALESCE(source, 'manual')
      )
      ORDER BY updated_at DESC
    ),
    '[]'::jsonb
  )
  INTO new_playbook
  FROM coaching_playbook_entries
  WHERE is_active = true;

  -- Upsert into srt_playbook (single row, id=1 by convention).
  SELECT version INTO current_version FROM srt_playbook ORDER BY id LIMIT 1;

  IF current_version IS NULL THEN
    INSERT INTO srt_playbook (playbook, version, updated_at)
    VALUES (new_playbook, 1, now());
    RETURN 1;
  ELSE
    UPDATE srt_playbook
    SET playbook = new_playbook,
        version = current_version + 1,
        updated_at = now()
    WHERE id = (SELECT id FROM srt_playbook ORDER BY id LIMIT 1);
    RETURN current_version + 1;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- 4. Add analysis columns to existing call_coach_sessions.
-- These are used by the Call Library (title/contact/outcome) and later
-- by the Call Analyzer (analysis_status/analysis_result/score).
ALTER TABLE call_coach_sessions
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS contact_name TEXT,
  ADD COLUMN IF NOT EXISTS business_name TEXT,
  ADD COLUMN IF NOT EXISTS outcome TEXT,
  ADD COLUMN IF NOT EXISTS analysis_status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS analysis_result JSONB,
  ADD COLUMN IF NOT EXISTS score INTEGER,
  ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE INDEX IF NOT EXISTS idx_call_coach_sessions_started
  ON call_coach_sessions (started_at DESC);

CREATE INDEX IF NOT EXISTS idx_call_coach_sessions_outcome
  ON call_coach_sessions (outcome) WHERE outcome IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════
-- One-time migration: copy entries from the legacy srt_playbook
-- JSONB blob into the normalized table so existing playbook data
-- is preserved when the UI goes live. Safe to re-run (skips
-- duplicates by trigger+category).
-- ═══════════════════════════════════════════════════════════════
INSERT INTO coaching_playbook_entries (trigger, category, suggestions, context, source)
SELECT
  (entry->>'trigger')::TEXT,
  (entry->>'category')::TEXT,
  COALESCE(entry->'suggestions', '[]'::jsonb),
  (entry->>'context')::TEXT,
  COALESCE((entry->>'source')::TEXT, 'legacy-import')
FROM srt_playbook,
LATERAL jsonb_array_elements(playbook) AS entry
WHERE NOT EXISTS (
  SELECT 1 FROM coaching_playbook_entries e
  WHERE e.trigger = (entry->>'trigger')::TEXT
    AND e.category = (entry->>'category')::TEXT
);

-- ═══════════════════════════════════════════════════════════════
-- After running this SQL:
-- 1. Playbook entries from srt_playbook are migrated into
--    coaching_playbook_entries (one-time, idempotent)
-- 2. The Coaching Studio UI reads/writes coaching_playbook_entries
-- 3. After every mutation, call SELECT sync_playbook_to_legacy()
--    to rebuild the srt_playbook JSONB so the Chrome extension
--    keeps working with zero changes
-- ═══════════════════════════════════════════════════════════════
