-- 2026-09-14 — the audience becomes a row the client owns, and the words become data
--
-- Matthew wants one workflow that serves every client, and three buyer shapes already exist:
-- srt-agency-llc sells to a med spa OWNER, a med spa sells to a PATIENT, la-casita sells to a
-- DINER. The preset layer holds two rows and neither is patient-facing.
--
-- ‼️ THE BUG IS A NAMESPACE COLLISION, NOT A MISSING PRESET. Three different things are called
-- "the audience": Vertical.audience in src/config/verticals.ts (dead, read by nothing), Audience in
-- concierge/magnets.ts (alive, two values, load-bearing), and the unnamed thing that
-- KEYWORD_CATEGORIES, PATIENT_HARD_LINES and patientPrompt each encode privately. Meanwhile the one
-- true shared-audience key already exists and nobody named it: question_bank (vertical, avatar) and
-- avatar_briefs (vertical, avatar_slug) are keyed on exactly the pair that identifies one buyer
-- shared across the clients who sell to them.
--
-- This file names that pair, gives each client a ROW that points at it and owns the words, and
-- leaves question_bank untouched: not one column, not one index, not one row. Research sharing is
-- preserved by construction rather than by care.
--
-- ‼️ STANCE AND VOCABULARY ARE SPLIT, AND THAT IS THE WHOLE DESIGN.
--   STANCE      structural: does the buyer buy from the CLIENT or from the SELLER. Stays a closed
--               two-value column using the strings already stored ('patient' / 'owner'), so
--               lead_magnets.audience, concierge_configs.audience, the placement unique index and
--               rungOf()'s firewall are all untouched.
--   VOCABULARY  'patient' / 'treatment' / 'clinic' / 'consultation'. These are not structural at
--               all. They are the med-spa preset leaking into every prompt, guard rail and label,
--               and they become data on the client's own row. This is what lets a taco restaurant
--               say diner / dish / restaurant without a code change.
--
-- ‼️ MEASURED BEFORE WRITING, AND IT CHANGED THE BACKFILL. The design this file implements derived
-- stance from concierge_configs.audience. THAT TABLE HAS ZERO ROWS, so that backfill would have
-- created zero client_audiences rows, including for SRT. Stance is derived from clients.vertical_slug
-- through the same closed allowlist OWNER_VERTICALS already uses instead, which is Layer 1 read
-- once at seed time and is what the design calls for anyway.
--
-- Additive, idempotent, safe to run more than once.
-- Runner: bun run scripts/db.ts --file=docs/2026-09-14-client-audiences.sql [--dry]
--
-- ‼️ RUN IT BEFORE THE DEPLOY THAT READS IT. One unknown column fails the WHOLE PostgREST select
-- and supabase-js RETURNS that error rather than throwing, so every client verifier would refuse at
-- once rather than degrade.


