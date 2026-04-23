-- Section B of plan im-also-getting-emails-prancy-pony.md
-- Tables backing the Email Marketing Director pipeline:
--   marketing_sends  — audit log per sent merchant email
--   contact_tasks    — open tasks (feeds the 7-day handoff rule)
--   cadence_state    — per-contact cadence position + pause flag

create table if not exists marketing_sends (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references contacts(id) on delete cascade,
  campaign_key text not null,             -- 'new_lead_d1' | 'new_lead_d2' | 'confirmation_daily' | 'awaiting_statements' | 'approved_nurture' | 'custom'
  cadence_day integer,                    -- 1-based day since cadence start (null for ad-hoc)
  sequence_position integer,              -- 1-based position within that day
  zoho_lead_id text,
  subject text not null,
  body_preview text,                      -- first 500 chars for dashboard search
  magic_link_token text,                  -- the portal magic link token we substituted at send time
  sent_at timestamptz default now(),
  slack_ts text,                          -- approval card ts
  approved_by text,                       -- slack user id
  opened_at timestamptz,                  -- magic link first clicked
  clicked_at timestamptz,
  replied_at timestamptz,
  unsubscribed_at timestamptz
);
create index if not exists marketing_sends_contact_idx on marketing_sends(contact_id, sent_at desc);
create index if not exists marketing_sends_campaign_idx on marketing_sends(campaign_key, sent_at desc);

create table if not exists contact_tasks (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references contacts(id) on delete cascade,
  title text not null,
  assigned_to text,                       -- 'matt' | 'benjamin' | 'vektor'
  due_at timestamptz,
  completed_at timestamptz,
  completed_by text,
  created_at timestamptz default now(),
  created_by text default 'system'
);
create index if not exists contact_tasks_open_idx on contact_tasks(contact_id) where completed_at is null;

create table if not exists cadence_state (
  contact_id uuid primary key references contacts(id) on delete cascade,
  track text not null default 'new_lead',  -- 'new_lead' | 'awaiting_statements' | 'approved_nurture' | 'confirmation' | 'paused' | 'done'
  started_at timestamptz not null default now(),
  current_day integer not null default 1,
  sends_today integer not null default 0,
  last_send_at timestamptz,
  paused boolean not null default false,
  paused_reason text,
  updated_at timestamptz not null default now()
);
create index if not exists cadence_state_track_idx on cadence_state(track) where paused = false;
