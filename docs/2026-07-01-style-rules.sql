-- ============================================================================
-- Style Rules — the ✅-gated, two-tier tuning memory for the content engine.
-- Paste into the Supabase SQL Editor (Mission Control project) and Run.
-- Add-only and idempotent: safe to re-run.
--
-- A "style rule" is one learned correction the operator gave in a drop thread
-- ("make the furnace look older", "put some plates on the shelf so it isn't
-- empty"). Feedback replies are distilled into candidate rows (status='pending')
-- and only start affecting generations once the operator reacts ✅ on the
-- proposal card (status flips to 'active'). Rules are hand-editable here.
--
-- Two-tier scope:
--   scope='brand'   -> applies to every drop for the vertical.
--   scope='format'  -> applies only when format_group matches (e.g. 'bug_reveal').
--
-- Read back into prompts by src/lib/reel/style-rules.ts (loadStyleRulesText),
-- injected at src/lib/reel/prompt-enrich.ts (enrichScene) + the bug-reveal
-- edit/copy builders. Empty table -> byte-identical to today (graceful).
-- ============================================================================

CREATE TABLE IF NOT EXISTS style_rules (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vertical_id       text NOT NULL DEFAULT 'pest_control',
  scope             text NOT NULL DEFAULT 'brand',   -- 'brand' | 'format'
  format_group      text,                            -- e.g. 'bug_reveal' when scope='format'
  rule              text NOT NULL,                   -- one concrete, imperative correction
  status            text NOT NULL DEFAULT 'pending', -- 'pending' | 'active' | 'archived'
  source_thread_ts  text,                            -- the drop thread the feedback came from
  slack_channel     text,                            -- where the proposal card was posted
  proposal_ts       text,                            -- the "save these rules? ✅" card ts (approve routing)
  created_at        timestamptz DEFAULT now(),
  approved_at       timestamptz
);

CREATE INDEX IF NOT EXISTS idx_style_rules_active   ON style_rules (vertical_id, status);
CREATE INDEX IF NOT EXISTS idx_style_rules_proposal ON style_rules (proposal_ts);
CREATE INDEX IF NOT EXISTS idx_style_rules_scope    ON style_rules (vertical_id, scope, format_group);

-- Verification:
-- select scope, format_group, status, rule from style_rules
--   where vertical_id = 'pest_control' order by created_at desc limit 20;
