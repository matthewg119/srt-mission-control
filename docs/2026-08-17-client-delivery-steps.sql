-- The internal delivery checklist, and the Slack thread it lives in.
--
-- Safe to run more than once.
--
-- WHY A SECOND STEPS TABLE. client_onboarding_steps already exists and holds the EIGHT
-- client-facing pilot stages (start, intake, photograph_1, call, photograph_2, build,
-- rhythm, renew) that render on the client's board. This is a different thing at a
-- different altitude: the ~14 operational steps SRT's own team works through, several of
-- which live inside one pilot stage. Widening the existing enum would have mixed "what
-- the client sees" with "what we still owe them", and the two lists change for different
-- reasons.
--
-- The client never sees these rows. The checklist message is posted into
-- #onboarding-srt-aeo in the MAIN workspace, not into the client's channel in the hub.

create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────────────────────────────────────
-- Where the internal thread lives
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Two message timestamps, both in the main workspace:
--   ops_thread_ts    the "finished onboarding intake" card. Every internal reply about
--                    this client threads under it.
--   ops_checklist_ts the checklist message itself, a reply in that thread, edited in
--                    place via chat.update as steps are ticked.
--
-- Both are written with a conditional UPDATE guarded on `is null` (see
-- src/lib/lead-thread.ts:403-438 for the pattern) so two concurrent intake completions
-- cannot mint two checklists.

alter table public.clients
  add column if not exists ops_thread_ts    text,
  add column if not exists ops_checklist_ts text;

-- SHA-256 of (client ip + salt) via hashIp(), written by the PUBLIC /start route. This is
-- a rate-limit ledger, not a visitor log: never store the raw IP here. Same doctrine as
-- medspa_optins.ip_hash and scan_sessions.ip_hash.
alter table public.clients
  add column if not exists start_ip_hash text;

create index if not exists clients_start_ip_idx
  on public.clients (start_ip_hash, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- client_delivery_steps
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Seeded whole when intake completes, so the message renders the entire journey from the
-- first post and a missing row always means a bug rather than "not reached yet". Same
-- shape as client_onboarding_steps deliberately: one unique row per (client, step), so
-- the seeder can upsert and a tick is a targeted UPDATE.

create table if not exists public.client_delivery_steps (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid        not null references public.clients(id) on delete cascade,

  -- Stable key, not a position: the display order lives in code (DELIVERY_STEPS in
  -- src/lib/clients/delivery-checklist.ts) so steps can be reordered or reworded without
  -- a migration, and an existing row keeps its meaning.
  step_key      text        not null,

  status        text        not null default 'pending',
  completed_at  timestamptz,
  completed_by  text,
  note          text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.client_delivery_steps
  drop constraint if exists client_delivery_steps_status_check;
alter table public.client_delivery_steps
  add constraint client_delivery_steps_status_check
  check (status in ('pending', 'in_progress', 'complete', 'skipped'));

alter table public.client_delivery_steps
  drop constraint if exists client_delivery_steps_client_step_key;
alter table public.client_delivery_steps
  add constraint client_delivery_steps_client_step_key unique (client_id, step_key);

create index if not exists client_delivery_steps_client_idx
  on public.client_delivery_steps (client_id);

-- Service role bypasses RLS; enabling it with no policies blocks anon and breaks nothing.
alter table public.client_delivery_steps enable row level security;
