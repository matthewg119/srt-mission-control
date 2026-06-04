-- Bank-statement drops in #srt-sub → Submissions draft + Vektor thread controls.
--
-- One PDF drop (statements + optional application) in #srt-sub becomes one
-- statement_drops row, keyed by the Slack thread it posted into. The row holds
-- enough context to (a) rebuild the Outlook draft with a different month count,
-- (b) resolve a name mismatch via a thread "override", and (c) let Vektor answer
-- questions about the analysis in-thread. Intentionally standalone (no FK to
-- deals/contacts) — the deal may have no CRM record yet.
--
-- Statement PDFs are re-downloaded from Slack url_private_download on rebuild, so
-- only the file references (not the bytes) are stored here.
--
-- Run in Supabase prod (SQL editor) before deploying the feature.

create table if not exists public.statement_drops (
  id uuid primary key default gen_random_uuid(),
  slack_channel text,
  slack_thread_ts text not null,        -- thread the drop posted into
  business_name text,                   -- resolved/canonical name used for OneDrive + Zoho
  account_holder text,                  -- name exactly as it appears on the statements (subject)
  subject text,
  status text not null default 'built', -- built | awaiting_name_confirm | dnq
  metrics_json jsonb,                   -- extracted BankMetrics + report summary
  statements_json jsonb,                -- [{ name, slack_url, month }]
  app_json jsonb,                       -- { name, slack_url } | null
  months_limit int,                     -- null = attach all; N = most-recent N
  zoho_lead_id text,
  zoho_deal_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists statement_drops_thread_uniq on public.statement_drops (slack_thread_ts);
create index if not exists statement_drops_business_idx on public.statement_drops (lower(business_name));
