-- Offers that exist BEFORE the first page does, so the call demos this client's own.
--
-- Additive, idempotent, safe to run more than once. Requires docs/2026-09-04-magnet-lane.sql.
-- Runner: bun run scripts/db.ts --file=docs/2026-09-04-client-magnets.sql [--dry]
--
-- ‼️ THE PROBLEM THIS FIXES IS A TIMING PROBLEM, NOT A MISSING FEATURE. page_magnet_candidates
-- already drafts five real offers and approveMagnetCandidate already mints them. But drafting is
-- reached only from startPageDraft, and the only page-shaped step before the call is
-- `page_candidates`, which SCORES questions and writes no page at all. `first_page` is step 29,
-- after the call. So on the call the widget on the replica could only ever resolve the seven
-- generic library rows, and a prospect was shown "Free AI visibility scan" on a page about their
-- own business. Every part of the machine worked; nothing ran it early enough.
--
-- A CLIENT-SCOPED CANDIDATE IS THE SAME ROW WITH NO PAGE. rungOf() scores a client_id row at 8,
-- above every library rung, so ONE approved client magnet is offered on every replica section and
-- every hub page this client ever gets, with no per-page decision. That is why this is one nullable
-- column rather than a second table: the drafting, the validators, the approval gate and the mint
-- are identical, and only the thing it hangs off differs.

-- ── 1. A candidate may belong to the client rather than to a page ────────────
alter table public.page_magnet_candidates alter column page_id drop not null;

comment on column public.page_magnet_candidates.page_id is
  'The page these offers were written for. NULL means they were written for the CLIENT, before any '
  'page existed, from their own site and their intake. Approving one of those mints a client-rung '
  'lead_magnets row and sets no page key, because there is no page yet to point.';

-- ── 2. One approved client-scoped candidate per client ───────────────────────
--
-- ‼️ A SECOND INDEX, BECAUSE THE FIRST ONE STOPS WORKING THE MOMENT page_id IS NULL. Postgres
-- treats two NULLs as distinct in a unique index, so page_magnet_candidates_one_approved silently
-- permits any number of approved client-scoped rows. Two of those means two client-rung magnets at
-- sort_order 50, and rankMagnets would break the tie on magnet_key, which is alphabetical order
-- deciding what a stranger is offered. Same reason the partial index on page_id exists.
create unique index if not exists page_magnet_candidates_one_client_approved
  on public.page_magnet_candidates (client_id)
  where status = 'approved' and page_id is null;

-- ── 3. What this should look like afterwards ─────────────────────────────────

-- The column is nullable and both indexes are present.
select column_name, is_nullable
  from information_schema.columns
 where table_schema = 'public' and table_name = 'page_magnet_candidates' and column_name = 'page_id';

select indexname from pg_indexes
 where schemaname = 'public' and tablename = 'page_magnet_candidates'
 order by indexname;

-- Which clients have an offer of their own, and which are still on the generic library.
select c.slug,
       count(lm.id) filter (where lm.active) as own_offers,
       count(pmc.id) filter (where pmc.status = 'draft' and pmc.page_id is null) as awaiting_approval
  from public.clients c
  left join public.lead_magnets lm on lm.client_id = c.id
  left join public.page_magnet_candidates pmc on pmc.client_id = c.id
 where c.billing_status in ('pilot', 'active')
 group by c.slug
 order by own_offers, c.slug;
