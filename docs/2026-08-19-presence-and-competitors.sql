-- The presence sweep log and the competitor shortlist.
--
-- Safe to run more than once.
--
-- WHY THIS EXISTS. Findings sections 2 and 3 have nowhere to read from. Runner v3 section 6
-- specifies nap_discrepancies and section 7 specifies competitor_candidates, and neither table
-- exists anywhere in this repo. Until they do, the presence PDF has nothing to print and the
-- review gap has no competitors to compare against.
--
-- ‼️ NO PRESENCE PROVIDER IS KEYED. Google Places, Bing Maps, Foursquare and Yelp Fusion are
-- all unkeyed, verified 2026-08-18. So every row in nap_discrepancies arrives from the MANUAL
-- sweep today: a human searches the string the Slack card already composes, screenshots what
-- they see, and the file_shared handler files it. The 'api' source value exists so an automated
-- tier can be added later without a migration, not because anything writes it now.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. What is published about this business, everywhere
-- ─────────────────────────────────────────────────────────────────────────────
--
-- ‼️ 'not_checked' IS A FIRST-CLASS STATUS AND THAT IS THE WHOLE POINT OF THIS TABLE.
-- Runner v3 section 6: "A skipped platform renders as 'not checked,' NEVER as 'no issues
-- found.'" Those two sentences look similar on a PDF and mean opposite things — one is evidence
-- of correctness, the other is an absence of evidence. A client reading "no issues found" for a
-- platform nobody opened has been told something false about their own business.
--
-- The default is 'not_checked' so a row created by seeding the eighteen platforms says the true
-- thing until somebody actually looks.
create table if not exists public.nap_discrepancies (
  id           uuid        primary key default gen_random_uuid(),
  client_id    uuid        not null references public.clients(id) on delete cascade,

  platform     text        not null,

  -- A core-six mismatch and a Manta mismatch are not equivalent, and no artifact may imply they
  -- are. Core six is the findings gate and the only tier remediated in week one; extended is
  -- context. Runner v3 section 6 keeps them apart, so the column does too.
  tier         text        not null,

  source       text        not null default 'manual',
  status       text        not null default 'not_checked',

  -- The RAW listed values, exactly as published. NOT normalized.
  -- Normalization decides whether something MATCHES; the client-facing document has to show
  -- what is actually live on the internet today, and "Ste 200" versus "Suite 200" is the
  -- finding. Normalizing before storage would destroy the evidence to save a function call.
  raw_name     text,
  raw_address  text,
  raw_phone    text,

  listing_url  text,
  claimed      boolean,

  -- The screenshot. For a 'missing' listing this is a picture of an empty search result, which
  -- IS the evidence — Runner v3 section 6 says so explicitly.
  screenshot_ref uuid      references public.client_docs(id) on delete set null,

  -- ‼️ TWO STATUS COLUMNS, AND THE SECOND ONE IS ONLY EVER WRITTEN BY A HUMAN CLICK.
  -- Runner v3 section 6: "NEVER auto-mark a listing verified. The tool proposes; I confirm."
  -- proposed_status is what the comparison thinks. confirmed_status is what Matthew says after
  -- looking at the screenshot. A remediation list built from proposed_status would send someone
  -- to edit a listing on the strength of a string comparison.
  proposed_status  text,
  confirmed_status text,

  skip_reason  text,
  checked_by   text,
  checked_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.nap_discrepancies drop constraint if exists nap_discrepancies_tier_check;
alter table public.nap_discrepancies add constraint nap_discrepancies_tier_check
  check (tier in ('core_six', 'extended'));

alter table public.nap_discrepancies drop constraint if exists nap_discrepancies_source_check;
alter table public.nap_discrepancies add constraint nap_discrepancies_source_check
  check (source in ('api', 'manual'));

-- One vocabulary for all three status columns. 'duplicate' is two or more live listings for one
-- business on one platform, which is a different problem from a mismatch and is fixed a
-- different way (a merge request, weeks, not an edit).
alter table public.nap_discrepancies drop constraint if exists nap_discrepancies_status_check;
alter table public.nap_discrepancies add constraint nap_discrepancies_status_check
  check (status in ('match', 'mismatch', 'duplicate', 'missing', 'not_checked'));

alter table public.nap_discrepancies drop constraint if exists nap_discrepancies_proposed_check;
alter table public.nap_discrepancies add constraint nap_discrepancies_proposed_check
  check (proposed_status is null or proposed_status in
    ('match', 'mismatch', 'duplicate', 'missing', 'not_checked'));

alter table public.nap_discrepancies drop constraint if exists nap_discrepancies_confirmed_check;
alter table public.nap_discrepancies add constraint nap_discrepancies_confirmed_check
  check (confirmed_status is null or confirmed_status in
    ('match', 'mismatch', 'duplicate', 'missing', 'not_checked'));

-- A business can legitimately have two rows for one platform: that is what 'duplicate' means.
-- So the uniqueness is per listing, not per platform, and a platform with no listing url yet
-- gets one row.
create unique index if not exists nap_discrepancies_platform_listing_key
  on public.nap_discrepancies (client_id, platform, coalesce(listing_url, ''));

create index if not exists nap_discrepancies_client_idx
  on public.nap_discrepancies (client_id, tier, status);

alter table public.nap_discrepancies enable row level security;

comment on table public.nap_discrepancies is
  'Runner v3 section 6. The presence sweep log across eighteen platforms in two tiers. Every '
  'presence provider is unkeyed, so rows arrive from the manual sweep. status ''not_checked'' is '
  'a real answer and must never render as ''no issues found''.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Who the engines actually name
-- ─────────────────────────────────────────────────────────────────────────────
--
-- ‼️ THE CLIENT'S THREE GUESSES ARE NOT THE AUDIT SET. Runner v3 section 7: "Do not use the
-- client's three guesses as the audit set. Use them as candidates alongside who the engines
-- actually named." A clinic naming three competitors nobody's AI has ever mentioned is itself a
-- finding worth saying out loud on the call, and that finding only exists if both sources are
-- kept and labelled.
--
-- Candidates are ranked by times_named across the twenty questions, computed from
-- audit_runs.recommended (0-5 business names per prompt, produced by extract-recommended.ts).
create table if not exists public.competitor_candidates (
  id           uuid        primary key default gen_random_uuid(),
  client_id    uuid        not null references public.clients(id) on delete cascade,

  name         text        not null,
  normalized_name text     not null,
  address      text,
  place_id     text,
  website      text,

  source       text        not null,

  times_named  integer     not null default 0,
  engines      text[]      not null default '{}',
  -- The question text AS RUN, copied. Never a reference into audit_reports.prompts, which is
  -- REGENERATED by every run — a reference would silently rewrite the example question under a
  -- shortlist that was already decided.
  sample_questions text[]  not null default '{}',

  -- Exactly three get selected, by a person, on the shortlist card.
  selected     boolean     not null default false,
  selected_at  timestamptz,
  selected_by  text,

  created_at   timestamptz not null default now()
);

alter table public.competitor_candidates drop constraint if exists competitor_candidates_source_check;
alter table public.competitor_candidates add constraint competitor_candidates_source_check
  check (source in ('baseline_named', 'client_intake', 'both'));

-- De-duplicated on the NORMALIZED name, because the engines write one business five ways.
create unique index if not exists competitor_candidates_client_name_key
  on public.competitor_candidates (client_id, normalized_name);

create index if not exists competitor_candidates_rank_idx
  on public.competitor_candidates (client_id, selected, times_named desc);

alter table public.competitor_candidates enable row level security;

comment on table public.competitor_candidates is
  'Runner v3 section 7. Ten candidates, three selected by a human. National chains and '
  'aggregator pages are excluded before insert (Integrity Law 7: those are a consensus lock, '
  'not competitors). Feeds findings section 3.';

-- ─────────────────────────────────────────────────────────────────────────────
-- What to expect
-- ─────────────────────────────────────────────────────────────────────────────
--
-- select tier, status, count(*) from public.nap_discrepancies group by 1,2 order by 1,2;
--   After the sweep seeds a client: 6 core_six + 12 extended, all 'not_checked'. That is
--   correct and the PDF will say exactly that.
--
-- select count(*) filter (where selected) as picked, count(*) as candidates
--   from public.competitor_candidates group by client_id;
--   picked must be 0 or 3. Nothing downstream proceeds on 1 or 2.
