-- The market competitor dataset, the ammo supply columns, and the identity spine.
-- src/lib/market/*, src/lib/ammo/*, scripts/build-market-dataset.ts.
--
-- Safe to run more than once. Every statement is create-if-not-exists, add-column-if-not-exists,
-- create-or-replace, or a drop-then-add constraint. Nothing here drops a table or a column.
--
-- Nothing on main reads these objects yet, so this is safe to run against production today and
-- deploy after.
--
-- NO POSTGRES ENUMS. Text plus a named check, in the drop-then-add form, the same as
-- scraper_batches, chatgpt_ads_leads and lead_magnets. Widening a check is one statement; widening
-- an enum in a transaction with a running app is not.
--
-- ‼️ WHY A NEW TABLE AND NOT ONE OF THE FIVE EMPTY ONES. client_datasets, query_index,
-- fanout_citations, client_url_inventory and report_snapshots are all empty and all unreferenced
-- from this repo, so reusing one looked right. Four of them are defined in the SIBLING checkout
-- srt-mc-colony (docs/2026-08-31-colony-and-fanout.sql) against this same database, so they belong
-- to a live lane rather than being abandoned. The decisive one is fanout_citations: its run_id is
-- NOT NULL with an FK to fanout_runs, and every mention here is evidenced by an audit_runs row.
-- Storing this data there would mean inventing a fanout run for each one, which is exactly the
-- thing this lane exists to make impossible. None of the five is dropped or altered by this file.
--
-- ‼️ THE FK ON run_id IS THE POINT OF THE WHOLE TABLE, NOT BOOKKEEPING. A competitor may never be
-- invented, so a mention row cannot exist without the run that produced it. The database refuses
-- the orphan; scripts/_probe-market-ammo.ts then re-reads each row and asserts the run's own
-- `recommended` jsonb still contains the name. The FK cannot see inside jsonb and the probe cannot
-- prevent a write, so both are needed and neither is redundant.

create extension if not exists pgcrypto;

-- ── 1. market_mentions: one row per business named in one real run ──────────────────────────

create table if not exists public.market_mentions (
  id               uuid primary key default gen_random_uuid(),

  run_id           uuid not null references public.audit_runs(id) on delete cascade,
  report_id        uuid not null references public.audit_reports(id) on delete cascade,

  city             text not null,
  state            text,
  service          text not null,

  display_name     text not null,
  normalized_name  text not null,

  engine           text not null,
  prompt           text not null,

  cited_domains    text[] not null default '{}',

  seen_at          timestamptz not null,
  created_at       timestamptz not null default now()
);

comment on table public.market_mentions is
  'Who the AI engines actually named, per city and service, across every audit report including
   prospect scans. The market-level counterpart to competitor_candidates, which is per client.
   Every row traces to an audit_runs row by a NOT NULL foreign key: a competitor that no engine
   named cannot be represented here.';

comment on column public.market_mentions.run_id is
  'The audit_runs row whose response named this business. NOT NULL and cascading on purpose: if
   the evidence is deleted the claim goes with it, because a claim without evidence is the one
   thing this table may never hold.';
comment on column public.market_mentions.city is
  'Lowercased and punctuation-folded by src/lib/market/place.ts. Audits store "Austin, TX" while
   lead tables store "Austin" plus a separate spelled-out state, and a raw join between the two
   returns zero rows out of 2,671 leads. This column is the normalized half of that fix.';
comment on column public.market_mentions.state is
  'Two-letter postal code, or null when the source never said one. Never guessed: a wrong code
   files a business under the wrong state and then names its rivals to a stranger.';
comment on column public.market_mentions.service is
  'Lowercased vertical_slug, falling back to business_type. The second half of the market key.';
comment on column public.market_mentions.display_name is
  'The first spelling the engines used. The engines write one business several ways and there is
   no authority to prefer one, so the alternative is picking arbitrarily and pretending otherwise.';
comment on column public.market_mentions.normalized_name is
  'normalizeNameForCompare + stripEntitySuffix, the same pair competitor_candidates dedupes on.
   The grouping key, so one business written five ways is one competitor.';
comment on column public.market_mentions.cited_domains is
  'Domains cited in THIS run whose hostname contains this business name, matched conservatively
   (compacted name of 5+ characters must appear in the compacted host). It means "the engine cited
   this domain in the same answer that named them", which is weaker than "this is their website",
   and it under-claims deliberately. Empty is the common and correct case.';
comment on column public.market_mentions.seen_at is
  'audit_runs.created_at, copied so recency can be read without joining. The dataset ages and a
   two-year-old naming should not be presented as what ChatGPT says today.';

-- One business per run. Matches tallyRecommended, which counts a name repeated inside a single
-- prompt once, and is the upsert conflict target that makes the build script re-runnable.
create unique index if not exists market_mentions_run_name_key
  on public.market_mentions (run_id, normalized_name);

-- The lookup the ammo supply actually makes: everyone named in this city and service.
create index if not exists market_mentions_market_idx
  on public.market_mentions (city, state, service);

create index if not exists market_mentions_name_idx
  on public.market_mentions (normalized_name);

create index if not exists market_mentions_report_idx
  on public.market_mentions (report_id);

alter table public.market_mentions drop constraint if exists market_mentions_engine_check;
alter table public.market_mentions add constraint market_mentions_engine_check
  check (engine in ('openai', 'perplexity'));

-- Two uppercase letters or nothing. Rejects "Texas" and "tx" at the door rather than letting two
-- spellings of one state split a market in half.
alter table public.market_mentions drop constraint if exists market_mentions_state_check;
alter table public.market_mentions add constraint market_mentions_state_check
  check (state is null or state ~ '^[A-Z]{2}$');

alter table public.market_mentions drop constraint if exists market_mentions_city_check;
alter table public.market_mentions add constraint market_mentions_city_check
  check (length(trim(city)) > 0 and city = lower(city));

alter table public.market_mentions enable row level security;

drop policy if exists "Service role full access" on public.market_mentions;
create policy "Service role full access" on public.market_mentions
  for all to service_role using (true) with check (true);

revoke all on public.market_mentions from anon, authenticated;

-- ── 2. market_competitors: the rollup, as a VIEW ────────────────────────────────────────────
--
-- ‼️ A VIEW AND NOT A TABLE, DELIBERATELY. A rollup table would need refreshing after every audit
-- and would spend the rest of its life one build behind its own evidence. The counts here are
-- small (roughly three thousand mention rows) so there is nothing to buy by materializing, and a
-- stale competitor count is exactly the kind of quiet wrongness that ends up in an email.

create or replace view public.market_competitors as
select
  m.city,
  m.state,
  m.service,
  m.normalized_name,
  min(m.display_name)                          as display_name,
  count(*)::int                                as times_named,
  count(distinct m.run_id)::int                as run_count,
  count(distinct m.report_id)::int             as report_count,
  array_agg(distinct m.engine)                 as engines,
  (array_agg(distinct m.prompt))[1:3]          as sample_prompts,
  array_remove(array_agg(distinct d.domain), null) as cited_domains,
  min(m.seen_at)                               as first_seen,
  max(m.seen_at)                               as last_seen
from public.market_mentions m
left join lateral unnest(m.cited_domains) as d(domain) on true
group by m.city, m.state, m.service, m.normalized_name;

comment on view public.market_competitors is
  'market_mentions rolled up to one row per business per city and service. A view rather than a
   table so the counts can never drift from the evidence they are counted from. times_named counts
   mention rows; run_count counts distinct runs, and the two differ only if one run names a
   business under two spellings that normalize apart.';

-- ── 3. The scraper scores, carried onto the prospect and the contact ────────────────────────
--
-- These are computed today by scraper/score.ts and scraper/gbp-audit.ts, shown in a Slack card,
-- written into dominant.csv, and then dropped. Nothing in this repo has ever stored them against a
-- business. presence_score in particular has never had a column at all: presenceScore() computes
-- it in memory for the sort and it is gone the moment the card is posted.

alter table public.outreach_prospects
  add column if not exists gbp_place_id            text,
  add column if not exists dominance_score         integer,
  add column if not exists score_components        jsonb,
  add column if not exists optimization_score      integer,
  add column if not exists optimization_components jsonb,
  add column if not exists presence_score          integer,
  add column if not exists scores_updated_at       timestamptz;

comment on column public.outreach_prospects.presence_score is
  'The combined visibility score presenceScore() computes from the dominance and optimization
   components. Stored here because it is the sort key the scraper lane ranks on and it existed
   only in memory before this migration.';
comment on column public.outreach_prospects.scores_updated_at is
  'When the scores were last carried across from a scraper row. Null means never scored, which is
   different from scored zero and must stay distinguishable.';

alter table public.contacts
  add column if not exists google_place_id         text,
  add column if not exists dominance_score         integer,
  add column if not exists score_components        jsonb,
  add column if not exists optimization_score      integer,
  add column if not exists optimization_components jsonb,
  add column if not exists presence_score          integer,
  add column if not exists scores_updated_at       timestamptz;

comment on column public.contacts.google_place_id is
  'The Google place id, backfilled from the lead tables. contacts had no place id at all before
   this, while trt_leads, prospect_leads and med_spa_leads carry one on 100 percent of their rows,
   which made the CRM the only copy of a business that could not be matched to a scrape.';

-- Not unique. Two contacts legitimately sharing a place id is a duplicate to investigate, not a
-- write to reject, and a unique index here would fail the backfill on the first pair.
create index if not exists contacts_google_place_id_idx
  on public.contacts (google_place_id) where google_place_id is not null;

create index if not exists outreach_prospects_gbp_place_id_idx
  on public.outreach_prospects (gbp_place_id) where gbp_place_id is not null;

-- ── 4. The identity spine: contact_id on every lead table ───────────────────────────────────
--
-- ‼️ contacts IS THE SPINE. NO NEW IDENTITY TABLE. Measured before choosing: joining trt_leads,
-- prospect_leads and med_spa_leads to contacts on phone_last10 yields 1,973 matches, and every one
-- resolves to exactly ONE contact whose normalized business name agrees. Zero ambiguous, zero
-- disagreements. These businesses are already in contacts, so a second identity table would add a
-- grain and a join to every existing query to express a fact contacts already holds.
--
-- ‼️ NO FOREIGN KEY, MATCHING outreach_prospects.contact_id. contacts is console-created and has a
-- documented drift history (docs/2026-08-19-contacts-drift-repair.sql), and the followup operator
-- deliberately declined an FK for the same reason. Consistency with the existing column beats a
-- constraint on a table whose shape is not under version control.
--
-- A DO block because prospect_leads has no CREATE TABLE in any checkout on this machine: it exists
-- in production with 694 rows and was made by hand. Naming it in a bare ALTER would make this file
-- fail anywhere it has not been created, so each table is altered only if it is actually there.

do $$
declare
  t text;
begin
  foreach t in array array['trt_leads', 'prospect_leads', 'med_spa_leads', 'scraper_rows']
  loop
    if exists (select 1 from information_schema.tables
               where table_schema = 'public' and table_name = t) then
      execute format('alter table public.%I add column if not exists contact_id uuid', t);
      execute format(
        'create index if not exists %I on public.%I (contact_id) where contact_id is not null',
        t || '_contact_id_idx', t
      );
    end if;
  end loop;
end $$;

-- ── 5. Verification ─────────────────────────────────────────────────────────────────────────
-- These run in the same file because scripts/db.ts sends one statement at a time and autocommits,
-- so a failing SELECT here can no longer roll back the DDL above.

select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'market_mentions')            as market_mentions_cols,
  (select count(*) from information_schema.views
    where table_schema = 'public' and table_name = 'market_competitors')         as market_competitors_view,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'contacts'
      and column_name = 'google_place_id')                                       as contacts_place_id,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and column_name = 'contact_id'
      and table_name in ('trt_leads','prospect_leads','med_spa_leads','scraper_rows'))
                                                                                 as lead_tables_linked;
