-- SRT Reel Studio — Slack #content-full automation schema.
--
-- reel_studio_jobs: per-job thread state for the studio workflow (operator posts
--   an image + copy -> Vektor posts 4 reel-copy variations -> operator replies with
--   the final 4 text boxes OR reacts 1/2/3/4 -> Vektor renders the branded MP4 via
--   the api/render-reel.py engine and posts it back with its caption).
--
-- This is the SRT Reel Studio look (white label -> colored hooks -> CTA pill over
-- the fixed song), distinct from reel_drops (the daily-creative hook/payoff flow).
--
-- Run in: Supabase SQL Editor. Safe to re-run.
-- Also create a Storage bucket named `reels` (public read) for the rendered MP4s.

CREATE TABLE IF NOT EXISTS public.reel_studio_jobs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slack_channel    TEXT NOT NULL,
  slack_thread_ts  TEXT NOT NULL,              -- the original image post ts (the thread)
  options_msg_ts   TEXT,                       -- the 4-variations message ts (for reaction mapping)
  brief            TEXT,                        -- the operator's copy/angle from the post
  image_url        TEXT,                        -- url_private of the uploaded picture
  image_mimetype   TEXT,
  variations       JSONB,                       -- [{label,line1,line2,cta} x4]
  final_script     JSONB,                       -- {label,line1,line2,cta} actually rendered
  caption          TEXT,
  mp4_url          TEXT,
  status           TEXT NOT NULL DEFAULT 'awaiting_pick'
                   CHECK (status IN ('awaiting_pick', 'rendering', 'done', 'error')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reel_studio_jobs_thread ON public.reel_studio_jobs(slack_thread_ts);
CREATE INDEX IF NOT EXISTS idx_reel_studio_jobs_options_msg ON public.reel_studio_jobs(options_msg_ts);

ALTER TABLE public.reel_studio_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reel_studio_jobs_service_all ON public.reel_studio_jobs;
CREATE POLICY reel_studio_jobs_service_all ON public.reel_studio_jobs
  FOR ALL TO service_role USING (true) WITH CHECK (true);
