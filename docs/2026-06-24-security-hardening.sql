-- ════════════════════════════════════════════════════════════════════════════
-- Security Advisor hardening — 2026-06-24
-- Supabase project: gvsborqpkyvhcfrpgagp (shared by Mission Control,
-- Call Coach, srt-portal, texttwin/salestwin — single consolidated DB).
--
-- Closes every open item from the Security Advisor scan:
--   ERRORS
--     • RLS disabled in public: srt_playbook, call_coach_users,
--       call_coach_sessions, call_coach_transcripts
--     • Sensitive columns exposed: call_coach_transcripts, call_coach_users
--   WARNINGS
--     • Function search_path mutable: sba_applications_set_updated_at,
--       increment_call_coach_calls, increment_call_coach_suggestions,
--       match_voice_examples
--     • Extension in public schema: pg_trgm
--     • RLS policy always true: automation_logs, bank_statements,
--       message_sequences, message_templates, report_snapshots
--     • Public / signed-in can execute SECURITY DEFINER:
--       increment_call_coach_calls, increment_call_coach_suggestions
--     • Leaked password protection disabled  → dashboard toggle, see §6
--
-- DESIGN NOTE — this is a SINGLE-TENANT app with NO Supabase Auth users.
-- Every table is read/written server-side via the service_role key
-- (supabaseAdmin), which BYPASSES RLS. The `user_id` columns on the
-- call_coach_* tables reference the app's own `call_coach_users` table, NOT
-- `auth.users`, so `auth.uid()` is always NULL here. The correct lockdown is
-- therefore "RLS on + service_role-only policy + nothing for anon/authenticated"
-- (matches docs/enable-rls-all-tables.sql), NOT per-user auth.uid() policies.
--
-- Idempotent / safe to re-run. Run in Supabase SQL Editor.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ §1  ERRORS — enable RLS + service_role-only policy on the 4 exposed tables │
-- │     (also resolves the "sensitive columns exposed" errors)                │
-- └──────────────────────────────────────────────────────────────────────────┘
DO $$
DECLARE
  t text;
  p record;
  tables text[] := ARRAY[
    'srt_playbook', 'call_coach_users', 'call_coach_sessions', 'call_coach_transcripts'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    -- Drop ALL existing policies so no stray permissive policy survives.
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, t);
    END LOOP;
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      'Service role full access', t
    );
  END LOOP;
END $$;

-- Defense-in-depth for the two PII tables: make sure anon/authenticated have no
-- direct table grants. (RLS already blocks them, but the advisor checks grants.)
REVOKE ALL ON public.call_coach_users       FROM anon, authenticated;
REVOKE ALL ON public.call_coach_transcripts FROM anon, authenticated;
REVOKE ALL ON public.call_coach_sessions    FROM anon, authenticated;
REVOKE ALL ON public.srt_playbook           FROM anon, authenticated;

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ §2  WARNING — "RLS policy always true" on 5 service-only tables.           │
-- │     Re-assert RLS and replace every existing policy with a single          │
-- │     service_role-only policy. With RLS on and no anon/authenticated        │
-- │     policy, those roles are fully denied — the "always true for public"    │
-- │     exposure is gone.                                                      │
-- └──────────────────────────────────────────────────────────────────────────┘
DO $$
DECLARE
  t text;
  p record;
  tables text[] := ARRAY[
    'automation_logs', 'bank_statements', 'message_sequences',
    'message_templates', 'report_snapshots'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- Skip silently if a table is absent in this environment.
    IF NOT EXISTS (
      SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t
    ) THEN
      RAISE NOTICE 'skip: public.% does not exist', t;
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, t);
    END LOOP;
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      'Service role full access', t
    );
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ §3  WARNING — function search_path mutable. Pin search_path on all four.   │
-- │     Omitting pg_temp from the list is the recommended anti-hijack form.    │
-- │     match_voice_examples additionally needs `extensions` once pg_trgm      │
-- │     moves there (see §4) for similarity()/% to resolve.                    │
-- └──────────────────────────────────────────────────────────────────────────┘
ALTER FUNCTION public.increment_call_coach_calls(uuid)        SET search_path = public;
ALTER FUNCTION public.increment_call_coach_suggestions(uuid)  SET search_path = public;
ALTER FUNCTION public.sba_applications_set_updated_at()        SET search_path = public;
ALTER FUNCTION public.match_voice_examples(text, uuid, integer) SET search_path = public, extensions;

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ §4  WARNING — extension pg_trgm in public schema → move to `extensions`.   │
-- │     Existing gin_trgm_ops indexes (idx_contacts_business_name_trgm,        │
-- │     voice_examples_incoming_trgm) reference the opclass by OID and survive │
-- │     the move. The only SQL consumer of the % / similarity() operators is   │
-- │     match_voice_examples(), whose search_path now includes `extensions`    │
-- │     (§3). All app fuzzy search uses core ILIKE, which is unaffected.       │
-- │                                                                            │
-- │     NOTE: this is the one operation with cross-repo blast radius (the DB   │
-- │     is shared). After deploy, verify with the query at the bottom of this  │
-- │     file. If any other DB function uses unqualified trgm operators, pin    │
-- │     its search_path to include `extensions` too.                          │
-- └──────────────────────────────────────────────────────────────────────────┘
CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'pg_trgm' AND n.nspname = 'public'
  ) THEN
    EXECUTE 'ALTER EXTENSION pg_trgm SET SCHEMA extensions';
  END IF;
