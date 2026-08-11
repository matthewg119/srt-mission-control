// The Stripe server client.
//
// SERVER ONLY. Never import this, or anything that imports it, from a "use client"
// file or from src/config/medspa-funnel.ts. The server SDK is large and dragging it
// into the browser bundle is the same mistake the SCAN_STEPS / session.ts split was
// made to undo (129 kB down to 3.66 kB there; this would be worse).

import Stripe from "stripe";

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (_stripe) return _stripe;

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not set.");
  }

  _stripe = new Stripe(key, {
    // Pinned deliberately. Left unset, the account's dashboard default applies, and
    // a dashboard change would silently reshape objects this code reads. This value
    // matches the SDK's own bundled version, which is what the TypeScript types
    // describe, so the types and the wire format cannot disagree.
    apiVersion: "2026-07-29.dahlia",
    appInfo: { name: "SRT Mission Control (med spa funnel)" },
  });
  return _stripe;
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/** Live checkout is off until this is explicitly armed. */
export function isCheckoutEnabled(): boolean {
  return process.env.MEDSPA_CHECKOUT_ENABLED === "1" && isStripeConfigured();
}

/**
 * The first subscription item's period end.
 *
 * On API 2026-07-29.dahlia `current_period_end` is NOT on the subscription any more,
 * it moved onto each subscription ITEM. Reading `sub.current_period_end` compiles
 * against `any` and is undefined at runtime, which is exactly the sort of silent
 * null this function exists to prevent.
 */
export function subscriptionPeriodEnd(sub: Stripe.Subscription): string | null {
  const item = sub.items?.data?.[0];
  if (!item?.current_period_end) return null;
  return new Date(item.current_period_end * 1000).toISOString();
}

/**
 * The client_secret needed to finish paying a subscription's first invoice.
 *
 * Also an API-version trap: `invoice.payment_intent` was REMOVED. The replacement is
 * `invoice.confirmation_secret`, and it only materializes when the caller expands
 * `latest_invoice.confirmation_secret`.
 */
export function invoiceClientSecret(sub: Stripe.Subscription): string | null {
  const invoice = sub.latest_invoice;
  if (!invoice || typeof invoice === "string") return null;
  return invoice.confirmation_secret?.client_secret ?? null;
}

/** Stripe statuses that mean the seat is genuinely live and occupies a market. */
export const LIVE_SUBSCRIPTION_STATUSES = ["active", "trialing", "past_due"] as const;

export function isLiveStatus(status: string): boolean {
  return (LIVE_SUBSCRIPTION_STATUSES as readonly string[]).includes(status);
}
