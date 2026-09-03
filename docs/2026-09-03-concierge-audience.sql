-- Lane B: the owner concierge. One engine, two audiences.
--
-- Additive, idempotent, safe to run more than once. Requires docs/2026-09-01-concierge.sql.
-- Runner: bun run scripts/db.ts --file=docs/2026-09-03-concierge-audience.sql [--dry]
--
-- ‼️ WHY AN audience COLUMN AND NOT A SECOND SET OF TABLES. The patient concierge on a med spa's
-- site and the owner concierge on ours are the same machine pointed at different people: same
-- session row, same message ledger, same magnet resolver, same turn route. Matthew's framing,
-- 2026-09-03: "both are the same thing but for different clients". SRT is already a client row
-- (srt-agency-llc) with learn.srtagency.com already attached and a concierge_configs row already
-- seeded by the concierge_preview step, so the owner lane is a tenant, not a codebase.
--
-- ‼️ AND THE COLUMN IS EXPLICIT, NEVER DERIVED FROM vertical. Reading the audience off
-- vertical_slug would mean that the day a second AEO agency onboards as a client, their patients
-- start getting pitched on booking a call with us. Who is reading is not something to infer from a
-- classifier's free text.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Who is this widget talking to.
-- ─────────────────────────────────────────────────────────────────────
alter table public.concierge_configs
  add column if not exists audience text not null default 'patient';

alter table public.concierge_configs drop constraint if exists concierge_configs_audience_check;
alter table public.concierge_configs add constraint concierge_configs_audience_check
  check (audience in ('patient', 'owner'));

comment on column public.concierge_configs.audience is
  'patient = a visitor to this client''s site who might book a treatment. owner = a business owner '
  'reading our own content who might book a call with SRT. Decides which magnet catalogue resolves, '
  'whether competitor ammo is offered at all, and where the booking hands off to. Defaults to '
  'patient, because a config row created by provisioning for a real clinic is always that case.';

-- The one owner tenant today. Matched on slug rather than a pasted uuid so this file is portable
-- and so re-running it cannot flip a row that was renamed underneath it.
update public.concierge_configs cc
   set audience = 'owner', updated_at = now()
  from public.clients c
 where c.id = cc.client_id
   and c.slug = 'srt-agency-llc'
   and cc.audience is distinct from 'owner';


-- ─────────────────────────────────────────────────────────────────────
-- 2. The session's own ammo ledger.
--
-- ‼️ A VISITOR HAS NO outreach_prospects ROW, WHICH IS THE ONLY PLACE ammo_used LIVES TODAY. A
-- stranger who lands on a post is not a prospect anybody enrolled. So the session carries its own
-- ledger in the SAME shape, [{kind, detail, step}], so spentAmmo() reads both with no second parser
-- and ammoKey() stays the one identity function in the codebase.
--
-- On start, when the visitor resolves to a contact that HAS a prospect row, the session ledger is
-- seeded FROM outreach_prospects.ammo_used, so the bot never repeats an argument the email operator
-- already spent. spend.ts predicted this exact moment: "If ammo ever gets spent from two lanes at
-- once this becomes an append via an ammo_touches table." It is not that yet, because only one lane
-- writes at a time and a column on the session is the cheaper correct answer.
-- ─────────────────────────────────────────────────────────────────────
alter table public.concierge_sessions
  add column if not exists ammo_used jsonb not null default '[]'::jsonb,
  add column if not exists magnets_delivered jsonb not null default '[]'::jsonb;

comment on column public.concierge_sessions.ammo_used is
  'Same shape as outreach_prospects.ammo_used: [{kind, detail, step}]. Seeded from the prospect '
  'ledger at session start when the visitor is known, so one argument is never spent twice across '
  'the email lane and the widget.';

comment on column public.concierge_sessions.magnets_delivered is
  'Array of lead_magnets.magnet_key strings already handed over in this session. The chaining gate '
  'counts this, which is what lets offer_booking refuse before two things have actually been given. '
  'Distinct from magnet_id, which records the ONE magnet attributed to the outcome.';


-- ─────────────────────────────────────────────────────────────────────
-- 3. Magnets gain an audience, a stable key, and the chain.
--
-- ‼️ audience IS THE FIREWALL, AND WITHOUT IT LANE B BREAKS LANE A. An owner magnet is a library
-- magnet (client_id null), and the resolver's library rungs match every client. Seeding "The AI
-- Visibility Scan" without this column would put it in front of a patient reading a filler page on
-- a clinic's own website.
-- ─────────────────────────────────────────────────────────────────────
alter table public.lead_magnets
  add column if not exists audience text not null default 'patient',
  add column if not exists magnet_key text,
  add column if not exists chains_to_key text;

alter table public.lead_magnets drop constraint if exists lead_magnets_audience_check;
alter table public.lead_magnets add constraint lead_magnets_audience_check
  check (audience in ('patient', 'owner'));

