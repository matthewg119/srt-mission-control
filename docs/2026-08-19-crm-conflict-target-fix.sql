-- =====================================================================
-- MAKE THE IDEMPOTENCY INDEXES USABLE AS ON CONFLICT TARGETS  (2026-08-19)
--
-- THE BUG
-- docs/2026-08-17-crm-core.sql created the three re-run guards as PARTIAL
-- unique indexes:
--
--   create unique index lead_activities_external_uidx
--     on lead_activities (source, external_id) where external_id is not null;
--
-- Postgres will not infer a partial index from a bare conflict target. It needs
-- the index predicate restated in the statement:
--
--   ... on conflict (source, external_id) where external_id is not null ...
--
-- PostgREST cannot emit that clause — supabase-js `onConflict: "source,external_id"`
-- produces the bare form — so every upsert in src/lib/zoho-pull.ts failed with:
--
--   42P10: there is no unique or exclusion constraint matching the
--          ON CONFLICT specification
--
-- Verified against the live database on 2026-08-16: two upserts, zero rows
-- written, both errored. That is 14,335 notes + 16,699 calls + 60 tasks + 8,307
-- leads — i.e. the ENTIRE import, silently counted as `errored` per batch rather
-- than crashing. The whole point of those indexes is that a re-run is a no-op,
-- and they could never once have been exercised.
--
-- THE FIX
-- Drop the WHERE clause. This does NOT weaken the constraint: a unique index
-- treats NULLs as distinct, so rows with external_id IS NULL still never
-- conflict with each other, exactly as the partial version intended. The only
-- difference is that those rows are now stored in the index — a few thousand
-- entries at this scale — and in exchange the conflict target becomes
-- inferrable.
--
-- Same reasoning for contacts_zoho_lead_id_uidx, which pullLeads() uses as
-- `onConflict: "zoho_lead_id"` and which has the identical predicate.
--
-- Safe to re-run. Run through scripts/db.ts, not the Supabase SQL editor.
-- =====================================================================


-- ─────────────────────────────────────────────────────────────────────
-- 1. lead_activities — the timeline replay guard
-- ─────────────────────────────────────────────────────────────────────
drop index if exists lead_activities_external_uidx;

create unique index if not exists lead_activities_external_uidx
  on lead_activities (source, external_id);


-- ─────────────────────────────────────────────────────────────────────
-- 2. lead_tasks
-- ─────────────────────────────────────────────────────────────────────
drop index if exists lead_tasks_external_uidx;

create unique index if not exists lead_tasks_external_uidx
  on lead_tasks (source, external_id);


-- ─────────────────────────────────────────────────────────────────────
-- 3. contacts.zoho_lead_id — the lead import's conflict target
-- ─────────────────────────────────────────────────────────────────────
-- Dropping a partial unique index and recreating it unpartitioned would fail on
-- duplicate NULLs if NULLs were not distinct. They are, so every contact with no
-- zoho_lead_id stays unaffected. The duplicate real ids were resolved on
-- 2026-08-16 (backup in contacts_zoho_dupes_20260816).
drop index if exists contacts_zoho_lead_id_uidx;

create unique index if not exists contacts_zoho_lead_id_uidx
  on contacts (zoho_lead_id);
