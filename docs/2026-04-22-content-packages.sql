-- Phase 1 of the Content Video System (plan:
-- C:\Users\matth\.claude\plans\this-is-another-thing-fluttering-whistle.md).
--
-- Stores every Viral Video Decoder package produced from #content and
-- #content-full Slack drops so the reaction handler can regenerate from
-- feedback, and so #content-full's video pipeline can pick up the same
-- structured package without re-prompting Claude.
--
-- Run in: Supabase SQL Editor. Safe to re-run.

CREATE TABLE IF NOT EXISTS public.content_packages (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slack_channel      TEXT NOT NULL,
  slack_thread_ts    TEXT NOT NULL,
  slack_package_ts   TEXT,
  brief              TEXT,
  image_count        INT  NOT NULL DEFAULT 0,
  package_json       JSONB NOT NULL,
  status             TEXT NOT NULL DEFAULT 'awaiting_approval'
                     CHECK (status IN ('awaiting_approval', 'approved', 'regenerating', 'killed', 'rendering', 'rendered', 'render_failed')),
  parent_package_id  uuid REFERENCES public.content_packages(id) ON DELETE SET NULL,
  regenerate_feedback TEXT,
  final_mp4_url      TEXT,
  total_cost_cents   INT,
  latency_ms         INT,
  model              TEXT,
  created_at         timestamptz NOT NULL DEFAULT now(),
  resolved_at        timestamptz
);

CREATE INDEX IF NOT EXISTS idx_content_packages_thread
  ON public.content_packages(slack_channel, slack_thread_ts);

CREATE INDEX IF NOT EXISTS idx_content_packages_status_created
  ON public.content_packages(status, created_at DESC);

-- Optional RLS hardening to match the rest of the schema
ALTER TABLE public.content_packages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS content_packages_service_all ON public.content_packages;
CREATE POLICY content_packages_service_all ON public.content_packages
  FOR ALL TO service_role USING (true) WITH CHECK (true);
