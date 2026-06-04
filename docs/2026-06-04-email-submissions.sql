-- Email-driven deal shopping: verbatim forward to funders.
--
-- One "New Deal — {Business}" email Matthew sends to submissions@ becomes one
-- email_submissions row + a parent message in #srt-sub. Each funder it gets
-- forwarded to becomes an email_submission_funders row. Intentionally standalone
-- (no FK to deals/contacts) — the deal starts by email and may have no Zoho/CRM
-- record yet, and we don't want to create pipeline shells or burn Zoho writes.
--
-- Run in Supabase prod (SQL editor) before deploying the feature.

create table if not exists public.email_submissions (
  id uuid primary key default gen_random_uuid(),
  business_name text not null,
  original_message_id text not null,   -- Graph message id in the submissions@ mailbox
  conversation_id text,                -- Graph conversationId, for funder-reply matching
  mailbox text not null default 'submissions@srtagency.com',
  subject text,
  html_body text,                      -- verbatim HTML body to forward
  from_address text,                   -- the address Matthew sent from
  slack_channel text,
  slack_thread_ts text,                -- parent message ts in #srt-sub
  status text not null default 'awaiting_funders', -- awaiting_funders | forwarded | closed
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists email_submissions_msg_uniq on public.email_submissions (original_message_id);
create index if not exists email_submissions_conv_idx on public.email_submissions (conversation_id);
create index if not exists email_submissions_thread_idx on public.email_submissions (slack_thread_ts);
create index if not exists email_submissions_business_idx on public.email_submissions (lower(business_name));

create table if not exists public.email_submission_funders (
  id uuid primary key default gen_random_uuid(),
  email_submission_id uuid not null references public.email_submissions(id) on delete cascade,
  lender_id uuid references public.lenders(id),
  funder_name text,
  funder_email text not null,
  funder_domain text,                  -- lower(host of funder_email), for reply matching
  status text not null default 'sent', -- sent | failed | approved | declined | stips | counter
  sent_at timestamptz,
  last_reply_at timestamptz,
  reply_message_id text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists esf_submission_idx on public.email_submission_funders (email_submission_id);
create index if not exists esf_domain_idx on public.email_submission_funders (funder_domain);
