-- 2026-10-09: what the ICP throws away, per metro, as a page rather than a question.
--
--   bun run scripts/db.ts --file=docs/2026-10-09-drop-rollup.sql --dry
--   bun run scripts/db.ts --file=docs/2026-10-09-drop-rollup.sql
--
-- Additive and idempotent: one `create or replace function`. No table, no column, no data change.
--
-- ‼️ THE QUESTION IS "WHICH CATEGORIES ARE WE THROWING AWAY", AND ANSWERING IT NEEDED A PAGE BECAUSE
-- THE ANSWER MOVES. Of the 1,200 records pulled on 2026-10-08, 493 did not pass the ICP: 257 by a
-- free rule and 236 by the model. The model's 236 break down into chains (80), platform-only
-- domains (57), too few reviews (39), wrong trade (13), product sellers (13) and a long tail. That
-- breakdown is the single best evidence about whether the PROFILE is wrong rather than the list, and
-- until now it existed only in whatever Slack card happened to be scrolled back to.
--
-- ‼️ `qualify_model` IS THE DISCRIMINATOR AND IT IS ALREADY WRITTEN ON EVERY ROW. 'rule' means a free
-- rule decided it, anything else is the model's own name (currently claude-haiku-4-5-20251001),
-- recorded per row rather than per run on purpose: a run can span a model change. So "free rule
-- against model" is a column, not an inference from the reason text.
--
-- ‼️ AND A DROP IS NOT A BIN. `qualify_keep = false` means "not going into enrichment", which is a
-- statement about the EMAIL channel and nothing else. 423 of those rows carry route = 'call': a real
-- business with a front desk and a phone number and no address this lane can crawl. The function
-- returns `route` alongside everything else precisely so the page can show "not emailable" split
-- into called and binned, instead of printing 493 under a heading that reads like a wastebasket.


-- =====================================================================
-- The rollup
-- =====================================================================
--
-- ‼️ IT GROUPS ON THE RAW REASON AND LETS THE PAGE NORMALISE, which is the same decision
-- territory_state_rollup already documents and made for the same reason. The one correct
-- normaliser is `normalizeReason` in src/lib/scraper/qualify.ts: it lowercases, strips punctuation,
-- drops stopwords and SORTS THE REMAINING WORDS, so "chain, not owner operated" and "a chain rather
-- than owner operated" collapse to one bucket. A second copy of that in SQL would start out
-- agreeing and then stop, and `groupDrops` is already the shared implementation three other callers
-- use.
--
-- ‼️ judged_vertical IS RETURNED EVEN THOUGH IT IS NULL ON EVERY DROP TODAY, AND THAT IS NOT DEAD
-- WEIGHT. qualifyChunk writes `judgedVertical: dropped ? null : answer`, so a dropped row has no
-- vertical by construction, and the buckets are therefore prose. The column is here because the
-- page must bucket on it WHERE IT EXISTS and fall back to the reason, never the reverse: the day a
-- prompt change starts naming what a dropped business actually was, the page picks it up with no
-- migration. Printing the column's emptiness is also the honest way to say "these buckets are model
-- prose, not a taxonomy".
--
-- ‼️ ORDERED BY COUNT DESCENDING BECAUSE THE CALLER PAGES IT. PostgREST caps any response at 1,000
-- rows server side and `.range()` can only MOVE that window, never widen it. This grouping is per
-- (metro, model, route, reason) and reasons are free text, so sixteen worked metros could exceed
-- the cap. dropRows() in territory.ts pages exactly the way territoryDots() does, and the biggest
-- buckets come first so a truncated read loses the tail rather than an arbitrary slice.
create or replace function public.territory_drop_rollup(
  p_vertical text default null,
  p_limit integer default 4000
)
returns table (
  source_metro text,
  -- 'rule' for a free rule, else the model that judged it.
  qualify_model text,
  -- 'call' or 'drop'. A called row is not a binned one.
  route text,
  -- Null on every drop today. See the note above: read first, fall back second.
  judged_vertical text,
  qualify_reason text,
  n bigint
)
language sql
stable
as $$
  select
    l.source_metro,
    coalesce(l.qualify_model, 'unrecorded') as qualify_model,
    coalesce(l.route, 'unrouted') as route,
    l.judged_vertical,
    coalesce(l.qualify_reason, 'no reason recorded') as qualify_reason,
    count(*) as n
  from public.raw_leads l
  where l.qualify_keep is false
    and (p_vertical is null or l.vertical_slug = p_vertical)
  group by 1, 2, 3, 4, 5
  order by count(*) desc, 1, 5
  limit greatest(p_limit, 1);
$$;

comment on function public.territory_drop_rollup(text, integer) is
  'Every raw lead the ICP did not keep, grouped per metro by what judged it (free rule against '
  'model), where it went (call against drop) and the reason text. Behind the drops section of '
  '/dashboard/territory and the get_drop_breakdown tool. Reasons are NOT normalised here: '
  'normalizeReason in src/lib/scraper/qualify.ts is the one implementation and the page applies it, '
  'so the nine spellings of "Instagram only" collapse to one bucket.';


-- =====================================================================
-- Verification
-- =====================================================================
--
-- ‼️ WRITTEN TO BE ABLE TO FAIL, AND THE FIRST TWO COLUMNS MUST BE EQUAL. If `rollup_total` and
-- `not_kept` disagree, the function is either losing rows to a join or counting some twice, and
-- every percentage on the page would be wrong in a way nobody could see. `called` plus `binned`
-- must also equal `not_kept`, or a row is routed to something the page has no column for.
select
  (select sum(n) from public.territory_drop_rollup('medspa', 100000)) as rollup_total,
  (select count(*) from public.raw_leads where qualify_keep is false and vertical_slug = 'medspa')
    as not_kept,
  (select count(*) from public.raw_leads
    where qualify_keep is false and vertical_slug = 'medspa' and qualify_model = 'rule') as by_rule,
  (select count(*) from public.raw_leads
    where qualify_keep is false and vertical_slug = 'medspa' and qualify_model <> 'rule') as by_model,
  (select count(*) from public.raw_leads
    where qualify_keep is false and vertical_slug = 'medspa' and route = 'call') as called,
  (select count(*) from public.raw_leads
    where qualify_keep is false and vertical_slug = 'medspa' and route = 'drop') as binned,
  (select count(*) from public.raw_leads
    where qualify_keep is false and vertical_slug = 'medspa' and judged_vertical is not null)
    as drops_with_a_vertical,
  (select count(*) from public.territory_drop_rollup('medspa', 100000)) as bucket_rows;
