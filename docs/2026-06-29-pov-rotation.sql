-- Meta Glasses POV format — scene rotation + #content-full workflow picker.
--
-- pov_rotation: a single row (id = 'pov') holding the recently-used POV_SCENES indices
--   so the 3 daily POV drops rotate through scenes instead of repeating. (Per-drop
--   audit lives in system_logs, event_type = 'cron_pov_drop'.)
-- pov_studio_jobs: one row per bare image/video posted to #content-full. The bot posts
--   a "what workflow?" breakdown; the operator's reaction (1=render, 2=animate,
--   3=recreate) is mapped back to the post by picker_msg_ts. Videos are resolved to a
--   still frame (thumbnail) so source_kind records whether the original was image/video.
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
  image_url       TEXT,                    -- chosen still-frame url (image url_private, or video thumbnail)
  image_mimetype  TEXT,
  source_kind     TEXT CHECK (source_kind IN ('image', 'video')),
  images          JSONB,                   -- daily-drop candidates [{index,scene,url,mimetype}] for the pick step
  workflow        TEXT CHECK (workflow IN ('render', 'animate', 'recreate', 'caption')),
  status          TEXT NOT NULL DEFAULT 'awaiting_workflow'
                  CHECK (status IN ('awaiting_pick', 'awaiting_workflow', 'running', 'done', 'error')),
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

-- If an earlier version of this table was already created, its workflow CHECK only
-- allowed ('render','animate','recreate') and the 4th workflow 'caption' (react 4️⃣)
-- would fail at write time. Re-add the constraint with 'caption' included.
ALTER TABLE public.pov_studio_jobs DROP CONSTRAINT IF EXISTS pov_studio_jobs_workflow_check;
ALTER TABLE public.pov_studio_jobs
  ADD CONSTRAINT pov_studio_jobs_workflow_check
  CHECK (workflow IN ('render', 'animate', 'recreate', 'caption'));
