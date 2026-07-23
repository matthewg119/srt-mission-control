-- SRT Audit Engine v2 — AI-search-visibility audits triggered by /audit in Slack.
-- See: src/lib/audit-engine/*, src/app/api/audit/*, src/app/r/[slug]/page.tsx
--
-- NO FABRICATED DATA RULE: audit_runs.mentioned/raw_response must reflect a real
-- engine call. A failed/timed-out run is stored with status='no_data', never
-- guessed, never silently dropped. Enforced in src/lib/audit-engine/run-prompts.ts.
-- Safe to re-run.

create table if not exists audit_reports (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null,                       -- short, non-guessable (see slug.ts)
  client_name      text,                                 -- optional, filled in later if known
  website          text not null,
  city             text,                                 -- detected city/region; null only if fallback-asked
  business_type    text,
  vertical_slug    text,                                  -- e.g. "medspa", "hvac" — informational only, never a code branch
  buyer_persona    text,                                  -- one-line "who buys / what hurts"
  competitors      jsonb not null default '[]'::jsonb,    -- [{name, domain, hypothesis: true}]
  prompts          jsonb not null default '[]'::jsonb,    -- the 20 generated {block, prompt} objects
  status           text not null default 'classifying',  -- classifying | awaiting_city | running | done | failed
  score            int,                                   -- 0-100, null until done
  requested_by     text,                                  -- Slack user_id
  slack_channel_id text,                                  -- #ai-visibility-audits channel id (cached)
  slack_thread_ts  text,                                   -- first post ts, for threaded follow-ups
  error            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index if not exists audit_reports_slug_uidx on audit_reports (slug);
create index if not exists audit_reports_status_idx on audit_reports (status);

create table if not exists audit_runs (
  id            uuid primary key default gen_random_uuid(),
  report_id     uuid not null references audit_reports(id) on delete cascade,
  block         text not null,                     -- SERVICIO | COMPARATIVO | INFO | MARCA
  prompt        text not null,
  engine        text not null,                      -- openai | perplexity
  mentioned     boolean,                            -- null until run completes; false = ran but no mention
  status        text not null default 'pending',    -- pending | ok | no_data
  raw_response  text,                                -- FULL, untruncated response body (never truncate at capture)
  citations     jsonb not null default '[]'::jsonb,
  recommended   jsonb not null default '[]'::jsonb,  -- 0-5 business/provider names extracted from raw_response (see extract-recommended.ts)
  attempt       int not null default 1,              -- 1 or 2 (one retry per prompt/engine)
  latency_ms    int,
  error         text,
  created_at    timestamptz not null default now()
);

create index if not exists audit_runs_report_idx on audit_runs (report_id);
create index if not exists audit_runs_report_engine_idx on audit_runs (report_id, engine);

-- RLS: single-tenant app, no Supabase Auth users — server always reads/writes via
-- supabaseAdmin (service_role), which bypasses RLS anyway. Lock down anon/authenticated
-- the same way every other table in this project is locked down.
alter table audit_reports enable row level security;
alter table audit_runs    enable row level security;

drop policy if exists "Service role full access" on audit_reports;
create policy "Service role full access" on audit_reports for all to service_role using (true) with check (true);
drop policy if exists "Service role full access" on audit_runs;
create policy "Service role full access" on audit_runs for all to service_role using (true) with check (true);

revoke all on audit_reports from anon, authenticated;
revoke all on audit_runs    from anon, authenticated;
