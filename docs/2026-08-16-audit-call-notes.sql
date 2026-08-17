-- Call notes pasted into an audit thread, and when they last changed.
-- Add-only. Nothing reads these columns until the notes branch ships.

alter table audit_reports add column if not exists call_notes text;
alter table audit_reports add column if not exists call_notes_at timestamptz;

comment on column audit_reports.call_notes is
  'Verbatim call notes pasted into the #ai-visibility-audits thread. Outranks the generic avatar pick when drafting the post-call email, same precedent as intake_answers.';
