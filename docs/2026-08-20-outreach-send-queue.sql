-- Nothing in this app has ever sent a cold email unattended. The audit lane says so out loud in
-- two file headers (audit-tools.ts, call-coach/wrap-card.ts): "microsoft.sendDraft is not imported
-- by this file and must not be." That stays true. First-contact emails remain DRAFTS.
--
-- This table is where the ONE exception lives, and it is deliberately a LEDGER rather than a job
-- runner: every row records what was going to be sent, from which mailbox, when it became
-- eligible, who claimed it, and what came back. A send that cannot be explained afterwards from
-- this table is a bug.
--
-- Two kinds only, enforced by a CHECK:
--   nudge  the day-after follow-up, a reply on a thread we already started
--   pitch  the public free-audit lead who filled in a form and asked for the report, which is
--          the one lane sendAuditPitch already allowed to send
--
-- Pacing lives in the ROW (send_after), not in the drainer, so a backlog cannot be flushed by
-- someone invoking the cron by hand.

create extension if not exists pgcrypto;

create table if not exists outreach_send_queue (
  id                  uuid primary key default gen_random_uuid(),
  prospect_id         uuid not null references outreach_prospects(id) on delete cascade,
  audit_report_id     uuid references audit_reports(id) on delete set null,

  kind                text not null,
  step                int,

  recipient           text not null,
  -- The address it must go OUT from. For a nudge this is the mailbox the ORIGINAL left from
  -- (outreach_touches.mailbox), never today's rotation pick: a reply from a different address
  -- than the one they were written to breaks the thread and reads as a spoof.
  mailbox             text not null,

  -- Two mutually exclusive payloads, and the CHECK below requires one.
  --   draft_message_id  a reviewed Outlook draft, fired verbatim, so what goes out is byte for
  --                     byte what was approved including any edit made in Outlook.
  --   subject/body_html composed here, for a nudge whose body is a constant.
  draft_message_id    text,
  reply_to_message_id text,
  subject             text,
  body_html           text,

  send_after          timestamptz not null default now(),

  status              text not null default 'queued',
  attempts            int  not null default 0,
  claimed_at          timestamptz,
  sent_at             timestamptz,

  sent_touch_id       uuid references outreach_touches(id) on delete set null,
  graph_message_id    text,
  internet_message_id text,
  error               text,

  -- 'nudge:<prospect_id>:2' / 'pitch:<report_id>'. Explicit rather than derived, so "have I
  -- already queued this" has one obvious answer and enqueue never relies on catching a
  -- constraint violation as flow control.
  dedupe_key          text not null,

  metadata            jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table outreach_send_queue drop constraint if exists outreach_send_queue_kind_check;
alter table outreach_send_queue add constraint outreach_send_queue_kind_check
  check (kind in ('nudge','pitch'));

alter table outreach_send_queue drop constraint if exists outreach_send_queue_status_check;
alter table outreach_send_queue add constraint outreach_send_queue_status_check
  check (status in ('queued','sending','sent','failed','canceled'));

-- A row with nothing to send is a row that fails at 7:31am with the phone ringing.
alter table outreach_send_queue drop constraint if exists outreach_send_queue_payload_check;
alter table outreach_send_queue add constraint outreach_send_queue_payload_check
  check (draft_message_id is not null or body_html is not null);

-- Enqueue idempotency. Cancelled rows are excluded so a held-then-rearmed pitch can be queued
-- again; everything else is one row per intent, forever.
create unique index if not exists outreach_send_queue_dedupe_uidx
  on outreach_send_queue (dedupe_key) where status <> 'canceled';

create index if not exists outreach_send_queue_due_idx
  on outreach_send_queue (send_after) where status = 'queued';

create index if not exists outreach_send_queue_mailbox_idx
  on outreach_send_queue (mailbox, send_after) where status in ('queued','sending');

-- A claim that never came back. The drainer releases these after 10 minutes rather than retrying
-- immediately: a Graph 202 we failed to read is a SENT email, and re-sending it is the one
-- unrecoverable mistake available here.
create index if not exists outreach_send_queue_stuck_idx
  on outreach_send_queue (claimed_at) where status = 'sending';

alter table outreach_send_queue enable row level security;
drop policy if exists "Service role full access" on outreach_send_queue;
create policy "Service role full access" on outreach_send_queue
  for all to service_role using (true) with check (true);

-- The once-per-Eastern-day guard for the 7:30am sender. The Vercel cron fires at BOTH candidate
-- UTC hours because crons are UTC and Eastern drifts an hour twice a year, so exactly one firing
-- must be allowed to act. Also the pacing check-ins, which fire at six candidate hours for three
-- Eastern slots.
alter table outreach_sweep_state add column if not exists last_nudge_run_at  timestamptz;
alter table outreach_sweep_state add column if not exists last_queue_tick_at timestamptz;
alter table outreach_sweep_state add column if not exists last_pacing_slot   text;

-- Verification.
select column_name, data_type from information_schema.columns
 where table_name = 'outreach_send_queue' order by ordinal_position;

select indexname from pg_indexes where tablename = 'outreach_send_queue' order by indexname;
