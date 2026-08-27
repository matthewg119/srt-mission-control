-- The Apollo cold-list scraper lane (#srt-sub, renaming to #srt-scraper).
-- src/lib/scraper/*, src/app/api/cron/scraper-tick.
--
-- Two tables. `scraper_batches` is one dropped file; `scraper_rows` is one line of it.
--
-- The rows exist so the MX sweep can be RESUMABLE: a 20k-row pull with 8k unique domains does not
-- finish its DNS sweep inside a 300s function, and a one-pass design fails by silently truncating.
-- Rows land with mx_ok = null, the cron fills them in, and a batch only produces a CSV once
-- nothing is pending.

create table if not exists scraper_batches (
  id                   uuid primary key default gen_random_uuid(),
  slack_channel_id     text not null,
  slack_thread_ts      text,
  slack_file_id        text,
  file_name            text,

  -- parsing -> mx -> filtered -> verifying -> done, or error.
  status               text not null default 'parsing',

  -- Which column the address was read from, and the file's header row VERBATIM and in order.
  -- The headers are stored rather than rebuilt from the rows because rebuilding would reorder the
  -- columns and drop any column empty on every surviving row, so the re-upload would be a
  -- different file than the one that was pulled.
  email_column         text,
  headers              jsonb,

  total_rows           integer not null default 0,
  clean_count          integer not null default 0,
  junk_count           integer not null default 0,

  mv_file_id           text,
  mv_status            text,
  mv_counts            jsonb,
  -- Over SCRAPER_MV_MAX_EMAILS the lane posts a card and waits for a reaction on it rather than
  -- spending credits. mv_approval_ts is that card's message ts.
  mv_awaiting_approval boolean not null default false,
  mv_approval_ts       text,

  -- Stamped once clean.csv and junk.csv are in the thread, so re-entering `filtered` after an
  -- approval wait cannot post the same two files a second time.
  csv_posted_at        timestamptz,

  error                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint scraper_batches_status_check
    check (status in ('parsing', 'mx', 'filtered', 'verifying', 'done', 'error'))
);

-- The cron's only query. Partial, because a finished batch is never looked at again by it.
create index if not exists scraper_batches_active_idx
  on scraper_batches (created_at)
  where status in ('parsing', 'mx', 'filtered', 'verifying');

create index if not exists scraper_batches_channel_idx
  on scraper_batches (slack_channel_id, created_at desc);

-- The reaction handler resolves a batch from the message that was reacted to.
create index if not exists scraper_batches_approval_idx
  on scraper_batches (slack_channel_id, mv_approval_ts)
  where mv_approval_ts is not null;

create table if not exists scraper_rows (
  id          uuid primary key default gen_random_uuid(),
  batch_id    uuid not null references scraper_batches(id) on delete cascade,

  -- 0-based index into the parsed CSV, so a row can be found again in the original file.
  row_index   integer not null,

  email       text,
  domain      text,
  raw         jsonb not null default '{}'::jsonb,

  -- null verdict = survived the string checks and is still waiting on MX. Neither clean nor junk:
  -- nobody has asked yet. Writing it either way is the failure the tri-state exists to prevent.
  verdict     text,
  reason      text,
  mx_ok       boolean,

  mv_result   text,
  mv_quality  text,

  created_at  timestamptz not null default now(),

  constraint scraper_rows_verdict_check check (verdict is null or verdict in ('clean', 'junk')),
  constraint scraper_rows_reason_check check (
    reason is null or reason in (
      'no_email', 'duplicate_in_file', 'already_in_crm',
      'bad_syntax', 'role_account', 'disposable_domain', 'no_mx'
    )
  ),

  -- Load-bearing: insertRows upserts with ignoreDuplicates against this, so a retried parse
  -- cannot double-insert a file.
  unique (batch_id, row_index)
);

create index if not exists scraper_rows_batch_verdict_idx on scraper_rows (batch_id, verdict);

-- The MX sweep's worklist. Partial so it stays small as a batch drains.
create index if not exists scraper_rows_pending_idx
  on scraper_rows (batch_id, domain)
  where verdict is null and mx_ok is null;

-- MillionVerifier results are joined back on by address.
create index if not exists scraper_rows_batch_email_idx on scraper_rows (batch_id, email);

-- Service role only. Nothing client-side reads either table.
alter table scraper_batches enable row level security;
alter table scraper_rows    enable row level security;
