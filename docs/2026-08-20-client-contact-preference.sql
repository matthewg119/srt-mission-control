-- How each client wants to be reached, and one phone number instead of three shapes.
--
-- Safe to run more than once.
--
-- WHY THIS EXISTS. Per-client Slack channels were retired on 2026-08-20: single-channel
-- guests are free at 5 per PAID ACTIVE MEMBER, not per channel and not a flat pool, so
-- fifty clients would have meant buying about ten seats purely to unlock guest capacity
-- for a workspace with one human in it. Slack is internal only now. Client conversation
-- is WhatsApp and anything contractual goes by email.
--
-- There is deliberately NO whatsapp_number column. One number, asked once: clients.phone
-- is the NAP number, the SMS number and the WhatsApp number. A second column would be a
-- second thing to keep in step with the first, and the intake question that filled it
-- ("is that number on WhatsApp?") is a question nobody enjoys answering.
--
-- The clients.slack_channel_id / slack_channel_name columns are deliberately NOT dropped.
-- One client (SRT Agency) was provisioned before the reversal and really did have a
-- channel; dropping the columns would lose the record that it ever existed. Nothing
-- writes them any more.

-- ─────────────────────────────────────────────────────────────────────────────
-- contact_preference
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Defaults to whatsapp because that is the channel this whole design is built on. It is
-- a column rather than an assumption so a client who turns out not to use WhatsApp can be
-- moved to sms or email by hand, without a migration and without the drafts guessing.

alter table public.clients
  add column if not exists contact_preference text not null default 'whatsapp';

alter table public.clients
  drop constraint if exists clients_contact_preference_check;
alter table public.clients
  add constraint clients_contact_preference_check
  check (contact_preference in ('whatsapp', 'sms', 'email'));

-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill: every stored phone to E.164
-- ─────────────────────────────────────────────────────────────────────────────
--
-- THE FAILURE THIS CLOSES. Until today every funnel kept whatever the visitor typed, so
-- "+13368332303", "13368332303" and "3368332303" were three different strings for one
-- human. findContact() in src/lib/lead-intake.ts dedupes with an EXACT string match on
-- phone / mobile_phone, so that one person became three contacts, three Zoho leads and
-- three Slack threads. wa.me links have the same problem from the other end: they take
-- digits only, so a stored "(336) 833-2303" builds a link to nowhere.
--
-- From today /onboarding stores E.164. This brings the existing rows across. It mirrors
-- normalizePhone() in src/lib/medspa/validate.ts: strip to digits, drop a leading US 1,
-- accept only a clean 10-digit result. Anything else is LEFT ALONE rather than guessed
-- at or nulled, because a number we cannot parse is still the only number we have.

update public.clients
   set phone = '+1' || regexp_replace(phone, '\D', '', 'g'),
       updated_at = now()
 where phone is not null
   and phone !~ '^\+1\d{10}$'
   and length(regexp_replace(phone, '\D', '', 'g')) = 10;

update public.clients
   set phone = '+' || regexp_replace(phone, '\D', '', 'g'),
       updated_at = now()
 where phone is not null
   and phone !~ '^\+1\d{10}$'
   and length(regexp_replace(phone, '\D', '', 'g')) = 11
   and left(regexp_replace(phone, '\D', '', 'g'), 1) = '1';

-- Read this back before trusting it. Any row whose phone is still not '+1XXXXXXXXXX'
-- needs a human: it was not a parseable US number and nothing has guessed one for it.
--
--   select slug, legal_name, phone, contact_preference,
--          phone ~ '^\+1\d{10}$' as phone_is_e164
--     from public.clients
--    order by created_at desc;
