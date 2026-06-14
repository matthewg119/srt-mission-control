-- SRT Daily Creative Drop — schema.
--
-- reel_rotation: one row per slot; tracks the last belief used so the cron rotates
--   instead of repeating. (Full per-drop audit lives in system_logs.)
-- reel_drops: per-drop thread state for the interactive workflow (cron posts a
--   prompt -> operator uploads the pic -> Vektor posts 3 headline options ->
--   operator reacts 1/2/3 -> Vektor posts the caption).
--
-- Run in: Supabase SQL Editor. Safe to re-run.

CREATE TABLE IF NOT EXISTS public.reel_rotation (
  slot        TEXT PRIMARY KEY CHECK (slot IN ('morning', 'midday', 'evening')),
  last_belief INT  NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.reel_drops (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slack_channel    TEXT NOT NULL,
  slack_thread_ts  TEXT NOT NULL,              -- top-level prompt message ts (the thread)
  headline_msg_ts  TEXT,                       -- the 3-options message ts (for reaction mapping)
  slot             TEXT,
  belief_number    INT  NOT NULL,
  belief_title     TEXT,
  scene            TEXT,
  image_prompt     TEXT,
  image_url        TEXT,                        -- url_private of the uploaded picture
  image_mimetype   TEXT,
  headline_options JSONB,                       -- [{hook,payoff} x3]
  chosen_index     INT,
  caption          TEXT,
  status           TEXT NOT NULL DEFAULT 'awaiting_image'
                   CHECK (status IN ('awaiting_image', 'awaiting_pick', 'done')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reel_drops_thread ON public.reel_drops(slack_thread_ts);
CREATE INDEX IF NOT EXISTS idx_reel_drops_headline_msg ON public.reel_drops(headline_msg_ts);

ALTER TABLE public.reel_rotation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reel_drops ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reel_rotation_service_all ON public.reel_rotation;
CREATE POLICY reel_rotation_service_all ON public.reel_rotation
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS reel_drops_service_all ON public.reel_drops;
CREATE POLICY reel_drops_service_all ON public.reel_drops
  FOR ALL TO service_role USING (true) WITH CHECK (true);
