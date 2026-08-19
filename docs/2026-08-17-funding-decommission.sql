-- Business-funding decommission: collapse eighteen stages to five.
--
-- SRT is off business funding and onto AEO. The contacts stay, because they are
-- still good AEO prospects, and the stage vocabulary they carried was an MCA
-- pipeline, so Block B remaps it.
--
-- ⚠ THIS FILE HAS ALREADY BEEN RUN, ON 2026-08-17. It is kept as the record of
-- what was done, not as a script to run again.
--
-- It originally also wiped the imported Zoho call history. That part — Block C
-- — WAS REVERSED ON 2026-08-18 and is now commented out. The history was
-- restored by re-pulling from Zoho. Do not uncomment it; see Block C's own
-- header for the full reasoning.
--
-- Block A is a read-only preview and is still safe to run on its own.
--
-- Block D recomputes contacts.last_activity_at / next_action_at /
-- open_task_count from lead_activities and lead_tasks. The triggers only fire
-- on INSERT, so any bulk change to those tables — the original wipe, and
-- equally the 2026-08-18 restore — leaves the rollups stale and the call board
-- ranking on numbers that no longer describe anything. Re-run Block D after
-- any such change.


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
-- BLOCK C — REVERSED 2026-08-18. DO NOT RUN. DO NOT UNCOMMENT.
--
-- This block ran once, on 2026-08-17, and deleted all 30,472 imported Zoho
-- activities (14,156 notes + 16,316 calls) plus 56 tasks. The reasoning was
-- that funding notes — "needs $200K", "wants a new truck" — are noise now that
-- SRT sells AEO.
--
-- That was wrong, and the decision is reversed. The notes are the call history
-- on 8,353 leads we are still working: who picked up, who said call back in
-- August, who is busy until graduation season ends. Stripping the money out of
-- them also stripped out every record of the relationship. A lead page that
-- reads "last touch never" on somebody we called eleven times is worse than a
-- lead page that mentions a loan.
--
-- The history was restored on 2026-08-18 by re-pulling Notes, Calls and Tasks
-- from Zoho (`bun run crm:pull -- --entity=notes|calls|tasks`, no --resume and
-- no --since, which forces a full re-pull). Running the statements below again
-- would destroy it a second time, and the re-pull is only possible while the
-- Zoho subscription is live — so treat this as permanently disarmed.
--
-- Keep Blocks A, B and D. The five-stage collapse in Block B stands; only the
-- wipe is reversed.
--
-- The statements are kept, commented, as the record of what was run:
--
--   delete from lead_activities     where source = 'zoho';
--   delete from lead_tasks          where source = 'zoho';
--   delete from lead_status_history where origin in ('import', 'zoho');
--   drop table if exists deal_notes;
--
-- `deal_notes` is the one piece not restored, and does not need to be: its
-- contents were folded into lead_activities before the drop, so the re-pull
-- covers them. lead_status_history is not restored either — those rows were
-- funding-stage transitions and no pull entity produces them.
-- ═══════════════════════════════════════════════════════════════════════


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
