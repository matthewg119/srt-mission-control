-- Follow-up engine: new-lead intro suggestions, stale-reply nudges, morning digest.
-- Adds dedup bookkeeping columns so each feature posts at most once per cadence.

-- F2 New-lead intro text: set once when an intro suggestion is posted for a convo.
alter table sms_conversations
  add column if not exists intro_suggested_at timestamptz;

-- F3 Stale-reply detector: last time we nudged about an unanswered inbound.
alter table sms_conversations
  add column if not exists last_stale_nudge_at timestamptz;

-- F4 Morning digest: last time we posted an email follow-up card for this contact
-- (active-hanging dedup) and the Deal Lost revival cadence pointer.
alter table contacts
  add column if not exists last_digest_nudge_at timestamptz;
alter table contacts
  add column if not exists last_lost_followup_at timestamptz;

-- Helps the stale-reply scan filter recently-nudged conversations.
create index if not exists idx_sms_conversations_last_stale_nudge_at
  on sms_conversations (last_stale_nudge_at);
