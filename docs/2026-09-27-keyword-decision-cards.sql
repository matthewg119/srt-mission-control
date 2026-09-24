-- One card per keyword, decided with a reaction, counted toward a target.
--
-- Requires docs/2026-09-26-keyword-serp.sql and docs/2026-09-26-keyword-strategy.sql first.
-- Additive and idempotent, safe to run more than once.
-- Runner: bun run scripts/db.ts --file=docs/2026-09-27-keyword-decision-cards.sql [--dry]
--
-- ‼️ WHY A CARD PER KEYWORD, WHEN THIS REPO ALREADY LEARNED THE OPPOSITE LESSON. The step board's
-- header records it: eighteen replies under one thread in ninety seconds was "impossible to work
-- on", and the fix was one message per STEP. That was volume nobody asked for, arriving at once,
-- none of it a decision. This is the other case: these arrive one at a time, as he screenshots each
-- keyword, and each carries a decision only he can make. A Slack reaction attaches to a message, so
-- per-item reactions REQUIRE one message per item.
--
-- ‼️ selected_at IS A THIRD STATE, NOT A RENAME OF approved.
--     approved     it is in the keyword set. `keywords pick:` sets it, before any SERP is seen.
--     selected_at  it survived its screenshot. Set by a reaction, and what counts toward the 20.
--     dropped_at   it left the set entirely.
--
-- ‼️ NONE OF THE client_keywords COLUMNS BELOW MAY BE ADDED TO KW_COLUMNS in client-keywords.ts.
-- That string is a flat select whose own comment says it must fail loudly, and PostgREST fails a
-- WHOLE select on one unknown column. They are read by their own tolerant selects, the same way
-- docs/2026-09-26-keyword-strategy.sql handles cluster_id and intent.

-- ── 1. The card, and the decision taken on it ───────────────────────────────

-- ‼️ THE CARD IS EDITED, NEVER RE-POSTED, and this column is what makes that possible. Slack orders
-- a thread by post time, so a delete-and-repost moves a keyword to the bottom of a twenty-five card
-- thread permanently. Same rule keyword_clusters.card_ts and client_delivery_steps.slack_anchor_ts
-- already carry, for the same reason.
alter table public.client_keywords add column if not exists card_ts text;

alter table public.client_keywords add column if not exists selected_at timestamptz;
alter table public.client_keywords add column if not exists selected_by text;

-- ‼️ SELF-REFERENTIAL AND SET NULL, exactly as merged_into is. A variation is "this is another way
-- of saying that". If the parent is deleted the variation must SURFACE as a keyword of its own
-- rather than cascade-delete a phrase somebody may have already selected.
alter table public.client_keywords add column if not exists variation_of uuid
  references public.client_keywords (id) on delete set null;

-- Partial, because the overwhelming majority of rows carry neither. The card lookup runs by ts on
-- every single reaction event in the workspace, so it is the one that has to be fast.
create index if not exists client_keywords_card_ts
  on public.client_keywords (card_ts) where card_ts is not null;
create index if not exists client_keywords_selected
  on public.client_keywords (client_id, selected_at desc) where selected_at is not null;

comment on column public.client_keywords.selected_at is
  'It survived its screenshot. A THIRD STATE, not a rename of approved: approved means it is in the '
  'set, selected_at means somebody looked at its Google results and kept it, dropped_at means it '
  'left. Set by a reaction on the keyword''s own card.';

-- ── 2. What the screenshot said, and what we would build ────────────────────

-- ‼️ A QUERY IS NOT A CLAIM, and that is the whole licence for this column. It is the same licence
-- paa_questions already has, written out in docs/2026-09-26-keyword-serp.sql: a search is the same
-- class of object as the keyword being looked at. serp-read.ts still refuses to transcribe anything
-- that could become a claim and that refusal STANDS.
--
-- It is also the first thing that can catch a screenshot filed against the wrong keyword. Before
-- this column, `keywords serp 4` over a picture of a different search stored that picture as
-- evidence for keyword 4 and cleared its gate, and nothing anywhere could tell.
alter table public.keyword_serp_reads add column if not exists query_on_screen text;

-- ── The four observables. TRI-STATE: null is "could not tell", never "no". ──
--
-- Same doctrine as every other column on this table. A half-read screenshot scored as "no script on
-- screen" would send a keyword away from the one asset worth building, and nothing downstream could
-- tell that apart from a real reading.
alter table public.keyword_serp_reads add column if not exists has_script boolean;
alter table public.keyword_serp_reads add column if not exists has_steps boolean;
alter table public.keyword_serp_reads add column if not exists has_checklist boolean;
alter table public.keyword_serp_reads add column if not exists videos_rank boolean;

