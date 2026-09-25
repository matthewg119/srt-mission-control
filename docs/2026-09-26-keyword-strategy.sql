-- The keyword strategy: clusters, the pillar of each, what merged into what, what became a service
-- page, and the awareness rung the cluster is written to. Locked at step 12; READ, never
-- re-decided, at step 21 and in the page studio.
--
-- Requires docs/2026-09-26-keyword-serp.sql first. Additive and idempotent.
-- Runner: bun run scripts/db.ts --file=docs/2026-09-26-keyword-strategy.sql [--dry]
--
-- ‼️ THE STRATEGY DIES WITH THE OFFER AND THE VERDICTS DO NOT, AND THAT IS THE WHOLE SPLIT.
-- resetForNewOffer deletes every non-manual client_keywords row when the locked offer changes, so
-- the three columns added here go with it, which is correct: a clustering of "lip filler" is not a
-- clustering of "Botox". keyword_serp_reads is a separate table for exactly the opposite reason.
-- offer_fingerprint is carried on the cluster so a stale one can be SEEN rather than inferred from
-- an empty join.
--
-- ‼️ NONE OF THESE COLUMNS MAY BE ADDED TO KW_COLUMNS IN client-keywords.ts. That string is a flat
-- select whose own comment says it must fail loudly, and PostgREST fails a WHOLE select on one
-- unknown column. They are merged on by withStrategy(), the sixth instance of the tolerant-merge
-- pattern page-plan.ts already runs five times. A database without this file reads as "no strategy
-- yet", which is what it is.

-- ── 1. The clusters ─────────────────────────────────────────────────────────

create table if not exists public.keyword_clusters (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references public.clients (id) on delete cascade,
  -- Which offer this clustering was made for. Same job as client_keywords.offer_fingerprint: a
  -- cluster written for the old offer is shown as stale rather than silently mixed into the new one.
  offer_fingerprint text,

  -- The umbrella, in words. What this group of searches is really one question about.
  label             text not null,
  -- The keyword that carries the cluster. SET NULL rather than cascade: losing the pillar must leave
  -- a visible hole on the card, not delete the cluster and its merges with it.
  pillar_keyword_id uuid references public.client_keywords (id) on delete set null,

  -- 5 = problem unaware, 1 = most aware, LOWER IS CLOSER TO BUYING. Same pair and same numbering
  -- page_plan, page_angles and client_headlines already carry.
  awareness_entry   smallint,
  awareness_target  smallint,

  -- 'post' or 'service_page'. What this cluster becomes, from the SERP verdict on its pillar.
  page_kind         text,

  -- Why this is a cluster and why that keyword is its pillar, in words, for the person deciding.
  rationale         text,
  -- The order on the card. Frozen, for the reason client_keywords.rank is frozen: `strategy merge 18
  -- under 12` names a row by a printed number.
  rank              integer,

  -- ‼️ THE CARD IS EDITED, NEVER RE-POSTED. Slack orders a channel by post time, so a
  -- delete-and-repost moves a cluster to the bottom of the thread permanently. Same rule
  -- client_delivery_steps.slack_anchor_ts carries, written down here for the same reason.
  card_ts           text,

  -- ‼️ A CLUSTER MADE BY HAND SURVIVES A REGROUP, AND WITHOUT THIS COLUMN IT DOES NOT.
  -- persistClusters deletes every `proposed` row before re-inserting from clusterFinalists, so
  -- `strategy pillar 9` inserted a cluster at rank 999 that the very next `strategy approve` wiped,
  -- silently, along with every `strategy merge` and `strategy service` edit made since the last
  -- regroup. A cluster whose origin is `manual` is preserved instead of deleted.
  origin            text not null default 'derived'
                    check (origin in ('derived', 'manual')),

  -- ‼️ missing_pictures WAS HERE AND IS GONE. See docs/2026-09-25-drop-missing-pictures.sql. It was
  -- described as "a cache for the card only" and nothing ever read it: written on INSERT, never
  -- updated, so stale the moment a screenshot landed, and persistClusters re-inserts the proposed
  -- rows anyway. gateClusters() recomputes the number honestly every time. A dead column that looks
  -- like provenance is worse than no column, which is the verdict _probe-serp-gate.ts already records
  -- against the device column.

  -- 'rejected' is not 'dropped'. Dropped is what a merge does to a cluster that moved under another
  -- one; rejected is a person looking at the pictures and saying no. Keeping them apart is what lets
  -- the card say which happened, and neither one deletes a keyword.
  status            text not null default 'proposed'
                    check (status in ('proposed', 'approved', 'rejected', 'dropped')),
  approved_at       timestamptz,
  approved_by       text,
  rejected_at       timestamptz,
  rejected_by       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint keyword_clusters_awareness_entry_check
    check (awareness_entry is null or awareness_entry between 1 and 5),
  constraint keyword_clusters_awareness_target_check
    check (awareness_target is null or awareness_target between 1 and 5),
  constraint keyword_clusters_page_kind_check
    check (page_kind is null or page_kind in ('post', 'service_page'))
);

