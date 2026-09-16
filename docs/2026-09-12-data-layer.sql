-- The per-client data layer: one log of everything, conversations that can be found, and a place
-- for workflow runs to live.
--
-- Additive, idempotent, safe to run more than once. Requires docs/2026-08-16-client-onboarding.sql
-- (clients) and docs/2026-08-18-measurement.sql (audit_reports.run_label).
--
-- Runner: bun run scripts/db.ts --file=docs/2026-09-12-data-layer.sql
--
-- ‼️ RUN THIS BEFORE THE DEPLOY THAT READS IT. Three things in this file are read by code in the
-- same release: chat_conversations.external_key (every assistant surface), client_events (the log)
-- and audit_reports.run_label's widened CHECK (a supplied run cannot be inserted without it).
-- PostgREST fails a WHOLE select on one unknown column, so a deploy that lands first does not
-- degrade, it silences the surfaces that read them.
--
-- Matthew, 2026-09-11: "I intend to build a full AI database where we can create workflows
-- internally ... so all of the data of each customer (inside Slack or Mission Control) needs to be
-- saved with its specific dataset."

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. client_events — everything said and done, per client
--
-- ‼️ WHY A TABLE AND NOT "SLACK ALREADY HAS IT". Slack has the messages and cannot answer a
-- question about them: reading a client's history means the channel, 41 thread timestamps, a
-- token, the bot being a member, and one API call per thread. Nothing can ask "what happened on
-- this client last week" across that, and a workflow certainly cannot. And the board deletes its
-- own messages -- _reset-client-board removes every card by stored ts -- so a re-onboarding erases
-- the history of the one before it. A row survives that.
--
-- ‼️ NOTHING IS EVER DELETED FROM HERE, and the reset script does not touch it. It is a record of
-- what happened rather than state a verifier reads, so there is no step it can make tick green.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.client_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  -- Which step's thread it happened in. Null for client-level messages (the pinned header) and
  -- for anything that belongs to the client rather than to one step.
  step_key text,
  source text not null default 'slack' check (source in ('slack', 'dashboard', 'system')),
  kind text not null check (kind in ('message', 'command', 'button', 'file', 'bot_post', 'assistant_reply')),
  -- A Slack user id, 'Mission Control' for the bot, or a name from the dashboard session.
  author text,
  -- Verbatim. The whole value of a log is that it is what was actually said.
  text text,
  slack_channel text,
  slack_ts text,
  slack_thread_ts text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ‼️ A PLAIN UNIQUE CONSTRAINT, NOT A PARTIAL INDEX, AND THIS REPO HAS PAID FOR THAT DISTINCTION
-- TWICE. ON CONFLICT infers an arbiter by matching key EXPRESSIONS, and a bare column list does
-- not match a partial or expression index: seedPresenceSweep failed 42P10 at plan time for exactly
-- this reason (docs/2026-08-24-step-board-fixes.sql). Nulls compare DISTINCT by default, so the
-- dashboard and system events -- which carry no Slack message at all -- never collide with each
-- other, while a Slack message logged twice (the live path and the backfill) collides once and is
-- skipped.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'client_events_slack_unique'
  ) then
    alter table public.client_events
      add constraint client_events_slack_unique unique (slack_channel, slack_ts);
  end if;
end $$;

create index if not exists client_events_client_idx on public.client_events (client_id, created_at desc);
create index if not exists client_events_step_idx on public.client_events (client_id, step_key, created_at desc);

alter table public.client_events enable row level security;

comment on table public.client_events is
  'Every message, command, button, file and bot post about one client, in order. A RECORD, never '
  'state: nothing verifies off it and nothing deletes from it, including _reset-client-board.';
comment on column public.client_events.kind is
  'message/command = a person typed; the difference is whether the system acted on it. '
  'bot_post/assistant_reply = the system said something. button = a card was pressed.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. chat_conversations — a key the surfaces can actually use
--
-- ‼️ THE MEMORY WAS BROKEN ON EVERY SURFACE EXCEPT THE DASHBOARD AND NOTHING SAID SO.
-- `id` is a uuid. Slack passed 'slack-C0BLK797PNU-1757...', Telegram passed 'telegram-12345', the
-- web popup passed the literal 'chat-popup'. Postgres rejected all three, so history reads matched
-- nothing and writes failed -- inside try/catch blocks that never fire, because supabase-js returns
-- errors instead of throwing. The assistant in a client's step thread had no memory of the message
-- before it.
--
-- external_key holds the surface's own id; `id` stays the uuid chat_messages already points at.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.chat_conversations add column if not exists external_key text;
alter table public.chat_conversations add column if not exists surface text;
-- Which client this conversation is ABOUT, when it happened in their thread. Nothing recorded this
-- before, so none of it could be read back per client.
alter table public.chat_conversations add column if not exists client_id uuid references public.clients(id) on delete set null;