-- =====================================================================
-- 1. THE CLIENT'S OWN AUDIENCE
-- =====================================================================
--
-- ‼️ A PRESET IS READ EXACTLY ONCE, AT SEED TIME, AND THE RESULT IS WRITTEN HERE. Nothing
-- recomputes it at read time. seeded_from and seeded_at record that it happened.
--
-- That single rule is the only thing separating this design from mergeRowOverSeed() in
-- verticals.ts, which is the worst function in the probe precisely because its merge runs on EVERY
-- call: loadVertical('aeo-agency-med-spa') recomputes pest control every time and no row anywhere
-- records that it did. One read-time fallback added here in a hurry and this table IS verticals.ts
-- with a nicer name. That is the invariant to defend in review.
--
-- The second consequence is wanted: if a preset changes next month, existing clients do not change.
-- That is correct for copy already live on somebody's domain, and the same reason
-- question_set_versions is frozen and never edited in place.
create table if not exists public.client_audiences (
  id                      uuid primary key default gen_random_uuid(),
  client_id               uuid not null references public.clients(id) on delete cascade,

  -- 'medspa-owner', 'lip-filler-patient', 'weeknight-diner'. Said to a person on a card.
  slug                    text not null,
  label                   text not null,

  -- ‼️ THE CLOSED TWO-VALUE STANCE, USING THE STRINGS ALREADY STORED EVERYWHERE ELSE.
  -- Widening this to add 'customer' would split rungOf()'s firewall: every library 'patient'
  -- magnet becomes unreachable for a 'customer' client, the universal fallback stops terminating
  -- and resolveMagnet() can return null, which is the one thing docs/2026-09-01-concierge.sql
  -- protects against in capitals. The honest rename is a SECOND migration, once this table is the
  -- only reader of the literal. Until then a taco shop's stance reads 'patient' in psql and the
  -- table comment below carries the reading.
  stance                  text not null check (stance in ('patient', 'owner')),

  -- The SHARED research namespace. Joins question_bank.vertical and avatar_briefs.vertical.
  -- A null avatar_slug is not a gap: it means "read the untagged question_bank rows", which is
  -- what evidenceRows() already does.
  research_vertical       text not null,
  research_avatar_slug    text,

  is_primary              boolean not null default false,

  -- ‼️ THE VOCABULARY COLUMNS ARE NULLABLE AND THE NOT-NULL-NESS LIVES IN THE READ PATH.
  -- audienceFor() returns {ok:false, error} naming the repair when a hot noun is missing, the same
  -- refusal shape verticalFor() already uses. A nullable column with a refusing reader is honest.
  -- A `not null default 'patient'` column is concierge_configs.audience's default all over again:
  -- a defaulted value and a chosen one become indistinguishable.
  buyer_noun_singular     text,
  buyer_noun_plural       text,
  offer_noun_singular     text,
  offer_noun_plural       text,
  business_noun           text,
  visit_noun              text,

  -- The long tail, so a new word does not need a migration.
  vocabulary              jsonb not null default '{}'::jsonb,
  vocabulary_source       text check (vocabulary_source is null
                                      or vocabulary_source in ('preset', 'legacy_default', 'typed')),
  vocabulary_confirmed_at timestamptz,
  vocabulary_confirmed_by text,

  lane_name               text,
  launcher_label          text,

  -- The clinical guards move OUT of PATIENT_HARD_LINES and onto the row. p3 "never quote a price
  -- for a treatment" is not a safety rule, it is a med-spa business rule, and it has been silently
  -- forbidding every non-clinical client from answering their customer's most common question.
  hard_lines              text[] not null default '{}',

  -- RealSelf, Healthgrades and the NPI registry stop being universal. Today every client, agency
  -- and restaurant included, is swept against them and a missing RealSelf profile counts against
  -- the CORE_SIX gate.
  presence_platform_keys  text[] not null default '{}',

  question_set_preset     text,

  seeded_from             text,
  seeded_at               timestamptz,
  confirmed_at            timestamptz,
  confirmed_by            text,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create unique index if not exists client_audiences_client_slug
  on public.client_audiences (client_id, slug);

-- ‼️ AT MOST ONE PRIMARY, ENFORCED BY THE DATABASE. A `primary_audience_id` column on clients
-- would be a second source of truth for the same fact, and the two would drift.
-- A partial index, NOT a constraint: ON CONFLICT infers by matching key expressions and a bare
-- column list does not match a partial index (42P10), so nothing may upsert on this.
create unique index if not exists client_audiences_one_primary
  on public.client_audiences (client_id) where is_primary;

alter table public.client_audiences enable row level security;

comment on table public.client_audiences is
  'One row per buyer a client sells to, seeded once from a code preset and owned by the client '
  'afterwards. ‼️ stance is STRUCTURAL (does the buyer buy from the client or from the seller) and '
  'its two stored values are ''patient'' and ''owner'' for compatibility with lead_magnets.audience '
  'and the concierge firewall. A non-clinical end customer, such as a restaurant diner, is stored '
  'as ''patient'' today: read it as "buys from the client", never as a medical word. The vocabulary '
  'columns are what actually carry the nouns.';

comment on column public.client_audiences.research_vertical is
  'Joins question_bank.vertical and avatar_briefs.vertical. This is the SHARED half: two clients '
  'selling to the same buyer share a corpus, which is what makes the second med spa cheap.';

comment on column public.client_audiences.vocabulary_source is
  '''preset'' a code preset seeded it; ''legacy_default'' it was inherited from the old two-lane '
  'defaults and records the status quo rather than a decision; ''typed'' a person wrote it. '
  'A null vocabulary_confirmed_at with source legacy_default is the case the card must ask about.';


-- =====================================================================
-- 2. avatar_briefs BECOMES THE SHARED PRESET
-- =====================================================================
--
-- ‼️ WIDENED, NOT REPLACED, AND THE NAME STAYS. avatar_briefs is ALREADY the shared-audience
-- record: keyed (vertical, avatar_slug), the same pair as question_bank, and its own comment says
-- why -- "the whole value is that the second med spa aiming at laser hair removal gets the first
-- one's research". It is a few columns short of being the audience preset. Renaming a table with
-- live readers buys nothing.
-- ‼️ preset_key WAS HERE AND IS GONE. See docs/2026-09-25-drop-preset-key.sql. Zero readers ever,
-- no CHECK and no comment: the per-client answer is client_audiences.seeded_from, which every reader
-- already selects. default_stance below STAYS and now has a reader (defaultStanceFor in
-- clients/avatars.ts), where it is printed as a suggestion a person confirms.
alter table public.avatar_briefs add column if not exists default_stance text;
alter table public.avatar_briefs add column if not exists buyer_noun_singular text;
alter table public.avatar_briefs add column if not exists buyer_noun_plural text;
alter table public.avatar_briefs add column if not exists offer_noun_singular text;
alter table public.avatar_briefs add column if not exists offer_noun_plural text;
alter table public.avatar_briefs add column if not exists business_noun text;
alter table public.avatar_briefs add column if not exists visit_noun text;
alter table public.avatar_briefs add column if not exists lane_name text;
alter table public.avatar_briefs add column if not exists launcher_label text;
alter table public.avatar_briefs add column if not exists hard_lines text[];
alter table public.avatar_briefs add column if not exists presence_platform_keys text[];
alter table public.avatar_briefs add column if not exists question_set_preset text;
alter table public.avatar_briefs add column if not exists keyword_categories jsonb;
alter table public.avatar_briefs add column if not exists voc_quotes jsonb;
alter table public.avatar_briefs add column if not exists approved_numbers jsonb;

alter table public.avatar_briefs drop constraint if exists avatar_briefs_default_stance_check;
alter table public.avatar_briefs add constraint avatar_briefs_default_stance_check
  check (default_stance is null or default_stance in ('patient', 'owner'));

comment on column public.avatar_briefs.approved_numbers is
  'The ONLY figures copy for this audience may state, as [{value, source_url, approved_by, '
  'approved_at}]. ‼️ PROVENANCE PER ENTRY, not a bare text[] like the seed it replaces, because '
  'these end up as numbers in a client-facing headline and "backed, not banned" has to mean backed '
  'by something nameable. An EMPTY list forbids every figure, which is correct and is visible.';

comment on column public.avatar_briefs.voc_quotes is
  'Voice-of-customer quotes shared across every client selling to this audience, as [{text, source, '
  'source_url}]. Tier 2 behind the client''s own CUSTOMER_REVIEW rows in page_sources, which always '
  'win. There is no tier 3: no seed, no default, nothing inherited from another audience.';


-- =====================================================================
-- 3. THE 20 QUOTES AND THE 6 NUMBERS MOVE OUT OF CODE
-- =====================================================================
--
-- ‼️ THIS IS WHY approved_numbers HAS BEEN EMPTY FOR EVERY VERTICAL BUT ONE. In verticals.ts it is
-- one of seven fields hard-assigned from the SEED and never settable from the database, so a row
-- cannot carry it. It exists on exactly one seed, MEDSPA_OWNER_AI. Everywhere else the list is
-- empty, and an empty approved-numbers list forbids every figure, so "backed, not banned" collapses
-- back into "banned" for every audience except one. Moving it to a row is what fixes that for the
-- next audience rather than for this one.
--
-- The quotes already live on the verticals ROW (20 of them, seeded 2026-08-26). The numbers live
-- only in code. Both land on the avatar_briefs row SRT already points at.
update public.avatar_briefs b
set voc_quotes = coalesce(
      b.voc_quotes,
      (select v.voc_quotes from public.verticals v where v.id = 'medspa_owner_ai')
    ),
    updated_at = now()
where b.vertical = 'aeo-agency-med-spa'
  and b.avatar_slug = 'med-spa-owner';

-- ‼️ THE VALUE CARRIES ITS OWN SOURCE, VERBATIM, because that is what approvedNumbersBlock renders
-- and what _probe-dr-headlines asserts ("carries the stat with its source attached"). source_url is
-- null rather than invented: the seed never had URLs and fabricating them would be the exact thing
-- an approved-numbers list exists to prevent.
update public.avatar_briefs
set approved_numbers = coalesce(approved_numbers, $an$[
  {"value": "45% of consumers use AI for local recommendations, vs 6% a year ago (BrightLocal, n=1,002, Feb 2026)", "source_url": null, "approved_by": "config/verticals.ts MEDSPA_OWNER_AI", "approved_at": "2026-09-14"},
  {"value": "230 million health questions a week on ChatGPT (OpenAI, Jan 2026)", "source_url": null, "approved_by": "config/verticals.ts MEDSPA_OWNER_AI", "approved_at": "2026-09-14"},
  {"value": "only 1.2% of local businesses appear in ChatGPT, vs 35.9% in Google's local pack (SOCi, 350,000 locations, 2026)", "source_url": null, "approved_by": "config/verticals.ts MEDSPA_OWNER_AI", "approved_at": "2026-09-14"},
  {"value": "around 85% of AI citations come from off-site third-party sources (arXiv; Muck Rack; Ranqo)", "source_url": null, "approved_by": "config/verticals.ts MEDSPA_OWNER_AI", "approved_at": "2026-09-14"},
  {"value": "web-traffic-to-citation correlation is r=0.02 (Brandlight)", "source_url": null, "approved_by": "config/verticals.ts MEDSPA_OWNER_AI", "approved_at": "2026-09-14"},
  {"value": "42% of searchers click the local pack (the 2005 Google Maps window)", "source_url": null, "approved_by": "config/verticals.ts MEDSPA_OWNER_AI", "approved_at": "2026-09-14"}
]$an$::jsonb),
    default_stance = coalesce(default_stance, 'owner'),
    updated_at = now()
where vertical = 'aeo-agency-med-spa'
  and avatar_slug = 'med-spa-owner';


-- =====================================================================
-- 4. THE POINTERS
-- =====================================================================
--
-- Nullable everywhere. A null audience_id on a lead_magnets row means a LIBRARY row belonging to no
-- client audience, which is what most of them are.
alter table public.concierge_configs
  add column if not exists audience_id uuid references public.client_audiences(id) on delete set null;
alter table public.lead_magnets
  add column if not exists audience_id uuid references public.client_audiences(id) on delete set null;
alter table public.page_magnet_candidates
  add column if not exists audience_id uuid references public.client_audiences(id) on delete set null;
alter table public.client_workflow_runs
  add column if not exists audience_id uuid references public.client_audiences(id) on delete set null;

-- ‼️ THE SECOND ROUTE TO "LA CASITA IS A MED SPA", CLOSED. concierge-setup.ts:188 already had its
-- `|| "medspa"` literal removed with an eight-line comment explaining why, and this default put it
-- straight back one layer down: config.ts reads `str(row.vertical) ?? "medspa"` off a column whose
-- own default is 'medspa'. A taco shop that never chose anything reads as a med spa twice over.
alter table public.concierge_configs alter column vertical drop default;
alter table public.concierge_configs alter column vertical drop not null;

comment on column public.concierge_configs.vertical is
  'DEPRECATED as a source of truth. Read client_audiences.research_vertical through audience_id '
  'instead. The `default ''medspa''` was dropped 2026-09-14: it was the second independent route to '
  'filing a non-clinical client as a med spa, and a defaulted value is indistinguishable from a '
  'chosen one.';


-- =====================================================================
-- 5. THE BACKFILL
-- =====================================================================
--
-- ‼️ DETERMINISTIC, NO MODEL CALL, AND IT DOES NOT RE-ONBOARD ANYBODY. Every value is derived from
-- something already on the client row. srt-agency-llc keeps its confirmed avatar and its 41 seeded
-- board rows; nothing about its delivery board is touched.
--
-- ‼️ RESOLVED BY vertical_slug, NEVER BY A PINNED ID OR A SLUG LITERAL. srt-agency-llc has been
-- re-onboarded twice and its id has changed; the standing rule for this codebase is to resolve it
-- the same way every other client is resolved.
--
-- The allowlist is the same three keys OWNER_VERTICALS holds in audience-proposal.ts, and for the
-- reason its own header gives: "matching 'agency' loosely would silently claim every marketing
-- client that ever onboards." A client whose vertical is not on it gets NO ROW, and every reader
-- then refuses with a fix line. That refusal is the correct answer for la-casita today: it has no
-- vertical_slug at all, because it has never been onboarded.
insert into public.client_audiences (
  client_id, slug, label, stance, research_vertical, research_avatar_slug, is_primary,
  buyer_noun_singular, buyer_noun_plural, offer_noun_singular, offer_noun_plural,
  business_noun, visit_noun, lane_name, launcher_label,
  presence_platform_keys, vocabulary_source, seeded_from, seeded_at
)
select
  c.id,
  coalesce(nullif(trim(c.primary_avatar_slug), ''), 'primary'),
  coalesce(nullif(trim(c.primary_avatar_label), ''), 'the buyer'),
  'owner',
  c.vertical_slug,
  nullif(trim(c.primary_avatar_slug), ''),
  true,
  'med spa owner', 'med spa owners',
  'service', 'services',
  -- ‼️ 'agency', NOT 'clinic'. SRT is an agency that SELLS TO clinics, and this is the noun that
  -- stops ownerPrompt and engine.ts hardcoding "clinic" into copy written in SRT's own voice.
  'agency', 'call',
  'AI Visibility Concierge', 'Check my visibility',
  -- RealSelf and the NPI Registry are gone for an agency. The sweep gate is already "four distinct
  -- platforms of any tier", so dropping two does not break it.
  array['google', 'facebook', 'bbb', 'trustpilot'],
  'preset',
  'aeo_agency_owner',
  now()
from public.clients c
where lower(trim(coalesce(c.vertical_slug, ''))) in
      ('aeo-agency', 'aeo-agency-med-spa', 'aeo-marketing-agency')
on conflict (client_id, slug) do nothing;


-- =====================================================================
-- VERIFICATION
-- =====================================================================

-- Expect ONE row: srt-agency-llc, stance owner, research_vertical aeo-agency-med-spa,
-- research_avatar_slug med-spa-owner, seeded_from aeo_agency_owner.
select c.slug as client, a.slug, a.stance, a.research_vertical, a.research_avatar_slug,
       a.business_noun, a.vocabulary_source, a.confirmed_at
from public.client_audiences a
join public.clients c on c.id = a.client_id
order by c.slug;

-- Expect la-casita and the four flow* test rows to appear here with no audience. That is the
-- designed refusal, not a gap: none of them has been onboarded or classified.
select c.slug, c.vertical_slug, c.business_type
from public.clients c
left join public.client_audiences a on a.client_id = c.id
where a.id is null
order by c.slug;

-- Expect 20 quotes and 6 approved numbers on the shared preset row.
select vertical, avatar_slug, default_stance,
       jsonb_array_length(coalesce(voc_quotes, '[]'::jsonb))       as quotes,
       jsonb_array_length(coalesce(approved_numbers, '[]'::jsonb)) as numbers
from public.avatar_briefs
order by vertical;

-- Expect concierge_configs.vertical to have no default and to be nullable.
select column_name, column_default, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'concierge_configs' and column_name = 'vertical';
