-- SERP verdicts: what Google actually showed for a finalist keyword, and the triage that follows.
--
-- Additive, idempotent, safe to run more than once.
-- Runner: bun run scripts/db.ts --file=docs/2026-09-26-keyword-serp.sql [--dry]
--
-- ‼️ A TABLE, NOT COLUMNS ON client_keywords, AND resetForNewOffer IS THE REASON. That function
-- (src/lib/clients/client-keywords.ts) HARD-DELETES every non-manual client_keywords row the moment
-- the locked offer changes. A verdict is a measurement of a SERP on a day; it is still true after
-- the offer is re-worded. Columns there would be destroyed by an `offer:` edit, and the one thing
-- worth keeping across a re-scope is the evidence.
--
-- ‼️ AND KW_COLUMNS FAILS LOUDLY BY DESIGN. It is a flat select whose own comment says a missing
-- column must fail loudly with TABLE_HINT. Adding verdict columns to it would take step 12 down
-- between a deploy and this file, in a repo that deploys code first.
--
-- ‼️ THE READ IS SEPARATED FROM THE RULE, the same way screenshot-read.ts separates them. The model
-- records WHAT IS ON THE SERP (the *_read columns). The VERDICT is computed by a pure function,
-- verdictFrom() in src/lib/clients/keyword-strategy-rules.ts, and stored beside the read so the
-- rule that produced it can be re-derived and argued with. A model returning "merge" directly would
-- be a model with an opinion about the answer.

create table if not exists public.keyword_serp_reads (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references public.clients (id) on delete cascade,

  -- SET NULL, and the phrase is stored beside it, exactly as keyword_decisions does. The keyword row
  -- can be rebuilt by an offer change and the reading is still a fact about a SERP. `normalized` is
  -- what re-attaches it afterwards: client_keywords is unique on (client_id, normalized, use).
  keyword_id        uuid references public.client_keywords (id) on delete set null,
  phrase            text not null,
  normalized        text not null,

  -- ── WHAT WAS ON THE SCREEN. Every one is a TRI-STATE: null is "could not tell", never "no". ──
  --
  -- ‼️ null IS NOT false HERE AND THE WHOLE TRIAGE DEPENDS ON IT. Same doctrine as
  -- client_keywords.currently_named: a half-read screenshot scored as "no AI Overview" would send a
  -- keyword to a post that should have been merged, and nothing downstream could tell that apart
  -- from a real reading.
  ai_overview          boolean,   -- was an AI Overview box present at all
  ai_overview_answers  boolean,   -- did it FULLY answer the query, which is the triage's own words
  -- 'articles' | 'listings' | 'products' | 'mixed'. Text, not an enum: keyword-strategy-rules.ts is
  -- the authority and a probe asserts the two agree.
  result_shape         text,

  -- ── THE VERDICT, DERIVED. ──
  -- 'post'          articles rank, so write the post
  -- 'merge'         the AI Overview fully answers it, so fold it under a bigger post
  -- 'service_page'  all local listings or software products, so a service page and not a post
  -- 'unclear'       the read could not decide. NEVER silently 'post'.
  verdict           text not null check (verdict in ('post', 'merge', 'service_page', 'unclear')),

  -- 'vision' a screenshot was read. 'typed' a person said so in the thread, which is the fallback
  -- that means a screenshot is never required and is deliberately ranked ABOVE a vision read.
  source            text not null check (source in ('vision', 'typed')),
  -- 0..1, how clearly the SERP was legible. Always 1 on a typed verdict: a person is not a
  -- legibility score.
  confidence        numeric,
  -- One short phrase naming what it read from, or what was on screen instead. Never a paragraph.
  evidence          text,
  -- The screenshot itself, filed by captureOnboardingFile into the private `onboarding` bucket.
  doc_id            uuid references public.client_docs (id) on delete set null,
  model             text,
  actor             text,

  created_at        timestamptz not null default now()
);

-- Latest-per-keyword is resolved in code, not by a partial unique index: a re-read of the same
-- phrase next month is a SECOND fact, not a correction of the first. Append only.
create index if not exists keyword_serp_reads_client
  on public.keyword_serp_reads (client_id, created_at desc);
create index if not exists keyword_serp_reads_keyword
  on public.keyword_serp_reads (client_id, normalized, created_at desc);

comment on table public.keyword_serp_reads is
  'One row per SERP verdict on a finalist keyword: what the page showed, what triage follows, and '
  'whether it was read off a screenshot or typed by a person. Append only. Survives an offer change '
  'on purpose: client_keywords rows do not.';

alter table public.keyword_serp_reads enable row level security;

-- ── Verify. Expect ONE row saying 16. ──────────────────────────────────────
select table_name, count(*) as columns
from information_schema.columns
where table_schema = 'public' and table_name = 'keyword_serp_reads'
group by table_name;
