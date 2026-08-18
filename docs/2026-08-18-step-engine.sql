-- The step engine: a checklist you can drive from Slack.
--
-- Safe to run more than once.
--
-- WHY THIS EXISTS. Runner v3 §2 and §3. The checklist already tracks 33 rows, but a row can
-- only be pending or complete, and the only way to move one is the dashboard. §3 wants the
-- opposite: the work is posted to the person who has to do it, in the channel they are
-- already in, with the exact string to search and a button to press.
--
-- ‼️ NOTHING HERE AUTO-ADVANCES PAST A HUMAN. §2 is explicit: manual steps "go 'done' ONLY
-- when I click the button. Never infer completion from a file upload." So a screenshot
-- landing in the thread does NOT tick the step — it files evidence (client_docs) and the
-- step waits. The [Done] button reads that evidence to tell you what is missing, and then
-- still waits for you.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The wider status vocabulary
-- ─────────────────────────────────────────────────────────────────────────────
--
-- 'pending' and 'complete' were enough for a tracker. A step engine needs to say the
-- difference between "nobody has started this", "this is posted and waiting on a person",
-- and "this tried to run itself and failed" — because the last one is the only state that
-- needs somebody told, and today it is invisible.
--
--   pending      seeded, nothing has happened
--   blocked      a blockedBy key is not complete (advisory; see DeliveryStep.blockedBy)
--   ready        blockers clear, not started
--   running      an auto step is executing
--   awaiting_me  posted to Slack, waiting on a button. The state §3 is built around.
--   complete     done
--   skipped      explicitly not applicable, with a reason
--   error        an auto step failed. error_detail says how.
--
-- The existing check constraint is dropped and replaced rather than widened in place,
-- because 'pending'/'in_progress'/'complete'/'skipped' was written by the 14-step tracker
-- and 'in_progress' is now 'running'.
alter table public.client_delivery_steps
  drop constraint if exists client_delivery_steps_status_check;

update public.client_delivery_steps
   set status = 'running'
 where status = 'in_progress';

alter table public.client_delivery_steps
  add constraint client_delivery_steps_status_check
  check (status in (
    'pending', 'blocked', 'ready', 'running', 'awaiting_me', 'complete', 'skipped', 'error'
  ));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. The message lifecycle
-- ─────────────────────────────────────────────────────────────────────────────
--
-- One threaded message per step that needs a person, edited in place as it resolves —
-- the same doctrine as clients.ops_checklist_ts and the ai_* cards. Storing the ts is what
-- makes it an edit rather than a second message: a step that posts twice is a step nobody
-- trusts.
alter table public.client_delivery_steps
  add column if not exists slack_message_ts text;

-- What the step produced, when it produced something: a PDF, a report id, a URL. Free text
-- because the 33 steps produce genuinely different things and a typed column would be
-- eight nullable columns, seven of them always null.
alter table public.client_delivery_steps
  add column if not exists output_ref text;

-- Why an auto step failed, in the words the API used. Rendered verbatim into the Slack post
-- and the #alerts-infra digest, because a paraphrased 401 sends somebody hunting the wrong
-- problem.
alter table public.client_delivery_steps
  add column if not exists error_detail text;

alter table public.client_delivery_steps
  add column if not exists started_at timestamptz;

-- Skipping is a decision, so it carries a reason and a name, exactly like the Day 0 waiver.
-- §17: "A skipped platform records the reason and renders as 'not checked' in every
-- artifact, never as 'no issues found.'"
alter table public.client_delivery_steps
  add column if not exists skipped_reason text;

create index if not exists client_delivery_steps_awaiting_idx
  on public.client_delivery_steps (status, updated_at)
  where status in ('awaiting_me', 'error');

comment on column public.client_delivery_steps.slack_message_ts is
  'ts of this step''s threaded Slack post, edited in place. A step that posts twice is a '
  'step nobody trusts.';

comment on column public.client_delivery_steps.status is
  'pending | blocked | ready | running | awaiting_me | complete | skipped | error. '
  'awaiting_me means posted and waiting on a human button — never inferred from an upload.';

-- ─────────────────────────────────────────────────────────────────────────────
-- What to expect
-- ─────────────────────────────────────────────────────────────────────────────
--
-- select status, count(*) from public.client_delivery_steps group by status order by 2 desc;
-- Everything should be 'pending' or 'complete' until the first step is posted.
