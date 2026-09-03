-- The attribution stack. Three layers, and the ranking between them is STRUCTURAL.
-- src/lib/attribution/*. Read the header of src/lib/attribution/ai-domains.ts first.
--
-- Safe to run more than once. Every statement is create-if-not-exists, add-column-if-not-exists,
-- or a drop-then-add constraint, which is the guarded pattern the rest of docs/ uses.
--
-- Nothing on main reads these tables, so it is safe to run against production today and deploy
-- later.
--
-- ─────────────────────────────────────────────────────────────────────
-- ‼️ THE ONE RULE THIS WHOLE MIGRATION EXISTS TO MAKE UNBREAKABLE:
--
--   THE PIXEL MAY NEVER DEFINE A QUALIFIED APPOINTMENT.
--
-- Somebody reads a ChatGPT answer, then types the clinic name into Google and books. No
-- referrer, no UTM, no AI domain. That is the MAJORITY path and no pixel catches it. SRT is not
-- paid until 5 qualified appointments land, so a pixel-defined count silently deletes
-- appointments that were earned.
--
-- `attribution_bookings.qualified` is therefore a STORED GENERATED column, not a flag anybody
-- writes and not a WHERE clause somebody has to remember. Its expression excludes
-- count_basis = 'pixel_only' by construction. A report that reads `qualified` cannot count a
-- pixel row; a report that ignores it and counts rows by hand is visibly doing something else.
--
-- The public collector (/api/px/collect) does not accept `count_basis` at all and writes the
-- literal 'pixel_only'. So the ranking holds in two independent places: the endpoint cannot
-- claim a stronger basis, and the column cannot be made to count a weaker one.
-- ─────────────────────────────────────────────────────────────────────


-- ─────────────────────────────────────────────────────────────────────
-- 0. The pixel's public key, on the client row.
--
-- ‼️ NOT clients.id. The snippet sits in the <head> of a website anybody can view-source, so
-- whatever identifies the client there is public forever. A dedicated random key can be rotated
-- after a scrape or a departing web developer; a primary key cannot, and it is also the join
-- key for every other table in this database.
-- ─────────────────────────────────────────────────────────────────────
alter table public.clients add column if not exists pixel_key text;

create unique index if not exists clients_pixel_key_idx
  on public.clients (pixel_key) where pixel_key is not null;

comment on column public.clients.pixel_key is
  'Public site key for the SRT first-party pixel. Appears in the client website source, so it '
  'is rotatable by design and is never clients.id. Null until the snippet step provisions one.';


-- ─────────────────────────────────────────────────────────────────────
-- 1. One row per SESSION. The visit.
--
-- ‼️ ONE ROW PER SESSION, NOT ONE PER EVENT, AND PAGEVIEWS ARE A COUNTER RATHER THAN ROWS.
-- A pageview table on a clinic's whole website is millions of rows a year whose only question
-- ("did this person arrive from an AI domain") is answered once, at the start of the visit, and
-- never changes. The first touch is what attribution is about; the rest of the visit is a
-- number. What DOES get its own row is a booking, because a booking is the thing being counted.
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.attribution_sessions (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references public.clients(id) on delete cascade,

  -- ‼️ MINTED IN THE BROWSER AND HELD IN sessionStorage, SO IT IS CALLER-CONTROLLED. It is a
  -- dedup key and it is NOT a bearer token: nothing is ever served back by it, so a guessed one
  -- can add noise to a session and can never read one. The unique index below is what makes a
  -- retried beacon idempotent instead of a second visit.
  session_key       text not null,

  -- Where they landed. Host and path only.
  -- ‼️ THE QUERY STRING IS DROPPED AT WRITE TIME AND THERE IS NOWHERE HERE TO PUT ONE. A real
  -- clinic URL routinely carries a search term, a session token or an email address in a
  -- parameter. None of it is attribution data, and a column for it would be a retention
  -- obligation nobody signed up for. Same discipline as concierge_sessions refusing a mask url.
  landing_host      text,
  landing_path      text,

  -- The referrer, same treatment.
  referrer_host     text,
  referrer_path     text,

  -- ‼️ TRI-STATE, AND 'absent' IS A REAL ANSWER RATHER THAN A MISSING ONE. A direct visit, a
  -- bookmark, a link out of an app and any privacy-stripped browser all produce no referrer.
  -- Recording that as 'non_ai' would be writing down "we know they did not come from AI" about
  -- a visit we know nothing about. It is also the state the MAJORITY path lands in, which is
  -- exactly why this table may not decide the count.
  referrer_kind     text not null default 'absent',
  -- Set only when referrer_kind = 'ai'. chatgpt | claude | perplexity | gemini | copilot.
  ai_engine         text,

  utm_source        text,
  utm_medium        text,
  utm_campaign      text,
  utm_content       text,
  utm_term          text,

  pageviews         integer not null default 0,

  -- ‼️ TEST MODE IS A COLUMN ON THE REAL TABLE, NOT A SECOND TABLE. Meta's Test Events tab is
  -- the model: the point is to prove the REAL path end to end, so a test event has to travel
  -- the same route, the same validation and the same writer. A parallel table would be testing
  -- a code path that is not the one that runs in production. Every report filters is_test.
  is_test           boolean not null default false,
  test_code         text,

  -- sha256(ip + SCAN_IP_SALT) via hashIp() in src/lib/scan/session.ts. Never the raw address.
  -- Same treatment concierge_sessions.ip_hash gets, and for the same reason: this is an abuse
  -- ledger, not a visitor log.
  ip_hash           text,
  user_agent        text,

  -- ‼️ RETENTION IS A COLUMN WITH A DEADLINE ON IT, NOT A POLICY IN A DOC. concierge_sessions
  -- proved the shape: a row with no deadline is invisible to the purge forever. The monthly
  -- report reads pre-aggregated counts, so purging raw sessions never rewrites a report that
  -- has already been sent.
  purge_after       timestamptz not null default (now() + interval '180 days'),
  purged_at         timestamptz,

  created_at        timestamptz not null default now(),
  last_seen_at      timestamptz not null default now()
);

alter table public.attribution_sessions drop constraint if exists attribution_sessions_key_uniq;
alter table public.attribution_sessions add constraint attribution_sessions_key_uniq
  unique (client_id, session_key);

alter table public.attribution_sessions drop constraint if exists attribution_sessions_ref_kind_check;
alter table public.attribution_sessions add constraint attribution_sessions_ref_kind_check
  check (referrer_kind in ('absent','ai','non_ai'));

alter table public.attribution_sessions drop constraint if exists attribution_sessions_engine_check;
alter table public.attribution_sessions add constraint attribution_sessions_engine_check
  check (ai_engine is null or ai_engine in ('chatgpt','claude','perplexity','gemini','copilot'));

-- ‼️ AN ENGINE WITHOUT AN 'ai' VERDICT, OR AN 'ai' VERDICT WITHOUT AN ENGINE, IS A ROW THAT
-- CONTRADICTS ITSELF. Either one would let a reader answer "was this AI" two ways on one row.
alter table public.attribution_sessions drop constraint if exists attribution_sessions_engine_agrees;
alter table public.attribution_sessions add constraint attribution_sessions_engine_agrees
  check ((referrer_kind = 'ai') = (ai_engine is not null));

-- A test session must carry the code that made it one, or nobody can tell whose test it was.
alter table public.attribution_sessions drop constraint if exists attribution_sessions_test_code;
alter table public.attribution_sessions add constraint attribution_sessions_test_code
  check (is_test = false or test_code is not null);

-- The purge cron's worklist. Partial, same shape as concierge_sessions_purge_idx.
create index if not exists attribution_sessions_purge_idx
  on public.attribution_sessions (purge_after) where purged_at is null;

-- The monthly report's only query shape: this client, this window, real traffic.
create index if not exists attribution_sessions_report_idx
  on public.attribution_sessions (client_id, created_at desc) where is_test = false;

-- The test dashboard's query shape: newest first, this code.
create index if not exists attribution_sessions_test_idx
  on public.attribution_sessions (client_id, created_at desc) where is_test = true;

alter table public.attribution_sessions enable row level security;

comment on table public.attribution_sessions is
  'One row per visit to a client website carrying the SRT pixel. First touch only: referrer, '
  'UTM, landing page and whether the referrer was an AI domain. It CORROBORATES attribution and '
  'never defines it. No query string is stored anywhere in this table, by design.';


-- ─────────────────────────────────────────────────────────────────────
-- 2. One row per BOOKING. The thing being counted.
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.attribution_bookings (
  id                    uuid primary key default gen_random_uuid(),
  client_id             uuid not null references public.clients(id) on delete cascade,

  -- ‼️ NULLABLE, AND A NULL IS THE STRONGEST CASE RATHER THAN A BROKEN ONE. A booking taken by
  -- the Concierge on a site whose pixel has not been installed yet has no session and is 100%
  -- attributed anyway. Requiring a session here would make the pixel a precondition for the one
  -- layer that never needed it. `on delete set null` so the 180-day purge cannot take a booking
  -- with it.
  session_id            uuid references public.attribution_sessions(id) on delete set null,
  concierge_session_id  uuid references public.concierge_sessions(id) on delete set null,

  -- ‼️ THE RANKING, AS DATA. assistant > self_reported > pixel_only.
  count_basis           text not null,

  -- The patient's own answer, as a SLUG. Labels get reworded; a year of monthly reports has to
  -- stay comparable. See SELF_REPORT_OPTIONS in src/lib/attribution/ai-domains.ts.
  self_report           text,

  -- ‼️ "THEY SAID IT WAS AI". A FACT ABOUT THE ANSWER, NEVER ABOUT THE REFERRER. The pixel's
  -- verdict lives on the session row and is deliberately not an input to this column: letting
  -- a referrer set it would be the pixel deciding the count through the back door.
  ai_evidence           boolean not null default false,

  -- ‼️ GENERATED, STORED, AND THIS IS THE STRUCTURAL HALF OF THE WHOLE FEATURE.
  --
  -- It is not a flag a route writes and not a WHERE clause somebody has to remember. A pixel row
  -- carries count_basis 'pixel_only', so this evaluates false for it no matter what else is on
  -- the row and no matter who is querying. Both halves are required and they are different
  -- questions: `count_basis` is how we know anything at all, `ai_evidence` is whether what we
  -- know says AI. A Concierge booking by somebody who ticked "Friend or family" is perfectly
  -- attributed and is NOT qualified, because the clause counts patients who say they came from
  -- AI rather than patients we happened to serve.
  --
  -- Mirrored by isQualified() in src/lib/attribution/ai-domains.ts, which is the mirror and not
  -- the authority: a report that forgets to call it still cannot count a pixel row.
  qualified             boolean generated always as (
    count_basis <> 'pixel_only' and ai_evidence
  ) stored,

  -- Did they turn up. The third test in the guarantee clause, and the only one a human answers.
  -- ‼️ TRI-STATE. Null is "not yet confirmed", which is the state of every booking for its first
  -- few days and is not the same answer as false. A monthly report counts null as pending, never
  -- as a no-show.
  attended              boolean,
  attended_at           timestamptz,

  -- ‼️ CONFIRMED BY THE CLIENT, because the agreement says so: "You confirm each one. If we
  -- disagree on whether a booking qualifies, we default to your judgment." A row this system
  -- believes is qualified is still a proposal until this is stamped.
  client_confirmed_at   timestamptz,

  booked_at             timestamptz not null default now(),
  is_test               boolean not null default false,
  test_code             text,

  -- Whatever the layer that recorded it wants to keep. Never read by the count.
  payload               jsonb not null default '{}'::jsonb,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

alter table public.attribution_bookings drop constraint if exists attribution_bookings_basis_check;
alter table public.attribution_bookings add constraint attribution_bookings_basis_check
  check (count_basis in ('assistant','self_reported','pixel_only'));

alter table public.attribution_bookings drop constraint if exists attribution_bookings_self_report_check;
alter table public.attribution_bookings add constraint attribution_bookings_self_report_check
  check (self_report is null or self_report in (
    'google','friend_family','instagram_facebook','ai','sign','other'
  ));

-- ‼️ 'self_reported' MEANS SOMEBODY ANSWERED. A row claiming that basis with no answer on it is
-- claiming evidence it does not hold, and it would be one column away from qualifying.
alter table public.attribution_bookings drop constraint if exists attribution_bookings_self_report_present;
alter table public.attribution_bookings add constraint attribution_bookings_self_report_present
  check (count_basis <> 'self_reported' or self_report is not null);

-- ‼️ A PIXEL ROW MAY NEVER CARRY ai_evidence, AND THIS IS THE SECOND LOCK ON THE MAIN RULE.
-- The generated column already refuses to qualify it, so this is belt and braces: it stops a
-- pixel row from LOOKING like AI evidence to a human reading the table or to a future report
-- that counts ai_evidence directly instead of reading `qualified`.
alter table public.attribution_bookings drop constraint if exists attribution_bookings_pixel_no_evidence;
alter table public.attribution_bookings add constraint attribution_bookings_pixel_no_evidence
  check (count_basis <> 'pixel_only' or ai_evidence = false);

alter table public.attribution_bookings drop constraint if exists attribution_bookings_test_code;
alter table public.attribution_bookings add constraint attribution_bookings_test_code
  check (is_test = false or test_code is not null);

alter table public.attribution_bookings drop constraint if exists attribution_bookings_attended_at;
alter table public.attribution_bookings add constraint attribution_bookings_attended_at
  check (attended_at is null or attended is not null);

-- THE COUNT. The only index the guarantee's number is ever read through.
create index if not exists attribution_bookings_qualified_idx
  on public.attribution_bookings (client_id, booked_at desc)
  where qualified and is_test = false;

create index if not exists attribution_bookings_client_idx
  on public.attribution_bookings (client_id, booked_at desc) where is_test = false;

create index if not exists attribution_bookings_session_idx
  on public.attribution_bookings (session_id) where session_id is not null;

create index if not exists attribution_bookings_test_idx
  on public.attribution_bookings (client_id, created_at desc) where is_test = true;

alter table public.attribution_bookings enable row level security;

comment on table public.attribution_bookings is
  'One row per booking, with HOW we know where it came from (count_basis) kept separate from '
  'WHETHER the evidence says AI (ai_evidence). `qualified` is generated from both and excludes '
  'pixel_only by construction: the pixel corroborates and never counts. Attendance and client '
  'confirmation are the two human facts the guarantee clause also requires.';


-- ─────────────────────────────────────────────────────────────────────
-- 3. The monthly roll-up, so a purge never rewrites a sent report.
--
-- ‼️ THIS IS WHY THE 180-DAY PURGE IS SAFE. A report emailed in March quotes numbers off this
-- table, and the sessions behind them are gone by September. Recomputing from raw rows would
-- make an old report change its own figures the day the purge ran.
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.attribution_monthly (
  id                    uuid primary key default gen_random_uuid(),
  client_id             uuid not null references public.clients(id) on delete cascade,
  -- First day of the month, in the client's reporting month. A date, not a range.
  month                 date not null,

  sessions_total        integer not null default 0,
  sessions_ai_referrer  integer not null default 0,
  sessions_utm          integer not null default 0,

  bookings_total        integer not null default 0,
  bookings_assistant    integer not null default 0,
  bookings_self         integer not null default 0,
  bookings_pixel_only   integer not null default 0,
  -- The number the guarantee turns on, frozen.
  bookings_qualified    integer not null default 0,

  computed_at           timestamptz not null default now()
);

alter table public.attribution_monthly drop constraint if exists attribution_monthly_uniq;
alter table public.attribution_monthly add constraint attribution_monthly_uniq
  unique (client_id, month);

alter table public.attribution_monthly enable row level security;

comment on table public.attribution_monthly is
  'Frozen monthly counts. The report reads THIS, never the raw tables, so the 180-day session '
  'purge cannot change a figure that has already been sent to a client.';
