-- =====================================================================
-- contacts.application_signed_at  (2026-08-19)
--
-- THE BUG THIS CLOSES
-- Three live code paths SELECT this column and it has never existed:
--
--   src/app/api/leads/awaiting-statements/route.ts:16-20  (select + filter + order)
--   src/lib/ai-intel/zoho-guardian.ts:124                 (explicit select)
--   src/app/dashboard/awaiting-statements/page.tsx        (fed by the route)
--
-- PostgREST fails the WHOLE query on one unknown column, so those were not
-- returning an empty list, they were erroring — the Awaiting Statements page and
-- the guardian's statement check have been dead, not quiet. `contacts` was built
-- in the Supabase console and drifted from CONTACT_FIELD_MAP; this is the one
-- column of the twenty audited on 2026-08-19 that was genuinely absent. The
-- other nineteen are all real.
--
-- ON NOT BACKFILLING
-- The obvious backfill is "rows that have a signature". There are none:
--   select count(*) filter (where signature is not null) from contacts  ->  0
-- Nothing in the table records when an application was signed, so any value
-- written here for a historical row would be invented. The column starts NULL
-- everywhere and is stamped going forward by /api/leads/application at the point
-- the signature is captured. Callers must therefore treat NULL as "unknown",
-- never as "unsigned" — see the route change that accompanies this file.
-- =====================================================================

alter table contacts
  add column if not exists application_signed_at timestamptz;

comment on column contacts.application_signed_at is
  'When the merchant signed the portal application. NULL means unknown, not unsigned: no historical signing time existed anywhere when this column was added on 2026-08-19, so nothing was backfilled. Stamped by /api/leads/application from that point on.';

-- Supports the awaiting-statements ordering without scanning the table.
create index if not exists contacts_awaiting_statements_idx
  on contacts (application_signed_at)
  where portal_app_completed = true
    and coalesce(portal_statements_uploaded, false) = false;
