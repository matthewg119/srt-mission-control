-- The referral emails: two addresses people give us themselves, and the settings that gate them.
--
-- Run against prod Supabase. Safe to run twice; every statement is idempotent.
--
-- ‼️ RUN docs/2026-10-05-referral-invites.sql FIRST. It creates referral_invites, which this file
-- only adds columns to. That file is ALSO still unrun as of 2026-10-05, so on a fresh database the
-- order is: invites, then this.
--
-- ‼️ AND RUN BOTH BEFORE THE DEPLOY. src/app/api/hub/reviews/claim/route.ts now names
-- referrer_email and claimed_email in its select list, and PostgREST fails the WHOLE select on one
-- unknown column. Unlike referral-config.ts, which catches 42P01 and degrades to "no referral",
-- that select is the claim page's only read: without these columns a friend holding a link gets
-- "this link is not open any more", which is indistinguishable from an expired code and therefore
-- invisible as a fault.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ‼️ WHY TWO MORE CONTACT COLUMNS ARE ALLOWED HERE, WHEN THE WHOLE LANE IS BUILT ON NOT HAVING
-- THEM.
--
-- docs/2026-10-05-referral-invites.sql argues that review_tool_submissions must never gain a name,
-- an email, a phone, an IP or a session id, and that referral_invites is the one table in this
-- lane that holds a person's contact details. Both still hold: everything below is on
-- referral_invites and review_tool_submissions gains nothing, so "it holds nothing that identifies
-- the customer who wrote a review" stays literally true of that table.
--
-- What is new is the SOURCE of the detail, and it is the opposite of friend_contact's.
-- friend_contact is hearsay: a patient recited her friend's number at a counter and the friend had
-- agreed to nothing, which is exactly why nothing in this repo messages it. Both columns below are
-- typed by their own owner, knowingly:
--
--   claimed_email   the friend types it on /r/{code}, on the clinic's own domain, under a line
--                   saying the clinic will use it to contact them about this offer and nothing
--                   else. That page's header already calls itself "THE ONE PLACE A PERSON GIVES
--                   US THEIR OWN DETAILS".
--   referrer_email  the patient types her own at the invite step, under a line saying it buys her
--                   one message when her friend comes in.
--
-- So the rule that survives is not "no contact details". It is: WE WRITE TO PEOPLE WHO GAVE US
-- THEIR OWN ADDRESS FOR THIS, AND TO NOBODY ELSE. src/lib/hub/referral-emails.ts is the only
-- module that sends, and it reads these two columns and never friend_contact.
--
-- ‼️ SRT IS STILL NOT THE SENDER OF THE TEXT. referral-invite.ts has no network call and
-- scripts/_probe-referral-invite.ts fails the build if one appears. The emails are a different
-- channel with a different consent story, and adding them changed nothing about the message the
-- patient sends from her own phone.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ── What the friend types, when a clinic has asked us to confirm it to them ─────────────────────
alter table public.referral_invites
  add column if not exists claimed_email text;

comment on column public.referral_invites.claimed_email is
  'The friend''s own email, typed by them on the claim form at /r/{code}.

   ‼️ SEPARATE FROM claimed_contact ON PURPOSE, AND NOT A DUPLICATE OF IT. claimed_contact is one
   free-text box labelled "Phone or email", because a friend standing in a car park should be able
   to leave whichever they have. Sniffing that field for an "@" is not validation: a wrong guess
   means a confirmation sent to something that was never an address, or not sent at all with
   nothing recording why. This column only ever holds a value that passed oneEmail() in
   src/lib/hub/referral-config.ts.

   ‼️ AND THE FIELD IS ONLY SHOWN WHEN THE CLINIC HAS review_workflow.referral_email.email_friend
   SET. A form that asks for an address nothing uses is a form asking for something it does not
   need, which is the one thing this page cannot afford to do.';

-- ── What the patient types about herself ───────────────────────────────────────────────────────
alter table public.referral_invites
  add column if not exists referrer_email text;

comment on column public.referral_invites.referrer_email is
  'The PATIENT''s own email, typed by her at the invite step. Optional, and null is ordinary.

   It buys exactly one message: when her friend claims, she is told the reward she has earned.
   Nothing chases her, nothing reminds her, and there is no cron anywhere near it, for the same
   reason expires_at has no reminder.

   ‼️ IT IS WRITTEN BY src/app/api/hub/reviews/invite/route.ts AND BY NOTHING ELSE, which is the
   same single-writer rule friend_name and friend_contact live under and which
   scripts/_probe-referral-invite.ts enforces by grepping all of src/ and allowing exactly one
   file per column.

   ‼️ THE MESSAGE IT ENABLES IS ABOUT THE REFERRAL AND NEVER ABOUT WHAT SHE WROTE. Her reward is
   earned when her friend turns up; tying it to an endorsement is what FTC disclosure rules reach
   and what clients.review_incentive_flag exists to flag. src/lib/hub/referral-emails.ts does not
   contain the word for what she writes anywhere in its copy, and
   scripts/_probe-review-gating.ts fails the build if a discount, an offer, a percentage or a code
   appears within eighty characters of it.';

