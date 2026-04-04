-- Speed to Lead: call_log and dnc_list tables
-- Run this against Supabase SQL Editor before deploying Speed to Lead

-- Tracks every Speed to Lead call attempt
CREATE TABLE IF NOT EXISTS call_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES contacts(id),
  lead_phone TEXT NOT NULL,
  agent_phone TEXT NOT NULL,
  ringout_id TEXT,
  call_type TEXT NOT NULL DEFAULT 'speed_to_lead',
  status TEXT NOT NULL DEFAULT 'initiated',
  duration_seconds INTEGER,
  lead_name TEXT,
  lead_source TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for duplicate prevention (same phone called recently)
CREATE INDEX IF NOT EXISTS idx_call_log_phone_created
  ON call_log (lead_phone, created_at DESC);

-- Do Not Call list
CREATE TABLE IF NOT EXISTS dnc_list (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT UNIQUE NOT NULL,
  reason TEXT,
  added_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS (matches project convention)
ALTER TABLE call_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE dnc_list ENABLE ROW LEVEL SECURITY;

-- Service role can do everything (API routes use service role key)
CREATE POLICY "Service role full access" ON call_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access" ON dnc_list
  FOR ALL TO service_role USING (true) WITH CHECK (true);
