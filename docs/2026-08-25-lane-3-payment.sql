-- Payment recorded: what unlocks delivery step 21.
--
-- Matthew: "After we receive the payment it unlocks step 21 for GBP manager search console etc."
-- His chosen mechanism: he ticks it, with a note. No Stripe, no webhook, no charge.
--
-- ‼️ THIS IS AN ASSERTION THE BOARD RECORDS. IT IS NOT EVIDENCE OF A CHARGE.
--
-- It is exactly the distinction `clients.day_0_source` already draws between 'photograph_2' (a
-- real archived run wrote it) and 'manual_step' (a human ticked a box, which is an assertion
-- that the thing happened rather than evidence of it). Nothing in this application talks to a
-- payment processor, so nothing here can observe money moving.
--
-- Consequence, and it is enforced in code and asserted by the test suite: every surface that
-- reads these columns says "payment recorded by {who} on {date}". None of them says
-- "payment received", and none of them may.
--
-- `billing_status` already exists and reads 'pilot' on the live client. It is untouched: it
-- answers what KIND of arrangement this is, and these four answer whether somebody has said the
-- money side is agreed. A pilot client can have a card on file.
--
-- Add-only. Nothing is dropped, nothing is backfilled, and a client with all four null is the
-- normal state of every row that exists today.

alter table public.clients
  add column if not exists payment_recorded_at timestamptz,
  add column if not exists payment_recorded_by text,
  add column if not exists payment_terms       text,
  add column if not exists payment_note        text;

comment on column public.clients.payment_recorded_at is
  'When a human RECORDED that payment is arranged. An assertion, not a receipt: nothing here '
  'talks to a payment processor. Same doctrine as day_0_source = manual_step. Never render this '
  'as "payment received".';

comment on column public.clients.payment_recorded_by is
  'Who made the assertion, from the signed-in session. Printed beside the date everywhere it is '
  'read, because an unattributed assertion is indistinguishable from an observation.';

comment on column public.clients.payment_terms is
  'What was agreed, in words. Required to record: a payment with no stated terms is a tick, and '
  'a tick is what this design exists to refuse.';

comment on column public.clients.payment_note is
  'Optional. Whether a card is on file, what is still outstanding, anything the next person '
  'needs. Free text.';

-- Step 21 (access_granted) refuses while payment_recorded_at is null. The gate lives in
-- src/lib/clients/step-verify.ts's `access_granted` verifier, because setDeliveryStep runs
-- verifyStep before the row write on EVERY surface; step-engine.ts's stepPrecondition carries
-- the same refusal so the Slack button answers at the press rather than after the cascade.
--
-- Reason, stated rather than implied: technical access is collected after the commitment. A
-- client who has not committed does not hand over their Google account, and asking early is how
-- a call ends with neither.
