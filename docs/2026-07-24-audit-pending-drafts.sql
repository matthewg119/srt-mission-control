-- Audit email assistant: store the last set of 3 choose-from email options per report, so a
-- Slack "1 / 2 / 3" thread reply can turn the chosen option into an Outlook draft. ADD ONLY.
-- Shape: [{ "label": text, "subject": text, "body": text }] (see EmailOption in
-- src/lib/audit-engine/email-assistant.ts). Overwritten each time new options are posted.

ALTER TABLE audit_reports ADD COLUMN IF NOT EXISTS pending_drafts jsonb;
