-- Business-funding decommission: collapse to five stages, wipe the funding notes.
--
-- SRT is off business funding and onto AEO. The contacts stay, because they are
-- still good AEO prospects. The funding context around them does not: the notes
-- are all "needs $200K", "wants a new truck", "said call back about the loan",
-- and the stage vocabulary is an MCA pipeline.
--
-- RUN IN ORDER. Block A is a read-only preview. Read its output before B.
-- Block C is IRREVERSIBLE and must not run until the Phase 0 CSV exists:
--
--     bun run notes:archive -- --dry-run    # counts, writes nothing
--     bun run notes:archive                 # writes Desktop/SRT-Funding-Notes-Archive.csv
--
-- Block D is NOT optional. The lead_activities / lead_tasks triggers only fire
-- on INSERT, so after Block C every contacts.last_activity_at, next_action_at
-- and open_task_count is stale and the call board ranks on numbers that no
-- longer describe anything.


-- ═══════════════════════════════════════════════════════════════════════
-- BLOCK A — preview. Read this before running anything else.
-- ═══════════════════════════════════════════════════════════════════════

-- What stages exist today, and how many leads sit at each?
select coalesce(application_stage, '(null)') as stage, count(*)
from contacts
group by 1
order by 2 desc;

-- How many activities is Block C about to delete?
select activity_type, count(*)
from lead_activities
where source = 'zoho'
group by 1
order by 2 desc;

-- Funding vs everything else.
select
  count(*) filter (where source_system = 'zoho' or zoho_lead_id is not null) as from_zoho,
  count(*) filter (where portal_entry_source is not null)                    as from_portal,
  count(*)                                                                    as total
from contacts;


-- ═══════════════════════════════════════════════════════════════════════
-- BLOCK B — collapse eighteen stages to five.
--
-- application_stage_legacy is added FIRST so the whole remap is reversible
-- with one UPDATE. It costs nothing and it is the only safety net on a
-- statement that touches every row.
--
-- The mapping mirrors normalizeStage() in src/config/stage-display.ts. If you
-- change one, change the other.
-- ═══════════════════════════════════════════════════════════════════════

alter table contacts add column if not exists application_stage_legacy text;

update contacts
set application_stage_legacy = application_stage
where application_stage_legacy is null;

-- Closed: dead, lost, declined, junk, do-not-call, and won business. Converted
-- closes too. There is no funding deal left to work and the AEO pitch starts
-- from scratch either way.
update contacts
set application_stage = 'Closed',
    application_stage_updated_at = now(),
    application_stage_origin = 'import'
where lower(trim(coalesce(application_stage, ''))) in (
  'closed', 'closed - not converted', 'closed - converted', 'converted',
  'funded', 'dead declined', 'deal lost', 'declined', 'not interested',
  'unresponsive', 'lost', 'bad lead', 'wrong number', 'duplicate',
  'junk lead', 'lost lead', 'take off list'
)
-- The substring fallback catches Zoho's off-picklist casing and variants:
-- "Not interested" was live on 29 of a 2,400-lead sample against a list that
-- said "Not Interested", so exact matching alone left dead leads workable.
or lower(coalesce(application_stage, '')) ~
   '(declined|dead|dnq|lost|junk|duplicate|not interested)';

-- Working: anyone we actually reached.
update contacts
set application_stage = 'Working',
    application_stage_updated_at = now(),
    application_stage_origin = 'import'
where lower(trim(coalesce(application_stage, ''))) in (
  'working - contacted', 'working - application out', 'working', 'contacted'
);

-- No contact: everything else that HAS a value. That includes the whole funding
-- pipeline (Underwriting, Shopping, Pre-Approved, Approved, VC / DL, Contracts
-- Out, Contracts In, Pending Stips, Funding Call, In Funding) and every
-- pre-contact or funnel-capture value.
update contacts
set application_stage = 'No contact',
    application_stage_updated_at = now(),
    application_stage_origin = 'import'
where application_stage is not null
  and trim(application_stage) <> ''
  and application_stage not in ('Closed', 'Working');

-- Untouched: never had a stage on it at all. Not the same as No contact, which
-- is somebody's decision that we have not reached them yet. These are rows the
-- scrapers, funnels and bulk loads created without ever writing the column, and
-- keeping them separate stops imported noise burying real uncontacted leads on
-- the same call board. They stay workable, just on a slower cadence.
update contacts
set application_stage = 'Untouched',
    application_stage_updated_at = now(),
    application_stage_origin = 'import'
where application_stage is null
   or trim(application_stage) = '';

-- Confirm. Up to four rows: Untouched, No contact, Working, Closed.
-- "Email Pitch" and "Negotiating / Follow-up" start empty on purpose. Nothing
-- in the funding book maps to them; they are the new AEO motion.
select application_stage, count(*) from contacts group by 1 order by 2 desc;