-- ‼️ NO SELF CHAIN. One hop then the ask is the rule, so a magnet pointing at itself is a loop the
-- delivered-set would have to catch at runtime instead of one the schema simply refuses. Longer
-- cycles are prevented in the executor by the one-hop limit, not here: a two-row cycle is the only
-- one a CHECK can see without a recursive query, and a half-guarantee in a constraint reads as a
-- whole one.
alter table public.lead_magnets drop constraint if exists lead_magnets_chain_check;
alter table public.lead_magnets add constraint lead_magnets_chain_check
  check (chains_to_key is null or magnet_key is null or chains_to_key <> magnet_key);

-- ‼️ THE UNIQUE KEY IS THE PLACEMENT, NOT THE MAGNET. One magnet legitimately sits at more than one
-- rung: city_rivals answers a Comparison post and a Neighbourhood post with the same asset. So
-- magnet_key alone cannot be unique. coalesce'd because a plain UNIQUE treats two NULLs as
-- distinct, which would let the identical wildcard placement be inserted twice and make the ladder
-- non-deterministic, which is the one thing sort_order exists to prevent.
create unique index if not exists lead_magnets_placement_key
  on public.lead_magnets (
    magnet_key,
    audience,
    coalesce(client_id::text, ''),
    coalesce(vertical, ''),
    coalesce(treatment, ''),
    coalesce(category, '')
  ) where magnet_key is not null;

create index if not exists lead_magnets_audience_resolve_idx
  on public.lead_magnets (audience, vertical, treatment, category, sort_order) where active;

comment on column public.lead_magnets.magnet_key is
  'Stable slug. It is what chains_to_key points at and what concierge_sessions.magnets_delivered '
  'records. NOT unique on its own, because one magnet can hold several placements. Every row '
  'sharing a key must carry identical title, promise, asset_url and concierge_entry, which '
  'scripts/_probe-concierge-lane.ts asserts rather than trusting.';

comment on column public.lead_magnets.chains_to_key is
  'The magnet offered next once this one is delivered. Resolved by the executor, never chosen by '
  'the model. Null ends the chain at the booking ask.';


-- ─────────────────────────────────────────────────────────────────────
-- 4. The catalogues.
--
-- ‼️ THE LIBRARY LADDER IN docs/2026-09-01-concierge.sql HAS HOLES, AND THE RESOLVER I AM WRITING
-- FILLS THEM. That file documents six rungs, of which three are library rungs:
--     (null, vertical, treatment, category) / (null, vertical, null, category) / (null,null,null,null)
-- There is no rung for (null, vertical, treatment, null) or (null, vertical, null, null), so a
-- library magnet scoped to a vertical, or to a vertical and a treatment, is UNREACHABLE. Both of
-- those are exactly the shapes this catalogue needs. The resolver therefore walks the full lattice,
-- most specific first, and the client rungs are unchanged:
--
--     client:   (client, vertical, treatment, category) / (client, vertical, treatment, null)
--               / (client, null, null, null)
--     library:  (vertical, treatment, category) / (vertical, treatment, null)
--               / (vertical, null, category)   / (vertical, null, null)
--               / (null, null, null)
--
-- Stated here rather than fixed silently, because deviating from a ladder another migration wrote
-- down is the kind of drift that is invisible until a CTA is wrong on a live page.
--
-- ‼️ NO TREATMENT ROWS ARE SEEDED, ON PURPOSE. "A post about filler gets a filler magnet" is what
-- the treatment column is for, and the resolver now reaches it. But a magnet is a promise, and
-- there is no filler-specific asset in this repo today. Seeding a row for one would put a dead
-- offer on a live page, which is worse than no offer. The rows land when the posts and their
-- assets do.
-- ─────────────────────────────────────────────────────────────────────

-- The existing universal fallback, re-keyed. Its own comment says it must not be deleted, so it is
-- updated in place and stays the rung of last resort for the patient audience.
update public.lead_magnets
   set magnet_key = 'skin_report',
       audience   = 'patient',
       updated_at = now()
 where magnet_key is null
   and client_id is null
   and vertical is null
   and treatment is null
   and category is null;

insert into public.lead_magnets
  (magnet_key, chains_to_key, audience, client_id, vertical, treatment, category,
   title, promise, asset_url, concierge_entry, active, sort_order)
select v.magnet_key, v.chains_to_key, v.audience, null, v.vertical, null, v.category,
       v.title, v.promise, v.asset_url, v.concierge_entry, true, v.sort_order
