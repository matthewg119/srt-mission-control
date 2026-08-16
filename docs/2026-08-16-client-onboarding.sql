-- Pilot client onboarding — provisioning + six-step intake.
-- Governed by SRT-AEO-Onboarding-v2-PILOT.md (see docs/specs/).
--
-- Safe to run more than once (IF NOT EXISTS / DROP CONSTRAINT IF EXISTS everywhere).
--
-- NAMING, READ THIS FIRST. The build spec called this table `tenants`. It cannot be.
-- A `tenants` table already exists (docs/2026-06-16-sms-simulator.sql) holding exactly
-- one row, slug='srt', meaning SRT THE AGENCY, and voice_examples / bot_persona /
-- sim_conversations all carry NOT NULL FKs into it. Overloading it so that a row could
-- mean either "the agency" or "a clinic we work for" would silently corrupt every one
-- of those three tables. This is `clients`, and child tables reference `client_id`.
--
-- `contacts` and `deals` stay the source of truth for PEOPLE and PIPELINE, reached
-- through ingestLead(). contact_id / deal_id here are links, never ownership. They are
-- deliberately NOT foreign keys: every step inside ingestLead is best-effort and logs
-- rather than throws, so a Zoho or Supabase blip must never cost us the client row.
--
-- THE PILOT RULE. billing_status is the central branch. For a 'pilot' row there is no
-- price, invoice, credit, renewal, or Stripe object anywhere in the product. Note the
-- absence of stripe_customer_id below: it is not a nullable column waiting to be read,
-- it does not exist yet, and it arrives with the paid caller. Absent beats forbidden.

