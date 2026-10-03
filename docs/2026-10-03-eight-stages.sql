-- Eight stages. Retire the five that left, rename the two that moved.
--
-- ‼️ THE CODE DOES NOT NEED THIS TO BE CORRECT, AND THAT IS DELIBERATE.
-- normalizeStage() in src/config/stage-display.ts aliases every retired spelling forward, and
-- src/lib/stage-query.ts asks Postgres for every spelling rather than one. So the board, the
-- leads list and the pickers all read correctly before this runs and after it. What this buys is
-- a column that says what it means: 7,261 rows reading "No contact" against a config that says
-- "No Contact" is a trap for the next person who writes a .eq().
--
-- ‼️ IT TOUCHES NO FLAG. do_not_contact, do_not_contact_reason, do_not_contact_at and
-- working_state are left exactly as they are. The 30 rows that were on Take Off List keep the
-- flag that stage gave them; they just stop being called a stage. setDoNotContact() in
-- src/lib/crm.ts owns the flag now, and it recognises the old "Take Off List" reason prefix so
-- those rows can still be put back.
--
-- Measured against production 2026-10-03, 8,445 contacts:
--     7261  No contact            -> No Contact   (case only)
--      939  Closed                -> unchanged
--      174  Untouched             -> New Lead
--       39  NULL                  -> New Lead
--       30  Take Off List         -> Not Interested
--        2  Loom Sent             -> Follow Up
--        0  Email Pitch, Negotiating / Follow-up   (handled anyway: queued writes exist)
--
-- Safe to re-run.

begin;

-- ── 1. The two renames ───────────────────────────────────────────────
update contacts set application_stage = 'New Lead'
 where application_stage ilike 'untouched';

update contacts set application_stage = 'No Contact'
 where application_stage ilike 'no contact'
   and application_stage <> 'No Contact';

-- ‼️ NULL AND '' BECOME New Lead EXPLICITLY. normalizeStage() already calls them that, so this
-- changes no behaviour; it makes the column self-describing so a hand-written query agrees with
-- the application.
update contacts set application_stage = 'New Lead'
 where application_stage is null or btrim(application_stage) = '';

-- ── 2. The three merges ──────────────────────────────────────────────
update contacts set application_stage = 'Working'
 where application_stage ilike 'email pitch';

update contacts set application_stage = 'Follow Up'
 where application_stage ilike 'loom sent'
    or application_stage ilike 'negotiating / follow-up'
    or application_stage ilike 'negotiating';

-- The label merges. The flag does not: no do_not_contact column is named anywhere in this file.
update contacts set application_stage = 'Not Interested'
 where application_stage ilike 'take off list';

-- ── 3. The won / lost split ──────────────────────────────────────────
-- ‼️ THE 939 EXISTING "Closed" ROWS ARE LEFT ON Closed, AND THAT IS A JUDGEMENT CALL WORTH
-- KNOWING ABOUT. Before today Closed meant won AND lost, so some of those 939 are rejections that
-- belong on Not Interested. Nothing in the row says which, and guessing from notes would move
-- real records on a heuristic. They stay where they are; the split applies from here on. If a
-- rule for sorting them out is ever agreed, it is a separate migration with its own evidence.
update contacts set application_stage = 'Not Interested'
 where application_stage ilike any (array[
   'closed - not converted', 'closed lost', 'dead declined', 'deal lost', 'declined',
   'unresponsive', 'lost', 'lost lead', 'do not call', 'do-not-call', 'dnc',
   'remove from list', 'opted out', 'bad lead', 'junk lead', 'wrong number',
   'bad number', 'out of business', 'duplicate', 'dnq', 'not interested'
 ]);

update contacts set application_stage = 'Closed'
 where application_stage ilike any (array[
   'closed - converted', 'converted', 'funded', 'won', 'closed won', 'signed'
 ])
   and application_stage <> 'Closed';

commit;

-- ── Check ────────────────────────────────────────────────────────────
-- Every row should now read one of the eight. Anything else still renders correctly (the
-- unknown-value default puts it on No Contact) but is worth a look.
--
-- select coalesce(application_stage, '<NULL>') as stage, count(*)
--   from contacts
--  group by 1
--  order by 2 desc;
--
-- select count(*) as off_list
--   from contacts
--  where application_stage not in (
--    'New Lead','No Contact','Working','Hot','Appointment Booked','Follow Up','Closed','Not Interested'
--  );
