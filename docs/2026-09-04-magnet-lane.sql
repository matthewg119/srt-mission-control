-- The magnet lane's write half: an audience somebody chose, and offers drafted with the page.
--
-- Additive, idempotent, safe to run more than once. Requires docs/2026-09-01-concierge.sql,
-- docs/2026-09-03-concierge-audience.sql and docs/2026-09-03-page-magnet.sql.
-- Runner: bun run scripts/db.ts --file=docs/2026-09-04-magnet-lane.sql [--dry]

-- =====================================================================
-- 1. AN AUDIENCE THAT WAS RATIFIED, TOLD APART FROM ONE THAT DEFAULTED
-- =====================================================================
--
-- concierge_configs.audience has been NOT NULL DEFAULT 'patient' since 2026-09-03, and
-- src/lib/clients/concierge-setup.ts has never written it. So every client provisioned so far
-- carries 'patient' because nobody said otherwise, and SRT carries 'owner' only because section 1
-- of that migration updated one row by hand, matched on slug.
--
-- Those two states are indistinguishable in the column, and they must not be. The audience decides
-- which magnet catalogue resolves, whether competitor ammo is offered at all, and where booking
-- hands off. Turning a widget on over a client's visitors under a value nobody chose is the
-- failure this pair of columns exists to make visible.
--
-- NOT A BOOLEAN. The timestamp and the actor are what make this readable months later, the same
-- shape clients.primary_avatar_confirmed_at and clients.day_0_archived_by already use. A boolean
-- would record that somebody agreed without recording who, or when.
alter table public.concierge_configs
  add column if not exists audience_confirmed_at timestamptz,
  add column if not exists audience_confirmed_by text;

comment on column public.concierge_configs.audience_confirmed_at is
  'When a person ratified `audience` on the concierge_preview card. Null means the value is still '
  'the seed that provisioning proposed, and the concierge_live verifier refuses while it is null.';

comment on column public.concierge_configs.audience_confirmed_by is
  'The Slack user who pressed the button. Free text, same convention as page_gate_runs.run_by.';

-- The one row that was already a deliberate decision. Matched on slug rather than a pasted uuid so
-- this file is portable and so re-running it cannot flip a row that was renamed underneath it.
-- The actor is the migration rather than a person, because that is literally who decided it, and
-- inventing a name here would be a green tick over an act nobody performed.
update public.concierge_configs cc
   set audience_confirmed_at = now(),
       audience_confirmed_by = 'migration:2026-09-03-concierge-audience',
       updated_at = now()
  from public.clients c
 where c.id = cc.client_id
   and c.slug = 'srt-agency-llc'
   and cc.audience = 'owner'
   and cc.audience_confirmed_at is null;


