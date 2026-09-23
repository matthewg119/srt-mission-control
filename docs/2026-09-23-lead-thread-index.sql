-- The #hot-leads thread lane (src/lib/leads/thread-reply.ts) routes on
-- contacts.slack_thread_ts, which is the REVERSE of every existing read. Everything
-- written before today goes contact -> thread (lead-thread.ts selects slack_thread_ts
-- by id); the lane goes thread -> contact, on every message typed in that channel.
-- Without this index that is a sequential scan of contacts per keystroke-batch.
--
-- PARTIAL: postOrThreadLeadUpdate inserts the contact with slack_thread_ts NULL and
-- updates it a moment later once Slack answers, so the overwhelming majority of rows
-- are null and must not collide with each other.
--
-- UNIQUE: two contacts sharing one thread ts would make handleLeadThreadReply pick one
-- of them at random and then run an audit, a draft or a Loom against the wrong business.
-- Same doctrine, and the same reason, as audit_reports_slack_thread_ts_uidx in
-- docs/2026-07-30-audit-thread-unique.sql.
--
-- If this fails on a duplicate, find them first:
--   select slack_thread_ts, count(*), array_agg(id)
--   from public.contacts
--   where slack_thread_ts is not null
--   group by slack_thread_ts having count(*) > 1;

create unique index if not exists contacts_slack_thread_ts_uidx
  on public.contacts (slack_thread_ts)
  where slack_thread_ts is not null;
