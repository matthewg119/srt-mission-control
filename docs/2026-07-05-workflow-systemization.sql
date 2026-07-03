-- Workflow systemization: consistency profile + onboarding/LIVE gate.
-- Also adds the reference_media / production_status columns the code has referenced
-- since 2026-07-04 but no migration ever created (the 3-reference gate silently
-- failed without them).
--
-- production_status flow:  building -> in_production (3 reference files uploaded +
-- "finish workflow") -> live (4 approved variation renders).
--
-- visual_rules: ordered text array = this workflow's image style guide; every scene
-- image prompt is grounded on it (enrichScene extraRules + generatePicturePlan).
-- approved_variations: [{ label, structured_copy:[{key,text}], song_ref, thread_ts,
-- image_urls:[], approved_at }] - grows forever; doubles as the examples gallery.

alter table workflows
  add column if not exists reference_media     jsonb not null default '[]'::jsonb,
  add column if not exists production_status   text  not null default 'building',
  add column if not exists description         text,
  add column if not exists visual_rules        jsonb not null default '[]'::jsonb,
  add column if not exists approved_variations jsonb not null default '[]'::jsonb;

create index if not exists workflows_production_idx
  on workflows (vertical_id, production_status);
