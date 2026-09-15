-- 2026-09-15 — offers move under audiences, and the four framework documents get somewhere to live
--
-- Matthew, 2026-09-15: a client has many AUDIENCES (SRT: med spa owners AND plumbers), an audience
-- targets an AVATAR, and the OFFER hangs under the audience with its own outcome ("more appointments",
-- "more jobs"). His avatar and offer framework (Desktop\SRT-Avatar-Offer-Framework-Prompt.md) then
-- produces, per audience, a sales letter, a deep research, an avatar sheet, a short offer and the six
-- necessary beliefs.
--
-- ‼️ NOTHING READS THIS YET. It lands before the code that uses it, per house rule: one unknown column
-- fails a whole PostgREST select AND insert. The cutover of clients.offer onto client_offers is the next
-- deploy, and until then the old code keeps writing clients.offer. RE-RUN THIS FILE RIGHT AFTER THAT
-- DEPLOY: section 1b re-syncs anything written in the gap, and every statement is idempotent.
--
-- Runner: bun run scripts/db.ts --file=docs/2026-09-15-offers-and-framework.sql [--dry]
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ‼️ docs/2026-09-08-client-offer.sql ARGUED FOR ONE JSONB COLUMN AND AGAINST THIS TABLE. ITS THREE
-- REASONS, ANSWERED, BECAUSE A REVERSAL THAT DOES NOT ADDRESS THEM IS HOW THE NEXT ONE HAPPENS:
--
-- 1. "MATTHEW WANTS ONE ... a table would immediately raise 'which is primary'." He now wants many,
--    under each audience, and still works one at a time. `is_primary`, one per audience by a partial
--    unique index, answers "which is primary" exactly as client_audiences already does for audiences.
-- 2. "EVERYTHING DOWNSTREAM INTERPOLATES ONE STRING." Still true, and still honoured: loadOffer(clientId)
--    keeps returning ONE offer (the primary audience's primary offer), so [treatment] stays singular.
-- 3. "THE MAGNET SIDE ALREADY HAS A TABLE." Unchanged. magnet_key points into lead_magnets as before.
-- ─────────────────────────────────────────────────────────────────────────────


-- =====================================================================
-- 0. A KEY AN OFFER CAN POINT AT: (id, client_id)
-- =====================================================================
--
-- ‼️ SO AN OFFER CAN NEVER HANG UNDER ANOTHER CLIENT'S AUDIENCE. A plain fk on audience_id would
-- accept any audience id at all. A composite fk on (audience_id, client_id) needs a unique key on the
-- same two columns to reference. id is already unique, so this costs nothing but the index.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'client_audiences_id_client_key') then
    alter table public.client_audiences
      add constraint client_audiences_id_client_key unique (id, client_id);
  end if;
end $$;


-- =====================================================================
-- 1. client_offers
-- =====================================================================
create table if not exists public.client_offers (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid not null references public.clients (id) on delete cascade,
  -- ‼️ NOT NULL. An offer is sold TO an audience. A client with no audience gets one by hand
  -- (`audience: <preset>`, shipped 405f2a7) rather than an offer that belongs to nobody.
  audience_id         uuid not null,
  is_primary          boolean not null default false,

  -- The proposal: a reading of the intake form, overwritten freely, never treated as decided.
  proposed_treatment  text,
  proposed_source     text check (proposed_source is null
                        or proposed_source in ('primary_treatment', 'highest_margin', 'services_list', 'call')),
  proposed_at         timestamptz,

  -- The lock: a person, on the prep call. The only half anything downstream reads as a decision.
  treatment           text,
  magnet_key          text,
  positioning         text,
  locked_at           timestamptz,
  locked_by           text,
  terms               text[] not null default '{}',
  terms_at            timestamptz,

  -- ‼️ NEW, AND DECLARED MISSING SINCE dataset-spec.ts WAS WRITTEN ("not captured anywhere yet").
  outcome_promise     text,
  outcome_set_at      timestamptz,
  price               text,
  price_set_at        timestamptz,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint client_offers_audience_fkey foreign key (audience_id, client_id)
    references public.client_audiences (id, client_id) on delete cascade
);

-- ‼️ A PARTIAL INDEX, NOT A CONSTRAINT: ON CONFLICT cannot infer it (42P10), so nothing may upsert on
-- it. Same shape and same warning as client_audiences_one_primary.
create unique index if not exists client_offers_one_primary
  on public.client_offers (audience_id) where is_primary;

