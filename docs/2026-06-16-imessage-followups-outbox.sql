-- 2026-06-16 — iMessage outbound outbox + follow-up scheduler
-- Run in the Supabase SQL editor (supabase.com → SQL Editor).
--
-- Purpose:
--   1) sms_outbox  — queue of outbound iMessages for the Mac bridge to send.
--      With IMESSAGE_TRANSPORT='mac' we no longer call LoopMessage; instead we
--      INSERT a pending row here, the Mac bridge polls /api/imessage/outbox,
--      sends via AppleScript, and acks back. The bridge's normal is_from_me read
--      loop mirrors the sent message into Slack + logs sms_messages, so this
--      table is delivery plumbing only (no message body duplication into Slack).
--   2) sms_followups — scheduled reminders that post a check-in card into the
--      lead's OWN Slack channel on a future date and are logged as Zoho tasks.

-- ── Outbound outbox (Mac bridge transport) ─────────────────────────────────
create table if not exists sms_outbox (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid references sms_conversations(id) on delete set null,
  contact_id      uuid,
  phone           text not null,
  body            text not null,
  status          text not null default 'pending',  -- pending | sent | failed
  source          text,                              -- manual_send | auto_send | followup | ai_tool
  attempts        int default 0,
  error           text,
  created_at      timestamptz default now(),
  sent_at         timestamptz
);

create index if not exists idx_sms_outbox_pending
  on sms_outbox (status, created_at)
  where status = 'pending';

-- ── Follow-up scheduler ─────────────────────────────────────────────────────
create table if not exists sms_followups (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid,
  contact_id       uuid not null,
  slack_channel_id text,
  due_at           timestamptz not null,
  reason           text not null,
  zoho_task_id     text,
  status           text not null default 'scheduled', -- scheduled | posted | done | cancelled
  created_at       timestamptz default now(),
  posted_at        timestamptz
);

create index if not exists idx_sms_followups_due
  on sms_followups (status, due_at)
  where status = 'scheduled';