-- ‼️ DERIVED, NOT READ. answer_shape and asset_fit are pure functions of the four observables above
-- plus the ones already stored, computed by answerShapeFrom() and assetFitFrom() in
-- keyword-strategy-rules.ts. They are stored beside the read for the reason click_value and
-- citation_value are: a scoring change re-applies to every stored row for free, and the rule that
-- produced the number can be argued with.
--
-- 'task'   there is a deliverable on the screen: a script, steps, a checklist
-- 'fact'   an explanation. Nothing to open, so nothing to build
-- 'mixed'  a deliverable, and the page is also answering a different question underneath it
alter table public.keyword_serp_reads drop constraint if exists keyword_serp_reads_answer_shape_check;
alter table public.keyword_serp_reads add column if not exists answer_shape text;
alter table public.keyword_serp_reads add constraint keyword_serp_reads_answer_shape_check
  check (answer_shape is null or answer_shape in ('task', 'fact', 'mixed'));

alter table public.keyword_serp_reads drop constraint if exists keyword_serp_reads_asset_fit_check;
alter table public.keyword_serp_reads add column if not exists asset_fit smallint;
alter table public.keyword_serp_reads add constraint keyword_serp_reads_asset_fit_check
  check (asset_fit is null or asset_fit between 0 and 5);

-- ‼️ A JUDGEMENT, AND LABELLED AS ONE, exactly as magnet_idea and magnet_by are. The ideas come from
-- a separate call (src/lib/clients/asset-ideas.ts) whose inputs are the client's offer and magnet
-- library. Nothing may confuse a judgement with an observation, so they never travel in the same
-- call as the transcription.
--
-- ‼️ AN EMPTY ARRAY UNDER asset_ideas_by='model' IS "WE LOOKED AND THERE IS NOTHING". A null
-- asset_ideas_by is a THIRD state and is not that: it means the check never ran, or the call failed.
-- The card asks again rather than telling anybody there is nothing to build on an outage.
alter table public.keyword_serp_reads add column if not exists asset_ideas jsonb;
alter table public.keyword_serp_reads drop constraint if exists keyword_serp_reads_asset_ideas_by_check;
alter table public.keyword_serp_reads add column if not exists asset_ideas_by text;
alter table public.keyword_serp_reads add constraint keyword_serp_reads_asset_ideas_by_check
  check (asset_ideas_by is null or asset_ideas_by in ('model', 'person'));

comment on column public.keyword_serp_reads.query_on_screen is
  'The text in the search box, read off the screenshot. A SEARCH, not a claim, which is the same '
  'licence paa_questions carries. It is what lets a screenshot find its own keyword without anybody '
  'typing a number, and what makes a picture filed against the wrong keyword visible.';

comment on column public.keyword_serp_reads.asset_fit is
  '0..5, how much of a thing worth building is already visible on the results page. NOT magnet_space: '
  'that one asks whether anything is left to trade for an email, this one asks whether we could build '
  'the thing that WINS this SERP. A pricing calculator scores high here and low there.';

-- ── 3. The history's vocabulary ─────────────────────────────────────────────
--
-- ‼️ WITHOUT THIS THE DECISIONS GO DARK SILENTLY. keyword_decisions.action carries a CHECK
-- constraint, and recordKeywordDecisions swallows its own errors by design ("NOTHING HERE EVER FAILS
-- ITS CALLER"). A selection recorded against the old constraint would be refused by Postgres, logged
-- to a console nobody reads, and lost. Same trap, same fix, as the strategy migration.
alter table public.keyword_decisions drop constraint if exists keyword_decisions_action_check;
alter table public.keyword_decisions add constraint keyword_decisions_action_check
  check (action in (
    'approve', 'drop', 'add', 'restore', 'pick_pillar', 'pick_support', 'unpick',
    'merge', 'unmerge', 'mark_service_page', 'mark_post', 'pick_cluster_pillar', 'serp_verdict',
    'approve_cluster', 'reject_cluster', 'set_magnet',
    -- added with the decision cards. `select` and `unselect` are the reaction on a keyword's own
    -- card; `variation` is a phrase written because somebody asked for more ways to say one;
    -- `delete_all` is the whole set being thrown away on purpose.
    'select', 'unselect', 'variation', 'delete_all'
  ));

-- ── Verify. Expect TWELVE rows. Fewer means an alter did not apply. ─────────
select table_name || '.' || column_name as col, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'client_keywords' and column_name in
      ('card_ts', 'selected_at', 'selected_by', 'variation_of')) or
    (table_name = 'keyword_serp_reads' and column_name in
      ('query_on_screen', 'has_script', 'has_steps', 'has_checklist', 'videos_rank',
       'answer_shape', 'asset_fit', 'asset_ideas'))
  )
order by col;

-- ── And the CHECKs actually carry the new words. Expect TWO rows. ───────────
-- A column that exists proves an alter ran. A CHECK that was never replaced is invisible until an
-- insert fails in production, which is the shape of failure this whole lane keeps finding.
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where (conrelid = 'public.keyword_decisions'::regclass and conname = 'keyword_decisions_action_check'
        and pg_get_constraintdef(oid) like '%delete_all%')
   or (conrelid = 'public.keyword_serp_reads'::regclass and conname = 'keyword_serp_reads_answer_shape_check'
        and pg_get_constraintdef(oid) like '%mixed%');
