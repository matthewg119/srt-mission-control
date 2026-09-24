-- SERP readings: what Google actually showed for a finalist keyword, the two scores that follow, and
-- whether there is anything left to give away.
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
-- records WHAT IS ON THE SERP. The SCORES and the ROUTE are computed by pure functions in
-- src/lib/clients/keyword-strategy-rules.ts and stored beside the read, so the rule that produced
-- them can be re-derived and argued with. A model returning "merge" directly would be a model with
-- an opinion about the answer.
--
-- ‼️ ONE EXCEPTION TO THAT SPLIT, AND IT IS LABELLED IN THE DATA. magnet_space and magnet_idea are a
-- JUDGEMENT, not a reading: they come from a separate call (src/lib/clients/magnet-space.ts) whose
-- inputs are the client's offer and magnet library, and magnet_by records whether a model or a
-- person produced them. Nothing may confuse a judgement with an observation, so they never travel
-- in the same call as the transcription.

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
  -- 'articles' | 'listings' | 'products' | 'mixed'. Text, not an enum. RESULT_SHAPES in
  -- keyword-strategy-rules.ts is the authority, and scripts/_probe-serp-gate.ts parses this file and
  -- asserts the two lists agree. An earlier version of this comment claimed that probe existed
  -- before it did; it exists now, and it covers every CHECK list in this file.
  result_shape         text,

  -- More of the same screen, added with the two-score model. Observables, never judgements.
  -- 0..5: how completely the AI Overview resolved the search on its own. The finer-grained form of
  -- ai_overview_answers, and what click_value is mostly computed from.
  ai_overview_satisfies smallint,
  local_pack           boolean,   -- a map with business cards
  paa_present          boolean,   -- a "People also ask" box
  ads_above_fold       smallint,  -- sponsored results sitting above the first organic one

  -- ‼️ READ SINCE THE FIRST COMMIT AND THROWN AWAY UNTIL NOW. readSerp has always returned
  -- topDomains and forumRanks, recordVerdict printed both into the Slack reply, and neither had a
  -- column to land in. The brief asked for `competitors_named` while the data was already on the
  -- floor. Hostnames, never URLs: a host is a shape, a URL is a claim.
  top_domains          text[],
  forum_ranks          boolean,

  -- ‼️ A QUERY IS NOT A CLAIM AND A TERM IS NOT A SENTENCE, and that is the whole licence for these
  -- two columns. serp-read.ts refuses to transcribe anything that could become a claim and that
  -- refusal STANDS: there is no column here for a headline, a snippet, a price, a quote or any
  -- sentence from a result, and there will not be one. A People Also Ask entry is a SEARCH, the same
  -- class of object as the keyword being looked at. Vocabulary is which of two competing words
  -- appeared, which is shape. Both are capped in the reader, in code and not only in the prompt, so
  -- neither can grow into prose.
  paa_questions        text[],    -- at most 8, each at most 100 chars
  vocabulary           text[],    -- at most 12, each at most 40 chars

  -- ── THE VERDICT, DERIVED. What the SERP IS. ──
  -- 'post'          articles rank, so write the post
  -- 'merge'         the AI Overview fully answers it, so fold it under a bigger post
  -- 'service_page'  all local listings or software products, so a service page and not a post
  -- 'unclear'       the read could not decide. NEVER silently 'post'.
  verdict           text not null check (verdict in ('post', 'merge', 'service_page', 'unclear')),

  -- ── THE TWO SCORES. Pure functions of the read, so a scoring change re-applies to every stored
  -- row for free, the way scripts/_rescore-optimization.ts already does for the scraper. ──
  --
  -- ‼️ TWO SCORES AND NOT ONE VERDICT, AND THIS IS THE POINT OF THE WHOLE STAGE. The publisher's
  -- rule drops a query the AI Overview answers, because nobody clicks. For an AEO client, being
  -- NAMED inside that answer is the product, so a no-click query with citation value is the most
  -- valuable kind there is. What decides whether it survives is not the click score. It is whether
  -- anything is left to hand over.
  click_value       smallint check (click_value is null or click_value between 0 and 5),
  citation_value    smallint check (citation_value is null or citation_value between 0 and 5),

  dominant_intent    text check (dominant_intent is null or dominant_intent in
                       ('informational', 'commercial', 'transactional', 'local', 'tool')),
  dominant_page_type text check (dominant_page_type is null or dominant_page_type in
                       ('blog', 'service_page', 'price_page', 'booking', 'directory', 'tool')),

  -- ── THE OUTCOME. A DIFFERENT COLUMN FROM `verdict`, DELIBERATELY. ──
  --
  -- `verdict` says what the SERP IS. `route` says what we DO about it. `recommended_asset` says what
  -- we BUILD. Three questions, three columns. The brief called this one `verdict` as well, which
  -- collided with the column above, so it is named for what it actually answers rather than being
  -- given a third vocabulary.
  route             text check (route is null or route in ('keep', 'reroute', 'skip', 'drop')),
  recommended_asset text check (recommended_asset is null or recommended_asset in
                      ('service_page', 'answer_block', 'pillar', 'cluster_post', 'tool_page',
                       'gbp_offsite', 'none')),

  -- ── THE MAGNET TEST. A JUDGEMENT, AND LABELLED AS ONE. ──
  --
  -- ‼️ A NULL magnet_idea UNDER A HIGH ai_overview_satisfies IS A SKIP, NOT A BLANK. This field
  -- carries a drop decision, so nothing may leave it null by default. Either the drafter proposed
  -- something real, or a person said there is nothing left to give away, and magnet_by says which.
  -- A read whose magnet call simply FAILED has magnet_by null, which is a third state and is not a
  -- skip: the card asks for `magnet N:` rather than routing the keyword off the board on an outage.
  magnet_space      smallint check (magnet_space is null or magnet_space between 0 and 5),
  magnet_idea       text,
  magnet_by         text check (magnet_by is null or magnet_by in ('model', 'person')),
  rewritten_target  text,

  -- 'vision' a screenshot was read. 'typed' a person said so in the thread.
  --
  -- ‼️ A TYPED VERDICT IS RANKED ABOVE A VISION ONE FOR ROUTING AND DOES NOT SATISFY THE SCREENSHOT
  -- GATE, AND THOSE ARE TWO DIFFERENT QUESTIONS. bestVerdict() answers "which reading do I trust",
  -- and a person who looked at the page beats a model that half saw it. pictured() answers "is the
  -- picture on file", and a person asserting a conclusion is not a person's screenshot. An earlier
  -- version of this comment called typed "the fallback that means a screenshot is never required",
  -- which was true before src/lib/clients/serp-gate.ts existed and is false now.
  source            text not null check (source in ('vision', 'typed')),
  -- 0..1, how clearly the SERP was legible. Always 1 on a typed verdict: a person is not a
  -- legibility score.
  confidence        numeric,
  -- One short phrase naming what it read from, or what was on screen instead. Never a paragraph.
  evidence          text,
  -- The screenshot itself, filed by captureOnboardingFile into the private `onboarding` bucket.
  --
  -- ‼️ THIS COLUMN IS THE GATE. A row with source='vision' AND a non-null doc_id is the only thing
  -- that lets a keyword be used. See pictured() in keyword-strategy-rules.ts.
  doc_id            uuid references public.client_docs (id) on delete set null,
  -- 'mobile' or 'desktop'. Recorded, never inferred, and never used to claim the reading generalises
  -- past the screen it was taken on.
  device            text check (device is null or device in ('mobile', 'desktop')),
  model             text,
  actor             text,

  created_at        timestamptz not null default now()
);