create index if not exists client_offers_client
  on public.client_offers (client_id);

alter table public.client_offers enable row level security;

comment on table public.client_offers is
  'What a client sells to one of its audiences. A client has many audiences and an audience can carry '
  'more than one offer; one is primary per audience. loadOffer(clientId) in src/lib/clients/offers.ts '
  'returns the PRIMARY audience''s primary offer, so everything that interpolates [treatment] still reads '
  'one value. Supersedes clients.offer (see that column''s comment).';

comment on column public.client_offers.outcome_promise is
  'The outcome this offer promises the audience, in plain words ("more appointments", "more jobs"). '
  'Captured at the prep call with `outcome:`. Belongs to the OFFER, not the audience: the same audience '
  'can be sold two offers with two outcomes.';

comment on column public.client_offers.price is
  'The price or ticket as the client states it ("$399 per session"). Free text on purpose: prices come '
  'with units and conditions a number column would lose. Captured with `price:`.';


-- 1a. Backfill every client offer on file into its primary audience.
--
-- ‼️ INSERT-WHERE-NOT-EXISTS, NEVER ON CONFLICT: the only unique key on the target is a partial index.
-- Measured 2026-09-15: srt-agency-llc is the only client with an offer, and it has a primary audience,
-- so nothing is left behind. A client with an offer and no primary audience would be skipped here, and
-- the verification query at the bottom lists exactly those.
insert into public.client_offers (
  client_id, audience_id, is_primary,
  proposed_treatment, proposed_source, proposed_at,
  treatment, magnet_key, positioning, locked_at, locked_by, terms, terms_at
)
select
  c.id, a.id, true,
  nullif(c.offer ->> 'proposedTreatment', ''),
  case when c.offer ->> 'proposedSource' in ('primary_treatment', 'highest_margin', 'services_list', 'call')
       then c.offer ->> 'proposedSource' end,
  (c.offer ->> 'proposedAt')::timestamptz,
  nullif(c.offer ->> 'treatment', ''),
  nullif(c.offer ->> 'magnetKey', ''),
  nullif(c.offer ->> 'positioning', ''),
  (c.offer ->> 'lockedAt')::timestamptz,
  nullif(c.offer ->> 'lockedBy', ''),
  case when jsonb_typeof(c.offer -> 'terms') = 'array'
       then array(select jsonb_array_elements_text(c.offer -> 'terms'))
       else '{}'::text[] end,
  (c.offer ->> 'termsAt')::timestamptz
from public.clients c
join public.client_audiences a on a.client_id = c.id and a.is_primary
where c.offer is not null
  and not exists (select 1 from public.client_offers o where o.audience_id = a.id and o.is_primary);


-- 1b. Re-sync what the OLD code wrote to clients.offer after the row above was made.
--
-- ‼️ ONLY WHERE THE JSONB IS NEWER, stamp by stamp, so running this after the cutover (when the new code
-- writes client_offers and mirrors into clients.offer) can never roll a newer decision back.
update public.client_offers o
set
  proposed_treatment = nullif(c.offer ->> 'proposedTreatment', ''),
  proposed_at        = (c.offer ->> 'proposedAt')::timestamptz,
  updated_at         = now()
from public.clients c
join public.client_audiences a on a.client_id = c.id and a.is_primary
where o.audience_id = a.id and o.is_primary
  and (c.offer ->> 'proposedAt') is not null
  and (c.offer ->> 'proposedAt')::timestamptz > coalesce(o.proposed_at, '-infinity'::timestamptz);

update public.client_offers o
set
  treatment   = nullif(c.offer ->> 'treatment', ''),
  magnet_key  = nullif(c.offer ->> 'magnetKey', ''),
  positioning = nullif(c.offer ->> 'positioning', ''),
  locked_at   = (c.offer ->> 'lockedAt')::timestamptz,
  locked_by   = nullif(c.offer ->> 'lockedBy', ''),
  updated_at  = now()
from public.clients c
join public.client_audiences a on a.client_id = c.id and a.is_primary
where o.audience_id = a.id and o.is_primary
  and (c.offer ->> 'lockedAt') is not null
  and (c.offer ->> 'lockedAt')::timestamptz > coalesce(o.locked_at, '-infinity'::timestamptz);

