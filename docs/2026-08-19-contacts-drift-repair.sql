-- =====================================================================
-- REPAIR THE contacts SCHEMA DRIFT  (2026-08-19)
--
-- `contacts` was built in the Supabase console and drifted from what the code
-- assumes. A sweep of every `.from("contacts")` query in src/ and scripts/
-- against information_schema found ten columns that are selected, filtered on,
-- or written, and DO NOT EXIST.
--
-- These are not cosmetic. PostgREST fails the WHOLE query on one unknown
-- column, so each of these paths has been erroring — not returning empty, not
-- degrading — every time it ran:
--
--   statements_analyzed_at                  src/lib/statements-finish-app-followup.ts
--   statements_finish_app_followup_sent_at    "  (the whole /api/cron/statements-finish-app-followup lane)
--   statements_uploaded_at                  src/lib/ai-intel/zoho-guardian.ts, merchant-context.ts
--   last_nudge_posted_at                    zoho-guardian.ts, /api/leads/awaiting-statements,
--                                           /api/cron/awaiting-statements-escalation
--   awaiting_escalation_fired_at            /api/cron/awaiting-statements-escalation (also WRITES it)
--   utm_source                              /api/leads/awaiting-statements
--   ad_source                               /api/leads/awaiting-statements
--   time_in_business                        src/lib/sms-ai-engine.ts
--   drivers_license_uploaded                /api/agent/submissions  (the lender packet builder)
--   voided_check_uploaded                   /api/agent/submissions
--
-- Two of them — statements_analyzed_at and statements_finish_app_followup_sent_at
-- — were supposed to be created by docs/2026-06-25-statements-finish-app-followup.sql.
-- That file exists in the repo and was evidently never run. The others predate
-- any migration and were only ever assumptions.
--
-- ADDITIVE AND NULLABLE ON PURPOSE. Nothing is backfilled: there is no source
-- of truth for when a statement was analysed or a nudge was posted before the
-- column existed, and inventing values would make the follow-up crons act on
-- fiction. The follow-up lanes therefore start from "nothing has been nudged
-- yet", which is the honest state.
--
-- NOT FIXED HERE: /api/agent/submissions also selects a column called `ssn`.
-- That one is a code bug, not a missing column — the real columns are ssn_full
-- and ssn4, and adding a third SSN column to hold the same secret again would
-- be the wrong repair. Corrected in the route instead.
--
-- Run through scripts/db.ts. Safe to re-run.
-- =====================================================================

alter table contacts
  -- Bank-statement lane
  add column if not exists statements_analyzed_at                  timestamptz,
  add column if not exists statements_finish_app_followup_sent_at  timestamptz,
  add column if not exists statements_uploaded_at                  timestamptz,

  -- Awaiting-statements nudge + escalation lane
  add column if not exists last_nudge_posted_at                    timestamptz,
  add column if not exists awaiting_escalation_fired_at            timestamptz,

  -- Attribution. utm_campaign / utm_medium / utm_content already exist; the
  -- source half of the pair never did, despite being documented in CLAUDE.md.
  add column if not exists utm_source                              text,
  add column if not exists ad_source                               text,

  -- Underwriting facts
  add column if not exists time_in_business                        text,
  add column if not exists drivers_license_uploaded                boolean default false,
  add column if not exists voided_check_uploaded                   boolean default false;

comment on column contacts.statements_analyzed_at is
  'Stamped when the bank-statement analyzer finishes. Added 2026-08-19; NULL for everything before that, so the finish-app follow-up lane sees history as un-analysed rather than as overdue.';
comment on column contacts.awaiting_escalation_fired_at is
  'Cooldown marker for /api/cron/awaiting-statements-escalation. Added 2026-08-19 — the cron both read and wrote it against a column that did not exist.';

-- The escalation cron windows on last_nudge_posted_at every run.
create index if not exists contacts_last_nudge_posted_idx
  on contacts (last_nudge_posted_at)
  where last_nudge_posted_at is not null;

-- The finish-app follow-up cron windows on statements_analyzed_at and filters
-- on the not-yet-sent flag.
create index if not exists contacts_statements_analyzed_idx
  on contacts (statements_analyzed_at)
  where statements_analyzed_at is not null
    and statements_finish_app_followup_sent_at is null;