-- ── Columns for a database that already ran the FIRST version of this file ─────────────
--
-- ‼️ THE create table ABOVE IS `if not exists`, SO IT IS A NO-OP ON SUCH A DATABASE AND EVERY COLUMN
-- ADDED SINCE WOULD BE SILENTLY MISSING. Nothing has run either version at the time of writing, so
-- these are belt and braces. They are also what makes this file honestly idempotent rather than
-- idempotent-as-long-as-nobody-was-quick, which is the failure the runner cannot see.
alter table public.keyword_serp_reads add column if not exists ai_overview_satisfies smallint;
alter table public.keyword_serp_reads add column if not exists local_pack boolean;
alter table public.keyword_serp_reads add column if not exists paa_present boolean;
alter table public.keyword_serp_reads add column if not exists ads_above_fold smallint;
alter table public.keyword_serp_reads add column if not exists top_domains text[];
alter table public.keyword_serp_reads add column if not exists forum_ranks boolean;
alter table public.keyword_serp_reads add column if not exists paa_questions text[];
alter table public.keyword_serp_reads add column if not exists vocabulary text[];
alter table public.keyword_serp_reads add column if not exists click_value smallint;
alter table public.keyword_serp_reads add column if not exists citation_value smallint;
alter table public.keyword_serp_reads add column if not exists dominant_intent text;
alter table public.keyword_serp_reads add column if not exists dominant_page_type text;
alter table public.keyword_serp_reads add column if not exists route text;
alter table public.keyword_serp_reads add column if not exists recommended_asset text;
alter table public.keyword_serp_reads add column if not exists magnet_space smallint;
alter table public.keyword_serp_reads add column if not exists magnet_idea text;
alter table public.keyword_serp_reads add column if not exists magnet_by text;
alter table public.keyword_serp_reads add column if not exists rewritten_target text;
alter table public.keyword_serp_reads add column if not exists device text;

-- Latest-per-keyword is resolved in code, not by a partial unique index: a re-read of the same
-- phrase next month is a SECOND fact, not a correction of the first. Append only.
create index if not exists keyword_serp_reads_client
  on public.keyword_serp_reads (client_id, created_at desc);
create index if not exists keyword_serp_reads_keyword
  on public.keyword_serp_reads (client_id, normalized, created_at desc);

comment on table public.keyword_serp_reads is
  'One row per SERP reading on a finalist keyword: what the page showed, the click and citation '
  'scores that follow, whether there is a lead magnet left in it, and whether it was read off a '
  'screenshot or typed by a person. Append only. Survives an offer change on purpose: '
  'client_keywords rows do not.';

comment on column public.keyword_serp_reads.doc_id is
  'The screenshot. A row with source=''vision'' and a non-null doc_id here is the ONLY thing that '
  'satisfies the gate in src/lib/clients/serp-gate.ts. A typed verdict routes a keyword and never '
  'unblocks it.';

comment on column public.keyword_serp_reads.route is
  'keep | reroute | skip | drop. What we DO, as against `verdict`, which is what the SERP IS. A low '
  'click score with a high citation score is rerouted to an answer block when there is magnet space '
  'and SKIPPED when there is none. It is never dropped on the click score alone.';

comment on column public.keyword_serp_reads.magnet_idea is
  'One line naming what we would actually give away, or null when there is nothing. Under a high '
  'ai_overview_satisfies a null here is a SKIP decision rather than a blank, which is why magnet_by '
  'records whether a model proposed it, a person said there is nothing, or the call never ran.';

alter table public.keyword_serp_reads enable row level security;

-- ── Verify. Expect ONE row saying 35: the original 16 plus the 19 alters above. ──────────────────────────────────────
select table_name, count(*) as columns
from information_schema.columns
where table_schema = 'public' and table_name = 'keyword_serp_reads'
group by table_name;
