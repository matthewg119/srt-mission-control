-- Drop-studio generalization: any vertical can own a Slack drop channel. ADD ONLY.
-- Wiring a new channel = one UPDATE on its verticals row, no deploy.
--
--   slack_drop_channel_id  the Slack channel id whose drops run through drop-studio.ts
--   owner_vertical_id      the avatar the post-render SALES LETTER speaks to
--                          (replaces the hardcoded DROP_REPORT_VERTICAL_ID = 'pest_owner_ai')
--   workflow_vertical_id   which vertical's workflow library the drop lane matches against
--                          (null = share the pest_control library, today's behavior)
--   sales_letter_examples  full-text reference letters (voice anchor) — read from the OWNER
--                          row; captions are BLOCKED for a new avatar until this is set
--                          (pest_owner_ai falls back to the in-code pest letters)
--   sales_letter_swipe     distilled format/voice rules override — read from the OWNER row
--                          (null = pest swipe for pest ids, generic skeleton otherwise)

ALTER TABLE verticals ADD COLUMN IF NOT EXISTS slack_drop_channel_id text;
ALTER TABLE verticals ADD COLUMN IF NOT EXISTS owner_vertical_id     text;
ALTER TABLE verticals ADD COLUMN IF NOT EXISTS workflow_vertical_id  text;
ALTER TABLE verticals ADD COLUMN IF NOT EXISTS sales_letter_examples text;
ALTER TABLE verticals ADD COLUMN IF NOT EXISTS sales_letter_swipe    text;

-- One channel maps to exactly one vertical (a duplicate paste fails loudly here
-- instead of silently double-handling a channel).
CREATE UNIQUE INDEX IF NOT EXISTS verticals_drop_channel_uq
  ON verticals (slack_drop_channel_id) WHERE slack_drop_channel_id IS NOT NULL;

-- Make today's implicit pest wiring explicit (the code still falls back to these values
-- when null, so this is belt-and-suspenders, not required for pest to keep working).
UPDATE verticals SET owner_vertical_id = 'pest_owner_ai'
  WHERE id = 'pest_control' AND owner_vertical_id IS NULL;

-- ---------------------------------------------------------------------------------------
-- RECIPE: wiring a NEW avatar channel (run later, once per avatar — fill in the blanks).
-- The avatar rows should come from the `new avatar <id> <Name>` kit-drop ingest in
-- #content-analyzer so avatar_summary/beliefs/offer are populated (a sparse row would
-- fall back to pest persona fields). Then:
--
-- UPDATE verticals SET
--   slack_drop_channel_id = 'C0XXXXXXXXX',      -- the new Slack channel id (invite the bot!)
--   owner_vertical_id     = '<id>_owner_ai',    -- who the caption sells to
--   workflow_vertical_id  = 'pest_control'      -- share the existing workflow library
-- WHERE id = '<id>';
--
-- UPDATE verticals SET sales_letter_examples = $sl$
-- <paste 3-5 full reference sales letters in the avatar's voice>
-- $sl$ WHERE id = '<id>_owner_ai';
-- ---------------------------------------------------------------------------------------