update public.client_offers o
set
  terms      = case when jsonb_typeof(c.offer -> 'terms') = 'array'
                    then array(select jsonb_array_elements_text(c.offer -> 'terms'))
                    else '{}'::text[] end,
  terms_at   = (c.offer ->> 'termsAt')::timestamptz,
  updated_at = now()
from public.clients c
join public.client_audiences a on a.client_id = c.id and a.is_primary
where o.audience_id = a.id and o.is_primary
  and (c.offer ->> 'termsAt') is not null
  and (c.offer ->> 'termsAt')::timestamptz > coalesce(o.terms_at, '-infinity'::timestamptz);

comment on column public.clients.offer is
  'DEPRECATED 2026-09-15, superseded by client_offers. Kept for one release as a MIRROR: the new code '
  'writes client_offers and copies into this column so a rollback reads a current offer. Nothing outside '
  'src/lib/clients/offers.ts may read it (a test asserts that). Dropped in a later, separate migration.';


-- =====================================================================
-- 2. audience_documents
-- =====================================================================
--
-- ‼️ APPEND-ONLY, like client_avatar_runs. A replacement supersedes; nothing is updated in place except
-- the approval stamp. The framework's research and avatar sheet land HERE, per client, because they were
-- written with this client's sales letter in the prompt: copying them into the SHARED avatar_briefs is a
-- separate, explicit act (the code does it only when that row is empty, or on `share`).
create table if not exists public.audience_documents (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid not null references public.clients (id) on delete cascade,
  audience_id        uuid not null,
  -- ‼️ CASCADE, NOT SET NULL. Set null would move an offer document into the per-audience slot, where
  -- it would collide with that slot's live row and fail the offer's delete with 23505.
  offer_id           uuid references public.client_offers (id) on delete cascade,
  kind               text not null check (kind in
                       ('sales_letter', 'deep_research', 'avatar_sheet', 'short_offer', 'necessary_beliefs')),
  content            text not null,
  -- What the parser read out of `content`, by template heading. Null when it was not parsed.
  parsed             jsonb,
  -- What the validators found wrong, as [{rule, detail}]. A draft with faults cannot be approved.
  faults             jsonb,
  source             text not null check (source in ('client_site', 'drafted', 'pasted')),
  source_url         text,
  status             text not null default 'draft' check (status in ('draft', 'approved')),
  approved_at        timestamptz,
  approved_by        text,
  -- Normalised treatment + outcome at approval. A different fingerprint now means the approval is stale.
  offer_fingerprint  text,
  superseded_at      timestamptz,
  created_at         timestamptz not null default now(),
  created_by         text,

  constraint audience_documents_audience_fkey foreign key (audience_id, client_id)
    references public.client_audiences (id, client_id) on delete cascade,
  -- ‼️ A LETTER, A SHORT OFFER OR THE BELIEFS BELONG TO AN OFFER; THE RESEARCH AND THE SHEET DO NOT.
  -- Without this a letter saved with a null offer_id would sit in the per-audience slot beside the
  -- per-offer one, and "the approved letter" would have two answers.
  constraint audience_documents_offer_kind
    check ((kind in ('sales_letter', 'short_offer', 'necessary_beliefs')) = (offer_id is not null)),
  constraint audience_documents_approved_stamp
    check (status <> 'approved' or approved_at is not null)
);

-- One LIVE row per document. Both predicates include `superseded_at is null`. Partial indexes, so
-- nothing upserts on them (42P10): replacements go through the function below.
create unique index if not exists audience_documents_live_avatar_doc
  on public.audience_documents (audience_id, kind)
  where offer_id is null and superseded_at is null;

create unique index if not exists audience_documents_live_offer_doc
  on public.audience_documents (offer_id, kind)
  where offer_id is not null and superseded_at is null;

create index if not exists audience_documents_history
  on public.audience_documents (audience_id, kind, created_at desc);

alter table public.audience_documents enable row level security;

comment on table public.audience_documents is
  'The avatar and offer framework''s documents, per client audience, append-only. sales_letter, '
  'short_offer and necessary_beliefs belong to an offer (offer_id set); deep_research and avatar_sheet '
  'belong to the audience. One live row per document (superseded_at is null). Replace ONLY through '
  'supersede_audience_document(), which is atomic.';


