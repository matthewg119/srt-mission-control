-- /chatgpt-ads, the post-report onboarding funnel.
--
-- One row per lead, keyed on email, patched as they move through the funnel. Applied by
-- hand like every other file in this directory; there is no migration runner.
--
-- WHY A TABLE AND NOT A system_logs ROW. /onboardingfree and /LHR both deliberately take no
-- migration, because their submissions are read once, in Slack, and never queried again.
-- These rows are different: call_completed_at is filled in by hand days later, and the whole
-- point of the funnel is to be able to ask "how many call-me-nows did we actually call back".
-- A jsonb blob in system_logs cannot answer that without a scan.
--
-- NO POSTGRES ENUMS. Nothing in this database uses one. It is text plus a named check, the
-- same as scraper_batches, because widening a check is one statement and widening an enum in
-- a transaction with a running app is not.

create extension if not exists pgcrypto;

create table if not exists public.chatgpt_ads_leads (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- Identity. Email is the key: it is the only field present on every path, and it is what
  -- mission-control joins every other funnel on.
  email         text not null,
  phone         text,
  website       text,
  business_name text,
  city          text,

  -- Answers. Stored as the stable option ids from src/config/chatgpt-ads.ts, never as the
  -- labels a visitor read, so re-wording a question does not orphan a year of rows.
  revenue         text,
  branch          text,
  channels        jsonb,
  patient_volume  text,
  one_service     text,
  gbp_access      text,
  website_host    text,
  website_access  text,

  -- Carried in the link from the audit report. All nullable: the funnel is also reachable
  -- from a cold ad with no report behind it, and a missing param must never block a lead.
  ai_visibility_score int,
  competitor_name     text,
  user_showed_count   int,
  comp_showed_count   int,
  report_slug         text,

  -- Which path they took, and the timestamps that make the callback SLA measurable.
  -- call_completed_at is set BY HAND, by whoever made the call. Nothing writes it
  -- automatically, because nothing in this stack knows whether a call connected: there is no
  -- Twilio and RingCentral is not in this funnel.
  signup_path            text not null default 'incomplete',
  call_requested_at      timestamptz,
  call_completed_at      timestamptz,
  fallback_slot_shown_at timestamptz,
  booked_slot_at         timestamptz,
  calendly_event_uri     text,

  -- The signed self-intake link. The HASH, never the token, exactly as
  -- clients.onboarding_token_hash does it: clearing this column revokes one person's link
  -- without rotating CLIENT_LINK_SECRET for everybody.
  intake_token_hash text,

  -- Plumbing. contact_id is a LINK, never ownership: contacts is the CRM and this row is one
  -- funnel's notes about a person who exists there whether or not this table does.
  contact_id      uuid,
  slack_thread_ts text,
  ip_hash         text,
  source_url      text,
  utm_source      text,
  utm_medium      text,
  utm_campaign    text,
  utm_content     text,
  fbc             text,
  fbp             text,
  fbclid          text,

  -- A PLAIN UNIQUE CONSTRAINT, NOT a unique index on lower(email). PostgREST's
  -- .upsert({ onConflict: "email" }) can only name a column or a real constraint, and it
  -- fails at runtime rather than at deploy on an expression index. medspa_optins hit this
  -- exact wall. The application lowercases every address before it writes.
  constraint chatgpt_ads_leads_email_key unique (email),

  constraint chatgpt_ads_leads_branch_check
    check (branch is null or branch in ('under_10k', 'over_10k')),

  constraint chatgpt_ads_leads_gbp_check
    check (gbp_access is null or gbp_access in
      ('full_access', 'stale_access', 'agency_or_employee', 'unsure')),

  constraint chatgpt_ads_leads_website_access_check
    check (website_access is null or website_access in
      ('owner_full', 'host_full', 'agency_managed', 'unsure')),

  constraint chatgpt_ads_leads_signup_path_check
    check (signup_path in ('call_me_now', 'booked_call', 'self_intake', 'incomplete'))
);

-- The callback queue, which is the one query anybody will actually run against this table:
-- who asked to be called and has not been marked called yet. Partial, because a completed
-- call is dead weight in this index forever.
create index if not exists chatgpt_ads_leads_pending_call_idx
  on public.chatgpt_ads_leads (call_requested_at desc)
  where signup_path = 'call_me_now' and call_completed_at is null;

create index if not exists chatgpt_ads_leads_created_idx
  on public.chatgpt_ads_leads (created_at desc);

create index if not exists chatgpt_ads_leads_contact_idx
  on public.chatgpt_ads_leads (contact_id);

-- RLS on with no policies, like every other table here. Everything that touches this row
-- goes through supabaseAdmin on the service role, which bypasses RLS; the anon key must
-- reach nothing, and a table with RLS off is reachable by the anon key by default.
alter table public.chatgpt_ads_leads enable row level security;
