-- Content example library (Content Engine v2, Phase 4).
-- The ~15 reference MP4s the operator downloaded are run through analyzeVideo (shot-by-shot
-- Claude vision read), then stored here as a labeled, difficulty-tagged style library. These
-- rows become extra few-shot context for the recreate flow and the format generator.
-- ADD ONLY — no drops, no modifications to existing tables.
--
-- vertical_id is plain text (NOT a FK) so ingest never fails while `verticals` is unseeded;
-- it defaults to 'pest_control' (DEFAULT_VERTICAL_ID).

CREATE TABLE IF NOT EXISTS content_examples (
  id            text PRIMARY KEY,                        -- uuid string
  vertical_id   text NOT NULL DEFAULT 'pest_control',    -- which kit this example anchors
  source_path   text,                                    -- absolute path of the source mp4
  storyboard    jsonb DEFAULT '{}',                      -- { hook, why_it_works, shots:[{t,what,why}], our_version }
  labels        text[] DEFAULT '{}',                     -- 'open_loop_hook','satisfying_broll','pov',...
  difficulty    text NOT NULL DEFAULT 'medium',          -- easy | medium | hard
  frame_urls    jsonb DEFAULT '[]',                      -- sampled frames uploaded to the `reels` bucket
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS content_examples_vertical_idx ON content_examples (vertical_id, difficulty);

-- One row per source video; makes the ingest script idempotent (re-runs upsert, not duplicate).
CREATE UNIQUE INDEX IF NOT EXISTS content_examples_source_idx ON content_examples (source_path);