-- 2a. The one way to replace a document.
--
-- ‼️ ATOMIC, BECAUSE THE ALTERNATIVES BOTH FAIL. Supersede-then-insert from the client leaves ZERO live
-- rows whenever the insert fails; insert-then-supersede fails immediately on the unique index. Inside
-- one function call both statements commit together. Two pastes at once: the second waits on the old
-- row's lock, finds it already superseded, and its insert hits 23505, so the whole call rolls back and
-- its reply says it was not saved. The first paste is the one kept.
create or replace function public.supersede_audience_document(
  p_client_id         uuid,
  p_audience_id       uuid,
  p_offer_id          uuid,
  p_kind              text,
  p_content           text,
  p_parsed            jsonb,
  p_faults            jsonb,
  p_source            text,
  p_source_url        text,
  p_created_by        text
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
begin
  update public.audience_documents
     set superseded_at = now()
   where client_id = p_client_id
     and audience_id = p_audience_id
     and kind = p_kind
     and offer_id is not distinct from p_offer_id
     and superseded_at is null;

  insert into public.audience_documents (
    client_id, audience_id, offer_id, kind, content, parsed, faults, source, source_url, created_by
  ) values (
    p_client_id, p_audience_id, p_offer_id, p_kind, p_content, p_parsed, p_faults, p_source, p_source_url,
    p_created_by
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.supersede_audience_document(uuid, uuid, uuid, text, text, jsonb, jsonb, text, text, text)
  from public, anon, authenticated;
grant execute on function public.supersede_audience_document(uuid, uuid, uuid, text, text, jsonb, jsonb, text, text, text)
  to service_role;


-- =====================================================================
-- 3. avatar_briefs: the SHARED avatar sheet
-- =====================================================================
alter table public.avatar_briefs add column if not exists avatar_sheet text;
alter table public.avatar_briefs add column if not exists avatar_sheet_parsed jsonb;

comment on column public.avatar_briefs.avatar_sheet is
  'The avatar sheet shared by every client targeting this avatar, the sibling of research_text. Written '
  'from a client''s framework paste ONLY when this is empty, or on an explicit `share sheet`, because '
  'the chat that wrote it had that client''s sales letter in its prompt. The per-client copy is always '
  'in audience_documents.';


-- =====================================================================
-- 4. client_headlines: which audience a headline is for, and the framework's own origin
-- =====================================================================
alter table public.client_headlines
  add column if not exists audience_id uuid references public.client_audiences (id) on delete set null;

comment on column public.client_headlines.audience_id is
  'The audience this headline was written for. Headlines are written for the exact avatar, so a client '
  'with two audiences must be able to tell whose they are. Null on rows written before 2026-09-15.';

-- Measured 2026-09-15: the live check already allows 'keyword' alongside weekly, pre_call and manual.
alter table public.client_headlines drop constraint if exists client_headlines_origin_check;
alter table public.client_headlines add constraint client_headlines_origin_check
  check (origin in ('weekly', 'pre_call', 'manual', 'keyword', 'framework'));


-- =====================================================================
-- VERIFICATION
-- =====================================================================

-- Expect srt-agency-llc: one primary offer under its primary audience, treatment
-- "AEO Services for med spas", three terms, locked.
select c.slug, a.slug as audience, o.is_primary, o.treatment, o.terms, o.locked_at is not null as locked,
       o.proposed_source
from public.client_offers o
join public.clients c on c.id = o.client_id
join public.client_audiences a on a.id = o.audience_id
order by c.slug;

-- Expect ZERO rows: a client with an offer on file and no primary audience would be left behind.
select c.slug
from public.clients c
where c.offer is not null
  and not exists (select 1 from public.client_audiences a where a.client_id = c.id and a.is_primary);

-- Expect the two new tables, the function, and the new columns.
select to_regclass('public.client_offers') as client_offers,
       to_regclass('public.audience_documents') as audience_documents,
       to_regprocedure('public.supersede_audience_document(uuid,uuid,uuid,text,text,jsonb,jsonb,text,text,text)') as supersede_fn;

select table_name, column_name
from information_schema.columns
where table_schema = 'public'
  and ((table_name = 'avatar_briefs' and column_name in ('avatar_sheet', 'avatar_sheet_parsed'))
    or (table_name = 'client_headlines' and column_name = 'audience_id'))
order by 1, 2;
