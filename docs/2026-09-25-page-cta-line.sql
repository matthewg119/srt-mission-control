-- The sentence a page uses to ask, chosen when the page is created.
--
-- ‼️ RUN THIS BEFORE THE DEPLOY THAT READS IT. lib/hub/pages.ts selects cta_line by name inside its
-- one COLUMNS literal, and ONE unknown column fails the WHOLE PostgREST select. supabase-js RETURNS
-- that error rather than throwing it, so the hub would not crash: every page read would quietly come
-- back empty and every page on every client hub would 404 while the logs stayed calm.
--
-- ‼️ IT IS NOT IN answer_md AND IT MUST NOT BE. Three rails keep the body free of a pitch:
-- draft-page.ts tells the drafter not to write a call to action, the same prompt forbids links, and
-- page-gate.ts fails the publish gate on a markdown link in the body. The body exists to be QUOTED by
-- an assistant, and a pitch inside the answer is the part that stops it being quoted. This column is
-- rendered AFTER the answer instead, which is how a cited page can still ask for the click.
--
-- ‼️ PER PAGE, NOT PER TENANT, WHICH IS THE WHOLE POINT. 09e1699 made the MAGNET a per-page decision
-- (client_pages.lead_magnet_key) but the widget's speech bubbles are still templated from that
-- magnet's title, so every page on a hub teased the same words. The magnet says which offer stands at
-- the end of the page. This says how this page asks for it.
--
-- Null is not an absence to be filled in: it means the widget falls back to the magnet-templated
-- lines, which is correct for every page written before today.

alter table public.client_pages add column if not exists cta_line text;

comment on column public.client_pages.cta_line is
  'One sentence this page uses to offer its lead magnet. Rendered AFTER answer_md, never inside it, '
  'and sent to the widget as the first teaser line. NULL falls back to the magnet-templated lines. '
  'Capped at 90 characters by normalizeCtaLine in src/lib/hub/pages.ts, because the bubble slices at 90.';

-- ‼️ THE LENGTH IS ENFORCED HERE TOO, BECAUSE THE APP IS NOT THE ONLY WRITER. A sentence pasted
-- straight into the table by hand would otherwise be stored whole and shown truncated, which reads as
-- a broken widget rather than as a sentence nobody counted.
alter table public.client_pages drop constraint if exists client_pages_cta_line_len;
alter table public.client_pages add constraint client_pages_cta_line_len
  check (cta_line is null or char_length(cta_line) <= 90);

-- =====================================================================
-- 2. THE SAME SENTENCE ON THE PLAN, BECAUSE THAT IS WHERE IT IS CHOSEN
-- =====================================================================
--
-- The decision is made while the plan is being approved, which is BEFORE client_pages has a row to
-- hold it. Storing it only on the page would mean the question could not be asked until after the
-- drafting had already happened, and a redraft would lose whatever somebody had written.
--
-- draftOne copies this onto the page it creates. After that `cta N:` writes both, so they cannot
-- drift, and page_plan keeps the decision across a redraft.

alter table public.page_plan add column if not exists cta_line text;

comment on column public.page_plan.cta_line is
  'The sentence this planned page will use to offer its magnet, chosen before drafting. Copied to '
  'client_pages.cta_line when the page is drafted. NULL means nobody has chosen one yet.';

alter table public.page_plan drop constraint if exists page_plan_cta_line_len;
alter table public.page_plan add constraint page_plan_cta_line_len
  check (cta_line is null or char_length(cta_line) <= 90);


-- What has one and what does not, so the run can be checked against it.
select
  count(*)                                     as pages,
  count(*) filter (where cta_line is not null) as with_a_sentence,
  count(*) filter (where lead_magnet_key is not null and cta_line is null) as magnet_but_no_sentence
from public.client_pages
where status <> 'archived';
