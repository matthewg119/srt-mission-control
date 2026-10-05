-- The in-clinic referral: one deal per service, and the invites they produce.
--
-- Run against prod Supabase. Safe to run twice; every statement is idempotent.
--
-- ‼️ RUN THIS BEFORE THE DEPLOY, NOT AFTER. referral-config.ts selects from
-- client_service_offers on the reviews page's path. It catches the error and degrades to "no
-- referral", so a deploy landing first is survivable here, but the general rule in this repo is
-- the other way round and for a sharp reason: resolve.ts names columns in the hub's HOT-PATH
-- select, and PostgREST fails the WHOLE select on one unknown column. SQL first, always.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ‼️ WHY A FRIEND'S PHONE NUMBER IS IN A NEW TABLE AND NOT IN review_tool_submissions.
--
-- That table was built with deliberately no column for a name, an email, a phone, an IP, a user
-- agent or a session id, and docs/2026-08-18-client-hub.sql says THE ABSENCE OF THE COLUMN IS THE
-- ENFORCEMENT. docs/2026-09-04-review-rating.sql then added a rating, an attestation and a private
-- note and argued, correctly, that none of the three can identify anybody.
--
-- A friend's contact is not in that category. It identifies a specific person, and it is worse
-- than the patient's own details would be: the friend never scanned anything, never used the tool
-- and has agreed to nothing. Putting it on review_tool_submissions would retire that table's
-- no-PII position in a single migration, and every reader of it (page-review.ts pulls quotable
-- lines off `answers`, weekly-report.ts counts rows) would silently become a reader of PII.
--
-- So: a separate table, and THE FOREIGN KEY POINTS FROM THE INVITE AT THE SUBMISSION, never the
-- other way. review_tool_submissions gains no column in this file, which is what keeps the
-- sentence "it holds nothing that identifies the customer who wrote a review" literally true.
--
-- ‼️ AND SRT DOES NOT SEND TO THESE NUMBERS. The patient's own phone composes and sends the
-- message; src/lib/hub/referral-invite.ts has no network call in it and
-- scripts/_probe-referral-invite.ts fails the build if one appears. These rows are the clinic's
-- record of who was referred and which deal was promised. Before anything automated ever texts
-- one of them there has to be a signed BAA and a real consent record, which is what the
-- compliance half of the onboarding sheet exists to collect.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ── One referral deal per service ───────────────────────────────────────────────────────────────
--
-- ‼️ A TABLE AND NOT A review_workflow KEY, WHICH IS THE ONE REAL SCHEMA DECISION HERE.
-- Everything else the Referral Engine knows about a client lives in that jsonb bag, merged and
-- never replaced. A per-service deal does not fit: the onboarding panel edits one service at a
-- time, the grid is orderable, two boards can write it, and "excluded from referrals" is a real
-- state with a real reason. jsonb would have meant read-modify-write on every edit from either
-- board. The CLINIC-WIDE fallback does stay in the bag, under `referral_offer`, because that one
-- genuinely is a single value.
create table if not exists public.client_service_offers (
  id            uuid        primary key default gen_random_uuid(),
  client_id     uuid        not null references public.clients(id) on delete cascade,
  service_label text        not null,
  price_label   text,
  offer_text    text,
  -- What the PATIENT WHO REFERS gets, added the same day the two-sided model was decided.
  referrer_offer_text text,
  excluded      boolean     not null default false,
  sort_order    integer     not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- One row per service per client. The panel upserts on this, and it is what makes "set every
-- service to the same deal" a single statement rather than a diff.
create unique index if not exists client_service_offers_client_service_key
  on public.client_service_offers (client_id, lower(service_label));

create index if not exists client_service_offers_client_idx
  on public.client_service_offers (client_id, sort_order);

alter table public.client_service_offers enable row level security;

comment on table public.client_service_offers is
  'What a referred friend is offered, one row per service the clinic sells.

   Set on the onboarding call. NOTHING IN THE CODEBASE CARRIES A FIGURE FOR THIS, deliberately:
   "80% off the first month, then $299" is one clinic''s example and a number hardcoded in the
   bundle would be a discount SRT invented turning up in a message a patient sends to her friend.
   src/lib/hub/review-script.ts says the same thing where the offer token is declared.';

comment on column public.client_service_offers.service_label is
  'The service as the clinic names it, and as a patient is likely to type it.

   offerForService() in src/lib/hub/referral-config.ts matches what she typed against this
   loosely in both directions: her words may contain the label or the label may contain her
   words, so "botox" finds "Botox". Anything it cannot place falls back to
   review_workflow.referral_offer.default_offer, and with no default there is NO referral step at
   all. Absent beats wrong: a deal shown to a patient that the front desk has never heard of is
   an argument at the counter with her friend standing there.';

comment on column public.client_service_offers.excluded is
  'True when this service is sold but must never carry a referral deal.

   A real state and not a soft delete. Clinics have services they will not discount, and the
   honest way to record that is a row that says so, rather than an absent row that looks like
   nobody got round to it yet.';

comment on column public.client_service_offers.price_label is
  'The clinic''s own price for the service, as text.

   Text rather than numeric because it is quoted, never computed: "from $450", "$12 a unit".
   Nothing in the referral path reads it; it is there because the onboarding call collects the
   service list with prices and throwing half of that away would mean asking twice.';

-- ── The invites ─────────────────────────────────────────────────────────────────────────────────
create table if not exists public.referral_invites (
  id             uuid        primary key default gen_random_uuid(),
  client_id      uuid        not null references public.clients(id) on delete cascade,
  submission_id  uuid        references public.review_tool_submissions(id) on delete set null,
  service_label  text,
  offer_snapshot jsonb       not null,
  code           text        not null,
  friend_name    text,
  friend_contact text,
  -- 'text' (she sent it from her phone) or 'internal' (nobody sent anything; the clinic follows
  -- up). Both write this row and both mint the same claim link.
  mode           text        not null default 'text',
  -- Null when mode is 'internal': there was no message, so there was no channel.
  channel        text,
  sent_at        timestamptz,
  -- What the FRIEND typed into the claim form, which is where the clinic's lead comes from. Kept
  -- apart from friend_name/friend_contact above, which are what the PATIENT said about them: a
  -- referral where the two disagree is a real and useful thing for the clinic to see.
  claimed_name    text,
  claimed_contact text,
  claimed_service text,
  claimed_at     timestamptz,
  expires_at     timestamptz not null,
  created_at     timestamptz not null default now()
);

create index if not exists referral_invites_client_idx
  on public.referral_invites (client_id, created_at desc);

-- The desk looks a code up when somebody walks in holding one, so it is indexed per client.
-- NOT unique: a code is six readable characters from a 26-character alphabet, collisions across
-- a long enough history are expected, and refusing an insert would cost a real referral at the
-- counter. Whoever redeems quotes the code AND is standing in the clinic.
create index if not exists referral_invites_code_idx
  on public.referral_invites (client_id, code);

alter table public.referral_invites enable row level security;

comment on table public.referral_invites is
  'One row per referral a patient actually sent, with the friend''s details and the deal promised.

   ‼️ THIS IS THE ONLY TABLE IN THE REFERRAL ENGINE THAT HOLDS A PERSON''S CONTACT DETAILS, AND
   THE SPLIT IS THE POINT. review_tool_submissions has no column for a name, an email or a phone
   and must never gain one: see the header of docs/2026-09-04-review-rating.sql. The foreign key
   below points FROM here AT a submission, so that table gains nothing from this feature.

   ‼️ SRT DOES NOT MESSAGE THESE NUMBERS. The patient composed and sent the message from her own
   phone; src/lib/hub/referral-invite.ts returns an href and has no network call in it, which
   scripts/_probe-referral-invite.ts enforces. A friend here has given nobody permission to
   contact them, so anything automated reading this column needs a signed BAA and a consent
   record first.';

comment on column public.referral_invites.submission_id is
  'The review she went on to write, when there is one. NULLABLE, AND NULL IS ORDINARY.

   The referral is settled at the counter BEFORE the review questions are asked, so at insert
   time there is usually no submission row yet. A null here means the order of the walk worked as
   designed; it does not mean anything failed.';

comment on column public.referral_invites.offer_snapshot is
  'The deal exactly as it was shown to her, frozen at the moment she sent the message.

   ‼️ A SNAPSHOT AND NOT A JOIN TO client_service_offers, WHICH IS THE WHOLE REASON IT EXISTS. A
   clinic editing its deals next month must not be able to change what a friend is already
   walking in holding. The friend has a text message on their phone quoting a specific offer; the
   row has to be able to agree with it.';

comment on column public.referral_invites.code is
  'What the friend quotes at the desk. NOT A SECRET AND NOT A TOKEN.

   It identifies a deal, never a person, and it carries no authority: this row is what records
   who it was for and when it dies. Six characters from an alphabet with no O/0, I/L/1, S/5 or
   B/8, because it is read aloud over a phone and typed by a receptionist.';

comment on column public.referral_invites.channel is
  'How the message was opened: sms, whatsapp or copy.

   ‼️ ONLY `sms` IS GENUINELY THREE-WAY. A wa.me link takes exactly one recipient and cannot open
   a group, so a whatsapp invite is the patient to her friend with the clinic not on the thread.
   INVITE_CHANNELS carries that as a flag and the labels on screen say which is which, because a
   button promising a group text that opens a one-to-one is a promise the link cannot keep.';

comment on column public.referral_invites.sent_at is
  'When she opened the composed message. NOT a delivery confirmation.

   We are not the sender and cannot know whether she pressed send in her own messages app. The
   column says the invite got as far as her keyboard, which is the most this architecture can
   honestly claim.';

comment on column public.referral_invites.expires_at is
  'When the code stops working. Fourteen days from the invite (INVITE_TTL_DAYS).

   A hard expiry with NO reminder and no cron, on purpose. Chasing the friend would mean messaging
   somebody who still has not given anybody permission to message them, which is the same reason
   SRT is not the sender in the first place.';

comment on column public.referral_invites.claimed_at is
  'When the clinic marked the code redeemed. Written by the clinic, never by the patient walk.';

-- ── The clinic-wide fallback, which needs no schema change ──────────────────────────────────────
--
-- ‼️ NO ALTER HERE, AND THAT IS DELIBERATE, the same note docs/2026-09-24-review-question-set-v4.sql
-- opens with. `clients.review_workflow` is intake step 4's jsonb and already holds ten keys plus
-- six destination URLs; a nested object fits where a column would be one more thing to maintain.
-- What does need writing down is the shape, because it lives in TypeScript and a reader with psql
-- open has no other way to find it.
comment on column public.clients.review_workflow is
  'Intake step 4''s answers, the six review destination URLs, and the referral settings.

   MERGED, NEVER REPLACED. It owns ten intake keys (asks, who, when, tool, booking_software,
   volume, destinations, incentive, lobby_tablet, blockers) plus google_url, yelp_url,
   trustpilot_url, bbb_url, facebook_url and realself_url. Any writer that assigns the whole bag
   deletes the client''s own intake answers, which is why
   /api/clients/[id]/review-workflow spreads before it writes.

   `referral_offer` (added 2026-10-05) is an object with two keys:
     default_offer  text. What a referred friend gets when the service she named is not in
                    client_service_offers. With no per-service row AND no default, the recommend
                    question and the invite are NOT ASKED: a clinic with no deal on file must not
                    be made to promise one.
     send_mode      "device" or "clinic". "device" opens the message on the patient''s own phone
                    and is the only mode implemented; composeInvite() refuses "clinic" until a
                    sender, a per-clinic number, an opt-out path and a signed BAA exist.

   ‼️ `incentive` IS A DIFFERENT THING AND STILL MEANS WHAT IT MEANT. It asks whether the clinic
   offers anything in exchange for A REVIEW, sets review_incentive_flag, and is still a problem to
   be talked out of. The referral offer is consideration for a REFERRAL: it goes to the friend, it
   is shown before she has written a word, and it is not conditional on her posting anything.
   scripts/_probe-review-gating.ts fails the build if any copy ties the two together.';

-- ‼️ ADDITIVE RE-RUN SAFETY. The block above only runs on a database that has never seen this
-- file. These four were added to the same file after it was written and before it was applied, so
-- a database that got the earlier version still needs them.
alter table public.client_service_offers
  add column if not exists referrer_offer_text text;

alter table public.referral_invites
  add column if not exists mode            text not null default 'text',
  add column if not exists claimed_name    text,
  add column if not exists claimed_contact text,
  add column if not exists claimed_service text;

-- The code is the lookup key for the claim form, and the form is opened by somebody holding a
-- link rather than a session, so it is read by code alone within one client's host.
create index if not exists referral_invites_claim_idx
  on public.referral_invites (code, expires_at desc);

comment on column public.client_service_offers.referrer_offer_text is
  'What the PATIENT WHO REFERS gets. Matthew, 2026-10-05: "refer a friend for 20% off on your
   next session and the friend gets 20% off also."

   ‼️ EARNED WHEN THE FRIEND CLAIMS, NEVER WHEN SHE WRITES A REVIEW, and that distinction is
   the whole legal position of this column. A reward for referring is an ordinary refer-a-friend
   programme. A reward for leaving a review is an incentivised review with an undisclosed
   material connection, which is what the FTC endorsement rules reach and what
   clients.review_incentive_flag exists to flag and talk a clinic out of. No copy anywhere may
   connect the two; scripts/_probe-review-gating.ts fails the build if any does.';

comment on column public.referral_invites.mode is
  'Who put the link in front of the friend.

   "text"     she did, from her own phone, with the clinic on the thread where the clinic has a
              number on file. Her thumb is the send button, so she is the sender of record.
   "internal" nobody did. The referral was recorded, she was told the clinic would reach out, and
              a human at the clinic works it. No message left the building.

   Both mint the same claim link and write the same row. SRT is not the sender in either, which
   is why there is no provider, no number of ours and no outbound call anywhere in this lane.';

comment on column public.referral_invites.claimed_name is
  'What the FRIEND typed into the claim form at /r/{code}.

   ‼️ SEPARATE FROM friend_name, WHICH IS WHAT THE PATIENT SAID. A referral where the two
   disagree is not a fault to be reconciled: it is the clinic finding out that "Jamie" is Jamie''s
   partner, or that the number was mistyped, and both are worth seeing.';
