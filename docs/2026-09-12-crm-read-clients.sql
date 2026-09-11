-- The client tables, readable by the assistant's SQL tool.
--
-- Additive, idempotent, safe to run more than once. Requires docs/2026-08-18-crm-readonly-role.sql
-- and its fix docs/2026-08-19-crm-readonly-setrole-fix.sql (the mc_readonly role and the
-- crm_read schema), plus docs/2026-09-12-data-layer.sql (client_events, client_workflow_runs).
--
-- Runner: bun run scripts/db.ts --file=docs/2026-09-12-crm-read-clients.sql
--
-- ‼️ RUN IT BEFORE THE DEPLOY THAT NAMES THESE VIEWS. The system prompt tells the model these
-- exist; a model asked to query a view that is not there gets an error it will retry into.
--
-- WHY: the typed client tools (src/lib/client-tools.ts) answer the questions we thought of.
-- query_database is for the ones we did not, and until now it could not reach a single client
-- table -- crm_read held leads, activities, tasks and deals and nothing else. Matthew:
-- "to be able to pull any info I need from our current chatbot in Mission Control."
--
-- ‼️ THE COLUMN LIST IS THE SECURITY BOUNDARY, NOT THE VIEW NAME.
-- docs/2026-08-19-crm-readonly-setrole-fix.sql:92 makes mc_readonly the OWNER of
-- crm_readonly_query, and its search_path includes `public`. So the role can reach
-- `public.<table>` directly if it is ever granted table-level SELECT there. Every grant below is
-- therefore COLUMN-level and matches the view exactly, the same shape the original role file uses
-- for public.contacts. Never `grant select on public.clients` without a column list, and never
-- `select *` in a view over a table that has a secret in it.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. clients — everything except the secrets
--
-- Withheld, and each one for a stated reason:
--   onboarding_token_hash, onboarding_token_expires_at  the intake link's credential
--   start_ip_hash                                       who filled the form in, from where
--   pixel_key                                           the attribution secret on their site
--   access_inventory                                    intake step 5, "who has the login", and
--                                                       it carries a `credentials` key
-- ─────────────────────────────────────────────────────────────────────────────

create or replace view crm_read.clients as
select id, slug, legal_name, dba_name, website, domain,
       city, state, postal_code, phone, email, language,
       vertical_slug, business_type, tier_scope, billing_status,
       pilot_started_at, pilot_ends_at,
       intake_step, intake_completed_at,
       services, ideal_patient, review_workflow,
       primary_avatar, primary_avatar_label, primary_avatar_slug,
       primary_avatar_confirmed_at, primary_avatar_confirmed_by,
       offer,
       day_0_archived_at, day_0_archived_by, day_0_source, day_0_waived_reason,
       payment_recorded_at, payment_recorded_by,
       subdomain, ops_channel_id, ops_channel_name, ops_thread_ts,
       contact_id, deal_id, created_at, updated_at
  from public.clients;

grant select (
  id, slug, legal_name, dba_name, website, domain,
  city, state, postal_code, phone, email, language,
  vertical_slug, business_type, tier_scope, billing_status,
  pilot_started_at, pilot_ends_at,
  intake_step, intake_completed_at,
  services, ideal_patient, review_workflow,
  primary_avatar, primary_avatar_label, primary_avatar_slug,
  primary_avatar_confirmed_at, primary_avatar_confirmed_by,
  offer,
  day_0_archived_at, day_0_archived_by, day_0_source, day_0_waived_reason,
  payment_recorded_at, payment_recorded_by,
  subdomain, ops_channel_id, ops_channel_name, ops_thread_ts,
  contact_id, deal_id, created_at, updated_at
) on public.clients to mc_readonly;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. The tables with no secrets in them: whole rows, still named explicitly.
--
-- `select *` is avoided even here, so a column added later is a deliberate decision to expose it
-- rather than something that arrives on the next migration.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace view crm_read.client_delivery_steps as
select id, client_id, step_key, status, completed_at, completed_by, note,
       output_ref, error_detail, started_at, skipped_reason,
       verified_source, verified_at, slack_anchor_ts, created_at, updated_at
  from public.client_delivery_steps;

create or replace view crm_read.client_keywords as
select id, client_id, phrase, normalized, category, use, origin, audience,
       score, rank, currently_named, source_url,
       approved, approved_at, approved_by, dropped_at, created_at, updated_at
  from public.client_keywords;

create or replace view crm_read.page_plan as
select id, client_id, rank, question, target_keyword, working_title, angle, theme,
       origin, status, page_id, role, pillar_id, keyword_category,
       approved_at, approved_by, created_at
  from public.page_plan;

