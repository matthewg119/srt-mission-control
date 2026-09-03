-- /onboarding2, the signature-first onboarding funnel and the qualifying assistant behind it.
--
-- FOUR TABLES: TWO RECORDS AND TWO APPEND-ONLY LOGS. Applied by hand like every other file in
-- this directory; there is no migration runner. Safe to run more than once: every statement is
-- create-if-not-exists.
--
-- Nothing on main reads these tables, so this is also safe to run against production today and
-- deploy later.
--
-- WHY FOUR AND NOT TWO. The obvious version carries `initials jsonb` on the signing row and it
-- loses writes: fourteen sequential POST /api/onboarding2/initial calls would each
-- read-modify-write the same array. api/onboardingfree/submit does that same read-modify-write on
-- system_logs.metadata and gets away with it only because its own comment states the condition it
-- depends on, "nothing else touches this row between the insert above and here". That condition
-- does not hold across fourteen screens with a chatbot running beside them. So the two growing
-- things are rows with a unique key, and a double-submit from a flaky phone collides instead of
-- writing twice. Same move concierge_messages_ordinal_idx already makes.
--
-- WHY THE SIGNING AND THE LEAD ARE SEPARATE. The signing row's whole value is that nothing
-- rewrites it. The lead row is patched forever: nine answers arriving one at a time, a booked
-- slot, a disposition typed by hand days later. That is chatgpt_ads_leads' shape and this is
-- chatgpt_ads_leads' reasoning.
--
-- NO POSTGRES ENUMS. Nothing in this database uses one. Text plus a named check, the same as
-- scraper_batches and chatgpt_ads_leads, because widening a check is one statement and widening
-- an enum in a transaction with a running app is not.

create extension if not exists pgcrypto;


