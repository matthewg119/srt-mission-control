-- AI Intelligence Layer — Phase 1 migration
-- Creates 4 tables: ai_decisions, fine_tune_examples, pending_slack_actions, deal_submissions
-- Plus lender column extensions needed by the /dashboard/lenders page.
-- Apply in Supabase SQL Editor or via your migration runner.

-- ============================================================
-- ai_decisions: full audit log of every AI evaluation
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_decisions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamptz DEFAULT now(),
  merchant_id text,
  zoho_id text,
  trigger_type text NOT NULL,              -- 'cron' | 'webhook_zoho' | 'inbound_email' | 'slack_command'
  state_classified text,                   -- funded | declined | dead | approved_no_response | ...
  action_taken text,                       -- 'suppress' | 'draft_email' | 'slack_alert' | 'submit_deal' | 'none'
  was_approved boolean,
  approved_by text,
  slack_ts text,
  meta_capi_event_fired text,              -- 'Purchase' | 'DealDeclined' | 'skipped:no_attribution' | null
  sequences_suppressed boolean DEFAULT false,
  reasoning text,
  raw_response jsonb,
  model_used text,
  latency_ms int
);

CREATE INDEX IF NOT EXISTS idx_ai_decisions_merchant ON ai_decisions(merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_decisions_trigger ON ai_decisions(trigger_type, created_at DESC);

-- ============================================================
-- fine_tune_examples: human edits captured for future model improvement
-- ============================================================
CREATE TABLE IF NOT EXISTS fine_tune_examples (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamptz DEFAULT now(),
  trigger_type text NOT NULL,
  input_context jsonb NOT NULL,
  ai_draft text NOT NULL,
  human_correction text,
  rep_id text,
  was_approved_as_is boolean DEFAULT false,
  ai_decision_id uuid REFERENCES ai_decisions(id)
);

-- ============================================================
-- pending_slack_actions: queue of actions awaiting human approval via 👍/✏️/🚫
-- ============================================================
CREATE TABLE IF NOT EXISTS pending_slack_actions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamptz DEFAULT now(),
  slack_ts text UNIQUE NOT NULL,
  slack_channel text NOT NULL,
  action_type text NOT NULL,               -- 'send_email' | 'submit_deal' | 'update_zoho' | 'reply_funder'
  payload jsonb NOT NULL,                  -- full action data needed to execute
  status text DEFAULT 'pending',           -- 'pending' | 'approved' | 'edited' | 'cancelled'
  merchant_id text,
  zoho_id text,
  approved_by text,
  resolved_at timestamptz,
  ai_decision_id uuid REFERENCES ai_decisions(id)
);

CREATE INDEX IF NOT EXISTS idx_pending_slack_status ON pending_slack_actions(status, created_at DESC);

-- ============================================================
-- deal_submissions: per-lender submission tracking for follow-ups
-- ============================================================
CREATE TABLE IF NOT EXISTS deal_submissions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamptz DEFAULT now(),
  merchant_id text NOT NULL,
  deal_id uuid REFERENCES deals(id),
  lender_id uuid REFERENCES lenders(id),
  submitted_at timestamptz,
  amount_requested numeric,
  status text DEFAULT 'pending',           -- 'pending' | 'approved' | 'declined' | 'counter'
  last_funder_response_at timestamptz,
  follow_up_sent boolean DEFAULT false,
  notes text,
  email_message_id text,                   -- MS Graph message id for thread tracking
  onedrive_folder_url text
);

CREATE INDEX IF NOT EXISTS idx_deal_submissions_status ON deal_submissions(status, last_funder_response_at);
CREATE INDEX IF NOT EXISTS idx_deal_submissions_deal ON deal_submissions(deal_id);

-- ============================================================
-- lenders: column extensions for /dashboard/lenders UI
-- ============================================================
ALTER TABLE lenders ADD COLUMN IF NOT EXISTS min_deal_size numeric;
ALTER TABLE lenders ADD COLUMN IF NOT EXISTS max_deal_size numeric;
ALTER TABLE lenders ADD COLUMN IF NOT EXISTS verticals text[];

-- ============================================================
-- pg_trgm: fuzzy business-name matching for inbound email handler
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_contacts_business_name_trgm
  ON contacts USING gin (business_name gin_trgm_ops);
