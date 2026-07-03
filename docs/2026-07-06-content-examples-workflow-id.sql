-- 2026-07-06: per-workflow reference library
-- 1) Scope content_examples rows to a single workflow (nullable: vertical-level refs stay NULL)
ALTER TABLE content_examples ADD COLUMN IF NOT EXISTS workflow_id text;

CREATE INDEX IF NOT EXISTS content_examples_workflow_idx
  ON content_examples (workflow_id, created_at DESC)
  WHERE workflow_id IS NOT NULL;

-- 2) Purge the auto-saved GENERATED images that polluted the reference library
--    (the wasp/baseboard POV rows saved by workflow-pipeline after each generation).
--    Real references are labeled reference_video / realism_reference / reference_house
--    and are NOT touched.
DELETE FROM content_examples WHERE 'generated' = ANY(labels);
