-- Every client-facing message SRT drafts, kept.
--
-- Safe to run more than once.
--
-- WHY A TABLE AND NOT JUST A SLACK POST. Slack is the ops surface: it is where a draft is
-- read and where the tap that sends it happens. It is not the storage. A message that
-- exists only as a Slack post is unqueryable, expires with the retention plan, and cannot
-- be joined to anything. Mission Control is the source of truth, so what we said, to whom,
-- on which channel and whether it actually went all live here.
--
-- The point is the dataset. Fifty clients times six drafts is three hundred real messages
-- with outcomes attached: which phrasing preceded a fast DNS turnaround, which intro got a
-- reply, what an ask looks like when it has to be sent twice. None of that is answerable
-- if the messages are scattered across a phone and a Slack channel.
--
-- NOTHING IN HERE WAS SENT BY A MACHINE. The free WhatsApp Business app has no API, so
-- there is no send path and no code that pretends there is one. sent_at is stamped when a
-- human presses a button to say they sent it.

create extension if not exists pgcrypto;

create table if not exists public.client_messages (
  id            uuid        primary key default gen_random_uuid(),
  client_id     uuid        not null references public.clients(id) on delete cascade,

  -- Stable identifier for WHICH message this is ('intro', 'ask_gbp_access',
  -- 'report_day_30'). Display order and copy live in code (DRAFTS in
  -- src/lib/clients/client-drafts.ts, copy in src/config/client-messages.ts) so a message
  -- can be reworded without a migration and an existing row keeps its meaning. Same
  -- doctrine as client_delivery_steps.step_key.
  draft_key     text        not null,

  kind          text        not null,
  channel       text        not null,

  -- The number or address it was addressed to, as it stood when the draft was built.
  -- Stored rather than joined, because a client who changes their number later must not
  -- retroactively rewrite the history of where things were sent.
  recipient     text,

  body          text        not null,

  -- The wa.me link, when the channel was whatsapp. Kept for the same reason as recipient:
  -- it is what was actually on screen.
  wa_link       text,

  slack_ts      text,

  -- The values interpolated into the body. This is what makes the table worth having
  -- beyond an audit log: the copy plus its inputs, so a later pass can ask what was
  -- actually said to a client rather than which template was chosen.
  vars          jsonb       not null default '{}'::jsonb,

  generated_at  timestamptz not null default now(),

  -- NULL means drafted and not yet sent. There is no 'sent' status column on purpose: a
  -- timestamp answers both questions and cannot disagree with itself.
  sent_at       timestamptz,
  sent_by       text,

  created_at    timestamptz not null default now()
);

alter table public.client_messages
  drop constraint if exists client_messages_kind_check;
alter table public.client_messages
  add constraint client_messages_kind_check
  check (kind in ('send', 'ask', 'notify', 'report'));

alter table public.client_messages
  drop constraint if exists client_messages_channel_check;
alter table public.client_messages
  add constraint client_messages_channel_check
  check (channel in ('whatsapp', 'sms', 'email'));

-- ONE draft per client per key, and this constraint is load-bearing rather than tidy.
-- Delivery steps get ticked, untitcked and re-ticked while someone works out what actually
-- happened, and every one of those transitions would otherwise post the same message into
-- the thread again. The insert races the toggle and loses quietly.
alter table public.client_messages
  drop constraint if exists client_messages_client_draft_key;
alter table public.client_messages
  add constraint client_messages_client_draft_key unique (client_id, draft_key);

create index if not exists client_messages_client_idx
  on public.client_messages (client_id, generated_at desc);

-- Answers "what have I drafted and not sent" across every client at once, which is the
-- one query this table exists to make cheap.
create index if not exists client_messages_unsent_idx
  on public.client_messages (generated_at desc) where sent_at is null;

-- Service role bypasses RLS; enabling it with no policies blocks anon and breaks nothing.
alter table public.client_messages enable row level security;
