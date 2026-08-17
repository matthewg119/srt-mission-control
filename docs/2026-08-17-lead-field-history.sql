-- Field-level edit history for leads, plus the inferred industry on a client.
--
-- Safe to run more than once.
--
-- WHY A SEPARATE TABLE RATHER THAN lead_activities.
--
-- lead_activities already exists and already renders on the timeline, so a field change
-- could have gone there. It must not, for one concrete reason: the
-- lead_activities_touch trigger (docs/2026-08-17-crm-core.sql) fires on every insert and
-- bumps contacts.last_activity_at / last_inbound_at / last_outbound_at, and every write
-- path calls invalidateWorklistCache(). That is correct for a call or a note, which
-- genuinely are touches. It is wrong for field edits: one audit writing six fields is
-- ONE touch, not six, and routing them through activities would reshuffle the call list
-- and the hunt queue every time a scan finished.
--
-- So: separate storage, no trigger, merged into the timeline at render time. The reader
-- sees one history; the worklist does not get shoved around by bookkeeping.

create extension if not exists pgcrypto;

create table if not exists public.lead_field_history (
  id           uuid primary key default gen_random_uuid(),
  contact_id   uuid        not null references public.contacts(id) on delete cascade,

  -- The column on `contacts` that changed, e.g. 'industry', 'city', 'business_name'.
  field        text        not null,

  -- Rendered verbatim as "was updated from OLD to NEW". Stored as text regardless of the
  -- column's real type, because this is a display record, not a shadow copy: nothing
  -- reads these back into the row, and a uniform type keeps one render path.
  -- NULL old_value means the field was previously empty.
  old_value    text,
  new_value    text,

  -- Who or what made the change. 'audit_engine' is the one that matters most: it is how
  -- you tell an inference apart from something you typed.
  origin       text        not null,
  actor        text,

  occurred_at  timestamptz not null default now()
);

-- Mirrors the CrmOrigin union in src/lib/crm.ts. If you add a value there, add it here
-- in the same commit, or updateLeadFields starts failing its history insert silently.
alter table public.lead_field_history
  drop constraint if exists lead_field_history_origin_check;
alter table public.lead_field_history
  add constraint lead_field_history_origin_check
  check (origin in (
    'mission_control', 'zoho', 'slack', 'ai', 'portal', 'import', 'webhook', 'audit_engine'
  ));

-- The only read pattern: one lead's history, newest first.
create index if not exists lead_field_history_contact_idx
  on public.lead_field_history (contact_id, occurred_at desc);

-- Service role bypasses RLS; enabling it with no policies blocks anon and breaks nothing.
alter table public.lead_field_history enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- The inferred industry on a client
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Populated from the audit's classifyBusiness(), never asked at intake. Informational
-- only, never a code branch, which is the same rule audit_reports.vertical_slug carries
-- and the same invariant classify.ts enforces on itself.

alter table public.clients
  add column if not exists vertical_slug text,
  add column if not exists business_type text;
