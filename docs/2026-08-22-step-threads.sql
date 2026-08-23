-- One top-level Slack message per delivery step, and a tick that means something.
--
-- Add-only. Nothing is dropped: client_delivery_steps.slack_message_ts keeps its meaning
-- (the in-thread card carrying the buttons) and gains a sibling for the TOP-LEVEL message
-- whose thread that card now lives in.
--
-- Safe to run against production as it stands: client_delivery_steps has zero rows and
-- lacasitatacos has a null ops_thread_ts, so no existing value is reinterpreted.

alter table public.client_delivery_steps
  add column if not exists slack_anchor_ts text,
  add column if not exists verified_source text,
  add column if not exists verified_detail text,
  add column if not exists verified_at timestamptz;

-- ‼️ THERE IS DELIBERATELY NO 'override' VALUE.
--
-- The whole point of the confirmation pass is that a step cannot be ticked because somebody
-- pressed a button. Two honest sources and no third:
--   system  the app observed real state (a row, a resolver answer, an HTTP 200)
--   thread  a human put an artifact in the step's thread and the app read it back
-- A "mark done anyway" button would need a third value, so adding one means writing a
-- migration and reading this comment first. That is the intended cost.
alter table public.client_delivery_steps
  drop constraint if exists client_delivery_steps_verified_source_check;
alter table public.client_delivery_steps
  add constraint client_delivery_steps_verified_source_check
  check (verified_source is null or verified_source in ('system', 'thread'));

-- Same shape as clients_day_0_stamp_complete: a stamp is whole or it is absent. A row
-- carrying a verified_at with no source could not say what it verified against.
alter table public.client_delivery_steps
  drop constraint if exists client_delivery_steps_verify_complete;
alter table public.client_delivery_steps
  add constraint client_delivery_steps_verify_complete
  check ((verified_at is null) = (verified_source is null));

comment on column public.client_delivery_steps.slack_anchor_ts is
  'ts of this step''s TOP-LEVEL message in #onboarding-srt-aeo. Its thread holds every card, draft, artifact and question for the step. Claimed once with .is(null) and never re-posted, because editing a message keeps its channel position and re-posting does not.';

comment on column public.client_delivery_steps.slack_message_ts is
  'ts of the in-thread card carrying [Done] / [Skip] / [I hit a problem]. A REPLY under slack_anchor_ts.';

comment on column public.client_delivery_steps.verified_source is
  'system = the app observed real state. thread = a human put an artifact in the thread and the app read it back. There is deliberately no override value.';

comment on column public.client_delivery_steps.verified_detail is
  'What was actually checked and found, in words, as it was written into Slack. A thread-tier line may only describe the ARTIFACT it found, never the fact that artifact stands for.';
