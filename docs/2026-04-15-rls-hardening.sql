-- RLS hardening — 2026-04-15
-- Closes Supabase Security Advisor errors:
--   rls_disabled_in_public: call_coach_sessions, call_coach_transcripts,
--                           call_coach_users, srt_playbook
--   sensitive_columns_exposed: call_coach_transcripts, call_coach_users
--     (both resolved by enabling RLS with a service-role-only policy below)
--
-- Pattern matches existing docs/enable-rls-all-tables.sql. Every API route in
-- mission-control and srt-portal accesses these tables via the service-role
-- admin client, which bypasses RLS — so enabling RLS with service-role-only
-- policies is a no-op for working code paths while closing anon-key access.
--
-- Run in Supabase SQL Editor for project gvsborqpkyvhcfrpgagp.

BEGIN;

-- call_coach_sessions
ALTER TABLE public.call_coach_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON public.call_coach_sessions;
CREATE POLICY "Service role full access" ON public.call_coach_sessions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- call_coach_transcripts
ALTER TABLE public.call_coach_transcripts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON public.call_coach_transcripts;
CREATE POLICY "Service role full access" ON public.call_coach_transcripts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- call_coach_users
ALTER TABLE public.call_coach_users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON public.call_coach_users;
CREATE POLICY "Service role full access" ON public.call_coach_users
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- srt_playbook
ALTER TABLE public.srt_playbook ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON public.srt_playbook;
CREATE POLICY "Service role full access" ON public.srt_playbook
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMIT;

-- Verification:
--   SELECT tablename, rowsecurity FROM pg_tables
--   WHERE schemaname='public'
--     AND tablename IN ('call_coach_sessions','call_coach_transcripts',
--                       'call_coach_users','srt_playbook');
--   Expect rowsecurity = true for all four.
--
-- Advisor warnings (not errors) left intentionally untouched for later:
--   - "RLS Policy Always True" on automation_logs/bank_statements/message_*/
--     report_snapshots: the service-role-only policies are safe; the warning
--     is a scanner heuristic on USING(true). Revisit if we ever grant anon
--     access to any table.
--   - "Function Search Path Mutable" on 3 functions: low-risk, plan to add
--     SET search_path = public, pg_temp to each function definition.
--   - "Leaked Password Protection Disabled": enable in Supabase Auth settings
--     (dashboard toggle, no SQL needed).