END $$;

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ §5  WARNING — public / signed-in can execute SECURITY DEFINER functions.   │
-- │     increment_* are called ONLY server-side via supabaseAdmin.rpc(), so    │
-- │     restrict execution to service_role.                                    │
-- └──────────────────────────────────────────────────────────────────────────┘
REVOKE EXECUTE ON FUNCTION public.increment_call_coach_calls(uuid)       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_call_coach_suggestions(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.increment_call_coach_calls(uuid)       TO service_role;
GRANT  EXECUTE ON FUNCTION public.increment_call_coach_suggestions(uuid) TO service_role;

COMMIT;

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ §6  WARNING — leaked password protection disabled (NO SQL).                │
-- │     This project has no local supabase/config.toml (it is dashboard-       │
-- │     managed, not Supabase-CLI-linked), and it does not use Supabase Auth   │
-- │     at all — so this is purely a dashboard toggle:                         │
-- │       Dashboard → Authentication → Policies (Password) →                   │
-- │         enable "Leaked password protection" (HaveIBeenPwned).              │
-- │     If you later adopt the Supabase CLI, the equivalent is:                │
-- │       [auth.password]                                                      │
-- │       password_requirements = "..."                                        │
-- │       # and enable HIBP via the dashboard / management API.               │
-- └──────────────────────────────────────────────────────────────────────────┘

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICATION (run after applying; all should report the hardened state)
-- ════════════════════════════════════════════════════════════════════════════
-- 1) RLS on for every targeted table → rowsecurity = true:
--   SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public'
--    AND tablename IN ('srt_playbook','call_coach_users','call_coach_sessions',
--      'call_coach_transcripts','automation_logs','bank_statements',
--      'message_sequences','message_templates','report_snapshots');
--
-- 2) Only service_role policies remain (no anon/authenticated/public roles):
--   SELECT tablename, policyname, roles FROM pg_policies WHERE schemaname='public'
--    AND tablename IN ('srt_playbook','call_coach_users','call_coach_sessions',
--      'call_coach_transcripts','automation_logs','bank_statements',
--      'message_sequences','message_templates','report_snapshots');
--
-- 3) Functions have a pinned search_path (proconfig not null):
--   SELECT proname, proconfig FROM pg_proc
--    WHERE proname IN ('increment_call_coach_calls','increment_call_coach_suggestions',
--      'sba_applications_set_updated_at','match_voice_examples');
--
-- 4) pg_trgm now lives in `extensions`:
--   SELECT e.extname, n.nspname FROM pg_extension e
--     JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname='pg_trgm';
--
-- 5) Smoke-test the trgm RPC still resolves operators after the move:
--   SELECT * FROM public.match_voice_examples('test message',
--     (SELECT id FROM tenants WHERE slug='srt'), 3);
-- ════════════════════════════════════════════════════════════════════════════
