-- Off-site: where the engines get their answers, and who to ask for a link.
-- Safe to run more than once.
--
-- ‼️ `citation_sources` IS NOT THIS TABLE AND DOES NOT EXIST. It is named in a comment in
-- src/lib/clients/harvest.ts and in eight docs/specs/*.md, and nowhere else: no table, no
-- migration, no reader, no writer. Anything written against that name is written against
-- nothing. This is net new.

-- ─────────────────────────────────────────────────────────────────────────────
-- offsite_targets — the domains the engines actually cite, rolled up
-- ─────────────────────────────────────────────────────────────────────────────
--
-- ‼️ BY DOMAIN, NOT BY URL, AND THAT IS THE WHOLE SHAPE OF THE TABLE. audit_runs.citations is
-- a flat list of URLs and one outlet is cited at twenty of them. A row per URL is a list
-- nobody can act on: you do not email an article, you email a publication. example_url keeps
-- one of them so a person can see what kind of page it was.
create table if not exists public.offsite_targets (
  id            uuid        primary key default gen_random_uuid(),
  client_id     uuid        not null references public.clients(id) on delete cascade,

  domain        text        not null,
  example_url   text,
  times_cited   integer     not null default 0,

  -- Which audit first turned this up, so a target traces back to the run that found it.
  first_seen_run_id uuid,

  kind          text        not null default 'unknown',
  status        text        not null default 'new',
  notes         text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.offsite_targets drop constraint if exists offsite_targets_kind_check;
alter table public.offsite_targets add constraint offsite_targets_kind_check
  check (kind in (
    'directory', 'listicle', 'forum', 'review_platform', 'news', 'competitor', 'client_own',
    -- ‼️ A SUBJECT WE NAMED ON A PAGE OF OUR OWN, WHICH IS A DIFFERENT KIND OF TARGET.
    -- Everything above came out of an engine's citations: a stranger we would be asking for a
    -- favour. A listed_subject is somebody we already put on a roundup, a comparison or a
    -- review, so the email is "you are in this" rather than "please link to me". Same table
    -- because the follow-up is the same; different kind because the first line is not.
    'listed_subject',
    'unknown'
  ));

alter table public.offsite_targets drop constraint if exists offsite_targets_status_check;
alter table public.offsite_targets add constraint offsite_targets_status_check
  check (status in ('new', 'queued', 'contacted', 'replied', 'won', 'skipped'));

-- One row per client per domain. A second sighting increments times_cited rather than
-- inserting, which is what makes the count mean anything.
create unique index if not exists offsite_targets_client_domain_key
  on public.offsite_targets (client_id, lower(domain));

create index if not exists offsite_targets_client_idx
  on public.offsite_targets (client_id, times_cited desc);

alter table public.offsite_targets enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- listing_submissions — the foundation listings, for a client or for SRT
-- ─────────────────────────────────────────────────────────────────────────────
--
-- ‼️ owner_kind, NOT A NULLABLE client_id. SRT runs its own hundred and thirty-eight through
-- the same machinery, and a null client_id would make every per-client query need an `is not
-- null` that somebody eventually forgets. Two kinds, stated.
create table if not exists public.listing_submissions (
  id            uuid        primary key default gen_random_uuid(),

  owner_kind    text        not null,
  -- A clients.id when owner_kind is 'client'. The literal 'srt' owns no row, so this is null
  -- for those and the CHECK below is what keeps the pair honest.
  owner_id      uuid,

  platform_key  text        not null,

  status        text        not null default 'missing',
  submitted_at  timestamptz,
  live_url      text,
  verified_at   timestamptz,
  cost_cents    integer     not null default 0,
  notes         text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.listing_submissions drop constraint if exists listing_submissions_owner_check;
alter table public.listing_submissions add constraint listing_submissions_owner_check
  check (
    (owner_kind = 'client' and owner_id is not null)
    or (owner_kind = 'srt' and owner_id is null)
  );

alter table public.listing_submissions drop constraint if exists listing_submissions_status_check;
alter table public.listing_submissions add constraint listing_submissions_status_check
  -- The same vocabulary client_dns_records uses, and for the same reason: `submitted` is a
  -- human saying they did it and `live` is a request that came back. Two facts, never one.
  check (status in ('missing', 'queued', 'submitted', 'live', 'rejected'));

create unique index if not exists listing_submissions_owner_platform_key
  on public.listing_submissions (owner_kind, coalesce(owner_id::text, ''), platform_key);

create index if not exists listing_submissions_verify_idx
  on public.listing_submissions (status, verified_at) where status = 'live';

alter table public.listing_submissions enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- The two CHECKs the outreach lane needs widened
-- ─────────────────────────────────────────────────────────────────────────────

-- `offsite` beside `nudge` and `pitch`. One line, and the queue, the pacing, the mailbox
-- rotation, the suppression list and the reply webhook are all reused as they are.
alter table public.outreach_send_queue drop constraint if exists outreach_send_queue_kind_check;
alter table public.outreach_send_queue add constraint outreach_send_queue_kind_check
  check (kind in ('nudge', 'pitch', 'offsite'));

-- ‼️ ALL SEVEN EXISTING VALUES PLUS THE NEW ONE, AND THE PROMPT'S LIST IS STALE BY ONE
-- MIGRATION. §13 quotes the five from docs/2026-08-26-evidence-and-gate.sql. The live
-- constraint is docs/2026-09-08-customer-review-evidence.sql, which added `review_screenshot`
-- and `review_tool`. Re-adding the five-value list would silently break the review evidence
-- lane, which is the kind of breakage that shows up as a customer's own review being refused.
alter table public.page_sources drop constraint if exists page_sources_via_check;
alter table public.page_sources add constraint page_sources_via_check
  check (
    collected_via is null
    or collected_via in (
      'slack_voice',
      'slack_typed',
      'board',
      'crawl',
      'audit',
      'review_screenshot',
      'review_tool',
      -- A named person answered a question we asked them, and their sentence is the source.
      -- Filed as EXTERNAL_RESEARCH, never AI_DERIVED: it is somebody's own words.
      'outreach_reply'
    )
  );

comment on table public.offsite_targets is
  'Domains the engines cite, rolled up per client, plus the subjects we named on our own roundups and reviews.';
comment on table public.listing_submissions is
  'Foundation directory listings for one client or for SRT itself. submitted is asserted; live is observed.';
