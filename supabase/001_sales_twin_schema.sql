-- ============================================================================
-- Sales Twin — Red Panther kiosk schema (Modules 1 + 2)
-- Single-tenant demo. Run this in the Supabase SQL editor for project
-- gvsborqpkyvhcfrpgagp before opening /sales-twin.
--
-- RLS is intentionally NOT enabled: all writes go through service-role API
-- routes (src/app/api/sales-twin/*). The browser uses the anon key only to
-- SUBSCRIBE to Realtime changes on st_momentum_state (read-only stream).
-- ============================================================================

create extension if not exists "pgcrypto";

-- Demo tenant id — must match ST_DEMO_TENANT_ID in .env.local
-- 00000000-0000-0000-0000-000000000001

-- ── Leads cache (Zoho-backed + demo seed) ──────────────────────────────────
create table if not exists st_leads (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null,
  external_id    text not null,
  name           text,
  company        text,
  phone          text,
  email          text,
  stage          text default 'No Contact',
  metadata       jsonb default '{}'::jsonb,
  zoho_synced_at timestamptz,
  updated_at     timestamptz default now(),
  unique (tenant_id, external_id)
);
create index if not exists st_leads_tenant_idx on st_leads (tenant_id, updated_at desc);

-- ── Integration tracking (Zoho API budget) ─────────────────────────────────
create table if not exists st_integrations (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null,
  provider           text not null,
  status             text default 'connected',
  last_sync_at       timestamptz,
  api_calls_today    int  default 0,
  api_calls_reset_at date,
  unique (tenant_id, provider)
);

-- ── Momentum state machine (red/green) ─────────────────────────────────────
create table if not exists st_momentum_state (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null unique,
  current_state        text default 'RED',
  entered_at           timestamptz default now(),
  last_connect_at      timestamptz,
  consecutive_connects int  default 0,
  window_started_at    timestamptz,
  green_expires_at     timestamptz,
  active_queue         text default 'cold',
  updated_at           timestamptz default now()
);

-- ── Config key/value (momentum thresholds) ─────────────────────────────────
create table if not exists st_config_kv (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  key       text not null,
  value     text,
  unique (tenant_id, key)
);

-- ── Lead timeline events (dispositions, syncs) ─────────────────────────────
create table if not exists st_lead_timeline_events (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  lead_id     uuid,
  event_type  text,
  channel     text,
  direction   text,
  body        text,
  occurred_at timestamptz default now()
);
create index if not exists st_timeline_lead_idx on st_lead_timeline_events (lead_id, occurred_at desc);

-- ============================================================================
-- SEED
-- ============================================================================

insert into st_integrations (tenant_id, provider, status, api_calls_today)
values ('00000000-0000-0000-0000-000000000001', 'zoho', 'connected', 0)
on conflict (tenant_id, provider) do nothing;

insert into st_momentum_state (tenant_id, current_state, consecutive_connects, active_queue)
values ('00000000-0000-0000-0000-000000000001', 'RED', 0, 'cold')
on conflict (tenant_id) do nothing;

insert into st_config_kv (tenant_id, key, value) values
  ('00000000-0000-0000-0000-000000000001', 'momentum_required_connects', '3'),
  ('00000000-0000-0000-0000-000000000001', 'momentum_window_minutes', '8'),
  ('00000000-0000-0000-0000-000000000001', 'momentum_green_duration_minutes', '15')
on conflict (tenant_id, key) do nothing;

-- Red Panther demo leads (3 red / 4 green). metadata carries the full
-- Red-Panther lead shape so the kiosk renders before any Zoho pull.
-- Dollar-quoted JSON ($json$…$json$) avoids single-quote escaping.

insert into st_leads (tenant_id, external_id, name, company, phone, email, stage, metadata) values
('00000000-0000-0000-0000-000000000001', 'demo-0', 'Marcus Delgado', 'Delgado Auto Parts', '(312) 555-0174', null, 'No Contact', $json$
{
  "id": 0, "initials": "MD", "co": "Delgado Auto Parts · (312) 555-0174",
  "fund": "$85,000", "rev": "$100k+", "biz": "3 yrs", "score": "74/100", "touch": "Never",
  "sum": "<strong>No contact yet.</strong> Inbound web lead. $85k ask, $1.2M gross revenue, 3yr business. Never answered a call.",
  "notes": ["14d ago · Inbound web form. $85k ask, 3yr biz, $1.2M gross."],
  "slack": "#marcus-delgado",
  "drafts": [
    "Hey Marcus, this is Jordan with Sales Twin Funding. Tried reaching you — we have a strong MCA offer. Worth 2 mins this week?",
    "Marcus — Jordan here. You filled out our form a couple weeks back for $85k. Rates are moving, wanted to connect before they change.",
    "Hi Marcus! Jordan from Sales Twin. We can fund your $85k request quickly — just need 5 min to walk you through it. When works?"
  ],
  "outcome": "connect", "talkSec": 187
}
$json$::jsonb),
('00000000-0000-0000-0000-000000000001', 'demo-1', 'Dana Okonkwo', 'Okonkwo Logistics', '(718) 555-0291', null, 'No Contact', $json$
{
  "id": 1, "initials": "DO", "co": "Okonkwo Logistics · (718) 555-0291",
  "fund": "$42,000", "rev": "$65k+", "biz": "2 yrs", "score": "61/100", "touch": "Never",
  "sum": "<strong>No contact yet.</strong> Cold list pull. $42k ask, logistics business.",
  "notes": ["7d ago · Added from cold list. $42k ask."],
  "slack": "#dana-okonkwo",
  "drafts": [
    "Hi Dana, Jordan with Sales Twin Funding — tried reaching you about working capital for Okonkwo Logistics. Got 5 min this week?",
    "Dana — quick question. Are you open to funding options for your logistics business? We have something that might fit perfectly.",
    "Hey Dana! This is Jordan. We help logistics companies like yours get funded fast. $42k could be yours by end of week — interested?"
  ],
  "outcome": "connect", "talkSec": 143
}
$json$::jsonb),
('00000000-0000-0000-0000-000000000001', 'demo-2', 'Renee Villanueva', 'Villa Clean Services', '(305) 555-0138', null, 'No Contact', $json$
{
  "id": 2, "initials": "RV", "co": "Villa Clean Services · (305) 555-0138",
  "fund": "$120,000", "rev": "$180k+", "biz": "5 yrs", "score": "82/100", "touch": "Never",
  "sum": "<strong>High-value no-contact.</strong> 5yr business, strong revenue, large ask. Never picked up.",
  "notes": ["10d ago · Inbound referral from existing client."],
  "slack": "#renee-villanueva",
  "drafts": [
    "Renee, Jordan here from Sales Twin Funding. You were referred to us — we may have a $120k offer that fits perfectly. When can we talk?",
    "Hi Renee! Tried calling you today. Your business profile qualifies for our best rate. Quick call this week?",
    "Renee — Jordan from Sales Twin. $120k, fast funding, flexible payback. Worth a 3-min call to see if it fits?"
  ],
  "outcome": "connect", "talkSec": 224
}
$json$::jsonb),
('00000000-0000-0000-0000-000000000001', 'demo-10', 'Tom Brewer', 'Brewer HVAC', '(614) 555-0447', null, 'Warm', $json$
{
  "id": 10, "initials": "TB", "co": "Brewer HVAC · (614) 555-0447",
  "fund": "$55,000", "rev": "$90k+", "biz": "4 yrs", "score": "69/100", "touch": "1d · Call",
  "sum": "<strong>Due TODAY — high intent.</strong> Spoke yesterday, requested callback. 3 follow-up attempts total.",
  "notes": ["1d ago · Called back, asked for follow up today. Very interested.", "3d ago · First contact, explained offer.", "5d ago · Initial dial, callback requested."],
  "slack": "#tom-brewer",
  "drafts": [
    "Tom, Jordan here — following up from yesterday. Ready to walk you through the $55k offer whenever you are!",
    "Hey Tom! Just circling back as promised. Do you have 10 min today to go over the terms?",
    "Tom — Jordan from Sales Twin. I want to make sure we get your $55k sorted before end of week. When works?"
  ],
  "taskDue": "today", "attempts": 3, "outcome": "no-answer"
}
$json$::jsonb),
('00000000-0000-0000-0000-000000000001', 'demo-11', 'Liz Park', 'Park Wellness', '(213) 555-0066', null, 'Warm', $json$
{
  "id": 11, "initials": "LP", "co": "Park Wellness · (213) 555-0066",
  "fund": "$30,000", "rev": "$40k+", "biz": "1 yr", "score": "45/100", "touch": "3d · SMS",
  "sum": "<strong>Due TODAY — 5 attempts, now every 7 days.</strong> Has replied to texts but never picks up calls.",
  "notes": ["3d ago · SMS reply: \"I'll call you back\".", "7d ago · Call attempt 5, no answer.", "14d ago · Call attempt 4, no answer."],
  "slack": "#liz-park",
  "drafts": [
    "Hi Liz! Jordan from Sales Twin. Just checking in on the $30k — our 7-day follow-up. Still interested?",
    "Liz — Jordan here. This is our monthly check-in. $30k offer still available. 2-min call worth it?",
    "Hey Liz, still thinking of you for that $30k. No pressure — just keeping the door open. Let me know!"
  ],
  "taskDue": "today", "attempts": 5, "outcome": "connect", "talkSec": 98
}
$json$::jsonb),
('00000000-0000-0000-0000-000000000001', 'demo-12', 'Andre Kim', 'Kim Auto Repair', '(404) 555-0302', null, 'Warm', $json$
{
  "id": 12, "initials": "AK", "co": "Kim Auto Repair · (404) 555-0302",
  "fund": "$65,000", "rev": "$110k+", "biz": "6 yrs", "score": "77/100", "touch": "7d · Call",
  "sum": "<strong>Overdue by 2 days — stacked tasks.</strong> 4 attempts, said to call back \"next week\" twice.",
  "notes": ["7d ago · 4th attempt. Said call back next week.", "14d ago · 3rd attempt. Said call back next week."],
  "slack": "#andre-kim",
  "drafts": [
    "Andre, Jordan here — I know I keep catching you at a bad time. 60 seconds, I promise. Is now okay?",
    "Hey Andre! Just the 60-second version: we can fund your $65k at a great rate this week. Quick call?",
    "Andre — Jordan from Sales Twin. Final follow-up this cycle. Worth a quick chat before I close out your file?"
  ],
  "taskDue": "2d overdue", "attempts": 4, "outcome": "no-answer"
}
$json$::jsonb),
('00000000-0000-0000-0000-000000000001', 'demo-13', 'Sandra Scott', 'Scott Catering', '(617) 555-0521', null, 'Lukewarm', $json$
{
  "id": 13, "initials": "SS", "co": "Scott Catering · (617) 555-0521",
  "fund": "$90,000", "rev": "$150k+", "biz": "8 yrs", "score": "71/100", "touch": "5d · Email",
  "sum": "<strong>Follow-up due tomorrow.</strong> Responded to email but no call yet. Strong business profile.",
  "notes": ["5d ago · Replied to email: \"Send me more info\".", "10d ago · Email sent."],
  "slack": "#sandra-scott",
  "drafts": [
    "Sandra, Jordan from Sales Twin! I sent over the info you asked for — following up to make sure you got it. Do you have 5 min?",
    "Hey Sandra! Jordan here. Did you get a chance to look at the $90k offer details I sent? Happy to answer any questions.",
    "Sandra — just wanted to circle back on the catering biz funding. $90k, fast close. Worth a quick call?"
  ],
  "taskDue": "tomorrow", "attempts": 2, "outcome": "connect", "talkSec": 167
}
$json$::jsonb)
on conflict (tenant_id, external_id) do nothing;

-- ── Realtime: stream momentum state changes to the kiosk ───────────────────
alter publication supabase_realtime add table st_momentum_state;
