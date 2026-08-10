-- Call Coach lead context + post-call wrap, and the Outlook truth cache.
-- Add-only. Safe to run more than once.
--
-- Two things happen here:
--
-- 1. `call_coach_sessions` grows the identity of who was on the phone and the state of the
--    post-call wrap. It is extended rather than sidecarred because there is already exactly one
--    row per call, `call_coach_transcripts` is already keyed to it, and the session id is already
--    the token the extension carries end to end. Same precedent as `loom_state` /
--    `auto_send_state` living on `audit_reports`.
--
-- 2. `audit_reports` gains a 10-minute cache of what Outlook actually says about the thread.
--    `outreach_stage` only moves when someone types a command, so it drifts; the mailbox does not.

-- ── 1. Who was on the call ─────────────────────────────────────────────────
alter table call_coach_sessions
  add column if not exists zoho_module          text,
  add column if not exists zoho_record_id       text,
  add column if not exists contact_id           uuid,
  add column if not exists audit_report_id      uuid,
  add column if not exists business_name        text,
  add column if not exists person_name          text,
  add column if not exists prospect_email       text,
  add column if not exists prospect_phone       text,
  add column if not exists call_type            text,
  add column if not exists identify_confidence  text,
  add column if not exists identify_source      text,
  add column if not exists brief_text           text;

-- ── 2. The post-call wrap ──────────────────────────────────────────────────
-- wrap_state is a CLAIM flag, not a status label: the 👍 handler flips
-- pending -> writing with a conditional update BEFORE it calls Zoho or Graph, so the button, a
-- retry and a duplicate CALL_ENDED can all race and only one note is ever written.
alter table call_coach_sessions
  add column if not exists wrap                 jsonb,
  add column if not exists wrap_state           text,
  add column if not exists wrap_error           text,
  add column if not exists slack_channel        text,
  add column if not exists slack_thread_ts      text,
  add column if not exists wrap_card_ts         text,
  add column if not exists zoho_note_at         timestamptz,
  add column if not exists draft_message_id     text,
  add column if not exists draft_web_link       text;

-- Resolved by button value AND by the card's own message ts, so both paths are indexed.
create index if not exists idx_ccs_zoho_record on call_coach_sessions(zoho_record_id);
create index if not exists idx_ccs_wrap_card   on call_coach_sessions(wrap_card_ts);
create index if not exists idx_ccs_wrap_state  on call_coach_sessions(wrap_state);

-- ── 3. The Outlook truth cache ─────────────────────────────────────────────
alter table audit_reports
  add column if not exists thread_truth    jsonb,
  add column if not exists thread_truth_at timestamptz;

-- ── 4. Lock it down, same convention as every other table here ─────────────
alter table call_coach_sessions enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'call_coach_sessions' and policyname = 'service_role_all_ccs'
  ) then
    create policy service_role_all_ccs on call_coach_sessions
      for all to service_role using (true) with check (true);
  end if;
end $$;

revoke all on call_coach_sessions from anon, authenticated;
