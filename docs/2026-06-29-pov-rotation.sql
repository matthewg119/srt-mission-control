-- Meta Glasses POV format — scene rotation + #content-full workflow picker.
--
-- pov_rotation: a single row (id = 'pov') holding the recently-used POV_SCENES indices
--   so the 3 daily POV drops rotate through scenes instead of repeating. (Per-drop
--   audit lives in system_logs, event_type = 'cron_pov_drop'.)
-- pov_studio_jobs: one row per bare image posted to #content-full. The bot posts a
--   "what workflow?" picker; the operator's reaction (1=animate, 2=learn/recreate) is
--   mapped back to the image by picker_msg_ts.
--
-- Run in: Supabase SQL Editor. Safe to re-run.

CREATE TABLE IF NOT EXISTS public.pov_rotation (
  id         TEXT PRIMARY KEY DEFAULT 'pov',
  recent     JSONB NOT NULL DEFAULT '[]'::jsonb,   -- recently-used POV_SCENES indices
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pov_studio_jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slack_channel   TEXT NOT NULL,
  slack_thread_ts TEXT NOT NULL,           -- the image message ts (becomes the thread)
  picker_msg_ts   TEXT,                    -- the "what workflow?" message ts (reaction maps here)
  image_url       TEXT,                    -- url_private of the posted image
  image_mimetype  TEXT,
  workflow        TEXT CHECK (workflow IN ('animate', 'recreate')),
  status          TEXT NOT NULL DEFAULT 'awaiting_workflow'
                  CHECK (status IN ('awaiting_workflow', 'running', 'done', 'error')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pov_studio_jobs_picker ON public.pov_studio_jobs(picker_msg_ts);
CREATE INDEX IF NOT EXISTS idx_pov_studio_jobs_thread ON public.pov_studio_jobs(slack_thread_ts);

ALTER TABLE public.pov_rotation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pov_studio_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pov_rotation_service_all ON public.pov_rotation;
CREATE POLICY pov_rotation_service_all ON public.pov_rotation
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS pov_studio_jobs_service_all ON public.pov_studio_jobs;
CREATE POLICY pov_studio_jobs_service_all ON public.pov_studio_jobs
  FOR ALL TO service_role USING (true) WITH CHECK (true);
