-- Per-slide generation tracking for BrainHeart approval-to-execution loop
CREATE TABLE content_scenes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_package_id  uuid REFERENCES content_packages(id) NOT NULL,
  slide_number        int NOT NULL,

  -- Prompts (seeded from package_json.slides[] at job start)
  image_prompt        text,
  animation_prompt    text,
  duration_seconds    numeric,

  -- Image generation
  image_url           text,
  slack_image_ts      text,      -- ts of the image+approval message; used to map reactions back to this scene
  image_approved      boolean DEFAULT false,
  image_error         text,

  -- Video generation
  video_job_id        text,      -- ElevenLabs job_id (for polling)
  video_url           text,
  slack_video_ts      text,      -- ts of the video approval message; used to map reactions back to this scene
  video_approved      boolean DEFAULT false,
  video_error         text,

  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX idx_content_scenes_pkg_slide
  ON content_scenes(content_package_id, slide_number);
CREATE INDEX idx_content_scenes_image_ts ON content_scenes(slack_image_ts);
CREATE INDEX idx_content_scenes_video_ts ON content_scenes(slack_video_ts);

-- Extend content_packages (ADD ONLY — no drops, no modifications to existing columns)
ALTER TABLE content_packages
  ADD COLUMN IF NOT EXISTS assembly_guide_posted boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS sofia_voiceover_url   text;
