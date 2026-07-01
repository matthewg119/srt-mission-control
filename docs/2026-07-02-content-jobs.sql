-- Unified content-job state (Content Engine v2 — one pipeline).
--
-- Every content format (bug-reveal, POV, B-roll, jumpscare, reel studio, ...) used to keep
-- its OWN state table (bug_reveal_jobs, pov_studio_jobs, reel_studio_jobs, reel_drops). That is
-- why adding a format meant adding a table + a handler + a Slack-router branch. This one table
-- backs the single pipeline runner (src/lib/reel/pipeline.ts): a format is now a row in the
-- code registry (src/config/format-registry.ts), and every drop is a row here.
--
-- The pipeline stages map 1:1 to the reaction gates:
--   ideate  -> ideas posted, awaiting ✅ (generate) / 🚫 (skip)
--   shot    -> images posted, awaiting 1️⃣/2️⃣/3️⃣ pick
--   build   -> working (add reveal / write copy)
--   done | skipped | error
--
-- `data` (jsonb) holds the moving parts (scene ideas, generated shot options + urls, the chosen
-- shot, the after-frame url, and the final copy) so no per-format columns are ever needed again.
--
-- Legacy per-format tables are intentionally NOT dropped here — they keep any in-flight legacy
-- jobs alive. A follow-up migration drops them once every format is ported and verified.

create table if not exists content_jobs (
  id uuid primary key default gen_random_uuid(),
  format_id text not null,                 -- FK to the code registry, e.g. 'bug_reveal'
  vertical_id text not null default 'pest_control',
  slack_channel text,
  slack_thread_ts text,
  picker_msg_ts text,                      -- the message the operator reacts on (self-routing key)
  stage text not null default 'ideate',    -- ideate | shot | build | done | skipped | error
  source_kind text default 'scratch',      -- scratch | reference
  data jsonb not null default '{}'::jsonb,
  status text not null default 'active',   -- active | done | skipped | error
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Self-routing lookups: reactions arrive keyed by the reacted message ts; thread replies key by
-- the parent thread ts (most-recent job wins).
create index if not exists content_jobs_picker_ts_idx on content_jobs (picker_msg_ts);
create index if not exists content_jobs_thread_idx on content_jobs (slack_thread_ts, created_at desc);
create index if not exists content_jobs_format_idx on content_jobs (format_id, created_at desc);
