-- W0, part 2: make a confirmation atomic.
--
-- ‼️ WHY THIS EXISTS, AND IT IS A BUG I WROTE AND THEN FOUND. `client_field_values_live_idx` is a
-- unique index over (client_id, audience_id, field_key) WHERE superseded_at IS NULL, which is the
-- right guarantee: one live value per field, enforced by the database rather than by whoever wrote
-- the last call site. But it makes a confirmation a two-step operation, and supabase-js has no
-- transaction across two statements. Both orders are broken from the client:
--
--   insert then supersede   The insert violates the unique index for every field that already has
--                           a live value, and a batch insert means ONE such field fails ALL of
--                           them. Updating an existing value becomes impossible.
--   supersede then insert   If the insert then fails, the old values are already retired and
--                           nothing replaced them. The field reads as missing and the confirmed
--                           answer is only recoverable by hand.
--
-- So it goes in one transaction, server side. This is the one write in the system that can poison
-- every page a client ever publishes, which is worth a function rather than a compensating action.

create or replace function public.commit_field_values(
  p_client_id     uuid,
  p_audience_id   uuid,
  p_document_id   uuid,
  p_confirmed_by  text,
  p_values        jsonb
)
returns table (written integer, superseded integer)
language plpgsql
security invoker
as $$
declare
  v_now        timestamptz := now();
  v_written    integer := 0;
  v_superseded integer := 0;
  v_item       jsonb;
  v_old_id     uuid;
  v_new_id     uuid;
begin
  -- ‼️ ONE FIELD AT A TIME, INSIDE ONE TRANSACTION. Per field the order is retire-then-insert,
  -- which the unique index allows because the old row stops being live before the new one starts.
  -- The whole loop is one transaction, so a failure on field nine rolls back fields one to eight
  -- and the caller sees no partial confirmation.
  for v_item in select * from jsonb_array_elements(p_values)
  loop
    -- ‼️ THIS PREDICATE AND client_field_values_live_idx ARE ONE DECISION, NOT TWO. That index is
    -- unique on (client_id, audience_id, field_key) nulls not distinct where superseded_at is null.
    -- Whatever it treats as one live row, this lookup must find, and nothing else. Leaving
    -- audience_id out was the original bug: it retired an ARBITRARY live row for the field, so
    -- confirming `fears` for one audience could retire another audience's `fears` and report it as
    -- superseded, with nothing on either row saying so. dataset-completeness.ts expects per-audience
    -- rows to coexist, so that is silent cross-audience data loss. `is not distinct from` is the SQL
    -- spelling of the index's `nulls not distinct`, which is exactly why it is used here rather than
    -- `=`. If either the index or this WHERE gains or loses a column, change both in the same edit.
    --
    -- The order by cannot matter while the index exists, because the index guarantees at most one
    -- live row per key. It is here for the database that somehow has the function without the index:
    -- there the choice becomes deterministic instead of arbitrary.
    select id into v_old_id
      from public.client_field_values
     where client_id = p_client_id
       and audience_id is not distinct from p_audience_id
       and field_key = v_item->>'field_key'
       and superseded_at is null
     order by confirmed_at desc, id desc
     limit 1;

    -- ‼️ RETIRE BEFORE INSERT, AND THE SELF-POINTER IS DELIBERATE. The unique index is PARTIAL
    -- (where superseded_at is null), so it cannot be a deferrable unique CONSTRAINT, and a plain
    -- index is checked per statement. That rules out insert-first: both rows would be live at once
    -- and the insert would be refused. So the old row is retired first, and because
    -- client_field_values_supersede_pair requires superseded_at and superseded_by to be set
    -- together, it briefly points at itself. It is corrected to the real replacement three
    -- statements below, and the intermediate state never escapes this transaction: if the insert
    -- throws, the whole loop rolls back and the row is live and unmodified again.
    if v_old_id is not null then
      update public.client_field_values
         set superseded_at = v_now, superseded_by = v_old_id
       where id = v_old_id;
    end if;

    insert into public.client_field_values (
      client_id, audience_id, dataset, field_key, value,
      source_document_id, source_section, extracted_confidence, origin,
      confirmed_by, confirmed_at
    )
    values (
      p_client_id,
      p_audience_id,
      v_item->>'dataset',
      v_item->>'field_key',
      v_item->>'value',
      p_document_id,
      nullif(v_item->>'source_section', '')::integer,
      v_item->>'confidence',
      'extraction',
      p_confirmed_by,
      v_now
    )
    returning id into v_new_id;

    v_written := v_written + 1;

    -- Now the replacement is known, so the retired row can point at what actually replaced it.
    if v_old_id is not null then
      update public.client_field_values
         set superseded_by = v_new_id
       where id = v_old_id;
      v_superseded := v_superseded + 1;
    end if;
  end loop;

  return query select v_written, v_superseded;
