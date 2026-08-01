-- =====================================================================
-- SRT FOLLOW-UP OPERATOR  (2026-07-31)
-- Per-prospect outreach pipeline + append-only touch history.
-- ADD ONLY. Safe to re-run.
--
-- Why new tables rather than columns on audit_reports: audit_reports is one
-- row per audit RUN, its pending_drafts is overwritten on every draft (so no
-- history survives), and its slack_thread_ts carries a UNIQUE index that
-- already belongs to the audit thread in #ai-visibility-audits. The operator
-- needs its own thread, its own clock, and a record of what was actually sent.
-- =====================================================================

create table if not exists outreach_prospects (
  id                uuid primary key default gen_random_uuid(),

  -- identity. email is the match key from the Outlook sweep, stored lowercase.
  email             text not null,
  name              text,
  company           text,
  website           text,
  city              text,
  phone             text,               -- display only, never required

  audit_report_id   uuid references audit_reports(id) on delete set null,
  contact_id        uuid,               -- contacts.id, no FK (contacts predates this)

  -- SENT_NO_REPLY | REPLIED_INTERESTED | ASKED_PRICE_HOT | OBJECTION | CLOSED
  state             text not null default 'SENT_NO_REPLY',
  closed_reason     text,
  step              int  not null default 1,       -- index into PERMISSION_SEQUENCE
  next_channel      text not null default 'email', -- email | call | sms

  first_sent_at     timestamptz,
  last_touch_at     timestamptz,        -- newest OUTBOUND touch
  last_reply_at     timestamptz,        -- newest INBOUND touch
  next_touch_at     timestamptz,        -- null = nothing scheduled
  last_call_at      timestamptz,
  call_attempts     int not null default 0,

  -- Outlook threading, so every follow-up is a reply on one conversation.
  conversation_id   text,
  thread_subject    text,
  last_message_id   text,

  -- What has already been said, so nudge 3 never respends nudge 1's finding.
  -- [{ "kind": "finding"|"competitor"|"signal", "detail": text, "step": int }]
  ammo_used         jsonb not null default '[]'::jsonb,

  -- This prospect's own thread in #followups_channel. Deliberately NOT
  -- audit_reports.slack_thread_ts, which is unique-indexed and holds the
  -- audit thread in #ai-visibility-audits.
  slack_channel_id  text,
  slack_thread_ts   text,

  confirmed         boolean not null default false,
  source            text not null default 'audit',  -- audit | outlook_sweep | manual
  paused            boolean not null default false,

  pending_drafts    jsonb,
  pending_kind      text,               -- email_options | permission | call_pitch | escalation
  last_digest_at    timestamptz,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- One pipeline row per address. This is what makes the sweep idempotent.
create unique index if not exists outreach_prospects_email_uidx
  on outreach_prospects (lower(email));

create unique index if not exists outreach_prospects_thread_uidx
  on outreach_prospects (slack_thread_ts) where slack_thread_ts is not null;

create index if not exists outreach_prospects_due_idx
  on outreach_prospects (next_touch_at)
  where state <> 'CLOSED' and paused = false and confirmed = true;

create index if not exists outreach_prospects_conv_idx
  on outreach_prospects (conversation_id) where conversation_id is not null;

create index if not exists outreach_prospects_state_idx on outreach_prospects (state);


-- Append-only history. Nothing here is ever overwritten.
create table if not exists outreach_touches (
  id               uuid primary key default gen_random_uuid(),
  prospect_id      uuid not null references outreach_prospects(id) on delete cascade,

  direction        text not null,   -- outbound | inbound
  channel          text not null,   -- email | call | sms | note
  step             int,

  subject          text,
  body             text,            -- plaintext, writer truncates to 8000 chars
  -- sent | draft_created | answered | no_answer | voicemail | not_interested |
  -- replied | copy_provided
  outcome          text,

  graph_message_id text,            -- the idempotency key
  conversation_id  text,

  occurred_at      timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  metadata         jsonb not null default '{}'::jsonb
);

-- THE double-count guard. The sweep re-reads an overlapping window each run.
create unique index if not exists outreach_touches_graph_uidx
  on outreach_touches (graph_message_id) where graph_message_id is not null;

create index if not exists outreach_touches_prospect_idx
  on outreach_touches (prospect_id, occurred_at desc);

create index if not exists outreach_touches_day_idx
  on outreach_touches (prospect_id, direction, occurred_at);


create table if not exists outreach_sweep_state (
  id                 int primary key default 1,
  last_sent_scan_at  timestamptz,
  last_reply_scan_at timestamptz,
  updated_at         timestamptz not null default now(),
  constraint outreach_sweep_state_singleton check (id = 1)
);
insert into outreach_sweep_state (id) values (1) on conflict (id) do nothing;


alter table outreach_prospects   enable row level security;
alter table outreach_touches     enable row level security;
alter table outreach_sweep_state enable row level security;

drop policy if exists "Service role full access" on outreach_prospects;
create policy "Service role full access" on outreach_prospects
  for all to service_role using (true) with check (true);

drop policy if exists "Service role full access" on outreach_touches;
create policy "Service role full access" on outreach_touches
  for all to service_role using (true) with check (true);

drop policy if exists "Service role full access" on outreach_sweep_state;
create policy "Service role full access" on outreach_sweep_state
  for all to service_role using (true) with check (true);


-- ── Instant pitch on a public free-audit lead ────────────────────────
-- draft_message_id is the Graph id of the Outlook draft, so the Send button
-- fires the exact message that was reviewed. auto_send_state is the claim flag
-- that makes the button, the timer and the backstop sweep safe to race:
-- whoever flips it to 'sent' first wins and the rest become no-ops.
alter table audit_reports add column if not exists draft_message_id text;
alter table audit_reports add column if not exists auto_send_state  text;  -- pending | sent | held
alter table audit_reports add column if not exists auto_send_at     timestamptz;

create index if not exists audit_reports_autosend_idx
  on audit_reports (auto_send_at)
  where auto_send_state = 'pending' and auto_send_at is not null;


-- Verification
select table_name, count(*) as columns
from information_schema.columns
where table_name in ('outreach_prospects','outreach_touches','outreach_sweep_state')
group by table_name;
