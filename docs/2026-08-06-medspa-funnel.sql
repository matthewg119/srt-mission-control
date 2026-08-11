-- /webflow-Aivisibility — the med spa AEO funnel, Phase 1 (opt-in + lead magnet).
--
-- Safe to run more than once (IF NOT EXISTS everywhere).
--
-- `contacts` stays the source of truth for PEOPLE, reached through ingestLead().
-- This table is funnel STATE, the same role scan_sessions plays for /scan. One row
-- per email address. contact_id is a link, never ownership.

create extension if not exists pgcrypto;

create table if not exists public.medspa_optins (
  id             uuid primary key default gen_random_uuid(),

  -- contacts.id from ingestLead(). Nullable on purpose: every step inside
  -- ingestLead is best-effort and logs rather than throws, so a Supabase or Zoho
  -- blip must not cost us the opt-in row itself.
  contact_id     uuid,
  email          text        not null,
  name           text,
  phone          text,
  consent_at     timestamptz,

  -- Typed into the $39 panel, normalized by normalizeTarget() from
  -- src/lib/scan/normalize.ts so clinic_domain matches how audit_reports.website
  -- formats a host. Do not write these with a second, hand-rolled URL parser.
  clinic_website text,
  clinic_domain  text,
  city           text,
  state          text,

  -- Claim flag for the guide email. Same doctrine as audit_reports.auto_send_state:
  -- claimed with a conditional UPDATE before Graph is called, and put back to
  -- 'pending' if the send throws, so it stays retryable.
  guide_state    text        not null default 'pending',
  guide_sent_at  timestamptz,

  -- Stamped when they tap "Run my audit, $39". Before Stripe exists this is the
  -- ONLY thing that tap records, and it is how the $39 click-through rate gets
  -- measured without writing a line of payment code.
  intent_at      timestamptz,

  -- SHA-256 of (client ip + SCAN_IP_SALT) via hashIp(). This is a rate-limit
  -- ledger, not a visitor log. Never store the raw IP here.
  ip_hash        text,
  source         text        not null default 'medspa_vsl',

  -- Meta attribution captured at opt-in. fbp is stored for completeness but NEVER
  -- counts as attribution on its own: the pixel sets it on every visitor including
  -- direct traffic. See src/lib/metaAttribution.ts.
  fbclid         text,
  fbc            text,
  fbp            text,
  utm_source     text,
  utm_medium     text,
  utm_campaign   text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- One row per person.
--
-- A plain UNIQUE CONSTRAINT on the column, deliberately NOT a unique index on
-- lower(email). PostgREST's on_conflict (supabase-js `.upsert({...},
-- { onConflict: "email" })`) can only name a column or a real constraint, so an
-- expression index would make the upsert fail at runtime with no compile-time hint.
--
-- Case folding therefore happens in the APPLICATION: validateOptin() lowercases the
-- address before it is ever written, exactly as ingestLead does. If a future writer
-- reaches this table without going through validateOptin, it must lowercase too.
alter table public.medspa_optins
  drop constraint if exists medspa_optins_email_key;
alter table public.medspa_optins
  add constraint medspa_optins_email_key unique (email);

create index if not exists medspa_optins_ip_created_idx
  on public.medspa_optins (ip_hash, created_at desc);

create index if not exists medspa_optins_contact_idx
  on public.medspa_optins (contact_id);

alter table public.medspa_optins
  drop constraint if exists medspa_optins_guide_state_check;
alter table public.medspa_optins
  add constraint medspa_optins_guide_state_check
  check (guide_state in ('pending', 'sent', 'skipped'));

-- Every code path reaches this table through supabaseAdmin (service role), which
-- bypasses RLS. Enabling it with no policies blocks anon/browser reads and breaks
-- nothing we do.
alter table public.medspa_optins enable row level security;
