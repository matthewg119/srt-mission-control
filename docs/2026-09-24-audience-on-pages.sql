-- Which buyer a page is aimed at, recorded ON the page instead of inferred from the client.
--
-- ‼️ THIS REVERSES A DELIBERATE SKIP, AND THE REASON IT WAS SKIPPED IS WORTH KEEPING.
-- An earlier session left page_studio_sessions alone on the measurement that no client has more
-- than one audience, so the ambiguity these columns resolve did not exist yet. That was correct on
-- its own terms. Matthew asked on 2026-09-24 that the avatar be CHOSEN every time a page is made,
-- and that a client be able to borrow another client's avatar, which is what turns a second
-- audience from a hypothetical into a normal state. The ambiguity is now being created on purpose,
-- so the columns come first.
--
-- ‼️ NULLABLE, AND EVERY EXISTING ROW STAYS NULL. Backfilling these to the client's current
-- primary audience would be inventing which buyer a page written weeks ago was aimed at, and then
-- treating that invention as evidence. A null means "nobody recorded it", which is the truth about
-- every page that exists today. The refusal belongs in the writer, not in the column: a NOT NULL
-- here would make the migration itself unrunnable against live data.
--
-- ‼️ THE COMPOSITE FOREIGN KEY IS THE POINT, NOT A PLAIN REFERENCE.
-- client_audiences_id_client_key (2026-09-15-offers-and-framework.sql) exists precisely so a row
-- carrying both ids can never name another client's audience, and audience_documents, page_plan
-- and page_angles already use it that way. A plain `references client_audiences(id)` would let a
-- page on client A be aimed at an audience of client B, which is the exact cross-client mixing
-- this change exists to prevent.
--
-- ‼️ ON DELETE SET NULL (audience_id), NAMING THE COLUMN. Without the column list Postgres would
-- null EVERY column of the key, including client_id, which is NOT NULL on both tables, so the
-- delete would fail instead. The column list needs PG15 or later; production is 17.6, checked
-- 2026-09-21. Deleting an audience must not delete the client's pages: the page survives and stops
-- claiming a buyer, which is the honest outcome.
--
-- ‼️ RUN THIS BEFORE THE CODE THAT SELECTS THESE COLUMNS DEPLOYS, NOT AFTER.
-- PostgREST fails the WHOLE select on one unknown column. src/lib/hub/pages.ts builds its read as
-- a single string literal, so an unknown column there 500s every hub page, and page-studio.ts
-- carries the same warning for the session read, where it would silence every thread in the
-- channel. Both readers are written to degrade rather than disappear, following confirmedAvatarFor
-- in avatars.ts, but that is a safety net and not a licence to deploy first.

alter table public.client_pages          add column if not exists audience_id uuid;
alter table public.page_studio_sessions  add column if not exists audience_id uuid;

-- `add constraint if not exists` does not exist in Postgres, so the guard is explicit and this
-- stays safe to run more than once.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'client_pages_audience_fk'
  ) then
    alter table public.client_pages
      add constraint client_pages_audience_fk
      foreign key (audience_id, client_id)
      references public.client_audiences (id, client_id)
      on delete set null (audience_id);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'page_studio_sessions_audience_fk'
  ) then
    alter table public.page_studio_sessions
      add constraint page_studio_sessions_audience_fk
      foreign key (audience_id, client_id)
      references public.client_audiences (id, client_id)
      on delete set null (audience_id);
  end if;
end $$;

-- "Every page aimed at this buyer", which is the question a second avatar makes askable at all.
-- Partial, because today every row is null and an index over all of them would be a list of nulls.
create index if not exists client_pages_audience_idx
  on public.client_pages (client_id, audience_id)
  where audience_id is not null;

comment on column public.client_pages.audience_id is
  'Which audience (client plus avatar) this page argues to. NULL means nobody recorded it, which '
  'is true of every page written before 2026-09-24 and is never backfilled: the client had one '
  'audience then, and writing it on would be inventing a decision nobody made. The writer refuses '
  'rather than defaulting once a client has more than one audience.';

comment on column public.page_studio_sessions.audience_id is
  'The audience picked for this studio thread, so a page claimed from the menu is aimed at the '
  'buyer somebody chose rather than at whichever audience happens to be primary when the digit '
  'is typed. NULL is "not picked yet", not "the primary one".';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Verification. Plain counts, so nothing here can roll the migration back.
-- Expect: both columns = 1, both fks = 1, idx = 1, and both bound counts = 0 on first run.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
select 'client_pages.audience_id' as check, count(*)::text as n
  from information_schema.columns
  where table_schema = 'public' and table_name = 'client_pages' and column_name = 'audience_id'
union all select 'page_studio_sessions.audience_id', count(*)::text
  from information_schema.columns
  where table_schema = 'public' and table_name = 'page_studio_sessions' and column_name = 'audience_id'
union all select 'client_pages_audience_fk', count(*)::text
  from pg_constraint where conname = 'client_pages_audience_fk'
union all select 'page_studio_sessions_audience_fk', count(*)::text
  from pg_constraint where conname = 'page_studio_sessions_audience_fk'
union all select 'client_pages_audience_idx', count(*)::text
  from pg_indexes where schemaname = 'public' and indexname = 'client_pages_audience_idx'
union all select 'pages already bound (expect 0)', count(*)::text
  from public.client_pages where audience_id is not null
union all select 'clients with 2+ audiences', count(*)::text from (
  select client_id from public.client_audiences group by client_id having count(*) > 1
) m;