-- The web dashboard mints its own uuid client-side; everything else needs one from the database.
alter table public.chat_conversations alter column id set default gen_random_uuid();

create unique index if not exists chat_conversations_external_key
  on public.chat_conversations (external_key) where external_key is not null;
create index if not exists chat_conversations_client_idx
  on public.chat_conversations (client_id, updated_at desc) where client_id is not null;

comment on column public.chat_conversations.external_key is
  'The surface''s own conversation id (slack-<channel>-<thread>, telegram-<chat>, chat-popup). '
  'Mapped to this row''s uuid by lib/chat-memory.ts, which is the one writer.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. client_workflow_runs — a workflow defined once, run against any client
--
-- The content engine's `workflows` table is video-shaped and keyed by vertical; content_jobs is a
-- Slack-thread state machine keyed by vertical and picker message. Neither has a client_id, and a
-- client_id stuffed into their jsonb would be a client dimension that nothing can join on.
-- client_delivery_steps cannot hold these either: it is one row per step per client, a checklist,
-- and a workflow is run repeatedly.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.client_workflow_runs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  -- The key in CLIENT_WORKFLOWS (src/lib/clients/workflows/registry.ts). A code registry, not a
  -- table, so a workflow is reviewed and deployed like everything else that writes to a client.
  workflow_key text not null,
  status text not null default 'running' check (status in ('running', 'done', 'failed')),
  inputs jsonb not null default '{}'::jsonb,
  output jsonb,
  error text,
  requested_by text,
  slack_ts text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists client_workflow_runs_client_idx
  on public.client_workflow_runs (client_id, started_at desc);

alter table public.client_workflow_runs enable row level security;

comment on table public.client_workflow_runs is
  'One run of one workflow for one client. Drafts only: nothing here sends, publishes or posts to '
  'a client-controlled property.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. audit_reports.run_label gains 'measurement'
--
-- ‼️ A2 D-P16: one engine is keyed, so a Day 0 run cannot be called a photograph. It is a real
-- measurement of the tracked set -- the keywords still get their answers -- and it is filed as one,
-- kept off the scorecard, with the Day 0 wall left unstamped. run-labels.ts resolves the label
-- from the engine count, so this value is what a requested photograph_2 becomes today, and the
-- same command writes photograph_2 the day a second engine is keyed.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  con_name text;
begin
  -- Find whatever the CHECK on run_label is actually called; docs/2026-08-18-measurement.sql let
  -- Postgres name it, and an assumed name that does not match would silently skip this.
  select conname into con_name
    from pg_constraint
   where conrelid = 'public.audit_reports'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%run_label%'
   limit 1;

  if con_name is not null then
    execute format('alter table public.audit_reports drop constraint %I', con_name);
  end if;

  alter table public.audit_reports
    add constraint audit_reports_run_label_check
    check (run_label in (
      'prospect_audit', 'test_run', 'photograph_1', 'photograph_2',
      'retest_30', 'retest_60', 'retest_90', 'measurement'
    ));
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. client_avatar_runs — backfill the history that was wiped
--
-- SRT has a confirmed avatar and zero rows here, which reads as a broken writer. The writer is
-- fine: _reset-client-board wiped the history on 2026-09-07 while deliberately keeping
-- clients.primary_avatar*, so the confirmation survived and the record of it did not. This writes
-- back exactly what the client row still says, and nothing else: the slot, the label, the slug and
-- when it was confirmed are all still there to be read.
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.client_avatar_runs (client_id, slot, avatar_slug, avatar_label, confirmed_at, confirmed_by)
select c.id,
       c.primary_avatar,
       c.primary_avatar_slug,
       c.primary_avatar_label,
       coalesce(c.primary_avatar_confirmed_at, now()),
       coalesce(c.primary_avatar_confirmed_by, 'backfilled from clients.primary_avatar')
  from public.clients c
 where c.primary_avatar is not null
   and not exists (
     select 1 from public.client_avatar_runs r
      where r.client_id = c.id and r.superseded_at is null
   );

-- What to expect:
--
--   -- The three new shapes exist:
--   select table_name, column_name from information_schema.columns
--    where table_schema = 'public'
--      and (table_name in ('client_events', 'client_workflow_runs')
--           or (table_name = 'chat_conversations' and column_name in ('external_key','surface','client_id')))
--    order by table_name, ordinal_position;
--
--   -- 'measurement' is now allowed:
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'public.audit_reports'::regclass and conname = 'audit_reports_run_label_check';
--
--   -- One avatar run per client with a confirmed avatar (SRT: 1):
--   select c.slug, count(r.id) from public.clients c
--     left join public.client_avatar_runs r on r.client_id = c.id
--    where c.primary_avatar is not null group by c.slug;