-- ── Columns for a database that already ran the FIRST version of this file ─────────────
--
-- ‼️ THE create table ABOVE IS `if not exists` AND WOULD BE A NO-OP ON SUCH A DATABASE, so every
-- column added since would be silently missing and persistClusters would fail its insert with a
-- 42703 that names one column and not the file. Same belt and braces as the serp migration.
alter table public.keyword_clusters add column if not exists card_ts text;
alter table public.keyword_clusters add column if not exists rejected_at timestamptz;
alter table public.keyword_clusters add column if not exists rejected_by text;
alter table public.keyword_clusters add column if not exists origin text not null default 'derived';

alter table public.keyword_clusters drop constraint if exists keyword_clusters_origin_check;
alter table public.keyword_clusters add constraint keyword_clusters_origin_check
  check (origin in ('derived', 'manual'));

-- The status CHECK is REPLACED rather than added, because a table created by the first version of
-- this file carries the three-value form and would refuse 'rejected' forever.
alter table public.keyword_clusters drop constraint if exists keyword_clusters_status_check;
alter table public.keyword_clusters add constraint keyword_clusters_status_check
  check (status in ('proposed', 'approved', 'rejected', 'dropped'));

create index if not exists keyword_clusters_client
  on public.keyword_clusters (client_id, rank);

comment on table public.keyword_clusters is
  'The keyword strategy for one client and one offer: the umbrellas, each one''s pillar keyword, and '
  'the awareness rung it is written to. Decided at step 12 and READ at step 21 and in the studio. '
  'Nothing downstream re-decides subjects.';

alter table public.keyword_clusters enable row level security;

-- ── 2. The lock ─────────────────────────────────────────────────────────────
--
-- ‼️ A ROW RATHER THAN "EVERY CLUSTER IS APPROVED", because zero clusters would then read as locked.
-- One row per client per offer_fingerprint, so a re-lock after an offer change is a new row and the
-- old one is still readable as what was locked before.
create table if not exists public.client_keyword_strategy (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references public.clients (id) on delete cascade,
  offer_fingerprint text not null,
  locked_at         timestamptz,
  locked_by         text,
  -- The strategy as it stood at the lock. A snapshot, for the same reason keyword_runs.rows_snapshot
  -- exists: the decision has to read without the rows.
  summary           jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);

create unique index if not exists client_keyword_strategy_one
  on public.client_keyword_strategy (client_id, offer_fingerprint);

alter table public.client_keyword_strategy enable row level security;

-- ── 3. The strategy on the keyword ──────────────────────────────────────────

alter table public.client_keywords add column if not exists cluster_id uuid
  references public.keyword_clusters (id) on delete set null;

-- 'post'         this keyword gets its own post
-- 'service_page' all local listings or software products, so a service page and not a post
-- 'merged'       folded under merged_into; it gets NO page of its own
-- null           no strategy decision yet
alter table public.client_keywords drop constraint if exists client_keywords_intent_check;
alter table public.client_keywords add column if not exists intent text;
alter table public.client_keywords add constraint client_keywords_intent_check
  check (intent is null or intent in ('post', 'service_page', 'merged'));

-- ‼️ SELF-REFERENTIAL AND SET NULL. A merge is "this question is answered by that page". If the
-- target is dropped, the merge must SURFACE as an unplaced keyword rather than cascade-delete a
-- phrase somebody approved.
alter table public.client_keywords add column if not exists merged_into uuid
  references public.client_keywords (id) on delete set null;

-- The latest SERP verdict, denormalised so the card and the shortlist sort without a join. The
-- append-only history stays in keyword_serp_reads; this is the current reading.
--
-- ‼️ A SORT CONVENIENCE, AND NOT THE AUTHORITY. IT WAS THE AUTHORITY AND THAT WAS A BUG. This column
-- is overwritten unconditionally by every recordVerdict, so when loadFinalists read it, a re-run
-- vision pass silently replaced a correction a person had typed ten minutes earlier: exactly the
-- failure bestVerdict() was written to prevent, on a path that never called bestVerdict() because
-- verdictsFor() had no callers at all. loadFinalists reads keyword_serp_reads now and resolves the
-- verdict through bestVerdict(). Nothing may go back to trusting this column for a decision.
alter table public.client_keywords add column if not exists serp_verdict text;
alter table public.client_keywords add column if not exists serp_checked_at timestamptz;

