-- Workflow Builder v2 (gov2): style DNA, caption template, stored beat grid,
-- and SCENE-scoped reference boards on content_examples.
-- Idempotent / additive. Safe to run more than once.

-- 1) workflows: per-workflow continuity + caption columns.
--    style_dna: ONE text block of visual invariants (character, location, lighting,
--    lens, wardrobe). PREPENDED to every scene image prompt; scene prompts then
--    describe only the ACTION. Falls back to the vertical's style_token when null.
--    caption_template: optional fill-in template for the caption stage.
--    beat_grid: analyzed song grid { bpm, beats:[seconds...], duration } so the
--    dashboard can re-snap timings without re-analyzing audio.
alter table workflows
  add column if not exists style_dna        text,
  add column if not exists caption_template text,
  add column if not exists beat_grid        jsonb;

-- 2) content_examples: scope references to ONE scene of a workflow.
--    scene_index is 1-based; null keeps existing workflow/vertical rows unchanged.
alter table content_examples add column if not exists scene_index int;

create index if not exists content_examples_scene_idx
  on content_examples (workflow_id, scene_index, created_at desc)
  where workflow_id is not null;