-- ─────────────────────────────────────────────────────────────────────
-- 1. THE RECORD. One signing session, from the first page paint to the signature.
--
-- ‼️ MUTABLE UNTIL signed_at IS STAMPED, AND NOTHING AFTER. The lock is a conditional update,
-- .is("signed_at", null), on every write path (patchOpenSigning in src/lib/onboarding2/session.ts).
-- That is the same claim pattern clients.provisioned_at already uses and it is this schema's
-- idiom. A BEFORE UPDATE trigger would be a stronger rail and is deliberately not taken: there is
-- not one trigger anywhere in this database, and a single lone trigger is a rule nobody would
-- think to look for. The hole check is:
--
--     grep -rn 'is("signed_at", null)' src/lib/onboarding2/
--
-- and it must match every writer. The one exception is patchDelivery(), which writes the delivery
-- columns at the bottom and carries its own runtime allowlist saying so.
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.onboarding2_signings (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- ‼️ THE BEARER, AND IT IS NOT THE ID. The browser holds this to append initials, chat turns
  -- and the signature, and it is what fetches the finished PDF back. Keeping it separate from the
  -- id is what lets the id appear in a Slack card without that card granting whoever reads it
  -- write access to somebody's half-signed contract. Same split as concierge_sessions.
  session_token text not null unique,

  -- open -> signed. `abandoned` is written by nothing but time and is not required for anything
  -- to work; it exists so a query can tell "started and stopped" from "started five minutes ago".
  status text not null default 'open',
  email  text,

  -- ‼️ A WALK-THROUGH ON A PREVIEW OR ON LOCALHOST. Decided server-side from the request host
  -- (src/lib/onboarding2/demo.ts); the client cannot ask for it and production can never be put
  -- into it. A demo signing still writes rows, because the session token has to resolve to
  -- something, and still renders a real PDF. It never calls startPilot, never calls ingestLead,
  -- never posts to Slack and never sends an email, so it cannot take one of the six client seats
  -- or put a test name in front of a human.
  --
  -- Purge a week of testing:
  --   delete from public.onboarding2_leads where is_demo;
  --   delete from public.onboarding2_signings where is_demo;
  is_demo boolean not null default false,

  -- ── THE IMMUTABLE SNAPSHOT ────────────────────────────────────────
  --
  -- ‼️ THE VERBATIM TEXT, NOT A POINTER TO IT, AND THAT IS THE WHOLE POINT OF THIS TABLE.
  -- src/config/onboarding2-agreement.ts gets edited. A row holding only template_version would
  -- render April's wording under a March signature and would look perfectly correct while doing
  -- it. A row holding only the hash would prove the current template is not what was signed and
  -- then leave nobody able to say what was. Neither failure is recoverable after the fact, and
  -- the storage is about 40 kB a signature.
  --
  -- Read ONCE, at POST /api/onboarding2/start, NOT at signature. This flow is fourteen screens
  -- long and a deploy landing at screen 9 would otherwise record v3.1 for somebody who read eight
  -- sections of v3.0, with no trace that anything moved. The browser is served the text back out
  -- of THIS COLUMN from then on, and the PDF is generated from it and never from the template.
  --
  -- Shape (src/lib/onboarding2/snapshot.ts owns the type):
  --   { version, canon, title, preamble[], promise, capturedAt, documentSha256,
  --     sections: [ { n, key, heading, body[], bullets[], after[], sha256 } x 14 ],
  --     closing[], footer[] }
  agreement_snapshot jsonb not null,
  template_version   text  not null,

  -- Denormalised out of the jsonb ON PURPOSE. POST /sign compares the browser's echo against it
  -- on every request, and doing that by deserialising 40 kB to read one field is work for
  -- nothing. It is also the only form that is indexable.
  agreement_sha256   text  not null,

  -- ── THE FROZEN COPY OF THE INITIALS ───────────────────────────────
  --
  -- Written EXACTLY ONCE, in the same statement that stamps signed_at, out of
  -- onboarding2_initials. Null before that. The log is the working set; this is the record.
  -- Shape: [ { n, key, initials, at, sectionSha256, dwellMs } ], newest attempt per section, in
  -- section order.
  initials_snapshot jsonb,

  -- ── WHAT THEY TYPED ───────────────────────────────────────────────
  --
  -- ‼️ SIGNED VALUES, NOT CURRENT VALUES. These are what the person attested to. The correctable
  -- copies live on onboarding2_leads and are allowed to diverge: a typo in a phone number gets
  -- fixed there and never here.
  signature_typed     text,
  print_name          text,
  signer_title        text,
  business_legal_name text,

  -- Four boxes, not one. checkMarket() in clients/provision.ts geocodes a STRUCTURED address, and
  -- its own comment says a centre-less client must not be allowed to mean no exclusivity. A
  -- single free-text address line would silently leave market_locked_at null for every client
  -- this funnel produces. The PDF joins them back into one line so the document still reads like
  -- a contract.
  address_line1  text,
  address_city   text,
  address_state  text,
  address_postal text,

  contact_email text,
  -- E.164 via normalizeLeadPhone, AND the raw string. A contract records what was written down;
  -- a normalizer that silently rewrote it would be editing the document.
  contact_phone       text,
  contact_phone_typed text,

  -- ‼️ TWO DATES AND THEY ARE NEVER RECONCILED. signed_date is what the signer typed into the
  -- date box. signed_at is the server clock. They disagree across time zones and when somebody
  -- types the wrong year, and the disagreement is a fact about the signing rather than an error
  -- to smooth over.
  signed_date text,
  signed_at   timestamptz,

  -- ── PROVENANCE ────────────────────────────────────────────────────
  -- hashIp(clientIpFrom(req)), never a raw address: these are rate-limit ledgers, not a visitor
  -- log (SCAN_IP_SALT). The user agent is stored raw, because it is evidence about the signing
  -- and there is nothing to salt.
  started_ip_hash   text,
  signed_ip_hash    text,
  signed_user_agent text,

  -- ── THE RENDERED COPY ─────────────────────────────────────────────
  --
  -- ‼️ pdf_sha256 DESCRIBES ONE RENDERING AND IS NOT A DOCUMENT HASH. jsPDF writes a CreationDate
  -- into every file, so re-rendering the same snapshot produces different bytes. The reproducible
  -- hash is agreement_sha256, over the TEXT. Nothing may verify anything against pdf_sha256; it
  -- exists only to prove the emailed attachment is the stored file.
  pdf_path          text,
  pdf_sha256        text,
  pdf_generated_at  timestamptz,
  emailed_signer_at timestamptz,
  emailed_srt_at    timestamptz,

  -- ── PLUMBING ──────────────────────────────────────────────────────
  --
  -- ‼️ ON DELETE SET NULL, NEVER CASCADE. Deleting a client must not delete the agreement they
  -- signed. audit_reports.client_id is set null for the identical reason.
  client_id uuid references public.clients(id) on delete set null,

  -- A LINK, never ownership, and NO FOREIGN KEY. `contacts` predates docs/ entirely, so no
  -- migration in this repo asserts its key type and a FK here would be a guess. Same call
  -- concierge_sessions.contact_id makes.
  contact_id uuid,
  lead_id    uuid,

  -- Our own card, posted TOP LEVEL in #onboarding-srt-aeo. Top level because
  -- clients.ops_thread_ts does not exist yet at signature time: its only writer is
  -- api/onboarding/save/route.ts, which runs when the intake completes days later. Everything
  -- else about this signing threads under this card.
  slack_channel   text,
  slack_thread_ts text,

  -- Spend and abuse. Counted PER MODE so a signed session cannot re-spend the pre-signature
  -- budget. ‼️ THIS IS THE CAP THAT BOUNDS COST IF A SESSION TOKEN LEAKS, because every other
  -- guard on the chat endpoint keys on IP and a leaked token arrives from wherever it likes.
  chat_turns_pre  integer not null default 0,
  chat_turns_post integer not null default 0,
  -- Questions the grounded assistant refused and flagged for a human. The best copy-editing
  -- feedback this agreement will ever get.
  flagged_questions jsonb not null default '[]'::jsonb,

  source_url text,
  referrer   text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  -- ‼️ A META EVENT ONLY COUNTS WITH fbc OR fbclid PRESENT. _fbp is set on every visitor
  -- including direct traffic, so a row with fbp and nothing else is NOT attributable and must
  -- never be reported as a Meta conversion. That rule lives in hasMetaAttribution() in
  -- src/lib/medspa/pixel.ts and is applied where an event is REPORTED, not where a row is
  -- written. fbp is stored anyway so the call can be re-made later against real data.
  fbc text,
  fbp text,
  fbclid text,

  -- Carried in from the audit report link. All nullable: the funnel is also reachable from a cold
  -- ad with no report behind it, and a missing param must never block a signature.
  ai_visibility_score int,
  competitor_name     text,
  user_showed_count   int,
  comp_showed_count   int,
  report_slug         text,

  constraint onboarding2_signings_status_check
    check (status in ('open', 'signed', 'abandoned')),

  constraint onboarding2_signings_sha_len_check
    check (char_length(agreement_sha256) = 64),

  -- A signed row that cannot say what was signed is the one row this table must not allow.
  constraint onboarding2_signings_signed_complete
    check (signed_at is null or (
      signature_typed is not null
      and print_name is not null
      and business_legal_name is not null
      and initials_snapshot is not null
    ))
);

