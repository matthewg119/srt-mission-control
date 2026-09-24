-- A workflow that is not about one client needs somewhere to live.
--
-- Additive, idempotent, safe to run more than once.
-- Runner: bun run scripts/db.ts --file=docs/2026-09-26-ops-workflow-runs.sql [--dry]
--
-- ‼️ WHY NOT JUST MAKE client_workflow_runs.client_id NULLABLE. It is one ALTER and it is the wrong
-- one, for four reasons:
--
--  1. THE COMMENT ON THAT TABLE SAYS "One run of one workflow for one client." Widening the column
--     makes that sentence false, and in this repo the comment is how the next person finds out what
--     a table is for.
--  2. workflowRuns() in src/lib/clients/workflows/registry.ts filters .eq("client_id", clientId).
--     Every ops run would be invisible to the only function that lists runs, while every caller
--     believes it lists "the runs". A silent half-table is worse than a missing one.
--  3. `on delete cascade` from clients means nothing for a row with no client. You would have one
--     set of constraints describing two row shapes, and none of them able to say which columns a
--     given shape requires.
--  4. registry.ts's own header already argues the mirror of this: "A client_id stuffed into one of
--     their jsonb blobs would be a client dimension nothing can join on, which is the thing this
--     layer exists to stop." An ops run with a NULL client dimension inside a client-keyed table is
--     the same mistake facing the other way.

create table if not exists public.ops_workflow_runs (
  id uuid primary key default gen_random_uuid(),

  -- The key in OPS_WORKFLOWS. A CODE registry, not a table, for the reason CLIENT_WORKFLOWS gives:
  -- a workflow writes copy that goes out under our name, so it is reviewed and deployed like
  -- everything else that does that.
  workflow_key text not null,

  -- The same three states client_workflow_runs uses, deliberately identical so one renderer serves
  -- both and a third vocabulary cannot appear.
  status text not null default 'running' check (status in ('running', 'done', 'failed')),

  inputs jsonb not null default '{}'::jsonb,
  output jsonb,
  error text,

  -- Free text, matching client_workflow_runs.requested_by. NOT a users FK: users.role is an auth
  -- flag and no work row in this system joins to a user. Inventing that join here would make this
  -- the only table that does.
  requested_by text,

  -- Where the outcome was posted, so a re-render edits rather than reposts.
  slack_channel text,
  slack_ts text,

  started_at timestamptz not null default now(),
  finished_at timestamptz
);

-- ‼️ NO FOREIGN KEYS AT ALL, AND THAT IS THE POINT OF THE TABLE. An ops workflow is about the
-- business, not about one row somewhere. The day one needs a subject, it is a field on THAT
-- workflow's `inputs`, not a nullable FK that half the rows ignore.

create index if not exists ops_workflow_runs_started_idx
  on public.ops_workflow_runs (started_at desc);

create index if not exists ops_workflow_runs_key_idx
  on public.ops_workflow_runs (workflow_key, started_at desc);

-- ‼️ THE ONE THAT MATTERS OPERATIONALLY: a run stuck in 'running'. finishRun's own comment says it
-- out loud, that a row claiming to be working when nothing is working is the failure mode the whole
-- file is careful about. Partial, so it indexes only the handful that can be stuck.
create index if not exists ops_workflow_runs_stuck_idx
  on public.ops_workflow_runs (started_at)
  where status = 'running';

comment on table public.ops_workflow_runs is
  'One run of one workflow that is NOT about a single client. Sibling of client_workflow_runs, not '
  'a widening of it: that table''s client_id is NOT NULL and its only lister filters on it. Drafts '
  'only. Nothing here sends, publishes or touches a property anyone else controls.';

alter table public.ops_workflow_runs enable row level security;

-- ── Verify ─────────────────────────────────────────────────────────────────
select column_name, data_type, is_nullable
  from information_schema.columns
 where table_name = 'ops_workflow_runs'
 order by ordinal_position;

-- client_workflow_runs.client_id must STILL be NO. If this says YES, something widened it and the
-- argument at the top of this file was lost.
select column_name, is_nullable
  from information_schema.columns
 where table_name = 'client_workflow_runs' and column_name = 'client_id';

select status, count(*) from public.ops_workflow_runs group by 1;
