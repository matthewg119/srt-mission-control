-- Hook selection columns for the pre-generation approval gate
ALTER TABLE content_packages
  ADD COLUMN IF NOT EXISTS hook_options_json   jsonb,   -- array of 3 {name, slide1_image_prompt, slide1_text_overlay, slide2_image_prompt}
  ADD COLUMN IF NOT EXISTS hooks_message_ts    text,    -- ts of the "pick a hook" Slack message (mapped by reactions)
  ADD COLUMN IF NOT EXISTS selected_hook_index int;     -- 0, 1, or 2 — which hook the user picked
