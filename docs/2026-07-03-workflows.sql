-- Content Engine v3: avatar-first, song-based WORKFLOWS + reference sectioning.
--
-- A `workflow` is the NEW first-class, curated recipe (richer than a single-image format
-- and richer than a vertical_formats rotation row): an ordered set of image-scenes + a song
-- + captions timed to the second, scoped to ONE avatar (vertical). vertical_formats stays as
-- the auto-generated single-image rotation fuel; workflows do not replace it.
--
-- Idempotent / additive. Safe to run more than once.

create table if not exists workflows (
  id                 text primary key,             -- e.g. pest_control__pov__wasp_nest
  vertical_id        text not null,                -- avatar (verticals.id)
  name               text not null,                -- "Wasp / Hornet Nest Removal (POV)"
  category           text not null default 'pov',  -- pov | broll | reveal | before_after
  subcategory        text,                         -- roof | inside_house | attic | modern_house | hood_house ...
  status             text not null default 'draft',-- draft | active | archived
  scenes             jsonb not null default '[]'::jsonb,  -- ordered [{ role, image_prompt, animation_prompt, duration_seconds, image_url, image_approved }]
  captions           jsonb not null default '[]'::jsonb,  -- ordered [{ text, at_second }] (on-screen text timed to the beat)
  song_ref           text,                         -- SONGS key or a pasted audio URL (the beat scenes sync to)
  render_options     jsonb not null default '{}'::jsonb,  -- { min_shots, max_shots, clip_seconds, aspect, provider }
  example_video_url  text,                         -- the reference/example reel this was authored from
  example_storyboard jsonb,                        -- the analyzer storyboard used to author it (for the library view)
  shot_screenshots   jsonb not null default '[]'::jsonb,  -- [{ role, url }] one still per scene, for the library grid
  source_kind        text not null default 'authored',    -- authored | reference_video | seeded
  source_example_id  uuid,                         -- content_examples.id when authored from a #content-analyzer drop
  used_at            timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists workflows_vertical_idx on workflows (vertical_id, status);
create index if not exists workflows_category_idx on workflows (vertical_id, category, subcategory);

-- Render sequences: template variants of the same workflow scenes (different song/beat/timing).
alter table workflows add column if not exists render_sequences jsonb not null default '[]'::jsonb;

-- Reference library sectioning (requirement: max 30 references per avatar per section,
-- optionally tagged by zip so the creative director can ask for "houses in 27401").
alter table content_examples add column if not exists section text;  -- e.g. 'pov/modern_house'
alter table content_examples add column if not exists zip text;
create index if not exists content_examples_section_idx on content_examples (vertical_id, section, created_at desc);
