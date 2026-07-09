-- Silent Zoho upload for the pest-control prospecting pipeline.
-- Tracks which prospect_leads rows have been pushed to Zoho CRM so nothing
-- double-uploads and we can retry failures. See src/lib/prospect-zoho-sync.ts.
--
-- Safe to run more than once.

alter table prospect_leads add column if not exists zoho_lead_id   text;
alter table prospect_leads add column if not exists zoho_synced_at timestamptz;
alter table prospect_leads add column if not exists zoho_sync_error text;

-- Fast lookup of rows still needing a Zoho push (backfill + safety-net sweeps).
create index if not exists prospect_leads_unsynced_idx
  on prospect_leads (zoho_synced_at) where zoho_synced_at is null;
