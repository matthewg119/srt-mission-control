-- Take Off List — backfill
-- ─────────────────────────────────────────────────────────────────────
-- The stage itself needs no migration: contacts.application_stage is free-form
-- text with no CHECK constraint, and src/config/stage-display.ts is what says
-- which values are real. This file only makes the EXISTING book agree with the
-- new stage, so the lead count on /dashboard/leads is the number of leads
-- somebody could actually call.
--
-- Two populations move:
--   1. Rows already carrying do_not_contact = true. Nothing was ever going to
--      call them again; they just had no label saying so, so they sat in the
--      book looking workable.
--   2. Rows still carrying a junk stage value. The funding decommission
--      collapsed most of these into 'Closed', which is why Closed and
--      "not a real lead" became indistinguishable — anything that survived
--      that pass gets the right label now.
--
-- 'Not Interested', 'Dead Declined', 'Deal Lost' and 'Funded' deliberately stay
-- at Closed. Those are real businesses with a finished deal, and the AEO pitch
-- can start from scratch with them next quarter.

-- ── 1. Read first. Nothing below runs until this looks right. ─────────
select
  coalesce(application_stage, '(null)') as stage,
  coalesce(do_not_contact, false)       as dnc,
  count(*)
from contacts
where coalesce(do_not_contact, false) = true
   or application_stage in (
     'DNQ', 'Take Off List', 'Junk Lead', 'Bad Lead', 'Duplicate',
     'Wrong Number', 'Bad Number', 'Do Not Call', 'Opted Out',
     'Out of Business', 'Dead'
   )
group by 1, 2
order by 3 desc;


-- ── 2. Already flagged do-not-contact: give it the label. ────────────
update contacts
set application_stage         = 'Take Off List',
    application_stage_updated_at = now(),
    application_stage_origin  = 'import',
    working_state             = 'closed'
where coalesce(do_not_contact, false) = true
  and application_stage is distinct from 'Take Off List';


-- ── 3. Junk stage values that never got the flag. ────────────────────
-- do_not_contact_reason keeps the marker setLeadStatus writes, so putting one
-- of these back on the board later clears the flag it set and nothing else.
update contacts
set application_stage         = 'Take Off List',
    application_stage_updated_at = now(),
    application_stage_origin  = 'import',
    working_state             = 'closed',
    do_not_contact            = true,
    do_not_contact_reason     = coalesce(
                                  do_not_contact_reason,
                                  'Take Off List: ' || application_stage
                                ),
    do_not_contact_at         = coalesce(do_not_contact_at, now())
where application_stage in (
  'DNQ', 'Junk Lead', 'Bad Lead', 'Duplicate', 'Wrong Number', 'Bad Number',
  'Do Not Call', 'Opted Out', 'Out of Business', 'Dead'
);


-- ── 4. Cancel their open follow-ups. ─────────────────────────────────
-- An open task on a lead nobody may call again can only ever be snoozed or
-- ignored. The lead_tasks trigger recomputes contacts.open_task_count and
-- next_action_at, so this also clears them off the "due today" board.
update lead_tasks t
set status = 'cancelled'
from contacts c
where t.contact_id = c.id
  and t.status = 'open'
  and c.application_stage = 'Take Off List';


-- ── 5. Verify. ───────────────────────────────────────────────────────
select application_stage, count(*)
from contacts
group by 1
order by 2 desc;

-- Workable book: what the leads page and the call board now count.
select count(*) as workable
from contacts
where working_state <> 'closed'
  and coalesce(do_not_contact, false) = false;

-- Nothing on the take-off list should still be workable or still have a task.
select
  count(*) filter (where working_state <> 'closed')          as still_working_state,
  count(*) filter (where coalesce(do_not_contact,false) = false) as missing_dnc_flag,
  count(*) filter (where open_task_count > 0)                as still_has_open_task
from contacts
where application_stage = 'Take Off List';
