-- Drop avatar_briefs.preset_key: migrated, seeded, and never read by anything.
--
-- Requires docs/2026-09-14-client-audiences.sql to have run first (it is the file that added it).
-- Idempotent, safe to run more than once.
-- Runner: bun run scripts/db.ts --file=docs/2026-09-25-drop-preset-key.sql [--dry]
--
-- ‼️ WHY DROP RATHER THAN WIRE. It has ZERO references in src/ and zero in scripts/, no CHECK
-- constraint and no column comment, and the question it would answer already has a column that every
-- reader selects: `client_audiences.seeded_from`, which records which AUDIENCE_PRESETS entry produced
-- a given client's audience. A second copy of that answer, keyed per vertical instead of per client
-- and read by nobody, is the "dead column that looks like provenance" _probe-serp-gate.ts already
-- refuses.
--
-- ‼️ THE `presetKey` IDENTIFIER IN src/ IS A DIFFERENT THING AND STAYS. audiences.ts and
-- config/audience-presets.ts pass a `presetKey` argument around and write it to
-- `client_audiences.seeded_from`. It never touched this column. Do not "restore" this column on the
-- strength of that grep.
--
-- ‼️ ITS SIBLING default_stance IS NOT DROPPED. It was equally unread until 2026-09-25 and now has a
-- reader: defaultStanceFor() in src/lib/clients/avatars.ts hands it to proposeAudience(), which folds
-- it into the REASON printed on the step card and never into the answer. That distinction is the only
-- thing that made reading it legal, because proposeAudience refuses to default the stance and says so.
--
-- ‼️ TWO OTHER FILES REFERENCED IT AND BOTH ARE ALREADY EDITED, in the same commit as this one:
--   docs/2026-09-14-client-audiences.sql  the add column, the seeding update, and its verify select.
--     The seeding update also set default_stance in the SAME statement, so only the preset_key line
--     was removed and the approved_numbers payload beside it is untouched.
--   docs/2026-09-14-buyer-market.sql      an update keyed on `preset_key in (...)` and a verify
--     select. The update is COMMENTED OUT rather than deleted, so re-running that file cannot fail on
--     a missing column, and its effect is already on the rows via the seeded_from statement above it.
-- Same treatment docs/2026-08-20-outlook-drafts-multi.sql gave a superseded pair.

alter table public.avatar_briefs drop column if exists preset_key;

-- ── Verify. Expect ZERO rows. One row means the drop did not apply. ─────────
select table_name || '.' || column_name as col
from information_schema.columns
where table_schema = 'public'
  and table_name = 'avatar_briefs'
  and column_name = 'preset_key';

-- ── default_stance STAYS, with its CHECK. Expect ONE row. ───────────────────
-- The sibling that was dropped alongside it in an earlier draft of this work. It has a reader now,
-- so a run that removed both would have taken out a live wire.
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'avatar_briefs'
  and column_name = 'default_stance';

-- ── And its CHECK survived the drop. Expect ONE row. ───────────────────────
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.avatar_briefs'::regclass
  and conname = 'avatar_briefs_default_stance_check';
