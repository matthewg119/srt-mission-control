-- Code Guardian: stores proposed fixes pending user approval
create table if not exists code_guardian_fixes (
  id uuid primary key default gen_random_uuid(),
  slack_ts text unique not null,
  slack_channel text not null,
  workflow_name text,
  commit_sha text,
  repo text,
  fix_payload jsonb,
  status text not null default 'pending',  -- pending | applied | skipped | failed
  pr_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists code_guardian_fixes_slack_ts_idx on code_guardian_fixes(slack_ts);
create index if not exists code_guardian_fixes_status_idx on code_guardian_fixes(status);
