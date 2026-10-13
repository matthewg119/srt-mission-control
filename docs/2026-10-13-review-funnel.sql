-- 2026-10-13: conversion rates per step of the walk, for each form.
--
--   bun run scripts/db.ts --file=docs/2026-10-13-review-funnel.sql --dry
--   bun run scripts/db.ts --file=docs/2026-10-13-review-funnel.sql
--
-- Additive and idempotent. Four columns on one existing table and two read functions. No new
-- table, nothing dropped, nothing rewritten.
--
-- ‼️ RUN THIS BEFORE THE DEPLOY THAT READS IT. PostgREST fails a WHOLE select on one unknown
-- column, so a deploy landing first does not degrade, it silences every surface that reads the
-- table: the walk stops storing reviews, not just stops counting them.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ‼️ WHY THERE IS NO NEW TABLE, AND WHY THERE IS NO session_id
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
--
-- The ask was conversion rates per step of the walk, per form. Three forms exist and two of them
-- already carry everything needed:
--
--   the review walk     review_tool_submissions   one row at the end, no step record  <- this file
--   the referral invite referral_invites          created_at, channel, sent_at        <- already there
--   the friend's claim  referral_invites          claimed_at, claimed_*               <- already there
--
-- So the invite and claim funnels need ZERO new columns, and the walk needs four. The denominator
-- for "how many people opened it" is hub_hits, which has counted every request to a client's own
-- hostname since docs/2026-08-21-hub-analytics.sql.
--
-- ‼️ A session id ON THIS TABLE IS FORBIDDEN AND IT IS NOT AN OVERSIGHT. docs/2026-08-18-client
-- -hub.sql says of review_tool_submissions: "NO NAME, EMAIL, PHONE, IP, USER AGENT, SESSION ID OR
-- DEVICE FINGERPRINT... THE ABSENCE OF THE COLUMN IS THE ENFORCEMENT... Adding one of these
-- columns later is a spec violation, not a feature." That is why the funnel is built from ROW
-- STATE (how far this row got) rather than by joining page views to submissions. It is a weaker
-- measurement and it is the one we are allowed to take.
--
-- ‼️ AND THERE IS NO RATING DIMENSION, DELIBERATELY. review_tool_submissions.rating is captured
-- and never routed, and scripts/_probe-review-gating.ts fails the build if any code path branches
-- on it. "Conversion by star rating" is one short step from showing the public link to happy
-- patients and a private box to unhappy ones, which is the gating funnel this whole feature
-- refuses to be and which Google prohibits outright. The columns below cannot answer that
-- question and that is intentional.

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. The walk's own progress, on the row it already writes
-- ═════════════════════════════════════════════════════════════════════════════
--
-- ‼️ THE ROW IS NOW CREATED AT HER FIRST ANSWER AND NOT AT THE END. That is what makes an
-- abandoned walk countable at all, and it is the behaviour change this migration pays for. It has
-- one consequence that must not be discovered later: anything counting rows in this table is now
-- counting attempts rather than reviews. weekly-report.ts is the one such reader and it moves to
-- `completed_at is not null` in the same release.

alter table public.review_tool_submissions
  add column if not exists last_step text;

alter table public.review_tool_submissions
  add column if not exists completed_at timestamptz;

alter table public.review_tool_submissions
  add column if not exists copied_edited boolean not null default false;

alter table public.review_tool_submissions
  add column if not exists regenerate_count smallint not null default 0;

comment on column public.review_tool_submissions.last_step is
  'The furthest step id she reached, from REVIEW_SCRIPT in src/lib/hub/review-script.ts. The step '
  'ORDER lives in that array and never here, so a reordered walk needs no migration. '
  'Deliberately not a foreign key and not constrained: a stored row must stay readable after a '
  'step is renamed or removed, and an unrecognised id folds into "unknown" rather than failing a '
  'read. NOTHING BRANCHES ON IT; it is counted.';

comment on column public.review_tool_submissions.completed_at is
  'When she reached her finished review. NOT when she posted one: no code path can observe a '
  'Google review being published, which is what posted_destination says in its own comment. This '
  'is the honest denominator for "did the walk work", and it is what separates a review from an '
  'abandoned attempt now that the row is created at her first answer.';

comment on column public.review_tool_submissions.copied_edited is
  'Whether she changed the review box before copying. Two things at once: a measurement of how '
  'often our joining needs fixing, and evidence that she read what she was posting. False is '
  'ordinary and is not a complaint about her.';

