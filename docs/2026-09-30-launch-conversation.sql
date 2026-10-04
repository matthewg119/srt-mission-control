-- The onboarding conversation: the thread that drives the Launch Lane board.
--
-- Safe to run more than once.
--
-- ‼️ THE THREAD IS A TRANSCRIPT, NOT THE SOURCE OF TRUTH, AND THESE TABLES ARE SHAPED TO SAY SO.
-- client_launch_steps and the verifiers in src/lib/launch/verify.ts stay authoritative exactly as
-- they are. Delete every row below and the board is unchanged; replay every row and each tick
-- still has to survive its verifier. This is the same split client_hosts draws against
-- client_dns_records and client_domain_orders draws against the purchase: record what HAPPENED,
-- and never let the narration become the record.
--
-- Nothing here is shared with the 41-step Slack lane. See scripts/_probe-launch-isolation.ts.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. launch_conversations -- one thread per client, and exactly one
-- ─────────────────────────────────────────────────────────────────────────────
--
-- ‼️ ONE CLIENT PER THREAD IS A UNIQUE INDEX, NOT A CONVENTION. Matthew's instruction was
-- "never two clients in one thread", and the failure it prevents is specific: a conversation that
-- can hold two clients is one where an action executes against whichever the model last mentioned.
-- The client is also in the route (/dashboard/launch/[id]/chat), so the id an action runs against
-- comes from the URL and never from the model's output.
create table if not exists public.launch_conversations (
  id          uuid        primary key default gen_random_uuid(),
  client_id   uuid        not null references public.clients(id) on delete cascade,

  -- Read by the unfinished-onboarding nudge. One timestamp, so there is never a second notion
  -- of "stale" to disagree with this one.
  last_turn_at timestamp with time zone,

  created_at  timestamp with time zone not null default now(),
  updated_at  timestamp with time zone not null default now()
);

create unique index if not exists launch_conversations_client_uidx
  on public.launch_conversations (client_id);

alter table public.launch_conversations enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. launch_messages -- the turns, and what each one actually did
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.launch_messages (
  id              uuid        primary key default gen_random_uuid(),
  conversation_id uuid        not null references public.launch_conversations(id) on delete cascade,

  role            text        not null,
  content         text        not null default '',

  -- ‼️ WHAT WAS EXECUTED, NOT WHAT WAS PROPOSED. The model's plan and the server's result are
  -- different facts and a turn that proposed four actions and executed one must not read as four.
  -- Each entry carries its own ok/error, so a refusal is auditable months later without re-running
  -- anything. jsonb because it is read whole and never filtered on.
  actions         jsonb,

  -- Set when this turn settled a step, so "here is where we are" is a cheap read rather than a
  -- replay of the whole thread.
  step_key        text,

  created_at      timestamp with time zone not null default now()
);

alter table public.launch_messages drop constraint if exists launch_messages_role_check;
alter table public.launch_messages add constraint launch_messages_role_check
  check (role in ('user', 'assistant', 'system'));

create index if not exists launch_messages_conversation_idx
  on public.launch_messages (conversation_id, created_at);

alter table public.launch_messages enable row level security;
