-- No-website audits: /audit "Business Name" | City, ST
--
-- A large share of local businesses worth pitching have no site at all: a Google Business
-- Profile, a Yelp page, and nothing they own. The audit engine can score them anyway, because
-- the domain was never an input to the answers. It only ever fed the QUESTIONS, and
-- search-research.ts can build those from third-party sources instead.
--
-- So `website` stops being required. It is now genuinely absent on a name-mode run, and every
-- reader must treat it as nullable rather than assuming an empty string.
--
-- research_source (added in 2026-08-18-audit-crawl-block.sql) carries a fourth value on these
-- runs: 'declared'. It means Matthew named the business and the profile came entirely from
-- third-party sources, with no site involved at any point. That is different from 'search',
-- which means a site EXISTS and we could not read it. Only the second is a fact worth pitching
-- as a crawler problem; conflating them would tell a business with no website that their
-- website is blocking crawlers.
--
-- crawl_block stays NULL on a declared run. There is no site to be blocked by, and
-- crawlBlockAngle() keys on it.

alter table audit_reports alter column website drop not null;

comment on column audit_reports.website is
  'The prospect''s website. NULL on a name-mode /audit run, where the business has no site at all. '
  'Readers must not assume a string: buildAliases() loses its bare-domain token, so client_name '
  'carries the whole mention match, and every "client_name || business_type || website" display '
  'chain loses its last rung. Use displayName() rather than re-deriving that chain.';

-- Restated because 'declared' is new. Kept in one place: this comment supersedes the one in
-- 2026-08-18-audit-crawl-block.sql.
comment on column audit_reports.research_source is
  'Where the 20 questions were derived from. "site" = we read their pages. "search" = a site '
  'exists and could not be read, so the profile came from third-party sources. "site+search" = '
  'the page was readable but too thin, so search filled the gap. "declared" = there is NO site; '
  'Matthew named the business and the whole profile is third-party. Anything claiming to describe '
  'THEIR SITE must check this first, and "search" vs "declared" is the difference between a '
  'crawler problem worth pitching and a business that simply has no website.';
