-- Email 1 now lands in the shared submissions mailbox as well as in Matthew's own, and so does
-- the no-website pitch. One draft id per report could not hold two drafts, so the pair added
-- yesterday (2026-08-19-outlook-draft-auto.sql) becomes a list.
--
-- Shape: [{ "mailbox": null | "submissions@srtagency.com", "id": "...", "url": "..." }]
-- `mailbox: null` is the connected account (/me) and is always the first entry: it is the draft
-- Matthew is going to send, and the CRM lead timeline links to that one.
--
-- The ids are Graph message ids and they SURVIVE being sent, so they must only ever be passed to
-- microsoft.deleteDraft(), which re-checks isDraft before deleting anything.

alter table audit_reports
  add column if not exists outlook_drafts jsonb;

comment on column audit_reports.outlook_drafts is
  'Outlook drafts auto-created for the newest single-email card in this thread: [{mailbox,id,url}], connected account (mailbox null) first. A redraft deletes each of these before creating the replacements, but only via microsoft.deleteDraft(), which refuses to touch a message Graph no longer reports as isDraft.';

-- The superseded pair. One day old, and all they ever held were draft ids that have since been
-- replaced, so there is nothing here worth migrating forward.
alter table audit_reports
  drop column if exists outlook_draft_id,
  drop column if exists outlook_draft_url;
