-- Loom wizard state: which step of the avatar -> image picker a thread is on.
--
-- Add-only and nullable. A null value means no menu is pending, which is what every existing row
-- means, and it is what keeps a bare "1" meaning "make the Outlook draft" on threads that were
-- created before the wizard existed. The router checks this column BEFORE the /^([123])$/ email
-- picker, and clears it once the image is chosen.

alter table audit_reports
  add column if not exists loom_state jsonb;

comment on column audit_reports.loom_state is
  'Pending loom-wizard menu: {stage:"avatar"|"image", avatarIndex, ideas[], price, window}. Null = no menu pending, so a bare digit means the Outlook draft. Cleared once the image is picked.';
