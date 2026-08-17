-- =====================================================================
-- MISSION CONTROL AS CRM OF RECORD — CORE SCHEMA  (2026-08-17)
--
-- Zoho is being retired. Today `contacts` mirrors ~40 Zoho Lead fields
-- (src/lib/field-map.ts), but the things that matter most for selling —
-- notes, call history, and the next follow-up date — live ONLY in Zoho.
-- This migration adds the three missing pieces:
--
--   lead_activities     append-only timeline (notes, calls, emails, SMS,
--                       status changes, portal events) — the thing that
--                       replaces "open the lead in Zoho and read down"
--   lead_tasks          mutable follow-ups. THE core rule: a logged call
--                       must always leave a follow-up date behind.
--   lead_status_history status transitions + WHERE they came from, which
--                       is what makes echo suppression possible.
--
-- ADD ONLY. Safe to re-run.
--
-- ── WHY application_stage IS NOT REPLACED ──────────────────────────
-- contacts.application_stage is already the Lead_Status mirror and has
-- ~163 code references. What broke status writes before (and forced
-- contacts.disposition to be split out — see 2026-07-27-lead-disposition.sql)
-- was the Zoho webhook ECHO LOOP, not the column name: a Supabase write
-- pushed to Zoho, which webhooked back and re-triggered everything.
-- The fix is origin tracking (application_stage_origin) + a 180s echo
-- guard in src/lib/crm.ts applyZohoStatus(), not a second status column.
-- The canonical name is exposed at the READ boundary by crm_read.leads
-- (2026-08-18-crm-readonly-role.sql) as `lead_status`.
--
-- ── RUN THIS FIRST ─────────────────────────────────────────────────
-- The unique index on contacts.zoho_lead_id below will fail if duplicates
-- exist. Find and resolve them before running this file:
--
--   select zoho_lead_id, count(*), array_agg(id) from contacts
--   where zoho_lead_id is not null group by 1 having count(*) > 1;
-- =====================================================================


-- ─────────────────────────────────────────────────────────────────────
-- contacts: sync bookkeeping
-- ─────────────────────────────────────────────────────────────────────
-- NOTE: phone_last10 + mobile_last10 already exist as STORED generated
-- columns (2026-06-04-contacts-phone-last10.sql). They are phone-only and
-- mobile-only respectively, NOT coalesced — the Zoho matcher in
-- src/lib/zoho-pull.ts must check both.

alter table contacts
  add column if not exists source_system       text default 'mission_control',
  add column if not exists zoho_modified_time  timestamptz,
  add column if not exists zoho_deleted_at     timestamptz;


-- ─────────────────────────────────────────────────────────────────────
-- contacts: working state + worklist inputs
-- ─────────────────────────────────────────────────────────────────────
-- working_state is Mission Control's OWN state machine, deliberately
-- decoupled from the Zoho picklist so a picklist rename in a CRM we are
-- about to cancel can never break the call board.
--
-- last_activity_at / next_action_at / open_task_count are DENORMALIZED by
-- the triggers at the bottom of this file. That is the whole point: the
-- "who do I call today" query becomes one partial-index scan with no
-- joins and no aggregation.

alter table contacts
  -- new | working | nurture | snoozed | closed
  add column if not exists working_state        text not null default 'new',
  add column if not exists snoozed_until        timestamptz,
  add column if not exists snooze_reason        text,

  add column if not exists last_activity_at     timestamptz,
  add column if not exists last_inbound_at      timestamptz,
  add column if not exists last_outbound_at     timestamptz,

  add column if not exists next_action_at       timestamptz,
  add column if not exists next_action_reason   text,
  add column if not exists open_task_count      int not null default 0,

  add column if not exists application_stage_updated_at timestamptz,
  -- mission_control | zoho | slack | ai | portal | import | webhook
  add column if not exists application_stage_origin     text;


-- ─────────────────────────────────────────────────────────────────────
-- contacts: matching indexes for the Zoho pull
-- ─────────────────────────────────────────────────────────────────────
-- zoho_lead_id UNIQUE is what makes the import re-runnable. Without it a
-- second pull creates a duplicate contact for every lead.

create unique index if not exists contacts_zoho_lead_id_uidx
  on contacts (zoho_lead_id) where zoho_lead_id is not null;

