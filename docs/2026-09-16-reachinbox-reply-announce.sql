-- The webhook announces a reply in #vektor-email-director, exactly once.
--
-- WHY A COLUMN AND NOT JUST "POST IT WHEN THE ROW INSERTS"
-- ReachInbox retries any webhook it did not get a 200 from. Two things follow. A retry that lands
-- while the first attempt is still talking to Slack would post the same reply into the thread
-- twice; and a first attempt that inserted the row and then died before Slack would, without a
-- retry path, lose the notification entirely. The receiver therefore always re-attempts the
-- announcement on a duplicate, and this column is what makes re-attempting free: the claim is a
-- conditional UPDATE ... WHERE announced_at IS NULL, so the database picks one winner.
--
-- !! NULLABLE AND WITHOUT A DEFAULT, ON PURPOSE. Every row already in the table predates this
-- lane. A default of now() would mark them announced, which is harmless today at 0 rows but lies
-- about history; a NOT NULL would have needed a backfill value that means nothing.
--
-- Safe to run before or after the deploy: announce.ts treats an undefined-column error (42703) as
-- "announce anyway", so the feature degrades to at-least-once delivery rather than to silence.

alter table public.reachinbox_events
  add column if not exists announced_at timestamptz;

comment on column public.reachinbox_events.announced_at is
  'When this event was announced in #vektor-email-director. Only replies are ever announced; the claim is a conditional update so a provider retry cannot double-post.';

-- Partial, because the only question ever asked of this column is "which replies still owe an
-- announcement". Sent and opened rows are the bulk of the table and are never announced, so
-- indexing them would be paying for rows the query excludes by definition.
create index if not exists reachinbox_events_unannounced_idx
  on public.reachinbox_events (occurred_at desc)
  where event_type = 'replied' and announced_at is null;

-- Verification. Autocommit per statement (scripts/db.ts) means a failure here cannot roll back the
-- DDL above; see the note in that file about the Supabase editor doing the opposite.
select
  count(*) filter (where event_type = 'replied')                            as replies,
  count(*) filter (where event_type = 'replied' and announced_at is null)   as replies_unannounced
from public.reachinbox_events;
