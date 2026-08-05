-- /scan — the public "paste your URL, watch the agents work" funnel.
--
-- Why a session row exists at all, when audit_reports already tracks a run:
-- runAuditPipeline() does researchWebsite() + classifyBusiness() BEFORE it
-- inserts its audit_reports row, which is 15-30 seconds. The scan page needs an
-- id to redirect to and start polling within ~200ms of the paste. This row is
-- created first, returned immediately, and linked to the report once the
-- pipeline gets that far.
--
-- It also carries the two things a public, unauthenticated, 40-model-call
-- endpoint cannot ship without: the per-IP rate-limit ledger (ip_hash) and the
-- per-domain cache key (domain).

create extension if not exists pgcrypto;

create table if not exists public.scan_sessions (
  id         uuid primary key default gen_random_uuid(),
  -- Registrable host, lowercased, no www. The cache + display key.
  domain     text        not null,
  -- The normalized absolute URL actually handed to researchWebsite().
  website    text        not null,
  -- SHA-256 of (client ip + SCAN_IP_SALT). Never the raw IP: this table is a
  -- rate-limit ledger, and it does not need to be a visitor log.
  ip_hash    text,
  -- researching | running | done | failed
  status     text        not null default 'researching',
  report_id  uuid        references public.audit_reports(id) on delete set null,
  -- Set at the email gate, once the visitor trades an address for the report.
  contact_id uuid,
  error      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Serves the domain cache lookup ("has this been scanned recently?").
create index if not exists scan_sessions_domain_created_idx
  on public.scan_sessions (domain, created_at desc);

-- Serves the per-IP rate limit.
create index if not exists scan_sessions_ip_created_idx
  on public.scan_sessions (ip_hash, created_at desc);

create index if not exists scan_sessions_report_idx
  on public.scan_sessions (report_id);

-- Every code path uses supabaseAdmin (service role), which bypasses RLS.
-- Enabling it with no policies blocks anon/browser reads and breaks nothing.
alter table public.scan_sessions enable row level security;
