-- =====================================================================
-- FIX crm_readonly_query: OWN THE FUNCTION, DO NOT SET ROLE  (2026-08-19)
--
-- THE BUG
-- docs/2026-08-18-crm-readonly-role.sql defined the query function as:
--
--   create function public.crm_readonly_query(q text)
--     security definer
--     set role = mc_readonly          <-- this
--
-- Postgres refuses that at CALL time, every time:
--
--   42501: cannot set parameter "role" within security-definer function
--
-- `role` and `session_authorization` cannot be set from inside a
-- security-definer context, whether as a function-level SET clause (which is
-- what this was — it lands in pg_proc.proconfig) or as a SET statement in the
-- body. So the chatbot's entire SQL tool was dead on arrival: describe_schema
-- worked, and every actual query 42501'd.
--
-- Note this is NOT the missing-role-membership problem the migration's header
-- warns about at length. That warning is real but it is a different failure,
-- and membership here is correct — the owner IS a member of mc_readonly. The
-- header's fix (grant the role to current_user) does not address this at all.
--
-- THE FIX
-- A SECURITY DEFINER function already executes as its OWNER. So there is
-- nothing to switch to at runtime: make mc_readonly the owner and delete the
-- SET clause. Same boundary, expressed the way Postgres intends, and it cannot
-- fail at call time because the privilege change happens at definition time.
--
-- Everything else about the boundary is unchanged: the function still forces a
-- read-only transaction, still caps statement_timeout, still pins search_path
-- to crm_read, and mc_readonly still holds SELECT on the PII-stripped views and
-- nothing else.
--
-- Run AFTER docs/2026-08-18-crm-readonly-role.sql. Safe to re-run.
-- Run through scripts/db.ts, not the Supabase SQL editor.
-- =====================================================================


-- ─────────────────────────────────────────────────────────────────────
-- 1. mc_readonly must be able to OWN an object in public
-- ─────────────────────────────────────────────────────────────────────
-- ALTER FUNCTION ... OWNER TO requires the incoming owner to hold CREATE on the
-- containing schema. The 08-18 migration revokes everything from mc_readonly on
-- public, so grant it back narrowly here.
--
-- This does not widen the boundary in practice: mc_readonly is NOLOGIN, the only
-- way to execute as it is through this function, and inside this function
-- default_transaction_read_only makes any CREATE fail as a write regardless.
grant create on schema public to mc_readonly;


-- ─────────────────────────────────────────────────────────────────────
-- 2. Redefine without `set role`
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.crm_readonly_query(q text)
returns jsonb
language plpgsql
security definer
set default_transaction_read_only = on
set statement_timeout = '5s'
set search_path = crm_read, public
as $$
declare
  out_json jsonb;
begin
  if q is null or btrim(q) = '' then
    raise exception 'empty query';
  end if;
  -- rtrim(str, chars), NOT trim(trailing ... from ...) — btrim/rtrim take a
  -- character set as the second argument; the SQL-standard TRIM(TRAILING x FROM y)
  -- form is a syntax error inside btrim().
  if position(';' in rtrim(btrim(q), ';')) > 0 then
    raise exception 'only one statement is allowed';
  end if;
  if lower(btrim(q)) !~ '^(select|with)\s' then
    raise exception 'only SELECT statements are allowed';
  end if;

  execute format('select coalesce(jsonb_agg(t), ''[]''::jsonb) from (%s) t', q)
    into out_json;

  return out_json;
end $$;


-- ─────────────────────────────────────────────────────────────────────
-- 3. The ownership change IS the privilege drop
-- ─────────────────────────────────────────────────────────────────────
alter function public.crm_readonly_query(text) owner to mc_readonly;

revoke all on function public.crm_readonly_query(text) from public;
grant execute on function public.crm_readonly_query(text) to service_role;


-- ─────────────────────────────────────────────────────────────────────
-- 4. mc_readonly needs to see its own function's dependencies
-- ─────────────────────────────────────────────────────────────────────
-- Belt and braces; these are already granted by the 08-18 migration, repeated
-- here so this file stands alone if it is ever run against a rebuilt database.
grant usage on schema crm_read to mc_readonly;
grant select on all tables in schema crm_read to mc_readonly;
grant usage on schema public to mc_readonly;
