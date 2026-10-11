-- 2026-10-09: make "last modified" on a lead mean something.
--
--   bun run scripts/db.ts --file=docs/2026-10-09-lead-timestamps.sql --dry
--   bun run scripts/db.ts --file=docs/2026-10-09-lead-timestamps.sql
--
-- Additive and idempotent: one function, one trigger, two indexes. No column is added, because both
-- already exist and are populated.
--
-- Matthew, 2026-10-09: "i want to be able to see last edited and created date and time for every
-- lead ... this way i can see when last where uploaded".
--
-- ‼️ THE COLUMNS WERE ALREADY THERE AND ONE OF THEM WAS A LIE. `contacts.created_at` and
-- `contacts.updated_at` both exist and neither is null on any of the 8,796 rows. There is NO trigger
-- on the table, though, so `updated_at` is only as true as whichever writer last remembered to set
-- it, and most of them do not: `src/app/api/contacts/[id]/route.ts` sets it, `recordCallList` does
-- not, the worklist writers do not, and `logCall` does not. So "last modified" on a page would have
-- been right for the rows edited through one API route and silently stale for everything else,
-- which is worse than not showing it: a column that is right some of the time gets trusted all of
-- the time.
--
-- ‼️ A TRIGGER RATHER THAN FIXING EVERY WRITER, AND THE REASON IS THAT THERE IS NO LIST OF WRITERS.
-- `contacts` is written by the CRM routes, the scraper lane, the funnel captures, the Zoho history
-- restore, the market dataset backfill and half a dozen scripts. Any of them added tomorrow would
-- be a new way for the column to go stale, and nothing would say so. Postgres is the one place that
-- sees every write.
--
-- ‼️ AND IT DELIBERATELY OVERRIDES A VALUE THE CALLER SENT. `new.updated_at = now()` rather than
-- `coalesce(new.updated_at, now())`: a caller that sends an old timestamp is a caller that is wrong,
-- and the whole point of this column is that it cannot be wrong. The three columns now mean three
-- different things and the page labels them that way:
--
--   created_at        when this lead first landed in the book. Never changes.
--   updated_at        when the row last changed, in any way, by anything.
--   last_activity_at  when a PERSON last touched it: a call, a note, a reply.


-- =====================================================================
-- A. the trigger
-- =====================================================================
create or replace function public.contacts_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.contacts_set_updated_at() is
  'Stamps contacts.updated_at on every UPDATE, overriding whatever the caller sent. There is no '
  'list of writers to this table (CRM routes, the scraper lane, funnel captures, the Zoho restore, '
  'several scripts), so the database is the only place that sees all of them.';

-- ‼️ DROPPED AND RECREATED RATHER THAN `create trigger if not exists`, WHICH POSTGRES DOES NOT HAVE
-- FOR TRIGGERS. The drop is `if exists`, so this file is still safe to run twice.
drop trigger if exists contacts_set_updated_at on public.contacts;
create trigger contacts_set_updated_at
  before update on public.contacts
  for each row
  execute function public.contacts_set_updated_at();


-- =====================================================================
-- B. the indexes the leads page now sorts on
-- =====================================================================
--
-- ‼️ SORTING A 8,800 ROW TABLE WITHOUT THEM IS A SEQUENTIAL SCAN PER PAGE VIEW, and the page already
-- pays for an exact count. These are the two new orderings the page offers; `last_activity_at` is
-- its default and already indexed by the worklist's own index.
create index if not exists contacts_created_at_idx on public.contacts (created_at desc);
create index if not exists contacts_updated_at_idx on public.contacts (updated_at desc);


-- =====================================================================
-- Verification
-- =====================================================================
--
-- ‼️ WRITTEN TO BE ABLE TO FAIL, AND THE TRIGGER IS PROVED BY USING IT RATHER THAN BY LOOKING IT UP.
-- A `select count(*) from pg_trigger` only shows that something is installed. This takes one row,
-- updates it to the value it already has, and asserts that `updated_at` MOVED: if the trigger is
-- missing or misfiring, `trigger_works` comes back false and the migration has visibly failed.
with victim as (
  select id, updated_at as before_ts from public.contacts order by id limit 1
), touched as (
  update public.contacts c
     set business_name = c.business_name
    from victim v
   where c.id = v.id
  returning c.id, c.updated_at as after_ts, v.before_ts
)
select
  (select count(*) from public.contacts) as contacts,
  (select after_ts > before_ts from touched) as trigger_works,
  (select count(*) from public.contacts where source = 'Med Spa Scrape - No Website')
    as medspa_no_website,
  (select count(*) from public.contacts
    where source = 'Med Spa Scrape - No Website' and next_action_reason like 'NO PHONE%')
    as flagged_no_phone,
  (select min(created_at) from public.contacts) as oldest_lead,
  (select max(created_at) from public.contacts) as newest_lead;
