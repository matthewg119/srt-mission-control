// Start a Core or Complete subscription from /get-named.
//
// TWO PATHS, and which one you get is decided by the SERVER from whether a paid
// audit with a saved card exists for that email. The browser does not choose.
//
//   Path A, audit buyers: off-session against the card they paid the $39 with. One
//           click, no re-entry. `requires_action` is a branch, not an exception.
//   Path B, everyone else: default_incomplete + an embedded Payment Element.
//
// ‼️ AN EXPLICIT CLICK IS ALWAYS REQUIRED. A saved card authorizes nothing by itself.
// Nothing in this file may ever be reachable from a page load, a webhook, a cron or a
// redirect: it is only ever called from a button the customer pressed.

import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { supabaseAdmin } from "@/lib/db";
import {
  getStripe,
  isCheckoutEnabled,
  invoiceClientSecret,
  subscriptionPeriodEnd,
} from "@/lib/medspa/stripe";
import { marketKey, findMarketConflict } from "@/lib/medspa/market";
import { clean, validEmail } from "@/lib/medspa/validate";
import { PRICES, tierPrice, dollars, type Tier } from "@/config/medspa-funnel";
import { slack } from "@/lib/slack-bot";
import { enrichLead } from "@/lib/lead-intake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// supabase-js calls the global fetch, which Next patches into the DATA cache. On a
// route that decides whether someone is charged, a stale read is the expensive kind.
export const fetchCache = "force-no-store";
export const maxDuration = 60;

function priceIdFor(tier: Tier): string | null {
  const id = tier === "core" ? process.env.PRICE_ID_CORE_349 : process.env.PRICE_ID_COMPLETE_499;
  return id || null;
}

async function note(message: string): Promise<void> {
  const channel = process.env.SLACK_CEO_CHANNEL;
  if (!channel) return;
  await slack.postMessage(channel, message).catch(() => {});
}

