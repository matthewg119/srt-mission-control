-- SRT Trading Bot Schema
-- Run this in the Supabase SQL editor

create table if not exists trade_signals (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  signal_type text not null,
  entry_trigger text,
  underlying_price numeric,
  strike numeric,
  expiration date,
  delta numeric,
  iv_rank numeric,
  timeframe text default '5m',
  status text default 'pending',
  confidence_score int,
  signal_time timestamptz default now(),
  notes text
);

create table if not exists bot_trades (
  id uuid primary key default gen_random_uuid(),
  signal_id uuid references trade_signals(id),
  schwab_order_id text,
  symbol text,
  option_symbol text,
  trade_type text,
  contracts int,
  entry_price numeric,
  exit_price numeric,
  premium_paid numeric,
  premium_received numeric,
  pnl numeric,
  pnl_percent numeric,
  status text default 'open',
  stop_loss_price numeric,
  take_profit_price numeric,
  opened_at timestamptz default now(),
  closed_at timestamptz,
  is_paper bool default true
);

create table if not exists bot_config (
  key text primary key,
  value text,
  updated_at timestamptz default now()
);

insert into bot_config (key, value) values
  ('bot_active', 'true'),
  ('paper_mode', 'true'),
  ('max_contracts', '1'),
  ('max_daily_trades', '5'),
  ('max_daily_loss_dollars', '500'),
  ('target_delta', '0.30'),
  ('dte_min', '7'),
  ('dte_max', '21'),
  ('spy_enabled', 'true'),
  ('qqq_enabled', 'true'),
  ('stop_loss_percent', '50'),
  ('take_profit_percent', '100')
on conflict (key) do nothing;

create table if not exists daily_stats (
  id uuid primary key default gen_random_uuid(),
  date date unique,
  total_trades int default 0,
  winning_trades int default 0,
  total_pnl numeric default 0,
  win_rate numeric,
  avg_winner numeric,
  avg_loser numeric
);
