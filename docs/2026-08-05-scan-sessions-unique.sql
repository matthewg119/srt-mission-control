-- /scan, follow-up to 2026-08-05-scan-sessions.sql. Run AFTER that one.
--
-- Closes the read-then-insert race on the domain cache. findCachedSession() and createSession()
-- are two round trips, so two visitors pasting the same new domain in the same second both miss
-- the cache and both run a full audit: double the model spend, two Slack prompt drops, two
-- report rows for one business. The check cannot fix that on its own; only the database can.
--
-- Partial, on the IN-FLIGHT statuses only. A finished ('done') or dead ('failed') session must
-- not block a later re-scan of the same domain, which is what a plain unique index on domain
-- would do, permanently.
--
-- start/route.ts depends on this: when the insert fails it re-reads the row the winning request
-- wrote and hands that session to the loser, so the race resolves into a cache hit rather than
-- an error.

create unique index if not exists scan_sessions_domain_inflight_idx
  on public.scan_sessions (domain)
  where status in ('researching', 'running');

-- Keeps a typo'd status from silently disabling the cache exclusion in findCachedSession,
-- which filters on status <> 'failed'.
alter table public.scan_sessions
  drop constraint if exists scan_sessions_status_check;

alter table public.scan_sessions
  add constraint scan_sessions_status_check
  check (status in ('researching', 'running', 'done', 'failed'));
