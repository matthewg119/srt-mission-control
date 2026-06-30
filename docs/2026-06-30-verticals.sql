-- Vertical + Avatar/Offer registry (Content Engine v2).
-- Persona/scenes/copy stop living in hardcoded constants (pov-style.ts, reel-style.ts,
-- viral-video-decoder-prompt.ts) and become selectable, avatar-driven "kits".
-- Each vertical = an uploaded kit: Avatar research + 6 Beliefs + Offer sheet.
-- ADD ONLY — no drops, no modifications to existing tables.

CREATE TABLE IF NOT EXISTS verticals (
  id                   text PRIMARY KEY,        -- 'mca','pest_control','pest_owner_ai'
  name                 text NOT NULL,
  audience             text,                    -- 'homeowner' | 'pest_owner' | 'business_owner'
  language             text DEFAULT 'en',
  status               text NOT NULL DEFAULT 'active',

  -- Persona / kit, ingested from the uploaded avatar + offer docs:
  business_descriptor  text,                    -- "pest control business" (used in system prompts)
  wearer_role          text,                    -- "pest control technician" (POV first-person actor)
  avatar_doc_url       text,                    -- source kit file in the `reels` bucket
  avatar_summary       text,                    -- Claude-distilled persona (pains/desires/voice)
  beliefs              jsonb DEFAULT '[]',      -- the 6 beliefs (ordered)
  offer                jsonb DEFAULT '{}',      -- {ump,ums,big_idea,belief_chains,objections,headlines}

  -- Look / generation:
  style_token          text NOT NULL,           -- replaces POV_GLASSES_TOKEN per vertical
  house_style_prompt   text,                    -- replaces HOUSE_STYLE_PROMPT (Soul brand wardrobe)
  soul_id              text,                    -- Higgsfield Soul for character consistency
  cta_formats          jsonb DEFAULT '[]',
  gold_examples        jsonb DEFAULT '[]',      -- replaces POV_GOLD_EXAMPLES (few-shot anchor)

  created_at           timestamptz DEFAULT now(),
  updated_at           timestamptz DEFAULT now()
);

-- The auto-generated content calendar — ~30 formats per vertical, difficulty-categorized.
CREATE TABLE IF NOT EXISTS vertical_formats (
  id              text PRIMARY KEY,             -- 'pest_f1_01'
  vertical_id     text REFERENCES verticals(id) NOT NULL,
  format_group    text,                         -- 'satisfying_broll','pest_reveal',...
  scene           text NOT NULL,                -- POV scene (animation-friendly)
  hook            text,                         -- open-loop / "wtf" first-frame hook
  difficulty      text NOT NULL DEFAULT 'easy', -- easy | medium | hard
  shot_count      int NOT NULL DEFAULT 11,      -- shots to assemble (scales w/ difficulty)
  reference_urls  jsonb DEFAULT '[]',           -- web examples found at generation time
  used_at         timestamptz,                  -- rotation: null = available
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vertical_formats_rotation
  ON vertical_formats(vertical_id, used_at);
CREATE INDEX IF NOT EXISTS idx_vertical_formats_group
  ON vertical_formats(vertical_id, format_group);
