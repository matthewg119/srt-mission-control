-- Section A.3 of plan im-also-getting-emails-prancy-pony.md
-- Hard "do not contact" flag on contacts. Read by zoho-guardian.fetchActiveZohoLeads
-- as a last-resort gate regardless of Zoho Lead_Status. Prevents repeats of the
-- Codi Cross case where a dead-declined lead kept receiving auto-follow-ups
-- because of picklist label drift.

alter table contacts
  add column if not exists do_not_contact boolean not null default false,
  add column if not exists do_not_contact_reason text,
  add column if not exists do_not_contact_at timestamptz;

create index if not exists contacts_do_not_contact_idx
  on contacts(do_not_contact) where do_not_contact = true;