end;
$$;

comment on function public.commit_field_values is
  'Atomically supersede and replace a set of confirmed dataset field values. Exists because the '
  'live unique index makes a confirmation two statements, and supabase-js has no transaction '
  'across two statements: insert-then-supersede cannot update an existing value, and '
  'supersede-then-insert can retire a value and replace it with nothing.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 2. The proposal, between the card and the button.
--
-- ‼️ THE EXTRACTION IS LIVE CODE AND IS NEVER CACHED, BUT A PROPOSAL IS NOT A CACHE. Those are
-- different things and conflating them produces the worst possible bug here. The extraction is
-- recomputed from the document on every run, per harvest.ts's rule: "what the page SAID is a fact
-- and keeps; what we make of it is recomputed every run." But the card shows a person a specific
-- set of values and asks them to approve THOSE. Re-running the extraction when the button is
-- pressed would be a second model call at temperature 0 over the same text, which is very likely
-- to agree and not certain to: the failure mode is that somebody approves what they read and
-- something else is written, with no way to notice. So the proposal is persisted, approved, and
-- then discarded.
--
-- It is deliberately NOT a row in client_field_values with a null confirmed_by. That column is NOT
-- NULL on purpose: there is no unconfirmed value in that table, and weakening it to carry pending
-- state would mean every reader of confirmed values had to remember to filter, forever.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.client_field_proposals (
  id uuid primary key default gen_random_uuid(),

  client_id uuid not null references public.clients (id) on delete cascade,
  audience_id uuid references public.client_audiences (id) on delete cascade,
  source_document_id uuid references public.audience_documents (id) on delete set null,

  -- The three lists exactly as the card showed them, so what is committed is what was read.
  proposed   jsonb not null default '[]'::jsonb,
  questions  jsonb not null default '[]'::jsonb,
  unanswered jsonb not null default '[]'::jsonb,
  -- W2b. The cited claims this paste can back, each with the URL the report gave. Filed as
  -- EXTERNAL_RESEARCH on the SAME press that commits the values, never on the paste.
  citations  jsonb not null default '[]'::jsonb,

  -- Where the card is, so the confirm can answer in the same thread it was asked in.
  slack_channel text,
  slack_ts text,

  status text not null default 'open' check (status in ('open', 'committed', 'discarded')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text,

  constraint client_field_proposals_decided_pair
    check ((status = 'open') = (decided_at is null))
);

-- ‼️ ONE OPEN PROPOSAL PER CLIENT. Two pastes in quick succession would otherwise leave two cards
-- live, and pressing the older one would commit values read out of a document that has since been
-- replaced. The second paste supersedes the first by discarding it, which is visible, rather than
-- by racing it, which is not.
create unique index if not exists client_field_proposals_open_idx
  on public.client_field_proposals (client_id) where status = 'open';

alter table public.client_field_proposals enable row level security;

comment on table public.client_field_proposals is
  'A set of extracted field values awaiting confirmation. Persisted because the card shows a '
  'person specific values and asks them to approve THOSE: re-extracting on the button press could '
  'write something other than what was read. Discarded once decided.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Verification. Expect: fn = 1, proposals = 1, open_idx = 1.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
select 'fn' as check, count(*)::text as n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'commit_field_values'
union all select 'proposals', count(*)::text from information_schema.tables
  where table_schema = 'public' and table_name = 'client_field_proposals'
union all select 'open_idx', count(*)::text from pg_indexes
  where schemaname = 'public' and indexname = 'client_field_proposals_open_idx';
