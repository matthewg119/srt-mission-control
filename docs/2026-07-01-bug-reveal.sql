-- ============================================================================
-- Bug-Reveal Spray format — job state table.
-- Paste into the Supabase SQL Editor (Mission Control project) and Run.
-- Add-only and idempotent: safe to re-run.
--
-- Isolated from pov_studio_jobs on purpose so the 1/2/3 "pick the before" reaction
-- can never collide with the POV workflow picker (both self-route by picker_msg_ts,
-- each against its own table).
-- ============================================================================

CREATE TABLE IF NOT EXISTS bug_reveal_jobs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slack_channel    text NOT NULL,
  slack_thread_ts  text NOT NULL,
  picker_msg_ts    text,            -- the message the operator reacts on (ideas gate, then pick)
  before_images    jsonb DEFAULT '[]',  -- [{index, scene}] -> [{index, scene, url, mimetype}]
  chosen_before    jsonb,           -- the picked before option
  after_image_url  text,            -- the "with bugs" frame (public reels URL)
  status           text NOT NULL DEFAULT 'awaiting_ideas_approval',
                   -- awaiting_ideas_approval | generating | skipped | awaiting_pick
                   -- | building | done | error
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bug_reveal_jobs_picker ON bug_reveal_jobs (picker_msg_ts);
CREATE INDEX IF NOT EXISTS idx_bug_reveal_jobs_status ON bug_reveal_jobs (status);

-- Verification:
-- select id, status, jsonb_array_length(before_images) as n_before, after_image_url
--   from bug_reveal_jobs order by created_at desc limit 5;