from (values
  -- ── Owner catalogue. Every one of these is a real asset that exists today. ──
  --
  -- The owner rung of last resort. vertical null so it is reachable from any post, which is what
  -- makes the owner CTA impossible to leave dead.
  ('visibility_scan', 'city_rivals', 'owner', null, null,
   'The AI Visibility Scan',
   'Twenty questions your patients actually ask, put to ChatGPT on a neutral account, and the scorecard that comes back.',
   'https://srtagency.com/scan',
   'I can run it on your clinic now. It takes about three minutes and you watch every answer come back. What is your website?',
   10),

  -- Two placements, one magnet. A Comparison post and a Neighbourhood post want the same thing.
  ('city_rivals', 'question_20', 'owner', 'aeo-agency-med-spa', 'Comparison',
   'Who ChatGPT Names In Your City',
   'The clinics ChatGPT actually named when we asked it for a med spa in your city, and how many of the answers each one appeared in.',
   null,
   'I can pull that list for your city. If we have not measured your city yet I will say so rather than guess. Which city are you in?',
   20),
  ('city_rivals', 'question_20', 'owner', 'aeo-agency-med-spa', 'Neighbourhood',
   'Who ChatGPT Names In Your City',
   'The clinics ChatGPT actually named when we asked it for a med spa in your city, and how many of the answers each one appeared in.',
   null,
   'I can pull that list for your city. If we have not measured your city yet I will say so rather than guess. Which city are you in?',
   20),

  -- asset_url stays null: the PDF lives behind MEDSPA_QUESTIONS_PDF_URL and the code resolves it,
  -- so an unset env drops this magnet out of the ladder instead of shipping a dead button.
  ('question_20', 'visibility_scan', 'owner', 'aeo-agency-med-spa', 'Guide',
   'The 20 Questions Your Patients Ask ChatGPT Before They Book',
   'The exact questions we put to the engines, written out, so you can go and ask them yourself.',
   null,
   'I can send you the twenty questions. Where should they go?',
   30),
  ('question_20', 'visibility_scan', 'owner', 'aeo-agency-med-spa', 'Objection',
   'The 20 Questions Your Patients Ask ChatGPT Before They Book',
   'The exact questions we put to the engines, written out, so you can go and ask them yourself.',
   null,
   'I can send you the twenty questions. Where should they go?',
   30),

  -- ── Patient catalogue. skin_report already exists above and is the terminal. ──
  --
  -- asset_url null because the scan is an action inside the widget, not a file. The 24 hour line in
  -- the entry copy is the consent sentence, and concierge/purge.ts is its entire implementation.
  ('skin_scan', 'skin_report', 'patient', 'medspa', null,
   'Your Free 3 Minute Skin Scan',
   'A read on your skin from a single photo, and what to actually do about what it finds.',
   null,
   'I can take a look from one photo. It takes about three minutes, and the photo is deleted within 24 hours. Want to try it?',
   10)
) as v(magnet_key, chains_to_key, audience, vertical, category,
       title, promise, asset_url, concierge_entry, sort_order)
where not exists (
  select 1 from public.lead_magnets lm
   where lm.magnet_key = v.magnet_key
     and lm.audience = v.audience
     and lm.client_id is null
     and coalesce(lm.vertical, '') = coalesce(v.vertical, '')
     and lm.treatment is null
     and coalesce(lm.category, '') = coalesce(v.category, '')
);


-- ─────────────────────────────────────────────────────────────────────
-- Verification. Safe to leave in the file: scripts/db.ts autocommits every statement on its own,
-- so a SELECT down here can no longer roll back the DDL above it.
-- ─────────────────────────────────────────────────────────────────────
select c.slug, cc.audience, cc.enabled, cc.analysis_provider, cc.vertical
  from public.concierge_configs cc join public.clients c on c.id = cc.client_id
 order by cc.audience desc, c.slug;

select audience, magnet_key, coalesce(vertical, '(any)') as vertical,
       coalesce(category, '(any)') as category, sort_order,
       coalesce(chains_to_key, '(ends)') as chains_to
  from public.lead_magnets
 where active
 order by audience desc, sort_order, magnet_key, category;

-- Every chain target must resolve to a magnet that exists, in the SAME audience. A dangling chain
-- is a dead second offer, which is the whole failure this catalogue is meant to prevent.
select lm.magnet_key, lm.audience, lm.chains_to_key as dangling
  from public.lead_magnets lm
 where lm.chains_to_key is not null
   and not exists (
     select 1 from public.lead_magnets t
      where t.magnet_key = lm.chains_to_key and t.audience = lm.audience and t.active
   );

-- Rows sharing a magnet_key must agree on what the magnet actually IS.
select magnet_key, count(distinct title) as titles, count(distinct promise) as promises,
       count(distinct coalesce(asset_url, '')) as assets,
       count(distinct concierge_entry) as entries
  from public.lead_magnets
 where magnet_key is not null
 group by magnet_key
having count(distinct title) > 1 or count(distinct promise) > 1
    or count(distinct coalesce(asset_url, '')) > 1 or count(distinct concierge_entry) > 1;