/** A paid audit for this email, with a card we can charge off-session. */
async function findPaidAudit(email: string) {
  const { data } = await supabaseAdmin
    .from("medspa_orders")
    .select("id, contact_id, stripe_customer_id, stripe_payment_method_id, city, zip")
    .eq("email", email)
    .eq("status", "paid")
    .order("paid_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

export async function POST(req: NextRequest) {
  if (!isCheckoutEnabled()) {
    return NextResponse.json({ ok: false, message: "Checkout is not open yet." }, { status: 503 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, message: "Bad request." }, { status: 400 });
  }

  const email = clean(payload.email, 120).toLowerCase();
  if (!validEmail(email)) {
    return NextResponse.json({ ok: false, message: "We need your email." }, { status: 400 });
  }

  const tierRaw = clean(payload.tier, 20);
  if (tierRaw !== "core" && tierRaw !== "complete") {
    return NextResponse.json({ ok: false, message: "Pick a plan." }, { status: 400 });
  }
  const tier: Tier = tierRaw;

  const priceId = priceIdFor(tier);
  if (!priceId) {
    console.error(`[medspa/subscribe] price id for ${tier} is not set.`);
    return NextResponse.json({ ok: false, message: "Not configured." }, { status: 500 });
  }

  const zip = clean(payload.zip, 12);
  const cityRaw = clean(payload.city, 80);

  // Already subscribed? Do not sell them a second one.
  const { data: existing } = await supabaseAdmin
    .from("medspa_subscriptions")
    .select("id, status")
    .eq("email", email)
    .in("status", ["active", "trialing", "past_due", "incomplete"])
    .limit(1)
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      { ok: false, message: "You already have a plan running. Check your inbox for the portal link." },
      { status: 409 }
    );
  }

  const audit = await findPaidAudit(email);
  const stripe = getStripe();

  // ── The $39 credit ──
  // A coupon, applied in the same create call as the subscription. See
  // scripts/medspa-stripe-setup.mjs for why this is not a customer balance credit.
  // If the coupon id is unset we charge full price rather than silently promising a
  // discount we cannot deliver, and we say so loudly in Slack.
  const couponId = process.env.AUDIT_CREDIT_COUPON_ID || null;
  const creditEligible = Boolean(audit);
  const applyCredit = creditEligible && Boolean(couponId);

  if (creditEligible && !couponId) {
    console.error("[medspa/subscribe] AUDIT_CREDIT_COUPON_ID unset; charging full price.");
    await note(
      `:rotating_light: ${email} bought the audit and is subscribing, but AUDIT_CREDIT_COUPON_ID ` +
        `is not set, so their $39 credit did NOT apply. Refund $39 by hand.`
    );
  }

  const discounts = applyCredit ? [{ coupon: couponId as string }] : undefined;
  const market = marketKey(cityRaw) || (audit?.city ? marketKey(audit.city as string) : null);

  try {
    let sub: Stripe.Subscription;
    let path: "saved_card" | "payment_element";

    if (audit?.stripe_customer_id && audit?.stripe_payment_method_id) {
      // ── PATH A: the card they paid the audit with ──
      path = "saved_card";
      sub = await stripe.subscriptions.create(
        {
          customer: audit.stripe_customer_id as string,
          items: [{ price: priceId }],
          default_payment_method: audit.stripe_payment_method_id as string,
          off_session: true,
          // allow_incomplete, NOT error_if_incomplete: this always returns a
          // subscription object, so "needs 3DS" is a branch rather than control flow
          // dug out of a thrown error, and it maps onto the webhooks that finish the
          // job after the customer authenticates.
          payment_behavior: "allow_incomplete",
          // On API 2026-07-29.dahlia `invoice.payment_intent` no longer exists. The
          // client_secret lives on confirmation_secret, and ONLY when expanded.
          expand: ["latest_invoice.confirmation_secret"],
          ...(discounts ? { discounts } : {}),
          metadata: { tier, email, audit_order_id: audit.id as string },
        },
        { idempotencyKey: `medspa-sub-${audit.id}-${tier}` }
      );
    } else {
      // ── PATH B: no saved card ──
      path = "payment_element";
      const customer = await stripe.customers.create({ email, metadata: { tier } });
      sub = await stripe.subscriptions.create({
        customer: customer.id,
        items: [{ price: priceId }],
        payment_behavior: "default_incomplete",
        payment_settings: { save_default_payment_method: "on_subscription" },
        expand: ["latest_invoice.confirmation_secret"],
        ...(discounts ? { discounts } : {}),
        metadata: { tier, email },
      });
    }

    const conflict = await findMarketConflict(market);

    const { data: row, error: rowError } = await supabaseAdmin
      .from("medspa_subscriptions")
      .insert({
        order_id: (audit?.id as string) ?? null,
        contact_id: (audit?.contact_id as string) ?? null,
        email,
        stripe_customer_id:
          typeof sub.customer === "string" ? sub.customer : sub.customer.id,
        stripe_subscription_id: sub.id,
        tier,
        amount_cents: tierPrice(tier),
        status: sub.status,
        market_key: market,
        city: cityRaw || ((audit?.city as string) ?? null),
        zip: zip || ((audit?.zip as string) ?? null),
        credit_applied: applyCredit,
        market_conflict: Boolean(conflict),
        market_conflict_with: conflict?.withSubscriptionId ?? null,
        current_period_end: subscriptionPeriodEnd(sub),
      })
      .select("id")
      .single();

    // ‼️ The Stripe subscription EXISTS by this point. If our row did not land we
    // have a paying customer with no local record, and the webhook cannot sync them
    // because syncSubscription() keys on this row and returns early without it.
    //
    // Do NOT auto-cancel the subscription to "clean up": a transient DB blip would
    // then cancel a legitimate paying customer, which is far worse than a missing
    // row. Fail LOUDLY instead and reconcile by hand. Silence here is what turns a
    // recoverable data gap into an untracked charge nobody notices for a month.
    if (rowError || !row) {
      console.error("[medspa/subscribe] subscription row insert FAILED:", rowError?.message);
      await note(
        `:rotating_light: ${email} has a LIVE Stripe subscription (${sub.id}, ${tier}) but the ` +
          `medspa_subscriptions insert failed: ${rowError?.message ?? "no row returned"}. ` +
          `They are being charged and we have no record. Add the row by hand.`
      );
    }

    // One clinic per market is a FLAG and a Slack note, never a block. A human
    // adjudicates. Losing a real sale to a string mismatch is worse than refunding a
    // duplicate, which takes two minutes.
    if (conflict) {
      await note(
        `:warning: MARKET CONFLICT. ${email} just subscribed (${tier}) for \`${market}\`, ` +
          `which ${conflict.withEmail} already holds. Both are live. Review and refund one if needed.`
      );
    }

    await enrichLead({
      email,
      noteTitle: `Subscribed: ${tier}`,
      headline: `:rocket: SUBSCRIBED ${tier} at ${dollars(tierPrice(tier))} a month`,
      detailLines: [
        `Subscription: ${sub.id}`,
        `Status: ${sub.status}`,
        applyCredit ? `$39 audit credit applied, first month ${dollars(tierPrice(tier) - PRICES.audit)}` : "",
        market ? `Market: ${market}` : "",
        zip ? `ZIP: ${zip}` : "",
        conflict ? `MARKET CONFLICT with ${conflict.withEmail}` : "",
      ].filter(Boolean),
    }).catch(() => false);

    // Needs the card challenge, on either path.
    if (sub.status === "incomplete") {
      const clientSecret = invoiceClientSecret(sub);
      if (clientSecret) {
        return NextResponse.json({
          ok: true,
          requiresAction: path === "saved_card",
          needsPaymentElement: path === "payment_element",
          clientSecret,
          subscriptionId: sub.id,
          subscriptionRowId: row?.id ?? null,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      requiresAction: false,
      needsPaymentElement: false,
      subscriptionId: sub.id,
      status: sub.status,
      subscriptionRowId: row?.id ?? null,
    });
  } catch (e) {
    const message = (e as Stripe.errors.StripeError).message ?? (e as Error).message;
    console.error("[medspa/subscribe] failed:", message);
    await note(`:x: Subscription failed for ${email} (${tier}): ${message}`);
    return NextResponse.json({ ok: false, message: "That card was declined." }, { status: 402 });
  }
}
