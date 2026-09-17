-- 2026-09-17  ReachInbox reply card: in-flight button claims, and the priorities row.
--
-- WHY THERE IS NO COLUMN FOR THE REPLY TEXT
-- The prospect's own words go to outreach_touches through the existing logTouch(), which is
-- append-only and already the answer to "what happened with this prospect". A last_reply_text
-- column would hold one reply, be clobbered by the second, and become a second place to look the
-- day the forwarding mailbox turns on and starts writing bodies of its own.

-- ── One in-flight claim per button press ──────────────────────────────────────────────────────
--
-- THIS IS THE EXACTLY-ONCE GATE FOR THE TWO EXPENSIVE BUTTONS. A double click on Loom buys two
-- full audit runs (a classification call, ~20 engine calls, five minutes). A double click on Draft
-- buys two model calls and posts two approval cards for one reply, and approving both sends the
-- prospect two emails. Same doctrine as reachinbox_events.announced_at: the database picks the
-- winner, the application never read-then-writes.
create table if not exists public.reachinbox_thread_actions (
  id uuid primary key default gen_random_uuid(),

  prospect_id uuid not null references public.outreach_prospects (id) on delete cascade,

  -- 'draft' | 'loom'. Free text, not a CHECK: a third button must not need a migration to ship.
  action text not null,

  slack_channel text not null,
  -- The ts of the MESSAGE THE BUTTON WAS PRESSED ON, which is the identity of this press. The same
  -- choice pending_slack_actions makes: its button `value` is the literal "pending" on every card,
  -- so the ts is the only thing that tells one card from another.
  slack_ts text not null,

  claimed_at  timestamptz not null default now(),
  finished_at timestamptz,
  outcome     text,

  pressed_by text
);

-- PARTIAL, AND THE PREDICATE IS THE WHOLE DESIGN. A plain unique on (slack_ts, action) would
-- forbid a SECOND draft forever, and re-drafting after a weak first attempt is the normal case.
-- This forbids only a second press while the first is still running. Once finished_at is stamped
-- the button is pressable again and costs whatever it costs.
--
-- Partial is safe here because the only writer does a plain INSERT and reads 23505. Do NOT point a
-- PostgREST .upsert({onConflict}) at it: PostgREST cannot emit the WHERE clause and every call
-- fails with 42P10.
create unique index if not exists reachinbox_thread_actions_inflight_idx
  on public.reachinbox_thread_actions (slack_ts, action)
  where finished_at is null;

create index if not exists reachinbox_thread_actions_prospect_idx
  on public.reachinbox_thread_actions (prospect_id, claimed_at desc);

alter table public.reachinbox_thread_actions enable row level security;
drop policy if exists "Service role full access" on public.reachinbox_thread_actions;
create policy "Service role full access" on public.reachinbox_thread_actions
  for all to service_role using (true) with check (true);

comment on table public.reachinbox_thread_actions is
  'One row per press of a ReachInbox reply-card button. The partial unique index on (slack_ts, action) where finished_at is null is the in-flight claim; a finished row lets the same button be pressed again.';

-- ── CURRENT PRIORITIES, which no row has ever carried ─────────────────────────────────────────
--
-- buildSystemPrompt() reads integrations where name = 'AI Configuration' and renders
-- config->>'priorities' as CURRENT PRIORITIES. That row has never existed, so every assistant in
-- this app has been reading "No specific priorities set." since the day it shipped.
--
-- Written as a guarded UPDATE then a guarded INSERT so running it twice, or running it after
-- Matthew has edited Settings, changes nothing.
update public.integrations
   set config = coalesce(config, '{}'::jsonb) || jsonb_build_object('priorities',
'1. GET ONBOARDING WORKING. This is the priority that outranks everything else right now. A signed
   client has to go from agreement to a live onboarding board without anyone typing a step by hand.
   When you are asked what to do next, or you are choosing which of two things to raise, this is
   the tiebreaker. Say plainly when something is a distraction from it.

2. Campaign replies get answered the same day. A reply to a ReachInbox campaign is the scarcest
   thing this business produces. The one ask on a campaign reply is a short onboarding call. Not a
   20 minute discovery call. Not a price conversation unless they asked about price.

3. Nothing reaches a prospect without Matthew approving it. Everything you produce is a draft on a
   card. Never say or imply that something was sent, booked or scheduled.

4. No audit numbers unless an audit actually ran. A campaign replier has no report, no score and no
   competitor list. Never state one.')
 where name = 'AI Configuration'
   and coalesce(config->>'priorities', '') = '';

insert into public.integrations (name, type, status, config)
select 'AI Configuration', 'AI', 'disconnected',
       jsonb_build_object('additionalContext',
'Campaign replies arrive from ReachInbox into #vektor-email-director, one thread per person.
Drafted emails send from matthew@srtagency.com and always wait on a card for approval.
Never use an em dash or an en dash in anything a prospect reads.',
       'priorities',
'1. GET ONBOARDING WORKING. This is the priority that outranks everything else right now. A signed
   client has to go from agreement to a live onboarding board without anyone typing a step by hand.
   When you are asked what to do next, or you are choosing which of two things to raise, this is
   the tiebreaker. Say plainly when something is a distraction from it.

2. Campaign replies get answered the same day. A reply to a ReachInbox campaign is the scarcest
   thing this business produces. The one ask on a campaign reply is a short onboarding call. Not a
   20 minute discovery call. Not a price conversation unless they asked about price.

3. Nothing reaches a prospect without Matthew approving it. Everything you produce is a draft on a
   card. Never say or imply that something was sent, booked or scheduled.

4. No audit numbers unless an audit actually ran. A campaign replier has no report, no score and no
   competitor list. Never state one.')
where not exists (select 1 from public.integrations where name = 'AI Configuration');

-- Verification.
select name, left(config->>'priorities', 60) as priorities_head
  from public.integrations where name = 'AI Configuration';

select indexname from pg_indexes
 where tablename = 'reachinbox_thread_actions' order by indexname;