create index if not exists onboarding2_signings_signed_idx
  on public.onboarding2_signings (signed_at desc) where signed_at is not null and not is_demo;

create index if not exists onboarding2_signings_email_idx
  on public.onboarding2_signings (email);

create index if not exists onboarding2_signings_client_idx
  on public.onboarding2_signings (client_id) where client_id is not null;

-- The per-IP start ledger's only query.
create index if not exists onboarding2_signings_start_ip_idx
  on public.onboarding2_signings (started_ip_hash, created_at desc);

-- The per-IP signature ledger's only query.
create index if not exists onboarding2_signings_sign_ip_idx
  on public.onboarding2_signings (signed_ip_hash, signed_at desc) where signed_at is not null;

-- THE ALERT QUERY: signed, but provisioning never completed. That is the MAX_CONCURRENT_CLIENTS
-- seat cap, and it means a valid signed agreement has no client row behind it. Partial, because
-- a healthy signature is dead weight in this index forever.
create index if not exists onboarding2_signings_unprovisioned_idx
  on public.onboarding2_signings (signed_at desc)
  where signed_at is not null and client_id is null and not is_demo;

alter table public.onboarding2_signings enable row level security;

comment on table public.onboarding2_signings is
  'One signing. Carries the VERBATIM agreement text that was on screen, its hash, and every typed '
  'field, so the PDF is generated from this row and never from the live template constant. '
  'Mutable until signed_at is stamped and never after.';


