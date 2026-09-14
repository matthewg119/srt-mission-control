-- 2026-09-14 — the audit stops throwing away the three things it already computed
--
-- Matthew, 2026-09-14: "if a lead is getting onboarded we must already have data from that
-- customer, since we literally just did an AI visibility scan for them." The data is there. The
-- join was not, and three of the richest things the scan computes never reached the database at
-- all: they are locals in run-audit-pipeline.ts and they die when the function returns.
--
-- Nothing here costs a new fetch. Every value is already in memory at insert time.
--
-- Additive, idempotent, safe to run more than once.
-- Runner: bun run scripts/db.ts --file=docs/2026-09-14-audit-foundation.sql [--dry]
--
-- ‼️ RUN IT BEFORE THE DEPLOY THAT READS IT. One unknown column fails the WHOLE PostgREST select
-- and supabase-js RETURNS that error rather than throwing, so a try/catch never fires. Every new
-- read of these columns is written as its own select for that reason.


-- =====================================================================
-- 1. THE SITE CRAWL
-- =====================================================================
--
-- researchWebsite() is the single richest description of what a business actually sells, and it is
-- distilled into site_signals, handed to the classifier as prose, and then dropped. draft-page.ts
-- documents the identical loss and re-reads the site live to work around it.
--
-- ‼️ homepageHtml IS DELIBERATELY NOT STORED. It is raw uncapped markup: a page-builder homepage
-- runs 150KB to 2MB, one to two orders of magnitude above every other blob this system persists
-- (bodyText is capped at 16,000 chars, an evidence source at 2,500). detectSiteSignals already
-- distils the only thing it was kept for into site_signals.
--
-- ‼️ pages[].text IS NOT STORED EITHER, AND FOR THE SAME REASON, which is less obvious. MAX_PAGES
-- is 3 but there is NO per-page character cap: pages[].text is each page's full extracted text,
-- and the 16,000-char budget applies only to the joined bodyText. So `pages` can be several times
-- larger than the field it feeds. What is worth keeping is which URLs were read and how much text
-- each had, so the writer stores [{url, chars}] and bodyText carries the text itself.
alter table public.audit_reports add column if not exists site_crawl jsonb;

comment on column public.audit_reports.site_crawl is
  'The SiteResearch this audit crawled, minus homepageHtml and minus pages[].text: '
  '{website, title, metaDescription, siteName, headings, bodyText, schemaHints, source, blocked, '
  'pages:[{url, chars}]}. Both omissions are size, not preference, and both are uncapped upstream. '
  'Written by run-audit-pipeline.ts at insert; promoted into page_sources at intake_received.';


-- =====================================================================
-- 2. THE PAID BUSINESS IDENTITY
-- =====================================================================
--
-- claude-research.ts calls this "the most expensive generation in the pipeline": Sonnet plus up to
-- four server-side web searches. Six of its twelve fields are read and the rest die as a local.
-- identity.services[] is the closest thing in the pipeline to "what they sell" and is flattened
-- into prose exactly once, by renderProfile, before being discarded.
--
-- ‼️ NEVER MERGE identity.competitors INTO THE EXISTING competitors COLUMN. They are two different
-- facts with one name. audit_reports.competitors holds classification.likely_competitors, and that
-- column's own schema comment says what they are: `[{name, domain, hypothesis: true}]`, the
-- classifier's GUESSES. identity.competitors is the only list in the system of real competitors a
-- named source actually mentioned. Merging them would make a hypothesis indistinguishable from an
-- observation, in the one table the sales lane quotes from.
alter table public.audit_reports add column if not exists identity jsonb;

comment on column public.audit_reports.identity is
  'The BusinessIdentity from claude-research.ts, whole: '
  '{found, tradingName, whatTheyDo, services, city, state, cityConfidence, alternates, websites, '
  'reviewsSummary, competitors, sources}. ‼️ identity.competitors are REAL competitors a source '
  'named, and are NOT the same fact as audit_reports.competitors, which holds the classifier''s '
  'hypotheses. Never merge the two. Null on an OpenAI-backup run, which returns prose not structure.';


-- =====================================================================
-- 3. THE CLASSIFICATION ENVELOPE
-- =====================================================================
--
-- classifyBusiness() returns is_local and city_confidence and the insert names neither, so a null
-- `city` on this table means three different things at once: not local, not found, or a name-mode
-- run. Nothing downstream can tell them apart.
--
-- ‼️ ONE COLUMN, NOT TWO, AND THE WHOLE RETURN VERBATIM. The next field the classifier learns then
-- needs no migration. Same reasoning site_signals and crawl_block already use.
--
-- ‼️ THIS IS A SNAPSHOT, NOT A SECOND SOURCE OF TRUTH. It necessarily repeats `prompts` and
-- `likely_competitors`, which have their own live columns, and those columns stay authoritative:
-- they are edited, re-run and read by dozens of callers. This blob is what the classifier SAID at
-- classify time and is never updated afterwards. A reader that wants the current questions reads
-- audit_reports.prompts; a reader asking what the classifier originally returned reads this.
alter table public.audit_reports add column if not exists classification jsonb;

