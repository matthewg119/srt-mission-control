-- One INTERNAL Slack channel per client, holding that client's whole board.
--
-- Matthew: "let us move the board but also let us run manual workflows using onboarding if we
-- want to but ideally then after they complete onboarding2 funnel we should create a channel
-- for them."
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ‼️ THIS IS NOT THE THING THAT WAS RETIRED ON 2026-08-20, AND THE DIFFERENCE IS WHO IS IN IT.
--
-- What was retired was CLIENT-FACING channels, and the blocker was billing, not doctrine:
-- src/lib/clients/provision.ts recorded it as "guests bill at 5 per PAID ACTIVE MEMBER, so fifty
-- clients would mean buying ten seats for a workspace with one human in it."
--
-- This channel is PRIVATE and holds the bot and SRT. No guest is ever invited, no client ever
-- sees it, and the rule underneath the reversal, that Slack is internal only, is untouched.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- ‼️ NOT slack_channel_id. That column is KEPT (CLAUDE.md: "clients.slack_channel_id /
-- slack_channel_name are KEPT and must not be dropped"), still holds the one channel created
-- before the reversal, and is rendered on the clients list as "legacy Slack". Writing to it
-- would make a dead record indistinguishable from a live one.
alter table public.clients
  add column if not exists ops_channel_id   text,
  add column if not exists ops_channel_name text,
  add column if not exists ops_index_ts     text;

-- ‼️ A ts IS ONLY ADDRESSABLE WITH THE CHANNEL IT WAS POSTED IN, and client_delivery_steps
-- stores bare timestamps: slack_anchor_ts and slack_message_ts carry no channel. chat.update,
-- reactions.add, pins.add and conversations.replies all need the pair.
--
-- So rather than adding a channel column to every anchor row, ops_channel_id is WRITE-ONCE: set
-- at provisioning, before any anchor exists, and never changed afterwards. Moving it on a client
-- that already has a board would orphan every anchor on that board at once, silently, because
-- chat.update against a ts in the wrong channel fails with message_not_found and slackFetch
-- returns {ok:false} rather than throwing.
--
-- The unique index is what stops two clients ever resolving to one channel, which would route
-- one client's step threads into the other's board.
create unique index if not exists clients_ops_channel_id_key
  on public.clients (ops_channel_id)
  where ops_channel_id is not null;

-- Routing looks this up for any Slack message that matched no other channel, so it wants an
-- index even though the unique one above would serve: that one is partial and this is the
-- lookup's own shape.
create index if not exists clients_ops_channel_lookup_idx
  on public.clients (ops_channel_id)
  where ops_channel_id is not null;

comment on column public.clients.ops_channel_id is
  'Private INTERNAL Slack channel for this client. WRITE-ONCE at provisioning: every step '
  'anchor ts is stored bare and is only addressable with the channel it was posted in, so '
  'changing this orphans the whole board. NULL means the board lives in '
  'SLACK_CLIENT_ONBOARDING_CHANNEL, which is correct for every client created before this and '
  'is what channelFor() falls back to.';

comment on column public.clients.ops_index_ts is
  'The one pinned index message, re-rendered in place by refreshOpsIndex. Never a second post: '
  'Slack orders a channel by post time, so a delete-and-repost moves it to the bottom '
  'permanently. Same pattern as ops_thread_ts and refreshHeader.';