comment on column public.review_tool_submissions.regenerate_count is
  'How many times she pressed "Try another wording". 0 means the first wording was fine. Each '
  'press re-runs a pure function over a table of literals (CARRIES in review-assemble.ts); it '
  'reaches no model and no network, and cannot change a word she typed. A high number here means '
  'our connectives read badly, which is a fact about us and not about her.';

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. The reads, aggregated in Postgres
-- ═════════════════════════════════════════════════════════════════════════════
--
-- ‼️ AGGREGATE HERE, NORMALISE IN TYPESCRIPT, AND NEVER BOTH. docs/2026-08-21-hub-analytics.sql
-- states the reason and it is worth repeating: PostgREST applies a server-side row ceiling, so a
-- raw select would silently return the newest N rows and draw a plausible, wrong chart. An
-- undercount that looks right is worse than an error. Folding the step ORDER in afterwards is the
-- right half to do in JS, because the order is declared in REVIEW_SCRIPT and not here.

create or replace function public.review_walk_funnel(
  p_client_id uuid,
  p_from date,
  p_to date
) returns table (
  last_step text,
  n bigint,
  completed bigint,
  edited bigint,
  regenerated bigint
)
language sql
stable
as $$
  select
    coalesce(nullif(trim(s.last_step), ''), 'unknown') as last_step,
    count(*)::bigint as n,
    count(s.completed_at)::bigint as completed,
    count(*) filter (where s.copied_edited)::bigint as edited,
    count(*) filter (where s.regenerate_count > 0)::bigint as regenerated
  from public.review_tool_submissions s
  where s.client_id = p_client_id
    and s.created_at >= p_from::timestamptz
    and s.created_at < ((p_to::date) + 1)::timestamptz
  group by 1
$$;

comment on function public.review_walk_funnel(uuid, date, date) is
  'One row per last_step reached, for one client in one window. The caller folds these into '
  'REVIEW_SCRIPT order to get "reached step S" as a running total. Inclusive of p_to.';

-- The invite and the claim, which needed no new columns at all.
--
-- ‼️ IT COUNTS STATES AND NEVER NAMES ANYBODY. referral_invites holds a friend's name and number,
-- given second hand by a patient at a counter about somebody who agreed to nothing, and
-- scripts/_probe-referral-invite.ts allows those two columns to be mentioned in exactly two route
-- files. This function reads neither, and no caller of it can.
create or replace function public.referral_funnel(
  p_client_id uuid,
  p_from date,
  p_to date
) returns table (
  channel text,
  invites bigint,
  sent bigint,
  claimed bigint
)
language sql
stable
as $$
  select
    coalesce(nullif(trim(i.channel), ''), 'unknown') as channel,
    count(*)::bigint as invites,
    count(i.sent_at)::bigint as sent,
    count(i.claimed_at)::bigint as claimed
  from public.referral_invites i
  where i.client_id = p_client_id
    and i.created_at >= p_from::timestamptz
    and i.created_at < ((p_to::date) + 1)::timestamptz
  group by 1
$$;

comment on function public.referral_funnel(uuid, date, date) is
  'Invites minted, got as far as her keyboard, and claimed by the friend, per channel. sent_at is '
  'NOT a delivery confirmation: we are not the sender and cannot know. Counts states only; it '
  'reads no friend_name and no friend_contact.';

-- ─────────────────────────────────────────────────────────────────────────────
-- ‼️ THE GRANTS. Without this block the tables' RLS is decorative.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- PostgREST exposes every function in `public` to `anon` by default, and a function READS THROUGH
-- RLS regardless of the policies on the table underneath it. NEXT_PUBLIC_SUPABASE_ANON_KEY is, by
-- its own name, public. Without the revoke, anybody holding it could read any client's patient
-- reviews and referral counts by passing a uuid. Same block, same reason, as hub-analytics.
do $grants$
declare fn text;
begin
  foreach fn in array array[
    'public.review_walk_funnel(uuid, date, date)',
    'public.referral_funnel(uuid, date, date)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $grants$;

-- =====================================================================
-- Verification
-- =====================================================================
--
-- ‼️ WRITTEN TO BE ABLE TO FAIL. Every line below must come back true. `anon_cannot_execute` is
-- the one that matters most: if it is false, a public key reads every clinic's patient reviews.
select
  (select count(*) = 4 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'review_tool_submissions'
       and column_name in ('last_step', 'completed_at', 'copied_edited', 'regenerate_count'))
    as four_columns_exist,
  (select count(*) = 2 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('review_walk_funnel', 'referral_funnel'))
    as both_functions_exist,
  (select not has_function_privilege('anon', 'public.review_walk_funnel(uuid, date, date)', 'execute'))
    as anon_cannot_execute,
  (select has_function_privilege('service_role', 'public.review_walk_funnel(uuid, date, date)', 'execute'))
    as service_role_can_execute,
  -- Existing rows keep their meaning: every one of them predates the columns, so none of them
  -- claims to have been completed and none claims an edit.
  (select count(*) = 0 from public.review_tool_submissions where completed_at is not null)
    as no_backdated_completions,
  (select count(*) from public.review_tool_submissions) as rows_today;