-- To revert the remap:
--   update contacts set application_stage = application_stage_legacy;


-- ═══════════════════════════════════════════════════════════════════════
-- BLOCK C — wipe the funding notes. IRREVERSIBLE.
--
-- Do NOT run until Desktop/SRT-Funding-Notes-Archive.csv exists and its row
-- count matches the second query in Block A.
--
-- source = 'zoho' is the whole imported funding history: notes, calls, tasks
-- and events. Leads created by the AEO funnels carry source = 'mission_control'
-- and are untouched.
-- ═══════════════════════════════════════════════════════════════════════

delete from lead_activities where source = 'zoho';

-- Follow-up tasks carried over from the funding pipeline.
delete from lead_tasks where source = 'zoho';

-- Stage history is entirely funding-stage transitions.
delete from lead_status_history where origin in ('import', 'zoho');

-- The legacy funding notes table. Nothing reads it any more: the AI tool that
-- did (get_deal_notes) is gone, and the CRM timeline reads lead_activities.
drop table if exists deal_notes;


-- ═══════════════════════════════════════════════════════════════════════
-- BLOCK D — recompute the denormalized rollups. NOT OPTIONAL.
--
-- Same work as docs/2026-08-17-crm-core-recompute.sql. Run either.
-- ═══════════════════════════════════════════════════════════════════════

update contacts c set
  last_activity_at = a.last_at,
  last_inbound_at  = a.last_in,
  last_outbound_at = a.last_out
from (
  select contact_id,
         max(occurred_at)                                      as last_at,
         max(occurred_at) filter (where direction = 'inbound')  as last_in,
         max(occurred_at) filter (where direction = 'outbound') as last_out
  from lead_activities group by contact_id
) a
where a.contact_id = c.id;

update contacts set
  last_activity_at = null, last_inbound_at = null, last_outbound_at = null
where not exists (select 1 from lead_activities la where la.contact_id = contacts.id);

update contacts c set
  open_task_count    = t.n,
  next_action_at     = t.due,
  next_action_reason = t.title
from (
  select contact_id, count(*) as n, min(due_at) as due,
         (array_agg(title order by due_at))[1] as title
  from lead_tasks where status = 'open' group by contact_id
) t
where t.contact_id = c.id;

update contacts set
  open_task_count = 0, next_action_at = null, next_action_reason = null
where not exists (
  select 1 from lead_tasks lt where lt.contact_id = contacts.id and lt.status = 'open'
);


-- ═══════════════════════════════════════════════════════════════════════
-- BLOCK E — retire the funding email sequences.
--
-- src/app/api/sequences/seed/route.ts only upserts the sequences it knows
-- about, so the retired slugs survive in the table until this removes them.
-- Anyone mid-drip is cancelled first, or the engine keeps sending funding copy
-- to a book we are now pitching AEO.
-- ═══════════════════════════════════════════════════════════════════════

update sequence_enrollments set status = 'cancelled', cancelled_at = now()
where status = 'active'
  and sequence_id in (
    select id from email_sequences where slug in (
      'website-lead-nurture','website-lead-to-application','application-abandoned',
      'application-completed-nurture','fu-new-inbound','awaiting-statements',
      'pre-approved-nurture','approved-nurture'
    )
  );

delete from email_sequence_steps where sequence_id in (
  select id from email_sequences where slug in (
    'website-lead-nurture','website-lead-to-application','application-abandoned',
    'application-completed-nurture','fu-new-inbound','awaiting-statements',
    'pre-approved-nurture','approved-nurture'
  )
);

delete from email_sequences where slug in (
  'website-lead-nurture','website-lead-to-application','application-abandoned',
  'application-completed-nurture','fu-new-inbound','awaiting-statements',
  'pre-approved-nurture','approved-nurture'
);

-- Then POST /api/sequences/seed to install the four AEO sequences, and
-- POST /api/templates/seed for the stage templates. The templates seed skips
-- when message_templates is non-empty, so clear the funding ones first if you
-- want it to run:
--   delete from message_templates;

select slug, name, is_active from email_sequences order by slug;


-- ═══════════════════════════════════════════════════════════════════════
-- BLOCK F — audit the prompt text that lives in the database, not in code.
--
-- buildSystemPrompt() (src/lib/ai.ts) appends the integrations row named
-- "AI Configuration" and every knowledge_entries row to the assistant prompt.
-- Rewriting the prompt in code does not touch either. Read these, then edit
-- anything that still describes SRT as a funding brokerage.
-- ═══════════════════════════════════════════════════════════════════════

select config from integrations where name = 'AI Configuration';

select id, title, category, left(content, 300) as preview
from knowledge_entries
order by category, title;
