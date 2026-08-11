-- /webflow-Aivisibility, v4 offer.
-- Run AFTER 2026-08-06-medspa-funnel.sql and 2026-08-07-medspa-stripe.sql.
-- Safe to run more than once.
--
-- WHAT CHANGED. The subscription is no longer an immediate one-time upsell after the
-- $39 audit. There is now a free training between them and the subscription is sold
-- from a normal, non-tokenized order page (/get-named). So:
--   * the $299 Founding tier and its five-seat cap are gone,
--   * the single-use OTO token system is gone,
--   * the tiers are now Core ($349) and Complete ($499),
--   * the $39 audit becomes a credit against the first month.
--
-- There are ZERO rows in medspa_orders and medspa_subscriptions in production, so
-- none of the drops below strand data. Confirmed before writing this.

-- ── Subscriptions: founding/standard becomes core/complete ──────────────────

-- Drop the constraint BEFORE renaming, or the rename carries a check that names a
-- column that no longer exists under that name.
alter table public.medspa_subscriptions
  drop constraint if exists medspa_subscriptions_plan_check;

-- `plan` -> `tier`, matching the spec's vocabulary. Guarded so a re-run is a no-op.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'medspa_subscriptions'
       and column_name = 'plan'
  ) and not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'medspa_subscriptions'
       and column_name = 'tier'
  ) then
    alter table public.medspa_subscriptions rename column plan to tier;
  end if;
end $$;

alter table public.medspa_subscriptions
  add column if not exists tier text,
  -- True when the $39 audit coupon was attached at creation. Recorded so a support
  -- question ("did my credit apply?") is answered from our own row rather than by
  -- reading Stripe.
  add column if not exists credit_applied boolean not null default false,
  add column if not exists zip text;

alter table public.medspa_subscriptions
  drop constraint if exists medspa_subscriptions_tier_check;
alter table public.medspa_subscriptions
  add constraint medspa_subscriptions_tier_check
  check (tier in ('core', 'complete'));

-- The founding cap is gone, so the seat pointer goes with it.
alter table public.medspa_subscriptions
  drop column if exists founding_slot_no;

-- ── Orders and opt-ins: ZIP capture + the credit reminder ledger ────────────

-- ZIP is collected on /get-named. It gates NOTHING: one-clinic-per-market is a flag
-- and a Slack note that a human adjudicates, never a block on checkout. Storing the
-- ZIP just makes that manual filtering possible on something better than city text.
alter table public.medspa_orders
  add column if not exists zip text;

alter table public.medspa_optins
  add column if not exists zip text,
  -- Fire-once ledger for the 18-day "$39 unused in your cart" email. A timestamp
  -- rather than a boolean so we can tell WHEN, and the send claims the row with a
  -- conditional UPDATE on `is null` before Graph is called.
  add column if not exists credit_reminder_sent_at timestamptz;

-- Partial index: the cron only ever scans for rows that have NOT been sent, and this
-- keeps that scan off the rows it will never touch again.
create index if not exists medspa_optins_credit_reminder_pending_idx
  on public.medspa_optins (created_at)
  where credit_reminder_sent_at is null;

-- ── Drop the OTO + founding machinery ───────────────────────────────────────
-- Order matters: the functions reference the slots table.

drop function if exists public.claim_founding_slot(uuid);
drop function if exists public.release_stale_founding_slots(integer);

drop table if exists public.medspa_oto_tokens;
drop table if exists public.medspa_founding_slots;