-- =====================================================================
-- 2. FIVE DRAFT OFFERS PER PAGE, HELD SOMEWHERE THAT IS NOT THE CATALOGUE
-- =====================================================================
--
-- A NEW TABLE RATHER THAN A `status` COLUMN ON lead_magnets, AND THERE ARE FOUR REASONS.
-- Nothing in src/ has ever inserted a lead_magnets row, so this is the first time the question has
-- had to be answered, and answering it wrong pollutes a catalogue every client's ladder walks.
--
--  1. lead_magnets_placement_key (2026-09-03-concierge-audience.sql) is UNIQUE over
--     (magnet_key, audience, client_id, vertical, treatment, category). A draft has no placement
--     yet. Five drafts for one page would collide on the identical all-null tuple, so holding them
--     there would force a placement to be invented before anybody had approved the offer.
--
--  2. The catalogue's hard invariant is that every row sharing a magnet_key agrees on title,
--     promise, asset_url and concierge_entry. scripts/_probe-concierge-lane.ts section 9 asserts it
--     rather than trusting it. Five drafts are five DIFFERENT offers, so each would need a distinct
--     key minted before approval, and the four nobody picks would be permanent junk in the ladder.
--
--  3. `active = false` would hide drafts from candidatesFor(), but it would make `active` mean two
--     things at once: "retired" and "not real yet". A reader cannot tell those apart.
--
--  4. A candidate belongs to a PAGE and should die with it. A magnet belongs to the CATALOGUE and
--     outlives every page that ever pointed at it. The cascade below is the honest expression of
--     that, and it is why page_id is a real foreign key while lead_magnets.magnet_key is not.
--
-- Approval MINTS a lead_magnets row. approveMagnetCandidate() in src/lib/concierge/magnet-drafts.ts
-- is the only place in src/ that inserts one, and it is reached only from a human act.
create table if not exists public.page_magnet_candidates (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  page_id   uuid not null references public.client_pages(id) on delete cascade,

  -- FROZEN AT DRAFT TIME, NOT RESOLVED AT APPROVAL TIME. The five were written for whoever the
  -- widget was talking to when the model wrote them. If somebody flips the client's audience
  -- afterwards, these drafts are about the wrong reader, and approving one would mint an owner
  -- offer into the patient catalogue. approveMagnetCandidate refuses on a mismatch.
  audience  text not null check (audience in ('patient', 'owner')),

  title text not null,
  promise text not null,

  -- NOT NULL HERE THOUGH IT IS NULLABLE ON lead_magnets, AND THAT IS DELIBERATE. On the catalogue
  -- a null cta_label falls back to the title and is a visible prompt to go and fill the column in.
  -- A row a MODEL wrote has no such excuse: it was asked for a label and either produced one under
  -- 28 characters or the whole batch was rejected. Letting it through null would ship the fallback
  -- path on purpose.
  cta_label text not null,
  concierge_entry text not null,

  -- Why this offer, in the model's own words, for the person reading five of them in Slack.
  -- Never copied onto the minted magnet: it is about the choice, not about the offer.
  rationale text,
  -- The S-numbers from loadNumberedEvidence() this candidate leaned on, so a reader can see which
  -- of them came from the business and which from outside research.
  evidence_refs jsonb not null default '[]'::jsonb,

  status text not null default 'draft' check (status in ('draft', 'approved', 'rejected')),
  -- Set when status becomes 'approved'. Points at the lead_magnets row that was minted, by KEY
  -- rather than by id, for the same reason client_pages.lead_magnet_key is a key: one magnet can
  -- hold several placements and an id would name half an offer.
  minted_magnet_key text,
  model text,

  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text
);

-- ONE APPROVED CANDIDATE PER PAGE, ENFORCED HERE RATHER THAN IN CODE. A page has exactly one
-- lead_magnet_key, so two approved candidates would mean one of them is a lie about what the page
-- offers. Partial, because 'draft' and 'rejected' are legitimately many per page.
create unique index if not exists page_magnet_candidates_one_approved
  on public.page_magnet_candidates (page_id) where status = 'approved';

create index if not exists page_magnet_candidates_page_idx
  on public.page_magnet_candidates (page_id, status, created_at desc);

comment on table public.page_magnet_candidates is
  'Drafted lead magnet offers for one page, written when the page is created and held here until a '
  'person picks one. Approving mints a client-scoped lead_magnets row and sets '
  'client_pages.lead_magnet_key. Nothing here is ever read by the widget.';

alter table public.page_magnet_candidates enable row level security;


-- =====================================================================
-- 3. WHAT THIS SHOULD LOOK LIKE AFTERWARDS
-- =====================================================================

-- Every tenant, and whether anybody has actually chosen its audience.
select c.slug,
       cc.audience,
       cc.enabled,
       case when cc.audience_confirmed_at is null then 'SEEDED, not confirmed'
            else 'confirmed by ' || coalesce(cc.audience_confirmed_by, '?') end as ratified
  from public.concierge_configs cc
  join public.clients c on c.id = cc.client_id
 order by cc.audience desc, c.slug;

-- Zero rows on a fresh run: the table is new and only the app writes it.
select status, count(*) from public.page_magnet_candidates group by status;

-- No approved candidate may disagree with the page it belongs to. This is the invariant
-- approveMagnetCandidate maintains, checked here from the other side.
select p.slug, p.lead_magnet_key, pmc.minted_magnet_key
  from public.page_magnet_candidates pmc
  join public.client_pages p on p.id = pmc.page_id
 where pmc.status = 'approved'
   and p.lead_magnet_key is distinct from pmc.minted_magnet_key;
