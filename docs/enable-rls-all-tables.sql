-- ============================================================
-- Enable Row Level Security (RLS) on all public tables
-- Mission Control — SRT Agency
--
-- This is a single-tenant app. All database access goes through
-- the Supabase service_role key (supabaseAdmin), so we grant
-- service_role full access on every table. No user_id columns
-- exist, so no authenticated-user scoped policies are needed.
--
-- Run this in: Supabase SQL Editor or via `supabase db push`
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. brainheart_pulses
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.brainheart_pulses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access"
  ON public.brainheart_pulses FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ────────────────────────────────────────────────────────────
-- 2. chat_conversations
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.chat_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access"
  ON public.chat_conversations FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ────────────────────────────────────────────────────────────
-- 3. chat_messages
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access"
  ON public.chat_messages FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ────────────────────────────────────────────────────────────
-- 4. pipeline_cache
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.pipeline_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access"
  ON public.pipeline_cache FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ────────────────────────────────────────────────────────────
-- 5. integrations
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access"
  ON public.integrations FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ────────────────────────────────────────────────────────────
-- 6. custom_workflows
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.custom_workflows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access"
  ON public.custom_workflows FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ────────────────────────────────────────────────────────────
-- 7. email_sequences
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.email_sequences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access"
  ON public.email_sequences FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ────────────────────────────────────────────────────────────
-- 8. deal_events
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.deal_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access"
  ON public.deal_events FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ────────────────────────────────────────────────────────────
-- 9. contacts
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access"
  ON public.contacts FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ────────────────────────────────────────────────────────────
-- 10. email_sequence_steps
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.email_sequence_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access"
  ON public.email_sequence_steps FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ────────────────────────────────────────────────────────────
-- 11. system_logs
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.system_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access"
  ON public.system_logs FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ────────────────────────────────────────────────────────────
-- 12. sequence_enrollments
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.sequence_enrollments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access"
  ON public.sequence_enrollments FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ────────────────────────────────────────────────────────────
-- 13. deals
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access"
  ON public.deals FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ────────────────────────────────────────────────────────────
-- 14. lenders
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.lenders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access"
  ON public.lenders FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ────────────────────────────────────────────────────────────
-- 15. deal_notes
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.deal_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access"
  ON public.deal_notes FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
