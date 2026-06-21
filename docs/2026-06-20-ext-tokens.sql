-- TextWin extension — tenant API token + lightweight feedback log.
--
-- The Chrome extension authenticates to /api/ext/* with a per-tenant bearer
-- token (Phase 1: one token per tenant; Phase 2 graduates to a revocable
-- per-user ext_tokens table). ext_feedback records every in-bubble approve /
-- edit / thumbs-down for observability; the positive ones (approve/edit) are
-- ALSO written to voice_examples so the live model keeps learning.

-- 1) Per-tenant API token on the existing tenants table.
alter table tenants add column if not exists api_token text;
create unique index if not exists tenants_api_token_key on tenants (api_token);

-- Generate a token for the SRT tenant if it doesn't have one yet.
-- pgcrypto ships with Supabase; gen_random_bytes -> 48-hex-char token.
create extension if not exists pgcrypto;
update tenants
   set api_token = encode(gen_random_bytes(24), 'hex')
 where slug = 'srt'
   and api_token is null;

-- Read it back to paste into the extension Options page:
--   select slug, api_token from tenants where slug = 'srt';

-- 2) Feedback log for the in-bubble Train loop.
create table if not exists ext_feedback (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid references tenants(id),
  conversation_id uuid,
  kind            text not null check (kind in ('approve','edit','thumbs_down')),
  inbound         text,
  ai_suggestion   text,
  final_body      text,
  created_at      timestamptz not null default now()
);
create index if not exists ext_feedback_tenant_created_idx
  on ext_feedback (tenant_id, created_at desc);