create index if not exists contacts_email_lower_idx
  on contacts (lower(email)) where email is not null;

create index if not exists contacts_mobile_last10_lookup_idx
  on contacts (mobile_last10) where mobile_last10 <> '';


-- ─────────────────────────────────────────────────────────────────────
-- contacts: the "who do we need to call today" indexes
-- ─────────────────────────────────────────────────────────────────────
-- All PARTIAL. The predicate is the point — it keeps each index to the
-- few thousand workable leads instead of the whole table.

-- Bucket "unscheduled": a working lead with NO open follow-up task.
-- This is the user's core rule and the most-run query in the product.
create index if not exists contacts_needs_followup_idx
  on contacts (last_activity_at asc nulls first)
  where working_state <> 'closed'
    and coalesce(do_not_contact, false) = false
    and open_task_count = 0;

-- Buckets "overdue" / "due_today".
create index if not exists contacts_due_idx
  on contacts (next_action_at)
  where next_action_at is not null and working_state <> 'closed';

-- Bucket "replied": they answered and we haven't.
create index if not exists contacts_replied_idx
  on contacts (last_inbound_at desc)
  where working_state <> 'closed' and coalesce(do_not_contact, false) = false;

create index if not exists contacts_stage_activity_idx
  on contacts (application_stage, last_activity_at desc);


-- ─────────────────────────────────────────────────────────────────────
-- lead_activities — append-only unified timeline
-- ─────────────────────────────────────────────────────────────────────
-- Replaces "read the notes in Zoho". Every note, call, text, email,
-- status change and portal event lands here, from every source.
--
-- deal_id has NO foreign key on purpose: `deals` was created in the
-- Supabase console and its id type is not asserted anywhere in this repo.
-- Same reasoning as outreach_prospects.contact_id.

