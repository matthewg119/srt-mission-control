-- Every audit-thread card that posts ONE finished email now drafts it straight into Matthew's
-- Outlook drafts instead of waiting for a `1` reply. These two columns are what makes a redraft
-- REPLACE the previous draft rather than pile another near-identical one into the folder, and
-- what lets the CRM lead timeline link into Outlook without a second Graph call.
--
-- outlook_draft_id is a Graph message id and it SURVIVES being sent, so it must only ever be
-- passed to microsoft.deleteDraft(), which re-checks isDraft before deleting anything.

alter table audit_reports
  add column if not exists outlook_draft_id  text,
  add column if not exists outlook_draft_url text;

comment on column audit_reports.outlook_draft_id is
  'Graph message id of the Outlook draft auto-created for the newest single-email card in this thread. A redraft deletes this one first, but only via microsoft.deleteDraft(), which refuses to touch a message Graph no longer reports as isDraft.';

comment on column audit_reports.outlook_draft_url is
  'webLink for that draft, so the CRM lead timeline can link straight into Outlook.';
