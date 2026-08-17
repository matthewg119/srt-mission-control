-- =====================================================================
-- CRM CORE — DENORMALIZATION RECOMPUTE  (2026-08-17)
--
-- Run AFTER a bulk import (scripts/pull-zoho-crm.ts), which disables the
-- lead_activities_touch trigger so a large load doesn't do one UPDATE per
-- activity row. This restores the denormalized columns in three set-based
-- statements instead.
--
-- Also safe to run any time you suspect drift. Idempotent.
-- =====================================================================


-- ── contacts.last_activity_at / last_inbound_at / last_outbound_at ────
update contacts c set
  last_activity_at = a.max_at,
  last_inbound_at  = a.in_at,
  last_outbound_at = a.out_at
from (
  select contact_id,
         max(occurred_at)                                        as max_at,
         max(occurred_at) filter (where direction = 'inbound')   as in_at,
         max(occurred_at) filter (where direction = 'outbound')  as out_at
  from lead_activities
  group by contact_id
) a
where a.contact_id = c.id
  and (c.last_activity_at is distinct from a.max_at
    or c.last_inbound_at  is distinct from a.in_at
    or c.last_outbound_at is distinct from a.out_at);


-- ── contacts.open_task_count / next_action_at / next_action_reason ────
-- LEFT JOIN so contacts whose last open task was just completed get
-- correctly zeroed rather than skipped.
update contacts c set
  open_task_count    = coalesce(t.cnt, 0),
  next_action_at     = t.next_due,
  next_action_reason = t.next_title
from (
  select c2.id as contact_id, t2.cnt, t2.next_due, t2.next_title
  from contacts c2
  left join lateral (
    select count(*)                                         as cnt,
           min(due_at)                                      as next_due,
           (array_agg(title order by due_at nulls last))[1]  as next_title
    from lead_tasks
    where contact_id = c2.id and status = 'open'
  ) t2 on true
) t
where t.contact_id = c.id
  and (c.open_task_count    is distinct from coalesce(t.cnt, 0)
    or c.next_action_at     is distinct from t.next_due
    or c.next_action_reason is distinct from t.next_title);


-- ── contacts.working_state ────────────────────────────────────────────
-- Seed Mission Control's own state machine from the imported Zoho status.
-- Only touches rows still at the 'new' default, so a hand-set state or a
-- later snooze is never stomped by a re-run.
update contacts set working_state = 'closed'
where working_state = 'new'
  and application_stage in (
    'Closed - Not Converted', 'Closed', 'Closed - Converted', 'Dead Declined',
    'Deal Lost', 'Funded', 'Declined', 'Not Interested', 'Unresponsive',
    'Lost', 'Bad Lead', 'Wrong Number', 'Duplicate', 'Junk Lead', 'Lost Lead',
    'DNQ', 'Take Off List', 'Dead'
  );

update contacts set working_state = 'closed'
where working_state <> 'closed' and coalesce(do_not_contact, false) = true;

update contacts set working_state = 'working'
where working_state = 'new'
  and application_stage is not null
  and application_stage not in ('Open - Not Contacted', 'Not Contacted', 'New', 'New Lead');


-- ─────────────────────────────────────────────────────────────────────
-- Verification
-- ─────────────────────────────────────────────────────────────────────
select working_state, count(*) from contacts group by 1 order by 2 desc;

select
  count(*) filter (where open_task_count = 0)                    as no_followup_scheduled,
  count(*) filter (where next_action_at < now())                 as overdue,
  count(*) filter (where last_activity_at is null)               as never_touched
from contacts
where working_state <> 'closed' and coalesce(do_not_contact, false) = false;
