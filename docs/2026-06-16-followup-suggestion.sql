-- 2026-06-16 — Proactive follow-up suggestions on SMS reply drafts.
--
-- When a lead signals a future decision timeline or a soft objection ("looking to
-- decide in 2 weeks", "thinking about it"), the SMS AI engine now proposes a reply
-- that offers to start prep now AND attaches a suggested follow-up (days + reason).
-- These two columns let us persist that suggestion on the live draft so the Slack
-- card can offer a one-click "📅 Follow-up in Nd" button, and so the send path can
-- auto-schedule the follow-up when the reply actually goes out.
--
-- Idempotent — safe to re-run.

alter table sms_pending_drafts add column if not exists suggested_followup_days int;
alter table sms_pending_drafts add column if not exists suggested_followup_reason text;