comment on column public.audit_reports.classification is
  'classifyBusiness()''s whole return, as returned, never updated: {business_name, business_type, '
  'vertical_slug, is_local, city_detected, city_confidence, buyer_persona, prompts, '
  'likely_competitors}. is_local and city_confidence exist ONLY here, which is what lets a reader '
  'tell "not local" from "city not found". The dedicated prompts/competitors columns remain '
  'authoritative for current values; this is the classify-time snapshot.';


-- =====================================================================
-- 4. WHAT client_id ACTUALLY MEANS
-- =====================================================================
--
-- ‼️ THIS IS THE LOAD-BEARING SECTION AND IT IS REPAIRING A REGRESSION, NOT ADDING A FEATURE.
--
-- Until 2026-09-14, audit_reports.client_id was set in exactly two places, both at INSERT, both
-- meaning "this run was fired FOR this client". Four readers depend on that meaning and say so in
-- capitals: step-verify.ts's baseline_scan verifier ("client_id ONLY, with no contact_id or domain
-- fallback ... both of those can match a prospect_audit"), adoptAuditClassification,
-- universalSetFor's frozen question set, and the presence/findings fidelity footer.
--
-- On 2026-09-14 a backfill linked 13 more reports to clients BY MATCHING THE WEBSITE HOST. That is
-- precisely the domain fallback those comments refuse, applied in SQL instead of in code. The link
-- itself is wanted, and it is what Matthew asked for. What broke is that client_id now answers two
-- different questions with one value, and BASELINE_ONLY cannot separate them: it filters by
-- EXCLUSION (run_label not in the supplied labels) and prospect_audit is not excluded, so every
-- backfilled row passes it.
--
-- Measured before writing this file. All 14 linked rows carry run_label = 'prospect_audit'. Of
-- them, 8 carry lead_source = 'aeo_client_onboarding' (what startBaselineScan stamps) but SIX of
-- those predate their own client row: srt-agency-llc has been re-onboarded twice, its current row
-- was created 2026-08-27T15:22:33, and those six audits are from 08-18 to 08-25. They belong to
-- client rows that no longer exist. So lead_source alone is NOT the test, and neither is run_label.
--
-- The honest test is both halves at once: fired by the onboarding lane, AND fired after the client
-- row it is attached to existed. Exactly one row in the database satisfies that today, and it is
-- the one the verifier already resolves, which is why step 2 is green by luck rather than by
-- construction.
alter table public.audit_reports add column if not exists client_link_source text;

alter table public.audit_reports drop constraint if exists audit_reports_client_link_source_check;
alter table public.audit_reports add constraint audit_reports_client_link_source_check
  check (client_link_source is null
         or client_link_source in ('fired_for_client', 'backfilled_by_domain'));

-- The principled backfill. No pinned ids and no slug literals: SRT is resolved by the same rule
-- every other client is, which is the standing instruction for this codebase.
update public.audit_reports r
set client_link_source = 'fired_for_client'
from public.clients c
where r.client_id = c.id
  and r.client_link_source is null
  and r.lead_source = 'aeo_client_onboarding'
  and r.created_at >= c.created_at;

-- Everything else that carries a client_id got it after the fact, from the host match.
update public.audit_reports
set client_link_source = 'backfilled_by_domain'
where client_id is not null
  and client_link_source is null;

comment on column public.audit_reports.client_link_source is
  'HOW client_id came to be set, and it is the difference between "a run fired for this client" '
  'and "a prospect audit we matched by website host afterwards". Only meaningful when client_id is '
  'not null. Every reader that means "this client''s own baseline photograph" must require '
  'fired_for_client AND the BASELINE_ONLY run_label filter: run_label excludes the runs we fire '
  'ourselves (measurement, photograph_2, retest_*), this excludes the prospect audits we adopted. '
  'Neither filter alone is sufficient and dropping either one re-opens the 2026-09-14 regression.';


-- =====================================================================
-- VERIFICATION
-- =====================================================================
--
-- Expect four rows: site_crawl, identity, classification, client_link_source, all jsonb except the
-- last, which is text.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'audit_reports'
  and column_name in ('site_crawl', 'identity', 'classification', 'client_link_source')
order by column_name;

-- Expect exactly one fired_for_client and thirteen backfilled_by_domain, and 89 rows still null
-- because they are prospects who never became clients. That last number is correct and is not a gap.
select coalesce(client_link_source, '(no client_id)') as link, count(*)
from public.audit_reports
group by 1
order by 2 desc;

-- ‼️ THE ROW THAT MATTERS. Expect ONE row: srt-agency-llc's 2026-08-27 scan, score 10. If this
-- returns zero rows, step 2's baseline verifier will refuse for every client, and the cause is
-- that no audit was ever fired for a client row that still exists.
select c.slug, r.created_at, r.score, r.lead_source
from public.audit_reports r
join public.clients c on c.id = r.client_id
where r.client_link_source = 'fired_for_client'
order by r.created_at desc;
