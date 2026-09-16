-- The page plan, the anchor a magnet frames, and the outline a page is written from.
--
-- Additive, idempotent, safe to run more than once. Requires docs/2026-08-18-client-hub.sql,
-- docs/2026-09-03-concierge-audience.sql and docs/2026-09-04-magnet-lane.sql.
-- Runner: bun run scripts/db.ts --file=docs/2026-09-11-page-plan.sql [--dry]
--
-- ‼️ RUN THIS BEFORE THE DEPLOY THAT READS IT. page-studio.ts selects page_plan and
-- client_pages.outline. The reads are written to degrade rather than to throw, but a studio
-- thread that silently shows "no plan" because the table is missing is the exact failure
-- readSession's header already records once.

-- =====================================================================
-- 1. THE PAGE PLAN: WHICH PAGES GET WRITTEN, DECIDED BEFORE ANY OF THEM IS
-- =====================================================================
--
-- Matthew, 2026-09-11: "All of this needs to be selected and done before we start drafting
-- pages, this way each page is done strategically and not just random."
--
-- A NEW TABLE RATHER THAN page_candidates.selected_for_month, AND FOR TWO REASONS.
--  1. page_candidates is REGENERATED. Step 14 re-scores it and now prunes rows the new run did
--     not produce, so a decision stored on a candidate row is a decision the next re-run deletes.
--  2. A plan row carries things a candidate does not have and should not have: the target
--     keyword, a working title, the angle, and the magnet framing. Those are decisions, and a
--     candidate is a reading of the corpus.
--
-- The question is stored VERBATIM, for the reason client_pages.question is: a reference into a
-- regenerated table would let a re-run turn an approved plan row into a different page.
--
-- ‼️ NO 'published' STATUS. Whether the page is live is client_pages.status, and a second copy
-- here would be a second writer to keep in step with setPublished, which must keep exactly one
-- caller. The studio reads it through page_id.
create table if not exists public.page_plan (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  rank integer not null,
  question text not null,
  -- A phrase from buildKeywordSet(), checked in code before the row is written.
  target_keyword text not null,
  working_title text not null,
  -- One line on the value this page gives the reader.
  angle text not null,
  theme text not null,
  origin text not null default 'harvested' check (origin in ('harvested', 'derived')),
  -- { title, ctaLabel, conciergeEntry }: how this page frames the client's anchor offer.
  magnet_frame jsonb,
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'claimed')),
  page_id uuid references public.client_pages(id) on delete set null,
  approved_at timestamptz,
  approved_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists page_plan_client_question
  on public.page_plan (client_id, lower(question));

create index if not exists page_plan_client_rank
  on public.page_plan (client_id, rank);

comment on table public.page_plan is
  'The N pages chosen for a client before any is drafted, each with a target keyword, an angle '
  'and a framing of the client anchor offer. Written and approved from the page studio. '
  'Whether a page is live is read from client_pages through page_id, never stored here.';

alter table public.page_plan enable row level security;


-- =====================================================================
-- 2. A MAGNET THAT FRAMES THE CLIENT'S ANCHOR OFFER
-- =====================================================================
--
-- Matthew, 2026-09-11: every page's lead magnet should lead back to ONE core offer (for SRT, the
-- AI visibility audit). So a page's magnet is a topic-shaped door into that offer, not a second
-- deliverable. frames_key names the anchor's magnet_key.
--
-- ‼️ THE ANCHOR'S asset_url IS NOT COPIED. The engine resolves the link through frames_key at
-- delivery time, so the day the audit moves, every framing follows it. Copying the URL would
-- freeze it on every minted row, the exact hazard magnets.ts ENV_ASSET documents.
alter table public.lead_magnets add column if not exists frames_key text;

comment on column public.lead_magnets.frames_key is
  'The magnet_key of the anchor offer this magnet frames. The widget hands over the anchor''s '
  'asset and follows the anchor''s chain. Null for an ordinary magnet.';

-- Written at draft time, when the client had an anchor, and copied onto the minted row on
-- approval. Frozen at draft time for the same reason audience is: the five were written as
-- framings of THAT anchor.
alter table public.page_magnet_candidates add column if not exists frames_key text;


-- =====================================================================
-- 3. THE OUTLINE A PAGE IS WRITTEN FROM
-- =====================================================================
--
-- { sections: [{ heading, bullets: [string] }], gaps: [{ id, prompt, scope }] }
--
-- ‼️ A SEPARATE COLUMN, NOT answer_md. The outline is written by a model. Putting it in the body
-- would put machine text on the page with no evidence map behind it, and the gate reads a body
-- with no map as hand-written and skips unbacked_claims. The gaps are answered as page_sources,
-- and `draft` writes the body from those, with a map.
alter table public.client_pages add column if not exists outline jsonb;


-- =====================================================================
-- 4. WHAT THIS SHOULD LOOK LIKE AFTERWARDS
-- =====================================================================

select column_name, data_type
  from information_schema.columns
 where (table_name = 'lead_magnets' and column_name = 'frames_key')
    or (table_name = 'page_magnet_candidates' and column_name = 'frames_key')
    or (table_name = 'client_pages' and column_name = 'outline');

-- Zero rows on a fresh run: only the page studio writes this table.
select status, count(*) from public.page_plan group by status;
