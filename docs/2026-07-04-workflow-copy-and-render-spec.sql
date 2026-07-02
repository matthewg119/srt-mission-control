-- Content Engine v3: workflow COPY STRUCTURE + RENDER SPEC + the workflow library seed.
--
-- Adds two columns to `workflows`:
--   copy_structure  ordered labeled copy boxes ([{ key, label, guidance, shot, at_second, out_second, position }])
--   render_spec     baked timeline the emitted Claude Code prompt is built from
--                   ({ mode, song_ref, duration_seconds, shots:[{i,start,end}], texts:[{n,text,at_second,out_second,role,position}] })
--
-- Then seeds the workflow LIBRARY: category/subcategory placeholders (draft = needs config via
-- Claude Code) + the first fully-authored workflow "B roll 6 headlines propaganda" (song added
-- in Slack). Idempotent / additive. Safe to run more than once.

alter table workflows
  add column if not exists copy_structure jsonb not null default '[]'::jsonb,
  add column if not exists render_spec jsonb;

-- Category/subcategory placeholders (draft = needs config via Claude Code)
insert into workflows (id, vertical_id, name, category, subcategory, status, source_kind)
values
  ('pest_control__pov__spray_outdoor',   'pest_control', 'Meta Glasses POV - spraying outdoors', 'pov', 'spray_outdoor', 'draft', 'seeded'),
  ('pest_control__pov__spray_indoor',    'pest_control', 'Meta Glasses POV - spraying indoors',  'pov', 'spray_indoor',  'draft', 'seeded'),
  ('pest_control__pov__attic_jumpscare', 'pest_control', 'Meta Glasses POV - attic removal (jumpscare)', 'pov', 'attic_jumpscare', 'draft', 'seeded'),
  ('pest_control__pov__attic_regular',   'pest_control', 'Meta Glasses POV - attic removal (regular)',   'pov', 'attic_regular',  'draft', 'seeded'),
  ('pest_control__pov__wasp_removal',    'pest_control', 'Meta Glasses POV - wasp nest removal', 'pov', 'wasp', 'draft', 'seeded'),
  ('pest_control__pov__vent_cleaning',   'pest_control', 'Meta Glasses POV - vent cleaning', 'pov', 'vent', 'draft', 'seeded'),
  ('pest_control__story__storytime',     'pest_control', 'Storytime', 'story', null, 'draft', 'seeded'),
  ('pest_control__pov__day_in_life',     'pest_control', 'Day in the Life POV', 'pov', 'day_in_life', 'draft', 'seeded'),
  ('pest_control__broll__indoctrination','pest_control', 'B-roll caption indoctrination', 'broll', 'indoctrination', 'draft', 'seeded')
on conflict (id) do nothing;

-- The real first workflow: B roll 6 headlines propaganda (song added in Slack).
insert into workflows (id, vertical_id, name, category, subcategory, status, source_kind, render_options, copy_structure, render_spec)
values (
  'pest_control__broll__6hl_propaganda', 'pest_control',
  'B roll 6 headlines propaganda', 'broll', '6hl_propaganda', 'active', 'authored',
  '{"min_shots":3,"max_shots":3,"aspect":"9:16","mode":"static_images"}'::jsonb,
  '[
    {"key":"avatar","label":"Avatar","guidance":"Name who this is for.","shot":1,"at_second":0.0,"out_second":3.5,"position":"upper_side"},
    {"key":"pain_callout","label":"Pain callout","guidance":"One-line pain that stops the scroll.","shot":1,"at_second":0.3,"out_second":3.5,"position":"upper_middle"},
    {"key":"increase_pain","label":"Increase pain / category","guidance":"Twist the knife, make it personal.","shot":2,"at_second":3.4,"out_second":8.3,"position":"center"},
    {"key":"logical_reason","label":"Logical reason","guidance":"The because: why the pain is real.","shot":2,"at_second":6.4,"out_second":8.3,"position":"center"},
    {"key":"dream_outcome","label":"Dream outcome","guidance":"The desired result in one line.","shot":3,"at_second":8.3,"out_second":11.3,"position":"center"},
    {"key":"cta","label":"CTA","guidance":"Single clear call to action.","shot":3,"at_second":10.2,"out_second":11.3,"position":"lower"}
  ]'::jsonb,
  '{
    "mode":"static_images","song_ref":null,"duration_seconds":11.3,
    "shots":[{"i":1,"start":0.0,"end":3.5},{"i":2,"start":3.4,"end":8.3},{"i":3,"start":8.3,"end":11.3}],
    "texts":[
      {"n":1,"text":"Pest control Owners","at_second":0.0,"out_second":3.5,"position":"upper_side","role":"avatar"},
      {"n":2,"text":"Your slow season, is somebody elses high season","at_second":0.3,"out_second":3.5,"position":"upper_middle","role":"pain_callout"},
      {"n":3,"text":"Homeowners already know who to call and is not you","at_second":3.4,"out_second":8.3,"position":"center","role":"increase_pain"},
      {"n":4,"text":"Because Your zip code doesn''t know you exist yet","at_second":6.4,"out_second":8.3,"position":"center","role":"logical_reason"},
      {"n":5,"text":"imagine clients calling you first","at_second":8.3,"out_second":11.3,"position":"center","role":"dream_outcome"},
      {"n":6,"text":"Check out link in bio.","at_second":10.2,"out_second":11.3,"position":"lower","role":"cta"}
    ]
  }'::jsonb
)
on conflict (id) do update set
  status = excluded.status, copy_structure = excluded.copy_structure,
  render_spec = excluded.render_spec, render_options = excluded.render_options, name = excluded.name;
