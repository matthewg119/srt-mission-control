-- SMS Texting Bot schema migration
-- Run in Supabase SQL editor at: supabase.com → SQL Editor

-- ── SMS Conversations ─────────────────────────────────────────────────────
-- One row per contact (phone number). Tracks the full conversation state.
create table if not exists sms_conversations (
  id                        uuid primary key default gen_random_uuid(),
  contact_id                uuid references contacts(id) on delete set null,
  phone                     text not null,
  slack_channel_id          text,
  slack_channel_name        text,
  close_stage               int default 1,         -- 1=soft_pitch 2=wisdom 3=uw_drama 4=close
  payment_flexibility       text,                  -- captured from portal or text reply
  sms_send_count            int default 0,         -- hard cap at 300 (LoopMessage limit)
  follow_up_count           int default 0,
  last_inbound_at           timestamptz,
  last_outbound_at          timestamptz,
  wisdom_window_started_at  timestamptz,           -- when stage-2 hold timer began
  outcome                   text default 'open',   -- 'open' | 'closed' | 'dead'
  portal_token              uuid default gen_random_uuid(),
  created_at                timestamptz default now()
);

create unique index if not exists sms_conversations_phone_idx on sms_conversations(phone);
create index if not exists sms_conversations_contact_idx on sms_conversations(contact_id);
create index if not exists sms_conversations_outcome_idx on sms_conversations(outcome);

-- ── SMS Messages ──────────────────────────────────────────────────────────
-- Every inbound and outbound message for a conversation.
create table if not exists sms_messages (
  id                    uuid primary key default gen_random_uuid(),
  conversation_id       uuid references sms_conversations(id) on delete cascade,
  direction             text not null check (direction in ('inbound', 'outbound')),
  body                  text not null,
  ai_draft              text,                      -- what AI suggested (null if Matthew initiated)
  matthew_approved_ai   boolean,                   -- true=sent AI draft, false=sent Matthew edit, null=Matthew sent raw
  close_stage           int,                       -- stage at time of send
  metadata              jsonb,                     -- { source: 'ai_draft' | 'ai_auto_send' | 'human_direct' | 'human_override' | 'ai_refined' }
  sent_at               timestamptz default now(),
  created_at            timestamptz default now()
);

create index if not exists sms_messages_conv_idx on sms_messages(conversation_id, sent_at desc);
create index if not exists sms_messages_created_idx on sms_messages(conversation_id, created_at desc);

-- ── SMS Training Log ──────────────────────────────────────────────────────
-- Logs AI suggestion vs Matthew's edit for weekly learning batches.
create table if not exists sms_training_log (
  id                    uuid primary key default gen_random_uuid(),
  conversation_id       uuid references sms_conversations(id) on delete cascade,
  ai_suggestion         text,
  matthew_version       text,                      -- null if AI was approved as-is
  matthew_approved_ai   boolean,
  close_stage           int,
  outcome               text,                      -- updated retroactively when deal closes
  created_at            timestamptz default now()
);

create index if not exists sms_training_log_created_idx on sms_training_log(created_at desc);

-- ── SMS Pending Drafts ────────────────────────────────────────────────────
-- Tracks the latest AI draft per conversation so ✅ reaction handler can find it.
-- One row per conversation (upsert on conversation_id).
create table if not exists sms_pending_drafts (
  id                    uuid primary key default gen_random_uuid(),
  conversation_id       uuid unique references sms_conversations(id) on delete cascade,
  slack_channel_id      text not null,
  slack_ts              text not null,           -- message timestamp for the draft post
  draft_body            text not null,           -- AI's suggested reply (or Matthew's override — this is what auto-sends)
  alt_draft_body        text,                    -- AI-refined version of Matthew's override (for 2️⃣ reaction)
  close_stage           int,
  auto_send_at          timestamptz,             -- when to auto-fire if no ✅/❌
  auto_send_status      text default 'pending',  -- pending | sending | sent | cancelled | failed
  created_at            timestamptz default now()
);

create index if not exists idx_sms_pending_drafts_auto_send
  on sms_pending_drafts (auto_send_at)
  where auto_send_status = 'pending';

-- Add last_inbound_slack_ts to sms_conversations (tracks last inbound post ts)
alter table sms_conversations add column if not exists last_inbound_slack_ts text;

-- 3-minute delayed first-SMS fields
alter table sms_conversations add column if not exists first_sms_scheduled_at timestamptz;
alter table sms_conversations add column if not exists first_sms_sent boolean default false;
alter table sms_conversations add column if not exists first_sms_template text;

-- ── LoopMessage multi-sender support ─────────────────────────────────────────
-- Tracks which sender slug (LOOP_SENDER_1/2/3) is assigned to each conversation.
alter table sms_conversations add column if not exists assigned_sender text;

-- ── SMS Campaigns ─────────────────────────────────────────────────────────────
-- Bulk outreach campaigns (CSV import or Zoho re-engagement).
create table if not exists sms_campaigns (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  template_name       text,                -- references message_templates.name
  status              text default 'draft', -- draft | running | paused | completed | cancelled
  total_contacts      int default 0,
  sent_count          int default 0,
  reply_count         int default 0,
  daily_limit         int default 50,      -- max sends per day (ramp: 50 warmup → 1000 full)
  spacing_minutes     int default 12,      -- minutes between outbound initiations
  slack_campaign_ts   text,               -- ts of pinned announcement in #sms-outreach
  created_at          timestamptz default now(),
  started_at          timestamptz,
  completed_at        timestamptz
);

-- ── SMS Campaign Contacts ─────────────────────────────────────────────────────
-- One row per contact per campaign.
create table if not exists sms_campaign_contacts (
  id              uuid primary key default gen_random_uuid(),
  campaign_id     uuid references sms_campaigns(id) on delete cascade,
  phone           text not null,
  first_name      text,
  business_name   text,
  contact_id      uuid references contacts(id) on delete set null,
  assigned_sender text,                   -- LoopMessage sender slug
  status          text default 'pending', -- pending | sent | replied | failed | opted_out
  scheduled_at    timestamptz,
  sent_at         timestamptz,
  conversation_id uuid references sms_conversations(id) on delete set null,
  unique(campaign_id, phone)
);

create index if not exists sms_campaign_contacts_campaign_idx on sms_campaign_contacts(campaign_id, status, scheduled_at);
create index if not exists sms_campaign_contacts_conv_idx on sms_campaign_contacts(conversation_id);