create table if not exists lead_activities (
  id            uuid primary key default gen_random_uuid(),
  contact_id    uuid not null references contacts(id) on delete cascade,
  deal_id       uuid,

  -- note | call | email | sms | meeting | task_created | task_completed
  -- | status_change | portal | submission | snooze | system
  activity_type text not null,
  direction     text,          -- inbound | outbound | internal
  channel       text,          -- phone | email | sms | imessage | slack | portal | zoho | web

  subject       text,
  body          text,
  -- connected | voicemail | no_answer | bad_number | not_interested | booked | sent | replied
  outcome       text,
  duration_secs int,

  occurred_at   timestamptz not null default now(),
  actor         text,
  actor_email   text,

  -- zoho | mission_control | slack | imessage | graph | portal | deal_events | deal_notes
  source          text not null,
  external_id     text,        -- the Zoho record id — THE idempotency key
  external_module text,        -- Notes | Calls | Tasks | Events

  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

-- The re-run guard. Every import and every delta sync is safe to replay:
-- re-reading the same Zoho note is a no-op instead of a duplicate row.
create unique index if not exists lead_activities_external_uidx
  on lead_activities (source, external_id) where external_id is not null;

create index if not exists lead_activities_contact_idx
  on lead_activities (contact_id, occurred_at desc);
create index if not exists lead_activities_recent_idx
  on lead_activities (occurred_at desc);
create index if not exists lead_activities_contact_type_idx
  on lead_activities (contact_id, activity_type, occurred_at desc);


-- ─────────────────────────────────────────────────────────────────────
-- lead_tasks — MUTABLE follow-up state
-- ─────────────────────────────────────────────────────────────────────
-- Deliberately NOT rows in lead_activities: a task is edited, completed
-- and rescheduled, and an append-only timeline is the wrong shape for
-- that. The timeline records task_created / task_completed events instead.
--
-- This table is what "I MUST leave a follow-up date" writes into. A lead
-- with zero open rows here is, by definition, a lead that needs working.

create table if not exists lead_tasks (
  id           uuid primary key default gen_random_uuid(),
  contact_id   uuid not null references contacts(id) on delete cascade,
  deal_id      uuid,

  title        text not null,
  description  text,
  task_type    text not null default 'followup',  -- followup | call | email | document | other
  priority     text not null default 'normal',    -- low | normal | high
  status       text not null default 'open',      -- open | done | cancelled

  due_at        timestamptz,
  snoozed_until timestamptz,

  created_by   text default 'system',
  completed_at timestamptz,
  completed_by text,
  outcome      text,

  source       text not null default 'mission_control',
  external_id  text,          -- Zoho Task id — import + delta idempotency
  zoho_task_id text,          -- write-back pointer during the dual-write window
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create unique index if not exists lead_tasks_external_uidx
  on lead_tasks (source, external_id) where external_id is not null;
create index if not exists lead_tasks_open_due_idx
  on lead_tasks (due_at) where status = 'open';
create index if not exists lead_tasks_contact_idx
  on lead_tasks (contact_id, status, due_at);


-- ─────────────────────────────────────────────────────────────────────
-- lead_status_history
-- ─────────────────────────────────────────────────────────────────────
-- `origin` is the load-bearing column. crm.applyZohoStatus() checks this
-- table for a recent non-zoho write of the same status before accepting
-- an inbound Zoho status, which is what breaks the echo loop.

create table if not exists lead_status_history (
  id          uuid primary key default gen_random_uuid(),
  contact_id  uuid not null references contacts(id) on delete cascade,
  old_status  text,
  new_status  text not null,
  reason      text,
  -- mission_control | zoho | slack | ai | portal | import | webhook
  origin      text not null,
  actor       text,
  occurred_at timestamptz not null default now(),
  metadata    jsonb not null default '{}'::jsonb
);

create index if not exists lead_status_history_contact_idx
  on lead_status_history (contact_id, occurred_at desc);
-- Powers the echo-suppression lookup specifically.
create index if not exists lead_status_history_echo_idx
  on lead_status_history (contact_id, new_status, occurred_at desc);


-- ─────────────────────────────────────────────────────────────────────
-- crm_sync_state — resumability
-- ─────────────────────────────────────────────────────────────────────
-- page_token is the Zoho v5 cursor, checkpointed after every written page
-- so a 60s Vercel timeout (or a laptop closing mid-import) resumes instead
-- of restarting. watermark is the Modified_Time high-water mark for the
-- incremental cron.

create table if not exists crm_sync_state (
  entity        text primary key,   -- leads | notes | calls | tasks | events | deleted_leads
  phase         text not null default 'idle',   -- idle | running | done | error
  page_token    text,
  watermark     timestamptz,
  records_seen    bigint not null default 0,
  records_written bigint not null default 0,
  last_run_at   timestamptz,
  last_error    text,
  updated_at    timestamptz not null default now()
);

insert into crm_sync_state (entity) values
  ('leads'), ('notes'), ('calls'), ('tasks'), ('events'), ('deleted_leads')
on conflict (entity) do nothing;


-- ─────────────────────────────────────────────────────────────────────
-- Denormalization triggers
-- ─────────────────────────────────────────────────────────────────────
-- These exist so buildWorklist() never has to join or aggregate.
--
-- BULK LOAD WARNING: lead_activities_touch fires per row, so a large
-- import would run one UPDATE per activity. src/lib/zoho-pull.ts disables
-- it around the bulk phase and then runs
-- docs/2026-08-17-crm-core-recompute.sql. Do not remove that handling.

create or replace function crm_touch_contact_from_activity() returns trigger
language plpgsql as $$
begin
  update contacts set
    last_activity_at = greatest(coalesce(last_activity_at, 'epoch'::timestamptz), new.occurred_at),
    last_inbound_at  = case when new.direction = 'inbound'
      then greatest(coalesce(last_inbound_at, 'epoch'::timestamptz), new.occurred_at)
      else last_inbound_at end,
    last_outbound_at = case when new.direction = 'outbound'
      then greatest(coalesce(last_outbound_at, 'epoch'::timestamptz), new.occurred_at)
      else last_outbound_at end
  where id = new.contact_id;
  return new;
end $$;

drop trigger if exists lead_activities_touch on lead_activities;
create trigger lead_activities_touch after insert on lead_activities
  for each row execute function crm_touch_contact_from_activity();


-- Recomputes the open-task rollup. Runs on insert/update/delete because a
-- task being completed must clear next_action_at just as surely as a task
-- being created must set it.
create or replace function crm_touch_contact_from_task() returns trigger
language plpgsql as $$
declare cid uuid := coalesce(new.contact_id, old.contact_id);
begin
  update contacts c set
    open_task_count    = t.cnt,
    next_action_at     = t.next_due,
    next_action_reason = t.next_title
  from (
    select count(*)                                        as cnt,
           min(due_at)                                     as next_due,
           (array_agg(title order by due_at nulls last))[1] as next_title
    from lead_tasks
    where contact_id = cid and status = 'open'
  ) t
  where c.id = cid;
  return coalesce(new, old);
end $$;

drop trigger if exists lead_tasks_touch on lead_tasks;
create trigger lead_tasks_touch after insert or update or delete on lead_tasks
  for each row execute function crm_touch_contact_from_task();


-- ─────────────────────────────────────────────────────────────────────
-- Bulk-import helpers (called by src/lib/zoho-pull.ts via .rpc())
-- ─────────────────────────────────────────────────────────────────────
-- The importer turns lead_activities_touch off for the activity phases and
-- recomputes afterwards. Without these two the import still works — it is
-- just one UPDATE per activity row, which is the difference between minutes
-- and hours on a full history load.

create or replace function crm_set_activity_trigger(enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if enabled then
    alter table lead_activities enable trigger lead_activities_touch;
  else
    alter table lead_activities disable trigger lead_activities_touch;
  end if;
end $$;

-- Set-based version of what the triggers do per-row. Mirrors
-- docs/2026-08-17-crm-core-recompute.sql so the importer can call it directly.
create or replace function crm_recompute_contact_rollups()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update contacts c set
    last_activity_at = a.max_at,
    last_inbound_at  = a.in_at,
    last_outbound_at = a.out_at
  from (
    select contact_id,
           max(occurred_at)                                       as max_at,
           max(occurred_at) filter (where direction = 'inbound')  as in_at,
           max(occurred_at) filter (where direction = 'outbound') as out_at
    from lead_activities
    group by contact_id
  ) a
  where a.contact_id = c.id
    and (c.last_activity_at is distinct from a.max_at
      or c.last_inbound_at  is distinct from a.in_at
      or c.last_outbound_at is distinct from a.out_at);

  update contacts c set
    open_task_count    = coalesce(t.cnt, 0),
    next_action_at     = t.next_due,
    next_action_reason = t.next_title
  from (
    select c2.id as contact_id, t2.cnt, t2.next_due, t2.next_title
    from contacts c2
    left join lateral (
      select count(*)                                        as cnt,
             min(due_at)                                     as next_due,
             (array_agg(title order by due_at nulls last))[1] as next_title
      from lead_tasks
      where contact_id = c2.id and status = 'open'
    ) t2 on true
  ) t
  where t.contact_id = c.id
    and (c.open_task_count    is distinct from coalesce(t.cnt, 0)
      or c.next_action_at     is distinct from t.next_due
      or c.next_action_reason is distinct from t.next_title);
end $$;

revoke all on function crm_set_activity_trigger(boolean) from public;
revoke all on function crm_recompute_contact_rollups() from public;
grant execute on function crm_set_activity_trigger(boolean) to service_role;
grant execute on function crm_recompute_contact_rollups() to service_role;


-- ─────────────────────────────────────────────────────────────────────
-- RLS — service role only, mirroring 2026-07-31-followup-operator.sql
-- ─────────────────────────────────────────────────────────────────────
alter table lead_activities     enable row level security;
alter table lead_tasks          enable row level security;
alter table lead_status_history enable row level security;
alter table crm_sync_state      enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'lead_activities', 'lead_tasks', 'lead_status_history', 'crm_sync_state'
  ] loop
    execute format('drop policy if exists "Service role full access" on %I', t);
    execute format(
      'create policy "Service role full access" on %I for all to service_role using (true) with check (true)',
      t
    );
  end loop;
end $$;


-- ─────────────────────────────────────────────────────────────────────
-- Verification
-- ─────────────────────────────────────────────────────────────────────
select table_name, count(*) as columns
from information_schema.columns
where table_name in ('lead_activities', 'lead_tasks', 'lead_status_history', 'crm_sync_state')
group by table_name
order by table_name;

select entity, phase, watermark from crm_sync_state order by entity;
