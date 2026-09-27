-- Funding leaves the schema, and stops touching the AEO board.
--
-- Matthew, 2026-09-27: "if there is something mixed from AEO offer to funding it needs to be dropped
-- and rewired / my onboarding for AEO has nothing to do with funding so make sure they dont even see
-- each other I want to drop everything regarding to funding".
--
-- ‼️ THE CODE CHANGE SHIPS FIRST. THIS FILE RUNS SECOND. Nothing in src/ reads or writes any of these
-- eight tables any more, and nothing writes the three deal_id columns, as of the commit that carries
-- this file. If this runs against an older deploy, `addNote` and `createTask` insert deal_id into a
-- column that no longer exists and every CRM note fails. Deploy, then run.
--
-- ‼️ MEASURED BEFORE WRITING, NOT ASSUMED. Of the eight tables, only `deals` had ANY reader in src/:
-- one file, api/contacts/bulk, a CSV importer that created a "New Deals" / "Open - Not Contacted" row
-- per imported contact. The other seven had zero. src/lib/crm.ts never wrote `deals` at all; it carried
-- deal_id as a nullable passthrough onto lead_activities and lead_tasks.
--
-- ‼️ THE deal_id COLUMNS CARRY NO FOREIGN KEY, ON PURPOSE. docs/2026-08-17-crm-core.sql:134 says why:
-- `deals` was created in the Supabase console and its id type is not asserted anywhere in this repo. So
-- dropping the tables does not cascade into the CRM, and the columns have to be dropped by name.
--
-- ‼️ WHAT WILL BITE, AND IT IS THE ONLY THING IN HERE THAT CAN: the crm_read views name deal_id
-- EXPLICITLY, and `create or replace view` cannot remove a column from a view. Each one has to be
-- dropped and recreated, and `grant select on all tables in schema crm_read` does not survive a drop,
-- so the grants are re-issued. Section 3 does all of it in the right order inside one transaction.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ARCHIVE. Optional, and it costs one schema.
--
-- ‼️ RUN THIS OR DELETE IT, BUT DECIDE ON PURPOSE. Matthew's answer was "drop everything regarding to
-- funding", and this section is not an argument with that: it makes the drop REVERSIBLE for the price of
-- a schema nothing queries. He has deliberately restored deal history once before
-- (30,472 Zoho notes, 2026-09-xx), which is the whole reason it is offered rather than assumed.
--
-- Skip it by deleting this section. Section 2 does not depend on it.
-- ─────────────────────────────────────────────────────────────────────────────

create schema if not exists funding_archive;

do $$
declare
  t text;
  tbls text[] := array[
    'standalone_applications', 'deal_submissions', 'statement_drops', 'lenders',
    'email_submissions', 'email_submission_funders', 'deals', 'deal_events', 'deal_notes'
  ];
begin
  foreach t in array tbls loop
    -- A table missing in this environment is skipped, not fatal: the same posture
    -- docs/2026-08-18-crm-readonly-role.sql takes for this exact list.
    if exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t and c.relkind = 'r'
    ) then
      execute format('create table if not exists funding_archive.%I as select * from public.%I', t, t);
    end if;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. THE EIGHT TABLES, AND THE VIEWS OVER THEM.
--
-- The views are `crm_read.<table> as select * from public.<table>`, created by the readonly-role
-- migration's loop. Dropped explicitly rather than relying on `drop table cascade`, so the statement
-- that removes a view is one somebody can read.
--
-- `deal_notes` is included and is NOT one of the eight named in the probe's FUNDING set. It is in the
-- same crm_read loop, it is a deal table, and `src/lib/crm.ts` writes its notes to `lead_activities`
-- instead: grep `from("deal_notes")` returns nothing in src/.
-- ─────────────────────────────────────────────────────────────────────────────

drop view if exists crm_read.deal_events;
drop view if exists crm_read.lenders;
drop view if exists crm_read.deals;
drop view if exists crm_read.deal_submissions;
drop view if exists crm_read.deal_notes;

-- cascade, because deal_submissions.deal_id really does reference deals(id)
-- (docs/2026-04-18-ai-intelligence-layer.sql:73) and the drop order between them would otherwise matter.
drop table if exists public.email_submission_funders cascade;
drop table if exists public.email_submissions       cascade;
drop table if exists public.deal_submissions        cascade;
drop table if exists public.statement_drops         cascade;
drop table if exists public.standalone_applications cascade;
drop table if exists public.deal_events             cascade;
drop table if exists public.deal_notes              cascade;
drop table if exists public.lenders                 cascade;
drop table if exists public.deals                   cascade;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. THE deal_id COLUMNS ON TABLES THAT STAY.
--
-- This is the "make sure they dont even see each other" half. `clients` is the AEO onboarding row, and
-- it carried a funding deal link; lead_activities and lead_tasks are the CRM timeline and task list,
-- which serve AEO leads now.
--
-- Order matters: drop the views, drop the columns, recreate the views without deal_id, re-grant.
-- ─────────────────────────────────────────────────────────────────────────────

drop view if exists crm_read.clients;
drop view if exists crm_read.lead_activities;
drop view if exists crm_read.lead_tasks;

alter table public.clients          drop column if exists deal_id;
alter table public.lead_activities  drop column if exists deal_id;
alter table public.lead_tasks       drop column if exists deal_id;

-- Recreated verbatim from docs/2026-09-12-crm-read-clients.sql and
-- docs/2026-08-18-crm-readonly-role.sql, minus deal_id. Nothing else about them changes.
create view crm_read.clients as
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
       contact_id, created_at, updated_at
  from public.clients;

create view crm_read.lead_activities as
select
  id, contact_id, activity_type, direction, channel,
  subject, body, outcome, duration_secs, occurred_at, actor,
  source, external_module, created_at
from public.lead_activities;

create view crm_read.lead_tasks as
select
  id, contact_id, title, description, task_type, priority, status,
  due_at, snoozed_until, created_by, completed_at, completed_by, outcome,
  source, created_at, updated_at
from public.lead_tasks;

-- ‼️ THE GRANTS DO NOT SURVIVE A DROP. `grant select on all tables in schema crm_read to mc_readonly`
-- ran once, in the readonly-role migration, and it applied to the views that existed THEN. A recreated
-- view has no grant on it, so mc_readonly would start getting permission denied on three of the tables
-- it exists to read, silently, the next time somebody used that role.
grant select on crm_read.clients          to mc_readonly;
grant select on crm_read.lead_activities  to mc_readonly;
grant select on crm_read.lead_tasks       to mc_readonly;

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify, after committing:
--
--   select table_name from information_schema.tables
--    where table_schema = 'public'
--      and table_name in ('deals','deal_events','deal_notes','lenders','deal_submissions',
--                         'statement_drops','standalone_applications','email_submissions',
--                         'email_submission_funders');
--   -- expect zero rows
--
--   select table_name from information_schema.columns
--    where table_schema = 'public' and column_name = 'deal_id';
--   -- expect zero rows
--
--   select table_name from information_schema.tables where table_schema = 'funding_archive';
--   -- expect nine rows if section 1 ran, zero if it was deleted
-- ─────────────────────────────────────────────────────────────────────────────
