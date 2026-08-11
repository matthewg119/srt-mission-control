-- Stripe layer for /webflow-Aivisibility.
-- Run AFTER docs/2026-08-06-medspa-funnel.sql.
-- Safe to run more than once (IF NOT EXISTS everywhere).

create extension if not exists pgcrypto;

-- ── Webhook idempotency ledger ──────────────────────────────────────────────
-- Deliberately NOT prefixed medspa_: Stripe delivers ONE event stream per account
-- and any later surface shares this table. The claim is insert-with-on-conflict-do
-- -nothing; an empty RETURNING means "already processed, 200 and stop".
create table if not exists public.stripe_events (
  id          text primary key,           -- Stripe's evt_...
  type        text        not null,
  received_at timestamptz not null default now()
);
alter table public.stripe_events enable row level security;

-- ── Orders: one row per $39 purchase attempt ────────────────────────────────
create table if not exists public.medspa_orders (
  id                       uuid primary key default gen_random_uuid(),
  optin_id                 uuid references public.medspa_optins(id) on delete set null,
  contact_id               uuid,
  email                    text        not null,
  name                     text,
  clinic_website           text        not null,
  clinic_domain            text        not null,

  -- Normalized "city|st" from src/lib/medspa/market.ts. A STRING key, not geo.
  market_key               text,
  city                     text,
  state                    text,

  stripe_customer_id       text,
  stripe_payment_intent_id text        not null,
  -- Read off the succeeded PaymentIntent, which carried
  -- setup_future_usage:'off_session'. This is the card the founding subscription is
  -- charged against later, with no re-entry.
  stripe_payment_method_id text,
  -- A single flat line item. There is no order bump and no add-on, so nothing here
  -- records one. An earlier revision carried bump_scripts; it was dropped 2026-08-10
  -- (see the ALTER at the bottom of this file, kept for anyone who ran the original).
  amount_cents             integer     not null,
  currency                 text        not null default 'usd',

  -- PROVISIONING claim flag. 'created' -> 'paid' is a conditional update and the
  -- winner does the one-time work (lead ingest, Slack, receipt, audit kick-off).
  -- The webhook and the client confirm endpoint both race for it; exactly one wins.
  status                   text        not null default 'created',
  paid_at                  timestamptz,

  -- FULFILMENT claim flag. Separate from status ON PURPOSE. Marking an order paid is
  -- cheap and safe to repeat; kicking off a 20-prompt audit is neither. One flag
  -- guarding both would let a webhook retry run, and bill, a second audit.
  fulfillment_state        text        not null default 'pending',
  fulfilled_at             timestamptz,
  audit_report_id          uuid references public.audit_reports(id) on delete set null,

  -- Random secret handed to the browser alongside the client_secret. /confirm
  -- requires it, so nobody can enumerate pi_ ids and mint OTO tokens for other
  -- people's orders.
  confirm_secret           text        not null,

  fbclid                   text,
  fbc                      text,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create unique index if not exists medspa_orders_pi_key
  on public.medspa_orders (stripe_payment_intent_id);
create index if not exists medspa_orders_email_idx  on public.medspa_orders (email);
create index if not exists medspa_orders_market_idx on public.medspa_orders (market_key);
create index if not exists medspa_orders_optin_idx  on public.medspa_orders (optin_id);

alter table public.medspa_orders drop constraint if exists medspa_orders_status_check;
alter table public.medspa_orders add constraint medspa_orders_status_check
  check (status in ('created', 'paid', 'failed', 'refunded'));

alter table public.medspa_orders drop constraint if exists medspa_orders_fulfillment_check;
alter table public.medspa_orders add constraint medspa_orders_fulfillment_check
  check (fulfillment_state in ('pending', 'running', 'done', 'failed'));

alter table public.medspa_orders enable row level security;

-- ── OTO tokens: single use, expiring ────────────────────────────────────────
-- Only the SHA-256 of the token is stored. Same reasoning as scan_sessions.ip_hash:
-- a table dump must not be a list of live one-click-$299-subscribe links.
--
-- The token itself is a DETERMINISTIC HMAC over (order id, order created_at), so the
-- webhook and the confirm endpoint independently derive the SAME string and the
-- on-conflict insert below makes a double issue a no-op. A random token would make
-- whichever path lost the race either mint a second live token or have to read back
-- a plaintext that was never stored.
create table if not exists public.medspa_oto_tokens (
  token_hash               text primary key,
  order_id                 uuid        not null references public.medspa_orders(id) on delete cascade,
  email                    text        not null,
  expires_at               timestamptz not null,
  -- The single-use claim: update ... set used_at = now()
  --                       where token_hash = $1 and used_at is null returning order_id
  used_at                  timestamptz,
  used_for_subscription_id uuid,
  created_at               timestamptz not null default now()
);
create index if not exists medspa_oto_tokens_order_idx   on public.medspa_oto_tokens (order_id);
create index if not exists medspa_oto_tokens_expires_idx on public.medspa_oto_tokens (expires_at);
alter table public.medspa_oto_tokens enable row level security;

-- ── Subscriptions ───────────────────────────────────────────────────────────
create table if not exists public.medspa_subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  order_id               uuid references public.medspa_orders(id) on delete set null,
  contact_id             uuid,
  email                  text    not null,
  stripe_customer_id     text    not null,
  stripe_subscription_id text    not null,
  plan                   text    not null,        -- founding | standard
  founding_slot_no       integer,
  amount_cents           integer not null,
  status                 text    not null,        -- Stripe's status, mirrored verbatim
  market_key             text,
  city                   text,
  state                  text,

  -- One clinic per market. A FLAG and a Slack note, never a block: refunding a
  -- duplicate takes two minutes, while losing a real sale because "Winston Salem"
  -- did not match "Winston-Salem" is unrecoverable and invisible.
  market_conflict        boolean not null default false,
  market_conflict_with   uuid,

  -- NOTE: on API 2026-07-29.dahlia this comes off subscription.items.data[0], NOT
  -- off the subscription itself. It moved.
  current_period_end     timestamptz,
  canceled_at            timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create unique index if not exists medspa_subscriptions_stripe_key
  on public.medspa_subscriptions (stripe_subscription_id);
-- Partial: only a LIVE subscription occupies a market.
create index if not exists medspa_subscriptions_market_active_idx
  on public.medspa_subscriptions (market_key)
  where status in ('active', 'trialing', 'past_due');

alter table public.medspa_subscriptions drop constraint if exists medspa_subscriptions_plan_check;
alter table public.medspa_subscriptions add constraint medspa_subscriptions_plan_check
  check (plan in ('founding', 'standard'));

alter table public.medspa_subscriptions enable row level security;

-- ── The founding cap, enforced by the DATABASE ──────────────────────────────
-- Five pre-seeded rows. The cap is DATA, not code: raising it to 7 is an INSERT
-- rather than a deploy, and "how many are left" is a plain count(*) instead of a
-- number derived from a subscription query that can drift.
--
-- Why not `select count(*) ... then insert`: that is a read-then-write race that
-- sells a sixth lifetime-locked seat under concurrency, which is the same class of
-- bug the scan_sessions partial unique index was added to fix.
create table if not exists public.medspa_founding_slots (
  slot_no         integer primary key check (slot_no between 1 and 50),
  claimed_by      uuid references public.medspa_orders(id) on delete set null,
  subscription_id uuid,
  claimed_at      timestamptz,
  -- Stamped when a founding subscription is cancelled, but claimed_by is LEFT SET.
  -- A seat that silently reopens makes "only 5, ever" false, and someone who cancels
  -- in month two has already consumed the scarcity. Reopening a seat is a deliberate
  -- manual UPDATE, never something a webhook does.
  released_at     timestamptz
);

insert into public.medspa_founding_slots (slot_no)
  select generate_series(1, 5)
  on conflict (slot_no) do nothing;

alter table public.medspa_founding_slots enable row level security;

-- Race-proof claim. FOR UPDATE SKIP LOCKED means two concurrent claimers take
-- DIFFERENT rows instead of blocking or both reading the same "next free" slot.
-- Idempotent per order: a retry gets back the slot it already holds rather than
-- consuming a second one. Returns null when sold out, and the caller then routes
-- that buyer to the $499 Standard plan.
create or replace function public.claim_founding_slot(p_order_id uuid)
returns integer
language plpgsql
as $$
declare
  v_slot integer;
begin
  select slot_no into v_slot
    from public.medspa_founding_slots
   where claimed_by = p_order_id
   limit 1;
  if v_slot is not null then
    return v_slot;
  end if;

  update public.medspa_founding_slots s
     set claimed_by = p_order_id,
         claimed_at = now()
   where s.slot_no = (
         select slot_no
           from public.medspa_founding_slots
          where claimed_by is null
          order by slot_no
          limit 1
            for update skip locked
       )
  returning s.slot_no into v_slot;

  return v_slot;
end;
$$;

-- Backstop for an abandoned 3DS challenge: the slot was claimed, the customer never
-- authenticated, the subscription is still 'incomplete'. Called from the existing
-- daily audit-watchdog cron rather than its own schedule, because Vercel Hobby crons
-- are daily only. Same "the ROW is the source of truth, the timer is only the fast
-- path" pattern as flushDueAutoSends().
create or replace function public.release_stale_founding_slots(p_minutes integer default 60)
returns integer
language sql
as $$
  with stale as (
    update public.medspa_founding_slots s
       set claimed_by = null, claimed_at = null
     where s.claimed_by is not null
       and s.claimed_at < now() - make_interval(mins => p_minutes)
       and not exists (
             select 1 from public.medspa_subscriptions sub
              where sub.founding_slot_no = s.slot_no
                and sub.status in ('active', 'trialing', 'past_due')
           )
    returning 1
  )
  select coalesce(count(*), 0)::integer from stale;
$$;

-- ── Order bump removed 2026-08-10 ───────────────────────────────────────────
-- The popup now sells a single flat $39 line item, so bump_scripts has no meaning.
-- Idempotent, and a no-op on any environment created from the CREATE TABLE above.
-- Safe unconditionally: it was only ever written by checkout/intent, which no longer
-- references it.
alter table public.medspa_orders
  drop column if exists bump_scripts;