create or replace view crm_read.client_pages as
select id, client_id, slug, title, question, status, published_at,
       source_report_id, scope, created_at, updated_at
  from public.client_pages;

create or replace view crm_read.client_docs as
select id, client_id, filename, content_type, size_bytes, delivery_step_key,
       source, presence_platform, uploaded_by, uploaded_at
  from public.client_docs;

create or replace view crm_read.client_events as
select id, client_id, step_key, source, kind, author, text,
       slack_channel, slack_ts, slack_thread_ts, created_at
  from public.client_events;

create or replace view crm_read.client_question_sets as
select id, client_id, version, status, questions, composition, sources,
       approved_at, approved_by, created_at, updated_at
  from public.client_question_sets;

create or replace view crm_read.client_avatar_runs as
select id, client_id, slot, avatar_slug, avatar_label,
       confirmed_at, confirmed_by, superseded_at
  from public.client_avatar_runs;

create or replace view crm_read.client_workflow_runs as
select id, client_id, workflow_key, status, inputs, output, error,
       requested_by, started_at, finished_at
  from public.client_workflow_runs;

-- audit_reports carries prospect research as well as client runs. The columns that matter for a
-- question about visibility are exposed; the outreach machinery (drafts, transcripts, prospect
-- names, thread caches) is not.
create or replace view crm_read.audit_reports as
select id, slug, client_id, contact_id, client_name, website, city,
       business_type, vertical_slug, run_label, excluded_from_scorecard,
       engines, status, score, prompts, call_notes, call_notes_at,
       created_at, updated_at
  from public.audit_reports;

create or replace view crm_read.audit_runs as
select id, report_id, block, prompt, engine, mentioned, status,
       recommended, latency_ms, created_at
  from public.audit_runs;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Grants and RLS
--
-- ‼️ A VIEW WITHOUT A POLICY RETURNS ZERO ROWS AND NO ERROR, which is the worst shape available:
-- the assistant reports "this client has no keywords" about a client with two hundred. Every table
-- below has RLS enabled with no policies of its own, so the role needs one, exactly as §4 of the
-- original role file does for the CRM tables.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  t text;
begin
  foreach t in array array[
    'clients', 'client_delivery_steps', 'client_keywords', 'page_plan', 'client_pages',
    'client_docs', 'client_events', 'client_question_sets', 'client_avatar_runs',
    'client_workflow_runs', 'audit_reports', 'audit_runs'
  ]
  loop
    -- The views are owned by this migration's runner and read the base tables as that owner, so
    -- the policy is what lets the ROLE see rows through them once RLS is on.
    execute format('alter table public.%I no force row level security', t);

    if exists (select 1 from pg_tables where schemaname = 'public' and tablename = t and rowsecurity) then
      if not exists (
        select 1 from pg_policies
         where schemaname = 'public' and tablename = t and policyname = 'Readonly role select'
      ) then
        execute format(
          'create policy "Readonly role select" on public.%I for select to mc_readonly using (true)', t
        );
      end if;
    end if;
  end loop;

  -- Table-level SELECT for everything except `clients`, whose grant above is column-level and must
  -- stay that way: the role can reach public.* directly, so a bare grant there would expose the
  -- token hash and the access inventory.
  foreach t in array array[
    'client_delivery_steps', 'client_keywords', 'page_plan', 'client_pages',
    'client_docs', 'client_events', 'client_question_sets', 'client_avatar_runs',
    'client_workflow_runs', 'audit_runs'
  ]
  loop
    execute format('grant select on public.%I to mc_readonly', t);
  end loop;
end $$;

-- audit_reports, column-level for the same reason as clients: the table holds Loom transcripts,
-- prospect emails and draft bodies that no question about visibility needs.
grant select (
  id, slug, client_id, contact_id, client_name, website, city,
  business_type, vertical_slug, run_label, excluded_from_scorecard,
  engines, status, score, prompts, call_notes, call_notes_at,
  created_at, updated_at
) on public.audit_reports to mc_readonly;

grant usage on schema crm_read to mc_readonly;
grant select on all tables in schema crm_read to mc_readonly;
alter default privileges in schema crm_read grant select on tables to mc_readonly;

-- What to expect:
--
--   -- The twelve views are listed by describe_schema, which reads information_schema for crm_read:
--   select table_name from information_schema.views where table_schema = 'crm_read' order by 1;
--
--   -- The boundary holds: this must return ZERO rows (the column is not granted):
--   select has_column_privilege('mc_readonly', 'public.clients', 'onboarding_token_hash', 'select');
--
--   -- And this must return the client:
--   select slug, legal_name from crm_read.clients where slug = 'srt-agency-llc';
