-- Audit Engine hardening: one Slack thread, one report. Safe to re-run.
--
-- thread-assistant.ts resolves an audit thread with
--   .from("audit_reports").select("*").eq("slack_thread_ts", threadTs).maybeSingle()
-- and audit_reports.slack_thread_ts had no index and no unique constraint, even though the
-- sibling thread tables (docs/2026-04-20-deal-threads.sql, docs/2026-06-04-statement-drops.sql)
-- both have one.
--
-- Today this fails CLOSED rather than wrong: a Slack message ts is unique per message, and if
-- two rows ever did collide, .maybeSingle() errors on the multi-row response and the handler
-- treats the thread as "not an audit thread" instead of silently picking one. So this is
-- hardening plus an index the lookup should always have had, not a bug fix.
--
-- Partial index: rows are inserted with slack_thread_ts NULL and updated a moment later once
-- Slack returns the ts, and every public-intake report that never posts a thread stays NULL
-- forever. A plain unique index would be fine with those (NULLs are distinct in Postgres), but
-- the partial form keeps the index small and states the intent.

create unique index if not exists audit_reports_slack_thread_ts_uidx
  on audit_reports (slack_thread_ts)
  where slack_thread_ts is not null;
