-- The #hot-leads thread lane (src/lib/leads/thread-reply.ts) routes on
-- contacts.slack_thread_ts, which is the REVERSE of every read written before it.
-- Everything in lead-thread.ts goes contact -> thread (select slack_thread_ts by id);
-- the lane goes thread -> contact, on every message typed in that channel.
--
-- ‼️ THIS IS ABOUT UNIQUENESS, NOT SPEED. A partial index already exists and has for
-- a while:
--
--   CREATE INDEX idx_contacts_slack_thread_ts ON public.contacts
--     USING btree (slack_thread_ts) WHERE (slack_thread_ts IS NOT NULL)
--
-- so the lookup was already cheap. What it does not give is the guarantee
-- contactByThread depends on: .maybeSingle() ERRORS when two rows come back, and two
-- contacts sharing one thread ts would otherwise make the lane pick a lead at random
-- and then run an audit, a draft or a Loom against the wrong business. Same doctrine,
-- and the same reason, as audit_reports_slack_thread_ts_uidx in
-- docs/2026-07-30-audit-thread-unique.sql.
--
-- PARTIAL, because postOrThreadLeadUpdate inserts the contact with slack_thread_ts
-- NULL and updates it a moment later once Slack answers. 8,285 of 8,439 rows were null
-- when this was written, and they must not collide with each other.
--
-- Verified clean before applying (0 duplicate groups, 154 rows carrying a thread). If
-- it ever fails on a duplicate, find them with:
--
--   select slack_thread_ts, count(*), array_agg(id)
--   from public.contacts
--   where slack_thread_ts is not null
--   group by slack_thread_ts having count(*) > 1;
--
-- The older non-unique index is deliberately left in place. Dropping it is a separate
-- decision from shipping the lane, and a redundant btree on 154 live rows costs
-- nothing worth a second migration.

create unique index if not exists contacts_slack_thread_ts_uidx
  on public.contacts (slack_thread_ts)
  where slack_thread_ts is not null;
