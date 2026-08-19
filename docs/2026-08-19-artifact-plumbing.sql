-- The plumbing the four onboarding artifacts need before any of them can be generated.
--
-- Safe to run more than once.
--
-- WHY THIS EXISTS. Five rows of the 33-row delivery checklist render "_auto_" in Slack and
-- nothing implements them: presence_pdf, avatar_harvest, findings_doc, review_card_pdf and
-- call_sheet. delivery-checklist.ts says in its own header that a checklist which lies about
-- what has happened is worse than no checklist. This migration is the first of three that
-- let the generators land so the label stops being a lie.
--
-- Three changes, each one a seam something downstream needs.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Which client does this audit belong to
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Today there is NO column joining audit_reports back to clients except contact_id, which is
-- a soft CRM link that is null for anyone who never came through the funnel. Every artifact
-- generator has to answer "which run is this client's" and a contact_id join is not an answer.
--
-- ‼️ clients.audit_report_id ALREADY EXISTS and is deliberately NOT reused for this. Its own
-- comment (2026-08-18-measurement.sql) reads "The prospect audit this client came from, if
-- any" — a prospect_audit row, excluded_from_scorecard, allowed into findings section 1 only
-- as "the audit you already saw". Pointing it at a baseline instead would let a one-engine
-- prospecting run be read as a photograph, which is exactly the contamination A2 D-P14
-- exists to stop. Two different facts, two different columns.
alter table public.audit_reports
  add column if not exists client_id uuid references public.clients(id) on delete set null;

create index if not exists audit_reports_client_idx on public.audit_reports (client_id);

comment on column public.audit_reports.client_id is
  'The client this run was fired FOR, set by startBaselineScan. Distinct from '
  'clients.audit_report_id, which points the other way at the PROSPECT audit the client came '
  'from. A row may legitimately have both, and they may be different runs.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Where the site actually lives
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Runner v3 section 5 writes this to tenant_hub.site_intel. tenant_hub does not exist in this
-- repo and is not being created for one column; client_hosts and client_pages are what that
-- name translates to and neither is about the CLIENT'S OWN site.
--
-- jsonb rather than columns because the shape is a survey, not a schema: WHOIS/RDAP registrar
-- and dates, the six DNS record types at apex and www, the nameserver-derived DNS provider,
-- reverse DNS and network org on the A record, response headers, a CMS fingerprint, the mail
-- provider off MX, and which of learn./guide./reviews. already resolve. Half of those are
-- absent for any given domain and a wide table of nulls says less than one document does.
--
-- ‼️ resolveHost() SELECTS EVERY COLUMN IT MAPS. This column is on clients, not client_hosts,
-- so it is out of that blast radius. Keep it that way: a new client_hosts column added before
-- its migration is applied takes every client hub to 5xx.
alter table public.clients
  add column if not exists site_intel jsonb;

comment on column public.clients.site_intel is
  'Runner v3 section 5. WHOIS/RDAP, DNS, NS-derived DNS provider, hosting, CMS, mail provider, '
  'subdomain availability. Written by src/lib/clients/site-intel.ts. Read by findings section 4 '
  'and by the call sheet, which prints the provider-specific click path from it. '
  'clients.dns_provider and dns_nameservers stay authoritative for the DNS panel.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Evidence that arrived versus artefacts we made
-- ─────────────────────────────────────────────────────────────────────────────
--
-- client_docs holds two different kinds of thing once the generators land. A screenshot of a
-- Yelp listing is EVIDENCE: a human went and looked, and it is the proof behind a finding. A
-- generated findings PDF is an ARTEFACT: we made it, and re-running the step makes another.
--
-- Without this column they are told apart by "does slack_file_id happen to be null", which is
-- an implementation detail of how the file arrived rather than a statement about what it is.
-- The presence PDF has to count evidence and must not count itself.
alter table public.client_docs
  add column if not exists source text not null default 'slack';

alter table public.client_docs drop constraint if exists client_docs_source_check;
alter table public.client_docs add constraint client_docs_source_check
  check (source in ('slack', 'generated'));

comment on column public.client_docs.source is
  '''slack'' = captured from a thread by the file_shared handler, i.e. EVIDENCE. '
  '''generated'' = a PDF this app produced, i.e. an ARTEFACT. The default is ''slack'' because '
  'every row that exists today arrived that way.';

create index if not exists client_docs_generated_idx
  on public.client_docs (client_id, delivery_step_key)
  where source = 'generated';

-- ─────────────────────────────────────────────────────────────────────────────
-- What to expect
-- ─────────────────────────────────────────────────────────────────────────────
--
-- select count(*) from public.audit_reports where client_id is not null;   -- 0 until the next
--   baseline scan runs. Every existing row was fired by the audit bot, not for a client.
--
-- select source, count(*) from public.client_docs group by 1;              -- all 'slack'.
--
-- select id, legal_name, site_intel is null as no_intel from public.clients;  -- all true until
--   the site_dns_intel step runs.
