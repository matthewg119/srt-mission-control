-- Why outreach_touches has been empty since it was created.
--
-- logTouch() upserted with `onConflict: graph_message_id` against a PARTIAL unique index
-- (`where graph_message_id is not null`, docs/2026-07-31-followup-operator.sql:108). Postgres
-- cannot infer a partial unique index unless ON CONFLICT repeats the predicate, and PostgREST
-- does not emit one. So every single call failed with SQLSTATE 42P10, was swallowed at
-- prospects.ts:177, and returned false. In sent-sweep.ts false means "already seen", so
-- recordOutbound() never ran either.
--
-- Live result: 0 touches, and 93 prospects with no ladder state at all (first_sent_at,
-- conversation_id, last_message_id, thread_subject, next_touch_at all 0/93), for three weeks,
-- with the cron reporting success the entire time.
--
-- The key was also the wrong SHAPE, in two ways:
--
--   1. One email addressed to two people at the same business is two prospects and two logTouch
--      calls carrying ONE graph message id. A single-column key advances one ladder and silently
--      drops the other. Idempotency here is per (message, prospect).
--
--   2. Graph message ids are PER MAILBOX. As soon as outbound rotates between matthew@ and
--      submissions@, the same email has a different `id` in each mailbox and one RFC5322
--      Message-ID. Probed against the live mailbox on 2026-08-20: Exchange stamps
--      internetMessageId at DRAFT CREATION, and the Sent Items copy carries the same value.
--      So internet_message_id is the identity and graph_message_id is just the handle used
--      to reply. message_key prefers the first and falls back to the second.
--
-- ADD ONLY. Safe to re-run.

alter table outreach_touches
  add column if not exists internet_message_id text;

-- Which mailbox this left from or arrived in. A REAL column, not metadata->>'mailbox':
-- it is grouped by, per day, on every draft decision and every queue tick, and a jsonb
-- extraction cannot be indexed usefully for that. It is also what the nudge sender reads to
-- reply FROM the mailbox the original left from, rather than from whichever mailbox happens
-- to be in rotation today. NULL on historical rows and on non-email touches; readers treat
-- NULL as the connected account.
alter table outreach_touches
  add column if not exists mailbox text;

alter table outreach_touches
  add column if not exists message_key text
  generated always as (coalesce(internet_message_id, graph_message_id)) stored;

comment on column outreach_touches.message_key is
  'The idempotency key: the RFC5322 Message-ID when we have it, else the per-mailbox Graph id. Generated, so a writer cannot set it wrong. NULL for calls, notes and SMS, and NULL never conflicts with anything.';

-- The old key. Partial, single-column, and uninferrable by PostgREST. Dropping it IS the fix.
-- The table is empty, so there is nothing to de-duplicate first.
drop index if exists outreach_touches_graph_uidx;

-- NON-PARTIAL on purpose. That is the entire point: a non-partial unique index is inferrable
-- from `ON CONFLICT (message_key, prospect_id)`, and rows where message_key is NULL are all
-- distinct under the SQL standard, so the partial predicate bought nothing except the bug.
create unique index if not exists outreach_touches_msgkey_uidx
  on outreach_touches (message_key, prospect_id);

-- The daily budget query: outbound email per mailbox since the start of the Eastern day.
-- occurred_at leads because the day range is the selective half.
create index if not exists outreach_touches_mailbox_day_idx
  on outreach_touches (occurred_at desc, mailbox)
  where direction = 'outbound' and channel = 'email';

-- Reply detection matches on conversation first. outreach_prospects already has this index;
-- the touch log did not.
create index if not exists outreach_touches_conv_idx
  on outreach_touches (conversation_id) where conversation_id is not null;

-- Verification.
select column_name, data_type, is_generated
  from information_schema.columns
 where table_name = 'outreach_touches'
   and column_name in ('internet_message_id','mailbox','message_key','graph_message_id')
 order by column_name;

select indexname from pg_indexes
 where tablename = 'outreach_touches'
 order by indexname;