comment on column public.client_keywords.serp_verdict is
  'The latest reading, denormalised for sorting only. NOT the authority: it is overwritten on every '
  'read regardless of source, so a decision taken from it ignores bestVerdict and lets a vision '
  'pass overwrite a typed correction. keyword_serp_reads is the authority.';

create index if not exists client_keywords_cluster
  on public.client_keywords (client_id, cluster_id);

comment on column public.client_keywords.intent is
  'post | service_page | merged. The step 12 strategy''s decision about this phrase. Cleared with '
  'everything else by resetForNewOffer: a strategy for one offer is not a strategy for another.';

-- ── 4. The strategy on the planned page ─────────────────────────────────────
--
-- ‼️ page_kind IS A DIFFERENT AXIS FROM post_format AND THE NAME SAYS SO. post_format is the written
-- SHAPE (answer-first, list, comparison), from src/config/post-formats.ts. page_kind is whether this
-- is a post at all or a service page.
alter table public.page_plan drop constraint if exists page_plan_page_kind_check;
alter table public.page_plan add column if not exists page_kind text;
alter table public.page_plan add constraint page_plan_page_kind_check
  check (page_kind is null or page_kind in ('post', 'service_page'));

alter table public.page_plan add column if not exists cluster_id uuid
  references public.keyword_clusters (id) on delete set null;

-- ‼️ THE URL, DECIDED BEFORE THE PAGE EXISTS, WHICH IS THE ONLY WINDOW IN WHICH IT CAN BE DECIDED.
-- pageSlug()'s own comment says a slug "must not silently change for an existing page": it is part
-- of a public URL a crawler has indexed. keywordSlug() has existed since 2026-09-14 with ZERO
-- production callers and a docstring saying the CALLER is responsible for using it at creation only.
-- This column is that caller. It reaches an INSERT and nothing else.
alter table public.page_plan add column if not exists slug text;

comment on column public.page_plan.slug is
  'The URL this page will take, built from the target keyword by keywordSlug() and fixable before '
  'the page exists. Null means "derive it from the working title", which is what every row did '
  'before this migration. Used at INSERT only; it can never rename a published page.';

-- ── 5. The history's vocabulary ─────────────────────────────────────────────
--
-- ‼️ WITHOUT THIS THE STRATEGY'S HISTORY GOES DARK SILENTLY. keyword_decisions.action carries a
-- CHECK constraint, and recordKeywordDecisions swallows its own errors by design
-- ("NOTHING HERE EVER FAILS ITS CALLER"). A merge recorded against the old constraint would be
-- refused by Postgres, logged to a console nobody reads, and lost.
alter table public.keyword_decisions drop constraint if exists keyword_decisions_action_check;
alter table public.keyword_decisions add constraint keyword_decisions_action_check
  check (action in (
    'approve', 'drop', 'add', 'restore', 'pick_pillar', 'pick_support', 'unpick',
    -- added with the step 12 strategy
    'merge', 'unmerge', 'mark_service_page', 'mark_post', 'pick_cluster_pillar', 'serp_verdict',
    -- added with the screenshot gate. A cluster approval is a decision about the keywords in it, so
    -- it belongs in the same history as the approve that put them there.
    'approve_cluster', 'reject_cluster', 'set_magnet'
  ));

alter table public.keyword_runs drop constraint if exists keyword_runs_reason_check;
alter table public.keyword_runs add constraint keyword_runs_reason_check
  check (reason in ('expansion', 'more', 'reset', 'measurement', 'rerun', 'strategy'));

-- ── Verify. Expect TEN rows. Fewer means an alter did not apply. ───────────
select table_name || '.' || column_name as col, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'client_keywords' and column_name in ('cluster_id', 'intent', 'merged_into', 'serp_verdict')) or
    (table_name = 'page_plan'       and column_name in ('page_kind', 'cluster_id', 'slug')) or
    (table_name = 'keyword_clusters' and column_name in ('label', 'card_ts', 'origin'))
  )
order by col;

-- ── And the status CHECK actually carries 'rejected'. Expect ONE row. ──────
-- A column that exists proves an alter ran. A CHECK that was never replaced is invisible until an
-- insert fails in production, which is the shape of failure this whole lane keeps finding.
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.keyword_clusters'::regclass
  and conname = 'keyword_clusters_status_check'
  and pg_get_constraintdef(oid) like '%rejected%';