-- ── The settings, which need no schema change ──────────────────────────────────────────────────
--
-- ‼️ NO ALTER, THE SAME CALL docs/2026-10-05-referral-invites.sql AND
-- docs/2026-09-24-review-question-set-v4.sql BOTH MADE. `clients.review_workflow` already holds
-- intake step 4's ten keys, six destination URLs and the referral settings; one more nested object
-- fits where a column would be one more thing to maintain. What does need writing down is the
-- SHAPE, because it lives in TypeScript and a reader with psql open has no other way to find it.
--
-- ‼️ AND THIS REPLACES A COMMENT THAT HAD GONE STALE BEFORE IT WAS EVER APPLIED. The version in
-- docs/2026-10-05-referral-invites.sql describes `referral_offer` as two keys, `default_offer` and
-- `send_mode` with values "device" and "clinic". The shipped code writes THREE, and the
-- send_mode/device/clinic vocabulary exists nowhere in src/: it became
-- `mode` with values "text" and "internal" on the same day, and _probe-referral-invite.ts now
-- actively asserts that the string "clinic" is absent from that module. Corrected here rather than
-- left for somebody to read as current.
comment on column public.clients.review_workflow is
  'Intake step 4''s answers, the six destination URLs, and the referral settings.

   MERGED, NEVER REPLACED. It owns ten intake keys (asks, who, when, tool, booking_software,
   volume, destinations, incentive, lobby_tablet, blockers) plus google_url, yelp_url,
   trustpilot_url, bbb_url, facebook_url and realself_url. Any writer that assigns the whole bag
   deletes the client''s own intake answers, which is why /api/clients/[id]/review-workflow and
   mergeWorkflow() in src/lib/clients/referral-setup.ts both spread before they write.

   `referral_offer` (2026-10-05) is an object with three keys:
     default_offer           text. What a referred friend gets when the service she named is not in
                             client_service_offers. With no per-service row AND no default, the
                             recommend question and the invite are NOT ASKED: a clinic with no deal
                             on file must not be made to promise one.
     default_referrer_offer  text. What the PATIENT gets, earned when the friend comes in. Clearing
                             this does NOT turn the referral off: a clinic rewarding only the friend
                             is an ordinary and complete configuration.
     mode                    "text" or "internal". "text" opens a message on the patient''s own
                             phone with the clinic on the thread; "internal" sends nothing and
                             hands the clinic a lead. BOTH are fully built and NEITHER has SRT as
                             the sender. There is deliberately no mode in which a server sends,
                             and scripts/_probe-referral-invite.ts fails the build if one appears.

   `referral_email` (2026-10-05) is an object with seven keys, and EVERY BOOLEAN DEFAULTS TO FALSE:
     enabled         boolean. Master switch. False means this lane sends nothing for this client
                     whatever else is set.
     notify_clinic   boolean. The clinic hears when a referral is made, and again when it is
                     claimed.
     email_friend    boolean. The friend gets a confirmation, at the address THEY typed on the
                     claim form. Also what makes that field appear at all.
     email_referrer  boolean. The patient hears that her friend came in and her reward is due.
     notify_to       text. Where the clinic''s own notices go. Falls back to clients.email.
     from_mailbox    text. Which SRT mailbox sends. Validated against the outreach rotation in
                     src/config/outreach-mailboxes.ts and falls back to the connected account,
                     because a typo here would stop every send for this client with no error
                     anywhere.
     reply_to        text. The clinic''s address, so a reply reaches them.

   ‼️ SRT IS THE ENVELOPE SENDER OF ALL OF THEM AND THE COPY SAYS SO. Graph''s
   /users/{mailbox}/sendMail only reaches mailboxes inside SRT''s own tenant that the delegated
   token holds Send-As on, so a clinic''s address can never be the From. reply_to is what puts the
   clinic on the other end, and every message that reaches a member of the public states that the
   clinic asked us to send it. A genuine from-the-clinic send needs a separate sending domain and a
   per-client delegation record, and nothing in this schema claims otherwise.

   ‼️ `incentive` IS A DIFFERENT THING AND STILL MEANS WHAT IT MEANT. It asks whether the clinic
   offers anything in exchange for A REVIEW, sets review_incentive_flag, and is still a problem to
   be talked out of. The referral offer is consideration for a REFERRAL: it goes to the friend, it
   is shown before she has written a word, and it is conditional on nothing she writes.
   scripts/_probe-review-gating.ts fails the build if any copy ties the two together.';

-- ── Verify ─────────────────────────────────────────────────────────────────────────────────────
--
-- select column_name, data_type
--   from information_schema.columns
--  where table_schema = 'public'
--    and table_name = 'referral_invites'
--    and column_name in ('claimed_email', 'referrer_email')
--  order by column_name;
--
-- Expect two rows, both text. Nothing in this file writes data, so there is nothing to count.