-- ─────────────────────────────────────────────────────────────────────
-- 2. THE LOG. One row per initial. Append only.
--
-- ‼️ A RE-INITIAL IS A SECOND ROW, NOT AN EDIT. Somebody who goes back to re-read section 6 and
-- initials it again has done something worth recording. The PDF prints the newest attempt per
-- section; the log keeps that there was an earlier one.
--
-- ‼️ WRITING THESE INCREMENTALLY IS THE WHOLE POINT. Fourteen initials posted in one payload at
-- the end are fourteen claims made in one request with client-asserted times. One at a time, the
-- timestamps are the server's, the dwell is measurable, and somebody who abandons at section 9
-- leaves evidence of exactly how far they read.
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.onboarding2_initials (
  id         uuid primary key default gen_random_uuid(),
  signing_id uuid not null references public.onboarding2_signings(id) on delete cascade,
  created_at timestamptz not null default now(),

  section_no  integer not null,
  section_key text    not null,
  -- ‼️ STORED EXACTLY AS TYPED. Not uppercased, not trimmed to two characters. The record is what
  -- they wrote.
  initials    text    not null,

  -- The hash of the section as it was on screen when this was typed, computed by the BROWSER over
  -- the text it rendered and checked against the snapshot before this row is written. Stored as
  -- well as checked, so a later reader can see the check happened rather than trusting that it
  -- did.
  section_sha256 text not null,

  -- Milliseconds between the section rendering and the initial being submitted. Fourteen initials
  -- that all landed inside three seconds is the single most useful anti-repudiation datum after
  -- the text itself.
  dwell_ms integer,

  -- ‼️ THE IDEMPOTENCY KEY, AND IT COSTS NOTHING. The browser mints one uuid per SUBMIT. A retry
  -- from a flaky mobile connection carries the same one and collides; going back and
  -- re-initialling mints a new one and legitimately writes a second row. That is why there is no
  -- attempt counter anywhere to keep in sync.
  client_nonce uuid not null,

  constraint onboarding2_initials_nonce_key unique (signing_id, client_nonce)
);

create index if not exists onboarding2_initials_signing_idx
  on public.onboarding2_initials (signing_id, section_no, created_at desc);

alter table public.onboarding2_initials enable row level security;

comment on table public.onboarding2_initials is
  'Append-only. One row per initial typed, with the hash of the section it was typed against. '
  'Folded into onboarding2_signings.initials_snapshot exactly once, at signature.';


-- ─────────────────────────────────────────────────────────────────────
-- 3. THE LOG. The assistant transcript, both modes.
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.onboarding2_chat_turns (
  id         uuid primary key default gen_random_uuid(),
  signing_id uuid not null references public.onboarding2_signings(id) on delete cascade,
  created_at timestamptz not null default now(),

  role    text not null,
  content text not null,

  -- ‼️ WHICH MODE PRODUCED THIS TURN, RECORDED AND NEVER DERIVED AT READ TIME. The mode is
  -- decided by whether signed_at was null when the turn ran, and it flips exactly once per
  -- session. Re-deriving it later from the row's CURRENT signed_at would relabel every
  -- pre-signature question about the contract as a qualifying answer the moment somebody signs.
  mode    text not null,

  -- 0-based and unique per signing. ‼️ THE INSERT IS THE CLAIM: a double-submit collides on this
  -- index instead of writing the same question into the transcript twice and paying the model
  -- twice for it. Free idempotency, and here it is also the spend guard.
  ordinal integer not null,

  -- Per-turn, because the per-IP chat cap is counted off THIS table. The signing's own
  -- started_ip_hash cannot do it: that is where the session BEGAN, and somebody holding a leaked
  -- token arrives from wherever they like.
  ip_hash text,

  input_tokens  integer,
  output_tokens integer,

  constraint onboarding2_chat_turns_role_check  check (role in ('user', 'assistant')),
  constraint onboarding2_chat_turns_mode_check  check (mode in ('grounded', 'qualifying')),
  constraint onboarding2_chat_turns_ordinal_key unique (signing_id, ordinal)
);

create index if not exists onboarding2_chat_turns_signing_idx
  on public.onboarding2_chat_turns (signing_id, ordinal);

-- The per-IP turn ledger's only query. Partial, because assistant turns are not what is capped.
create index if not exists onboarding2_chat_turns_ip_idx
  on public.onboarding2_chat_turns (ip_hash, created_at desc) where role = 'user';

alter table public.onboarding2_chat_turns enable row level security;


