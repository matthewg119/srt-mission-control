-- Audit engine: survive a site we cannot read, and record WHY we could not read it.
-- Add-only, safe to re-run.

alter table audit_reports
  add column if not exists crawl_block jsonb,
  add column if not exists research_source text;

comment on column audit_reports.crawl_block is
  'Tri-state. null = the homepage was read normally, so there is nothing to say. Object = { reason, status, detail, checked_at, engines_cited_site }. reason "blocked" (a challenge page or 403/429/503) is the ONLY value that is evidence about the prospect; timeout/network/http_error/not_html are facts about our own fetcher. engines_cited_site is written by finishReport from audit_runs.citations: true = the engines cited this domain during the run, so their crawlers get through and the block was ours alone. See crawlBlockAngle() in src/config/pitch.ts - nothing may be said to a prospect unless reason is "blocked" AND engines_cited_site is false.';

comment on column audit_reports.research_source is
  'Where the 20 questions were derived from. "site" = we read their pages. "search" = the page could not be read, so the profile came from third-party sources and site_signals is null. "site+search" = the page was readable but too thin to classify, so search filled the gap. Anything claiming to describe THEIR SITE must check this first.';
