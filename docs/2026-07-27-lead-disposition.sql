-- Lead disposition + Facebook lead id, for the #hot-leads DNQ / Booked Call /
-- Converted buttons and the Conversions API for Leads events they fire.
-- See: src/lib/lead-thread.ts, src/app/api/slack/actions/route.ts, src/lib/meta-capi.ts
--
-- WHY A SEPARATE `disposition` COLUMN, NOT `application_stage`:
-- application_stage is mapped to Zoho Lead_Status in src/lib/field-map.ts and is
-- picked up by zoho-backfill.ts, so writing it pushes status into Zoho. Every
-- Zoho Lead_Status write round-trips back through /api/webhooks/zoho-lead and
-- also trips a Deluge rule (docs/zoho-deluge/sequence-enroll.dg). This flow is
-- deliberately Slack-only and must stay out of that loop.
--
-- WHY fb_lead_id: Lead ads never touch the site, so there is no _fbc/fbclid to
-- attribute on. Meta's Conversions API for Leads matches on the lead's own
-- leadgen_id instead, which until now was written only into
-- system_logs.metadata and never onto the contact.
-- Safe to re-run.

alter table contacts add column if not exists fb_lead_id     text;
alter table contacts add column if not exists disposition    text;        -- dnq | booked_call | converted
alter table contacts add column if not exists disposition_at timestamptz;
alter table contacts add column if not exists disposition_by text;        -- Slack user id of whoever clicked

-- Lookup path for CAPI reporting and for tying a contact back to its Meta lead.
create index if not exists contacts_fb_lead_id_idx
  on contacts (fb_lead_id)
  where fb_lead_id is not null;

-- Reporting: "show me every lead dispositioned this month".
create index if not exists contacts_disposition_idx
  on contacts (disposition, disposition_at desc)
  where disposition is not null;
