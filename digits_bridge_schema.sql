-- T-Mobile DIGITS ↔ Slack bridge schema
-- Run in Supabase SQL editor.

-- Inbound DIGITS messages mirrored into Slack #personal-texts.
-- external_id is the DIGITS message_id and is the idempotency key —
-- a duplicate POST to /api/sms/digits/inbound must NOT re-post to Slack.
create table if not exists digits_messages (
  id              uuid primary key default gen_random_uuid(),
  external_id     text not null unique,
  sender          text not null,
  normalized      text,
  body            text not null,
  contact_id      uuid references contacts(id) on delete set null,
  slack_channel   text,
  slack_ts        text,
  created_at      timestamptz default now()
);

create index if not exists digits_messages_normalized_idx on digits_messages(normalized);
create index if not exists digits_messages_created_idx on digits_messages(created_at desc);

-- Outbound queue populated by Slack thread replies in #personal-texts.
-- The Mac-side Playwright worker pulls unsent rows via GET /api/sms/digits/pending
-- and acknowledges via POST /api/sms/digits/pending/[id]/sent.
create table if not exists digits_outbound_queue (
  id              uuid primary key default gen_random_uuid(),
  to_phone        text not null,
  body            text not null,
  created_at      timestamptz default now(),
  sent_at         timestamptz
);

create index if not exists digits_outbound_pending_idx
  on digits_outbound_queue(created_at)
  where sent_at is null;
