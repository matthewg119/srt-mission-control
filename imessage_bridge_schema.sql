create table if not exists imessage_messages (
  id uuid primary key default gen_random_uuid(),
  direction text not null,
  sender_phone text,
  body text not null,
  rowid bigint,
  created_at timestamptz default now()
);
create table if not exists imessage_outbound_queue (
  id uuid primary key default gen_random_uuid(),
  to_phone text not null,
  body text not null,
  created_at timestamptz default now(),
  sent_at timestamptz
);
create index if not exists imessage_messages_rowid_idx on imessage_messages(rowid);
create index if not exists imessage_outbound_queue_unsent_idx
  on imessage_outbound_queue(sent_at) where sent_at is null;
