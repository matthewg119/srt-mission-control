-- ═══════════════════════════════════════════════════════════════
-- SRT Mission Control — Tasks Table
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor)
-- Fixes PGRST205 error on /api/tasks (relation "public.tasks" does not exist)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS tasks (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Task identity
  type          TEXT NOT NULL,                          -- e.g. "follow_up", "underwriting", "document_request"
  title         TEXT NOT NULL,
    description   TEXT,

  -- Assignment / routing
  assignee      TEXT NOT NULL DEFAULT 'Matthew',       -- person or team slug
  department    TEXT NOT NULL DEFAULT 'general',       -- e.g. "sales", "underwriting", "ops"

  -- Priority & scheduling
  priority      TEXT NOT NULL DEFAULT 'medium'
                    CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    status        TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'in_progress', 'completed', 'cancelled')),
    due_date      TIMESTAMPTZ,

  -- Links to other records
  deal_reference  TEXT,                                -- free-text deal name / ID for display
  pulse_id        UUID,                                -- optional link to a BrainHeart pulse

  -- Metadata
  context       JSONB,                                 -- arbitrary extra data
  source        TEXT DEFAULT 'manual',                 -- "manual" | "brainheart" | "cron" | …

  -- Timestamps
  created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now(),
    completed_at  TIMESTAMPTZ
  );

-- Indexes for the common query patterns used in /api/tasks
CREATE INDEX IF NOT EXISTS idx_tasks_status      ON tasks (status);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee    ON tasks (assignee);
CREATE INDEX IF NOT EXISTS idx_tasks_department  ON tasks (department);
CREATE INDEX IF NOT EXISTS idx_tasks_priority    ON tasks (priority);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at  ON tasks (created_at DESC);

-- ═══════════════════════════════════════════════════════════════
-- After running this SQL:
-- 1. The PGRST205 error on GET /api/tasks will be resolved
-- 2. POST /api/tasks  — create a task
-- 3. PATCH /api/tasks — update status / assignee / priority
-- ═══════════════════════════════════════════════════════════════
