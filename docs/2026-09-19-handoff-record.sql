-- The handoff record: who we have actually mailed.
--
-- Run this alongside docs/2026-09-18-workflow-c-wiring.sql and docs/2026-09-19-vertical-per-drop.sql.
-- Order between the three does not matter; all are idempotent and none depends on the others.
--
-- ‼️ THIS CLOSES A LIVE HOLE, NOT A THEORETICAL ONE. suppression.ts answers "have we contacted this
-- person" by reading `outreach_prospects`, and the only thing that has ever minted a row there for
-- a ReachInbox lead is createCampaignProspect(), which runs when somebody REPLIES. Everyone who
-- ignored us stayed invisible. Measured on production 2026-09-19: `outreach_prospects` held ZERO
-- rows, while a 136 address campaign had gone out on 2026-09-16. So `already_contacted` and
-- `domain_contacted` have never once fired, and re-mailing the same person from a second sending
-- domain is currently the default behaviour rather than an edge case.

-- ---------------------------------------------------------------------------------------------
-- 1. Per-address proof that a run's output was handed off, without joining back through the board.
--
--    ‼️ "HANDED OFF", NOT "DELIVERED". It is stamped when sendable.csv is published, which is the
--    last moment this system can observe. Whether the operator then uploaded the file is not
--    something any code here can know. The asymmetry is why it is stamped early anyway: a row
--    wrongly marked costs one lead we never mail, a row wrongly unmarked costs that person a second
--    cold sequence from a second domain, which is how sending domains get burned at volume.
-- ---------------------------------------------------------------------------------------------
alter table public.sendable_leads add column if not exists sent_at timestamptz;

comment on column public.sendable_leads.sent_at is
  'When this address was handed off for sending, stamped as sendable.csv is published. NOT proof '
  'of delivery and not proof the operator uploaded the file: it is the last moment this system can '
  'observe. The authoritative "have we mailed them" answer is outreach_prospects, which is written '
  'in the same step; this column exists so a run can be audited without joining back through it.';

create index if not exists sendable_leads_sent_idx
  on public.sendable_leads (sent_at) where sent_at is not null;

-- ---------------------------------------------------------------------------------------------
-- 2. The board gets an index on the thing suppression actually filters on.
--
--    suppression.ts matches a company by `website ilike '%' || domain || '%'`. That is a leading
--    wildcard, so btree cannot serve it and every suppression check is a sequential scan of the
--    whole board. Harmless at zero rows. At 3,300 new prospects a month, with the check running
--    once per candidate address, it is the slowest thing in the suppressing sweep, and that sweep
--    is already the most deadline-sensitive arm in the lane because it is sequential by design.
--
--    ‼️ pg_trgm, NOT a plain btree. A btree on `website` cannot answer a leading-wildcard LIKE at
--    all; a trigram GIN index can. If the extension is unavailable the CREATE EXTENSION below is
--    the only statement that fails, and the column and everything above it still land, because
--    scripts/db.ts autocommits per statement. In the Supabase editor it would roll the file back,
--    so run this one through scripts/db.ts if the extension is not already there.
-- ---------------------------------------------------------------------------------------------
create extension if not exists pg_trgm;

create index if not exists outreach_prospects_website_trgm_idx
  on public.outreach_prospects using gin (website gin_trgm_ops);

-- ---------------------------------------------------------------------------------------------
-- Verification. Plain counts, so nothing here can roll the migration back.
-- Expect: sendable_sent_at = 1, sendable_sent_idx = 1, prospects_website_trgm = 1
-- ---------------------------------------------------------------------------------------------
select 'sendable_sent_at' as check, count(*)::text as n
  from information_schema.columns
  where table_schema = 'public' and table_name = 'sendable_leads' and column_name = 'sent_at'
union all select 'sendable_sent_idx', count(*)::text from pg_indexes
  where schemaname = 'public' and indexname = 'sendable_leads_sent_idx'
union all select 'prospects_website_trgm', count(*)::text from pg_indexes
  where schemaname = 'public' and indexname = 'outreach_prospects_website_trgm_idx';