create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────────────────────────────────────
-- clients
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.clients (
  id                      uuid primary key default gen_random_uuid(),

  -- Slug is the provisioning CLAIM. Unique, so two clicks of "Start pilot" cannot
  -- create two clients; the loser gets a duplicate-key error and reads the row back.
  -- It is also the Slack channel name (#srt-{slug}) and the subdomain label.
  slug                    text        not null,

  legal_name              text        not null,
  dba_name                text,
  website                 text,
  domain                  text,

  -- ── Canonical NAP (intake step 1) ──
  -- This is what gets confirmed aloud, field by field, on the onboarding call, and
  -- what every directory is then made to match. Written through normalizeAddress()
  -- so "Suite 200" and "Ste 200" cannot both be canonical.
  address_line1           text,
  address_line2           text,
  city                    text,
  state                   text,
  postal_code             text,
  phone                   text,
  email                   text,
  hours                   jsonb,

  -- ── Intake payloads (steps 2 to 5) ──
  services                jsonb,
  ideal_patient           jsonb,
  review_workflow         jsonb,
  access_inventory        jsonb,

  -- Resume support. The funnel saves on every advance, so a client who closes the tab
  -- on step 4 reopens on step 4. intake_step is the highest step COMPLETED, 0 to 6.
  intake_step             smallint    not null default 0,
  intake_completed_at     timestamptz,

  -- Set when step 4 says they offer something for reviews, or that a lobby tablet or
  -- QR exists. Either one is a conversation on the call, and per PILOT §6 it stops.
  review_incentive_flag   boolean     not null default false,

  -- ── Billing branch ──
  billing_status          text        not null default 'pilot',
  pilot_started_at        timestamptz,
  pilot_ends_at           timestamptz,

  -- INTERNAL ONLY. Describes delivery volume so hours can be measured (40 vs 80
  -- questions at Photograph II). Never rendered on a client-facing surface, never
  -- spoken to a pilot. PILOT §1 is explicit that Core/Complete are internal vocabulary.
  tier_scope              text,

  -- ── Consent (intake step 6, copy is PILOT §16.4 verbatim) ──
  language                text        not null default 'en',
  consent_results         text        not null default 'anonymized',
  consent_recorded_at     timestamptz,
  testimonial_disclosure_required boolean not null default true,

  -- ── Review mechanism (confirmed on the call, seeded from intake step 4) ──
  review_request_mode     text,
  booking_software        text,
  review_destination_primary   text   not null default 'google',
  review_destination_secondary text,
  review_owner_name       text,

  -- ── Market exclusivity ──
  -- Radius from a hand-entered center. There is no geocoder in this app and at six
  -- concurrent clients there does not need to be: someone right-clicks a map once.
  -- The overlap check FLAGS and Slacks. It never blocks provisioning, matching the
  -- precedent set by findMarketConflict() in src/lib/medspa/market.ts.
  market_center_lat       double precision,
  market_center_lng       double precision,
  market_radius_mi        double precision,
  market_locked_at        timestamptz,
  market_conflict         boolean     not null default false,
  market_conflict_with    uuid,

  -- ── Infrastructure ──
  slack_channel_id        text,
  slack_channel_name      text,

  -- learn.{domain} unless DNS already resolves it, in which case guide.{domain}.
  -- Two options only, and which one was chosen is recorded rather than recomputed.
  subdomain               text,
  subdomain_convention    text,
  registrar               text,

  -- SHA-256 of the onboarding token. The token itself is a bearer credential and is
  -- never stored: it exists in the welcome email and the address bar, nowhere else.
  onboarding_token_hash   text,
  onboarding_token_expires_at timestamptz,

  onboarding_status       text        not null default 'invited',

  -- ── Soft links to the CRM ──
  contact_id              uuid,
  deal_id                 uuid,
  zoho_lead_id            text,

  -- ── Claim flag for the expensive, non-repeatable half of provisioning ──
  -- Creating the row is cheap and safe to repeat. Creating a Slack channel and
  -- sending a welcome email are neither. Claimed with a conditional UPDATE before
  -- any of that runs, exactly as medspa_optins.guide_state and
  -- audit_reports.auto_send_state do.
  provisioned_at          timestamptz,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- A plain UNIQUE CONSTRAINT on the column, not a unique index on lower(slug):
-- PostgREST's on_conflict can only name a column or a real constraint, so an
-- expression index would fail at runtime with no compile-time hint. Slugs are
-- lowercased in the application by slugify() before they are ever written.
alter table public.clients drop constraint if exists clients_slug_key;
alter table public.clients add constraint clients_slug_key unique (slug);

alter table public.clients drop constraint if exists clients_billing_status_check;
alter table public.clients add constraint clients_billing_status_check
  check (billing_status in ('pilot', 'active', 'churned', 'waitlist'));

alter table public.clients drop constraint if exists clients_tier_scope_check;
alter table public.clients add constraint clients_tier_scope_check
  check (tier_scope is null or tier_scope in ('core', 'complete'));

alter table public.clients drop constraint if exists clients_language_check;
alter table public.clients add constraint clients_language_check
  check (language in ('en', 'es', 'both'));

alter table public.clients drop constraint if exists clients_consent_results_check;
alter table public.clients add constraint clients_consent_results_check
  check (consent_results in ('anonymized', 'named', 'none'));

alter table public.clients drop constraint if exists clients_review_request_mode_check;
alter table public.clients add constraint clients_review_request_mode_check
  check (review_request_mode is null or review_request_mode in ('booking_system', 'card_only'));

alter table public.clients drop constraint if exists clients_subdomain_convention_check;
alter table public.clients add constraint clients_subdomain_convention_check
  check (subdomain_convention is null or subdomain_convention in ('learn', 'guide'));

alter table public.clients drop constraint if exists clients_onboarding_status_check;
alter table public.clients add constraint clients_onboarding_status_check
  check (onboarding_status in
    ('invited', 'intake_started', 'intake_complete', 'call_booked', 'active', 'complete'));

alter table public.clients drop constraint if exists clients_intake_step_check;
alter table public.clients add constraint clients_intake_step_check
  check (intake_step between 0 and 6);

-- The seat cap (six concurrent, pilots included) counts this.
create index if not exists clients_billing_status_idx
  on public.clients (billing_status);

create index if not exists clients_domain_idx
  on public.clients (domain);

create index if not exists clients_contact_idx
  on public.clients (contact_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- client_onboarding_steps — the eight-stage board
-- ─────────────────────────────────────────────────────────────────────────────
--
-- All eight rows are seeded at provisioning rather than created as they are reached,
-- so the board renders the whole journey from day one and a missing row always means
-- a bug rather than "not there yet".

create table if not exists public.client_onboarding_steps (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid        not null references public.clients(id) on delete cascade,
  stage          text        not null,
  status         text        not null default 'pending',
  completed_at   timestamptz,
  note           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.client_onboarding_steps
  drop constraint if exists client_onboarding_steps_stage_check;
alter table public.client_onboarding_steps
  add constraint client_onboarding_steps_stage_check
  check (stage in
    ('start', 'intake', 'photograph_1', 'call', 'photograph_2', 'build', 'rhythm', 'renew'));

alter table public.client_onboarding_steps
  drop constraint if exists client_onboarding_steps_status_check;
alter table public.client_onboarding_steps
  add constraint client_onboarding_steps_status_check
  check (status in ('pending', 'in_progress', 'complete', 'skipped'));

-- One row per stage per client. Also what lets the seeder upsert idempotently.
alter table public.client_onboarding_steps
  drop constraint if exists client_onboarding_steps_client_stage_key;
alter table public.client_onboarding_steps
  add constraint client_onboarding_steps_client_stage_key unique (client_id, stage);

-- ─────────────────────────────────────────────────────────────────────────────
-- client_docs — findings docs, scorecards, screenshots attached to a stage
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Files live in OneDrive via uploadDriveFile(). NOTE its 4 MB ceiling: it PUTs to
-- :/content and there is no upload-session path in src/lib/microsoft.ts. Anything
-- larger needs that written first.

create table if not exists public.client_docs (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid        not null references public.clients(id) on delete cascade,
  step_id        uuid        references public.client_onboarding_steps(id) on delete set null,
  filename       text        not null,
  content_type   text,
  size_bytes     integer,

  -- OneDrive driveItem id, and the webUrl for inline preview.
  storage_ref    text,
  web_url        text,

  uploaded_by    text,
  uploaded_at    timestamptz not null default now()
);

create index if not exists client_docs_client_idx
  on public.client_docs (client_id, uploaded_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- time_log — mandatory from day 0 (PILOT D-P9)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- The number that goes on camera ("about fifteen hours per Complete clinic") has to be
-- a measurement, not an estimate, which is the entire reason this table exists before
-- the feature that fills it.
--
-- 'implementation' is EXCLUDED from the subscription total in every rollup. It is
-- one-time cleanup work (citations, GBP, orphaned access), it is logged as a confound
-- in the case study, and folding it into the monthly number would overstate what
-- ongoing delivery actually costs.

create table if not exists public.time_log (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid        not null references public.clients(id) on delete cascade,
  task_category  text        not null,
  minutes        integer     not null,
  logged_by      text,
  logged_at      timestamptz not null default now(),
  note           text
);

alter table public.time_log drop constraint if exists time_log_task_category_check;
alter table public.time_log add constraint time_log_task_category_check
  check (task_category in (
    'baseline_retest',
    'pages_new',
    'pages_refresh',
    'review_tool_setup',
    'review_responses',
    'outreach',
    'reporting_video',
    'client_comms',
    'implementation'
  ));

alter table public.time_log drop constraint if exists time_log_minutes_check;
alter table public.time_log add constraint time_log_minutes_check
  check (minutes > 0 and minutes <= 1440);

create index if not exists time_log_client_idx
  on public.time_log (client_id, logged_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Every code path reaches these tables through supabaseAdmin (service role), which
-- bypasses RLS. Enabling it with NO policies blocks anon and browser reads and breaks
-- nothing we do. This is the same doctrine as medspa_optins / medspa_orders, and it
-- matters more here than usual: the intake funnel is a PUBLIC route holding a client's
-- business data, and the anon key ships to the browser on every page of this app.
--
-- The funnel reads and writes only through server routes that verify the token first.

alter table public.clients                 enable row level security;
alter table public.client_onboarding_steps enable row level security;
alter table public.client_docs             enable row level security;
alter table public.time_log                enable row level security;