-- ─────────────────────────────────────────────────────────────────────
-- 4. THE RECORD. The funnel row. Keyed on email, patched forever.
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.onboarding2_leads (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Email is the key: it is present from screen one on every path, and it is what mission control
  -- joins every other funnel on.
  email text not null,

  -- The CORRECTABLE copies. onboarding2_signings holds what was signed; these may diverge.
  phone         text,
  business_name text,
  contact_name  text,
  signer_title  text,
  website       text,
  city          text,
  state         text,

  signing_id uuid references public.onboarding2_signings(id) on delete set null,
  signed_at  timestamptz,

  -- Carried from the signing so a demo lead is filterable without a join. Nothing reads a demo
  -- lead, but a funnel report that silently counted test runs would be worse than one that did.
  is_demo boolean not null default false,

  -- ── THE NINE ─────────────────────────────────────────────────────
  --
  -- ‼️ VERBATIM, IN ONE JSONB, AND THERE ARE DELIBERATELY NO PER-ANSWER COLUMNS. These arrive
  -- conversationally, as free text a person typed at a chatbot. chatgpt_ads_leads stores stable
  -- option ids precisely because its visitor TAPPED A BUTTON, and nobody taps anything here. A
  -- column of free text answers a question nobody can ask. Columns get added when a question is
  -- rewritten to CONSTRAIN its answer to a closed set, and not before, because a column with a
  -- reader and no writer is a bug this repo has recorded several instances of.
  --
  -- Shape: [ { key, question, answer, askedAt, sourceTurnOrdinals: [int] } ]
  qualifying              jsonb   not null default '[]'::jsonb,
  qualifying_answered     integer not null default 0,
  qualifying_completed_at timestamptz,

  booking_offered_at timestamptz,
  booked_slot_at     timestamptz,
  calendly_event_uri text,

  -- Plumbing. contact_id is a LINK, never ownership: contacts is the CRM and this row is one
  -- funnel's notes about a person who exists there whether or not this table does.
  contact_id uuid,
  client_id  uuid references public.clients(id) on delete set null,
  ip_hash    text,
  source_url text,
  referrer   text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  fbc text,
  fbp text,
  fbclid text,

  -- A PLAIN UNIQUE CONSTRAINT, NOT a unique index on lower(email). PostgREST's
  -- .upsert({ onConflict: "email" }) can only name a column or a real constraint, and it fails at
  -- RUNTIME rather than at deploy on an expression index. medspa_optins hit this exact wall and
  -- chatgpt_ads_leads records it. The application lowercases every address before it writes.
  constraint onboarding2_leads_email_key unique (email)
);

create index if not exists onboarding2_leads_created_idx
  on public.onboarding2_leads (created_at desc);

create index if not exists onboarding2_leads_contact_idx
  on public.onboarding2_leads (contact_id);

create index if not exists onboarding2_leads_signing_idx
  on public.onboarding2_leads (signing_id);

-- The one query anybody will actually run: signed, answered everything, has not booked.
create index if not exists onboarding2_leads_unbooked_idx
  on public.onboarding2_leads (qualifying_completed_at desc)
  where qualifying_completed_at is not null and booked_slot_at is null;

-- Signed but never finished the nine. The follow-up queue.
create index if not exists onboarding2_leads_stalled_idx
  on public.onboarding2_leads (signed_at desc)
  where signed_at is not null and qualifying_completed_at is null;

alter table public.onboarding2_leads enable row level security;

comment on table public.onboarding2_leads is
  'The /onboarding2 funnel row, keyed on email and patched as they move. The signature itself '
  'lives in onboarding2_signings and is never edited from here.';


-- RLS is on with NO POLICIES on all four, like every other table here. Everything that touches
-- these rows goes through supabaseAdmin on the service role, which bypasses RLS; the anon key
-- must reach nothing, and a table with RLS off is reachable by the anon key by default.

-- Verify:
--   select relname, relrowsecurity from pg_class where relname like 'onboarding2%';
--     -> 4 rows, relrowsecurity true on every one
--   select conname from pg_constraint where conname = 'onboarding2_leads_email_key';
--     -> 1 row. Without it every upsert in src/lib/onboarding2/lead.ts fails at runtime.
--   select conname from pg_constraint where conname = 'onboarding2_initials_nonce_key';
--     -> 1 row. Without it a retried initial writes a duplicate instead of colliding.
--   select conname from pg_constraint where conname = 'onboarding2_chat_turns_ordinal_key';
--     -> 1 row. Without it a double-tapped chat send is billed twice.
