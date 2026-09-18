-- Google's published guidance, versioned. Global: this belongs to no client and no audience.
--
-- Run it through the runner, NOT the Supabase SQL editor:
--   bun run scripts/db.ts --file=docs/2026-09-22-policy-documents.sql --dry
--   bun run scripts/db.ts --file=docs/2026-09-22-policy-documents.sql
-- The editor runs a pasted file as ONE implicit transaction, so the verification SELECT at the foot
-- failing rolls the whole migration back and looks exactly like "the migration did nothing".
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- THREE HOMES WERE CONSIDERED AND ALL THREE ARE WRONG. Each for a reason you can check.
--
-- ‼️ NOT knowledge_entries. It is genuinely global, which is why it looks right. But
-- buildSystemPrompt() (src/lib/ai.ts:70-77) selects EVERY row of that table, unfiltered and
-- unbounded, and concatenates them into the Office Manager's system prompt on every message. A
-- guidelines corpus there would be paid for on every CRM chat, every Telegram message and every
-- dashboard conversation, for ever, by a lane that has no use for it.
-- docs/2026-09-02-knowledge-seed.sql already states that hazard out loud.
--
-- ‼️ NOT audience_documents. It has exactly the right discipline (append-only, superseded_at,
-- replacement only through the atomic supersede_audience_document() RPC, source, source_url,
-- status, faults) and exactly the wrong scope: client_id AND audience_id are both NOT NULL.
-- Guidelines belong to no client and no audience, and inventing one for them is how a shared thing
-- acquires a fake owner.
--
-- ‼️ NOT client_datasets. That is a CACHE and it REPLACES on conflict: the upsert is on
-- (client_id, kind, cache_key) and Postgres overwrites the row, payload and all. Its own header
-- says so, corrected 2026-09-18. A weekly scan exists to answer WHAT CHANGED SINCE LAST WEEK,
-- which an overwriting cache structurally cannot.
--
-- So: append-only, superseded rather than updated, the discipline audience_documents keeps, with
-- the scope it cannot have.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

create table if not exists public.policy_documents (
  id            uuid primary key default gen_random_uuid(),

  -- Which published page this is a version of. Named in code, never typed by a person.
  kind          text not null,
  source_url    text,
  title         text,

  -- ‼️ THE TEXT, NEVER THE HTML. harvest.ts states the rule this copies: "What the page SAID is a
  -- fact and keeps; what we make of it is recomputed every run." Freezing the markup freezes a
  -- page's answers to whichever extraction ruleset was current the day it was first read.
  content       text not null,

  -- ‼️ sha256 OF THE NORMALISED TEXT, AND IT IS WHAT MAKES THE WEEKLY SCAN CHEAP AND HONEST.
  -- Same reasoning as page_gate_runs.body_hash: a version is a statement about bytes. An unchanged
  -- fetch must write NOTHING and post NOTHING, or the channel gets a card every Thursday that
  -- nobody reads by week three. A CHANGED hash is the entire trigger for the diff card.
  content_hash  text not null,

  -- 'fetched' is the five HTML pages the weekly scan reads. 'pasted' is the Quality Rater
  -- Guidelines, which are a ~180 page PDF and must never be fetched weekly.
  source        text not null check (source in ('fetched', 'pasted')),

  fetched_at    timestamptz not null default now(),
  superseded_at timestamptz,
  created_by    text,
  created_at    timestamptz not null default now()
);

-- The live version of each source, which is what a diff is taken against.
create index if not exists policy_documents_live_idx
  on public.policy_documents (kind, fetched_at desc) where superseded_at is null;

-- ‼️ ONE ROW PER (source, bytes). This is the append-only guard: re-fetching an unchanged page
-- cannot create a second version even if the caller forgets to check, because the hash collides.
create unique index if not exists policy_documents_version_idx
  on public.policy_documents (kind, content_hash);

alter table public.policy_documents enable row level security;

comment on table public.policy_documents is
  'Published external guidance, versioned and append-only. The compiled rules that BIND live in '
  'code (src/config/guideline-rules.ts); this is the reference a person reads when deciding '
  'whether those rules changed. NO client_id, deliberately: this is a fact about the public '
  'world, which is the one thing the cross-client doctrine says may be shared.';

comment on column public.policy_documents.content_hash is
  'sha256 of the normalised text. An unchanged fetch writes no row and posts no card.';

comment on column public.policy_documents.source is
  'fetched = the weekly scan read it. pasted = a person replaced it by hand (the rater guidelines).';

-- Verify. Expect one row, with 10 columns.
select table_name, count(*) as cols
from information_schema.columns
where table_schema = 'public' and table_name = 'policy_documents'
group by table_name;
