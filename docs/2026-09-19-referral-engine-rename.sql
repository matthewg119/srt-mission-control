-- The AI Referral Engine became the AI Referral Engine. Move every stored key to match.
--
-- Safe to run more than once (every UPDATE is keyed on the OLD value, so a second run
-- matches nothing).
--
-- ‼️ RUN THIS BEFORE THE DEPLOY, NOT AFTER. The moment the new code is live, a board
-- reading `review_tool_preview` off a row finds no step by that key and renders the client
-- as if the step had never been seeded. The reverse order is harmless: old code reading
-- `referral_engine_preview` has the same blind spot for a few minutes, on a board nobody
-- is looking at mid-deploy.
--
-- ‼️ WHY A KEY WAS RENAMED AT ALL, WHEN EVERY COMMENT IN delivery-steps.ts SAYS NOT TO.
-- Because the product name moved and two step keys were the last place still saying
-- `review_tool`. The rule those comments state is "a rename orphans rows", and the answer
-- to that is this file. What a migration cannot reach is a Slack button, which freezes
-- `${clientId}:${stepKey}` into its value at post time, so LEGACY_STEP_KEYS in
-- config/delivery-steps.ts maps the two old keys forward permanently. Old cards do not
-- expire, so neither does that map.
--
-- ‼️ THE TABLE AND COLUMN NAMES DID NOT MOVE. review_workflow, review_tool_submissions and
-- review_audit_rows keep their names, and so do the `reviews` DNS host and the /hub/[host]/
-- reviews route. Clients have already typed that hostname into a registrar and the QR codes
-- on printed review cards resolve to it.

begin;

-- ── step keys ────────────────────────────────────────────────────────────────
-- Plain text, no enum and no check constraint, by design (see 2026-08-17). The only
-- constraint is unique (client_id, step_key), and the new keys have never been written,
-- so nothing can collide.

update public.client_delivery_steps
   set step_key = 'referral_engine_preview'
 where step_key = 'review_tool_preview';

update public.client_delivery_steps
   set step_key = 'referral_engine_handed'
 where step_key = 'review_tool_handed';

update public.client_events
   set step_key = 'referral_engine_preview'
 where step_key = 'review_tool_preview';

update public.client_events
   set step_key = 'referral_engine_handed'
 where step_key = 'review_tool_handed';

update public.client_docs
   set step_key = 'referral_engine_preview'
 where step_key = 'review_tool_preview';

update public.client_docs
   set step_key = 'referral_engine_handed'
 where step_key = 'review_tool_handed';

-- ── time log ─────────────────────────────────────────────────────────────────
-- ‼️ UNLIKE step_key, THIS COLUMN IS FENCED BY A CHECK CONSTRAINT, so the constraint has
-- to come off before the rows can move and go back on with the new value. The list below
-- supersedes the one in 2026-08-16-client-onboarding.sql, which has been updated to match
-- so that re-running it cannot put the old value back.

alter table public.time_log drop constraint if exists time_log_task_category_check;

update public.time_log
   set task_category = 'referral_engine_setup'
 where task_category = 'review_tool_setup';

alter table public.time_log add constraint time_log_task_category_check
  check (task_category in (
    'baseline_retest',
    'pages_new',
    'pages_refresh',
    'referral_engine_setup',
    'review_responses',
    'outreach',
    'reporting_video',
    'client_comms',
    'implementation'
  ));

commit;

-- ── verify ───────────────────────────────────────────────────────────────────
-- Both should return only referral_engine* rows, and no review_tool* rows at all.
--
--   select step_key, count(*) from public.client_delivery_steps
--    where step_key like 'review\_tool\_%' or step_key like 'referral\_engine\_%'
--    group by step_key order by step_key;
--
--   select task_category, count(*) from public.time_log
--    where task_category in ('review_tool_setup', 'referral_engine_setup')
--    group by task_category;
