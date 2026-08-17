-- =====================================================================
-- VERIFY THE CRM READ-ONLY SURFACE  (companion to 2026-08-18-crm-readonly-role.sql)
--
-- The migration deliberately contains no SELECTs, because the Supabase SQL
-- editor runs a paste as one transaction and a failing verification query at
-- the bottom silently rolls the whole migration back. This file is the other
-- half, and it is meant to be run through scripts/db.ts, which executes one
-- statement at a time so a failure here cannot undo anything.
--
--   bun run scripts/db.ts --file=docs/2026-08-18-crm-readonly-verify.sql
--
-- Every check below prints a verdict column. Read them; a query that returns
-- rows is not the same as a query that passed.
-- =====================================================================


-- ─────────────────────────────────────────────────────────────────────
-- 1. The role exists, and the function owner is a MEMBER of it
-- ─────────────────────────────────────────────────────────────────────
-- Membership is what lets SECURITY DEFINER do `set role mc_readonly`. Without
-- it every call fails 42501 and the chatbot's SQL tool is simply dead.
select
  (select count(*) from pg_roles where rolname = 'mc_readonly')            as role_exists,
  (select count(*) from pg_auth_members m
     join pg_roles r on r.oid = m.roleid
     join pg_roles g on g.oid = m.member
    where r.rolname = 'mc_readonly' and g.rolname = current_user)          as owner_is_member,
  case
    when (select count(*) from pg_roles where rolname = 'mc_readonly') = 0 then 'FAIL: role missing'
    when (select count(*) from pg_auth_members m
            join pg_roles r on r.oid = m.roleid
            join pg_roles g on g.oid = m.member
           where r.rolname = 'mc_readonly' and g.rolname = current_user) = 0
      then 'FAIL: owner not a member — set role will throw 42501'
    else 'PASS'
  end                                                                       as verdict;


-- ─────────────────────────────────────────────────────────────────────
-- 2. The schema catalog the chatbot reads before writing any SQL
-- ─────────────────────────────────────────────────────────────────────
-- describe_schema is not a nicety: an LLM SQL tool without a column catalog
-- invents names. Expect 6-10 tables.
select
  jsonb_array_length(crm_describe_schema(null))                             as table_count,
  case
    when jsonb_array_length(crm_describe_schema(null)) between 6 and 12 then 'PASS'
    else 'FAIL: expected 6-12 exposed tables'
  end                                                                       as verdict;

select jsonb_array_elements(crm_describe_schema(null)) ->> 'table'          as exposed_table;


-- ─────────────────────────────────────────────────────────────────────
-- 3. The query path returns REAL ROWS
-- ─────────────────────────────────────────────────────────────────────
-- THE FAILURE THIS CATCHES: if RLS on the underlying tables does not admit
-- mc_readonly, the views return zero rows with no error at all. The chatbot
-- then reports "no leads found" rather than "I was blocked", which is far
-- harder to diagnose. An empty [] here is a FAILURE, not an empty database.
select
  crm_readonly_query('select lead_status, count(*) as n from crm_read.leads group by 1 order by 2 desc')
                                                                            as rows_returned;

select
  jsonb_array_length(
    crm_readonly_query('select id from crm_read.leads limit 5')
  )                                                                         as leads_readable,
  case
    when jsonb_array_length(crm_readonly_query('select id from crm_read.leads limit 5')) > 0
      then 'PASS'
    else 'FAIL: empty result — check RLS policy "Readonly role select" on public.contacts'
  end                                                                       as verdict;


-- ─────────────────────────────────────────────────────────────────────
-- 4. THE SECURITY PROBES — all five must say blocked
-- ─────────────────────────────────────────────────────────────────────
-- This is the boundary the whole design rests on. The same tool set is
-- reachable from a shared Slack channel, and this database holds SSNs, dates
-- of birth, and live Microsoft OAuth refresh tokens in integrations.config.
select 'ssn_full'            as probe, crm_security_probe('select ssn_full from crm_read.leads limit 1')            as result
union all
select 'ssn_full (base)',           crm_security_probe('select ssn_full from public.contacts limit 1')
union all
select 'integrations.config',       crm_security_probe('select config from public.integrations limit 1')
union all
select 'dob',                       crm_security_probe('select dob from crm_read.leads limit 1')
union all
select 'update',                    crm_security_probe('update public.contacts set first_name = ''x''')
union all
select 'stacked statements',        crm_security_probe('select 1; drop table public.lead_activities')
union all
select 'plaid token',               crm_security_probe('select plaid_access_token from public.contacts limit 1');


-- ─────────────────────────────────────────────────────────────────────
-- 5. Confirm the sensitive columns really are absent from the view
-- ─────────────────────────────────────────────────────────────────────
-- Belt and braces alongside the probes above: the probe proves the query is
-- refused, this proves there is nothing there to ask for in the first place.
select
  count(*) filter (
    where column_name in ('ssn_full','ssn4','dob','plaid_access_token','fbc','fbp','portal_token')
  )                                                                         as sensitive_columns_exposed,
  case
    when count(*) filter (
      where column_name in ('ssn_full','ssn4','dob','plaid_access_token','fbc','fbp','portal_token')
    ) = 0 then 'PASS'
    else 'FAIL: crm_read.leads exposes a column it must not'
  end                                                                       as verdict
from information_schema.columns
where table_schema = 'crm_read' and table_name = 'leads';


-- ─────────────────────────────────────────────────────────────────────
-- 6. lead_status is exposed under its canonical name
-- ─────────────────────────────────────────────────────────────────────
-- The base column stays application_stage (163 code references); the AI and the
-- new UI speak lead_status. If this aliasing broke, every generated query that
-- mentions lead_status fails and the model has no way to discover why.
select
  count(*) filter (where column_name = 'lead_status')                       as has_lead_status,
  count(*) filter (where column_name = 'application_stage')                 as leaks_base_name,
  case
    when count(*) filter (where column_name = 'lead_status') = 1 then 'PASS'
    else 'FAIL: crm_read.leads is missing the lead_status alias'
  end                                                                       as verdict
from information_schema.columns
where table_schema = 'crm_read' and table_name = 'leads';
