-- #srt-sub decommission + Code Guardian phantom cleanup (2026-08-22)
--
-- Context: the funding teardown (2881734, 2026-08-17) deleted
-- /api/agent/submissions but left the Graph subscription row that pointed at it,
-- so the daily renew cron tried to re-create a subscription against a 404 and
-- alerted #srt-sub every morning. That cron and its machinery are now deleted.
--
-- Separately, .github/workflows/ai-guardian-cron.yml was calling the deleted
-- /api/cron/ai-guardian every 4 hours; its failure was itself a watched workflow,
-- so Code Guardian carded a phantom failure 6x a day. Every code_guardian_fixes
-- row to date is one of those. The workflow is deleted; these rows are retired so
-- the table reflects reality and the new dedupe check is not fooled by them.

-- 1. Drop the orphaned subscription row. Nothing renews it any more and the
--    endpoint it names no longer exists.
delete from integrations
where name = 'graph_subscription_submissions_srtagency_com';

-- 2. Retire the phantom guardian cards.
update code_guardian_fixes
set status = 'skipped', updated_at = now()
where workflow_name = 'AI Guardian Cron'
  and status = 'pending';

-- 3. Verify.
select count(*) as remaining_graph_subscriptions
from integrations
where name like 'graph_subscription_%';

select status, count(*) as n
from code_guardian_fixes
group by status
order by n desc;
