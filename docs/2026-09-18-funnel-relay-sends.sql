-- Log every send through /api/notify/funnel, the public email relay for srtagency.com.
--
-- WHY THIS EXISTS. On 2026-09-18 a script used /api/invisible-lead as an email relay and the
-- site mailed thirteen strangers from matthew@srtagency.com. When the question became "who
-- did we actually mail, and did any of it bounce", there was no answer anywhere: the relay
-- route wrote nothing, and Graph /sendMail answers 202 with an empty body, so there was not
-- even a message id to have stored. Reconstructing it meant reading Sent Items by hand.
--
-- This records OUR SIDE ONLY. It is not delivery confirmation and it never can be. Microsoft
-- pushes no bounce or complaint events, so a row saying 'sent' means Graph accepted it, not
-- that anyone received it. Delivery still lives in message trace.

create table if not exists funnel_relay_sends (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  recipients        text[] not null,
  subject           text not null,
  has_attachment    boolean not null default false,
  attachment_bytes  integer not null default 0,
  status            text not null check (status in ('sent', 'failed')),
  error             text
);

create index if not exists funnel_relay_sends_created_at_idx
  on funnel_relay_sends (created_at desc);

create index if not exists funnel_relay_sends_recipients_idx
  on funnel_relay_sends using gin (recipients);

comment on table funnel_relay_sends is
  'Every send through /api/notify/funnel, the public relay for srtagency.com. Our side only: Graph /sendMail returns 202 with no body, so there is no message id and no delivery confirmation to store. Added 2026-09-18 after the subscription-bombing incident, when nobody could answer who had been mailed. Consider purging rows older than 90 days.';
