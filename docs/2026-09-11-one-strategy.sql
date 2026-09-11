-- One strategy per client: the keyword step, the pillar and its supports, the pages drafted before
-- the call, and the scope tag A1 asks for.
--
-- Additive, idempotent, safe to run more than once. Requires docs/2026-09-11-page-plan.sql FIRST:
-- page_plan is created there and this file alters it.
-- Runner: bun run scripts/db.ts --file=docs/2026-09-11-one-strategy.sql [--dry]
--
-- ‼️ RUN BOTH FILES BEFORE THE DEPLOY THAT READS THEM. Every new read is written to degrade (a
-- separate select, never added to a shared COLUMNS string), because PostgREST fails a whole select
-- on one unknown column and in this repo that has silenced every studio thread and every widget
-- before. Degrading still means the keyword step and the pre-call pages say "not run yet" instead
-- of working, so the order is: page-plan.sql, this file, then the deploy.


-- =====================================================================
-- 1. THE KEYWORDS A PERSON APPROVED, PER CLIENT
-- =====================================================================
--
-- Matthew, 2026-09-11: "We need to find at least 200 keywords around the offer from variations on
-- how it could potentially be said." "In what step are we going to select the keywords? I don't
-- see it in any step and we need to select them, right?" Nothing selected them: the studio's
-- `keywords` printed a ranked list, nothing saved it, and the page plan picked from it on its own.
--
-- ‼️ A TABLE, AND NOT question_bank, FOR TWO REASONS.
--  1. question_bank has no client_id. It is keyed (vertical, avatar, normalized) and shared by
--     every client in a vertical forever, so an approval or a drop written there would be one
--     client's decision applied to every other client's list.
--  2. Two thirds of these rows are MODEL-WRITTEN (origin 'expansion'). question_bank holds the
--     market's own wording, and mixing proposals into it would let a model's guess be read back
--     later as something a buyer said. Here every row carries its origin and is scored by it.
--
-- origin: harvest    lifted off pages the engines cited (question_bank source 'harvest')
--         research   the deep research brief or its KEYWORDS block (source 'deep_research' / 'keywords')
--         expansion  proposed by the model in the keyword step. Never scored as evidence.
--         measured   an expansion phrase put to an engine by `keywords check`
--         manual     typed by a person with `keywords add:`. Ranks like evidence: he said it.
-- use:    query      something a person types or dictates. The only rows a page may target.
--         hook       an ad headline or a subject line. Stored and exported, never a page target:
--                    draft-page.ts rule 4 bans outcome promises and guaranteeFor() gates them.
--
-- ‼️ dropped_at, NOT A DELETE. `keywords drop 12` is a decision about a phrase, and a re-expansion
-- that proposed it again must not bring it back. A deleted row is forgotten; a dropped row is
-- remembered as unwanted.
--
-- ‼️ rank IS FROZEN WHEN THE ROW IS WRITTEN. The card and the CSV number the rows and `keywords
-- drop 12` names one by that number, so a re-rank between the card and the reply would drop a
-- different phrase than the one read. `keywords more` appends at the end and never renumbers.
--
-- offer_fingerprint records which offer (treatment, terms, audience) an expansion row was written
-- for. When the lock changes, rows written for the old offer are reset instead of being approved
-- under the new one.
create table if not exists public.client_keywords (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  phrase text not null,
  normalized text not null,
  category text not null,
  use text not null check (use in ('query', 'hook')),
  origin text not null check (origin in ('harvest', 'research', 'expansion', 'measured', 'manual')),
  audience text not null check (audience in ('patient', 'owner')),
  offer_fingerprint text,
  score numeric not null default 0,
  rank integer,
  -- ‼️ TRI-STATE. null means no engine was asked, which is not the same as not named.
  currently_named boolean,
  source_url text,
  approved boolean not null default false,
  approved_at timestamptz,
  approved_by text,
  dropped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists client_keywords_client_normal_use
  on public.client_keywords (client_id, normalized, use);

create index if not exists client_keywords_client_rank
  on public.client_keywords (client_id, rank);

comment on table public.client_keywords is
  'The keyword set a person approved for one client: 200+ ways the locked offer is said, each '
  'with its origin (evidence or model expansion) and its use (query or hook). The page plan draws '
  'only from approved query rows. Written by the keyword_set delivery step.';

alter table public.client_keywords enable row level security;


-- =====================================================================
-- 2. THE PILLAR AND ITS SUPPORTS, AND THE LEASE THAT DRAFTS THEM
-- =====================================================================
--
-- Matthew, 2026-09-11: "I want 9 pages ready before we actually even talk to the customer on the
-- phone." One pillar (the offer page) and eight supports.
--
-- role       'pillar' | 'support'. Null on a studio row written before roles existed.
-- pillar_id  which pillar a support belongs to. A column rather than "the one pillar per client",
--            because a client may later sell more than one offer and each offer is its own pillar.
--            The hub template links a support to its pillar and to its siblings through this.
-- keyword_category  the keyword step's category the target came from, so the plan can spread the
--            supports (at most two per category) and a swap can stay in the same one.
-- draft_lease_*  who is drafting this row right now. The drafting runs in waves across more than
--            one request, and two waves drafting the same row would write two pages and mint two
--            magnets. A lease older than six minutes belongs to a request that is already dead
--            (the route's limit is 300 seconds), so it may be taken.
-- draft_error  the last reason drafting this row failed, so the step thread can say which one and why.
alter table public.page_plan add column if not exists role text;
alter table public.page_plan drop constraint if exists page_plan_role_check;
alter table public.page_plan add constraint page_plan_role_check
  check (role is null or role in ('pillar', 'support'));

alter table public.page_plan add column if not exists pillar_id uuid
  references public.page_plan(id) on delete set null;

alter table public.page_plan add column if not exists keyword_category text;

-- A plan row drawn from the approved keywords is its own origin: it is neither a harvested
-- question nor a derived idea.
alter table public.page_plan drop constraint if exists page_plan_origin_check;
alter table public.page_plan add constraint page_plan_origin_check
  check (origin in ('harvested', 'derived', 'keyword'));

alter table public.page_plan add column if not exists draft_lease_at timestamptz;
alter table public.page_plan add column if not exists draft_lease_id text;
alter table public.page_plan add column if not exists draft_error text;


-- =====================================================================
-- 3. MEASURED OR OVER-DELIVERY (A1 D-P5a)
-- =====================================================================
--
-- A1 names the table hub_pages; it is client_pages. Core sells 4 new + 4 refreshed a month and
-- Complete 8 + 8. The pages drafted before the call are month one, so on a Core client the ninth
-- is above the sold count and is tagged, never hidden: "a pilot that received 60 pages is
-- described as having received 60 pages."
alter table public.client_pages add column if not exists scope text not null default 'measured';
alter table public.client_pages drop constraint if exists client_pages_scope_check;
alter table public.client_pages add constraint client_pages_scope_check
  check (scope in ('measured', 'over_delivery'));


-- =====================================================================
-- 4. ROWS FOR THE TWO NEW STEPS ON EVERY CLIENT ALREADY ON THE BOARD
-- =====================================================================
--
-- reachableCursor also tops these up in code (a client restored from a backup next year has no
-- migration to run), so this is belt and braces. Only clients that already have step rows: a
-- client with none is seeded whole at intake.
insert into public.client_delivery_steps (client_id, step_key, status)
select c.id, k.step_key, 'pending'
  from public.clients c
  cross join (values ('keyword_set'), ('pre_call_pages')) as k(step_key)
 where exists (select 1 from public.client_delivery_steps s where s.client_id = c.id)
on conflict (client_id, step_key) do nothing;


-- =====================================================================
-- 5. WHAT THIS SHOULD LOOK LIKE AFTERWARDS
-- =====================================================================

select table_name, column_name
  from information_schema.columns
 where (table_name = 'client_keywords' and column_name in ('offer_fingerprint', 'dropped_at', 'rank'))
    or (table_name = 'page_plan' and column_name in ('role', 'pillar_id', 'keyword_category', 'draft_lease_at'))
    or (table_name = 'client_pages' and column_name = 'scope')
 order by table_name, column_name;

-- One row per client already on the board, for each of the two keys.
select step_key, count(*) from public.client_delivery_steps
 where step_key in ('keyword_set', 'pre_call_pages')
 group by step_key;
