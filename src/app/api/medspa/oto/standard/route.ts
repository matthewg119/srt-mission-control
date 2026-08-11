// The $499 Standard subscription.
//
// This is where everyone lands whose token is missing, used or expired, and everyone
// who arrives after the five founding seats are gone. It is an ordinary ON-SESSION
// Payment Element flow, because in this path we cannot assume a saved card exists.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import {
  getStripe,
  isCheckoutEnabled,
  invoiceClientSecret,
  subscriptionPeriodEnd,
} from "@/lib/medspa/stripe";
import { verifyOtoToken } from "@/lib/medspa/oto";
import { marketKey, findMarketConflict } from "@/lib/medspa/market";
import { clean, validEmail } from "@/lib/medspa/validate";
import { PRICES } from "@/config/medspa-funnel";
import { slack } from "@/lib/slack-bot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!isCheckoutEnabled()) {
    return NextResponse.json({ ok: false, message: "Checkout is not open." }, { status: 503 });
  }

  const priceId = process.env.STRIPE_PRICE_STANDARD;
  if (!priceId) {
    console.error("[medspa/oto/standard] STRIPE_PRICE_STANDARD is not set.");
    return NextResponse.json({ ok: false, message: "Not configured." }, { status: 500 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const cityRaw = clean(payload.city, 80);
  const token = clean(payload.token, 512);

  // The token may be expired or spent and that is fine here, we only use it to find
  // the order (and therefore the existing Customer). Signature is still required, so
  // a stranger cannot name someone else's order.
  const verdict = verifyOtoToken(token);
  const orderId =
    verdict.ok ? verdict.orderId : null;

  let order: Record<string, unknown> | null = null;
  if (orderId) {
    const { data } = await supabaseAdmin
      .from("medspa_orders")
      .select("id, email, contact_id, stripe_customer_id, city, market_key")
      .eq("id", orderId)
      .maybeSingle();
    order = data;
  }

  const email = (order?.email as string) || clean(payload.email, 120).toLowerCase();
  if (!validEmail(email)) {
    return NextResponse.json({ ok: false, message: "We need your email." }, { status: 400 });
  }

  const stripe = getStripe();

  try {
    const customerId =
      (order?.stripe_customer_id as string | null) ||
      (await stripe.customers.create({ email, metadata: { plan: "standard" } })).id;

    const sub = await stripe.subscriptions.create(
      {
        customer: customerId,
        items: [{ price: priceId }],
        // default_incomplete + the expand below is the standard "collect payment in
        // the browser" shape: Stripe creates the invoice, we hand its client_secret
        // to a Payment Element, and the subscription activates on confirmation.
        payment_behavior: "default_incomplete",
        payment_settings: { save_default_payment_method: "on_subscription" },
        expand: ["latest_invoice.confirmation_secret"],
        metadata: { plan: "standard", order_id: (order?.id as string) ?? "" },
      },
      orderId ? { idempotencyKey: `medspa-sub-standard-${orderId}` } : undefined
    );

    const market = marketKey(cityRaw) ?? ((order?.market_key as string | null) ?? null);
    const conflict = await findMarketConflict(market);

    await supabaseAdmin.from("medspa_subscriptions").insert({
      order_id: (order?.id as string) ?? null,
      contact_id: (order?.contact_id as string) ?? null,
      email,
      stripe_customer_id: customerId,
      stripe_subscription_id: sub.id,
      plan: "standard",
      amount_cents: PRICES.standard,
      status: sub.status,
      market_key: market,
      city: cityRaw || ((order?.city as string) ?? null),
      market_conflict: Boolean(conflict),
      market_conflict_with: conflict?.withSubscriptionId ?? null,
    });

    if (conflict) {
      const channel = process.env.SLACK_CEO_CHANNEL;
      if (channel) {
        await slack
          .postMessage(
            channel,
            `:warning: MARKET CONFLICT. ${email} is subscribing for \`${market}\`, which ` +
              `${conflict.withEmail} already holds. Review and refund one if needed.`
          )
          .catch(() => {});
      }
    }

    const clientSecret = invoiceClientSecret(sub);
    if (!clientSecret) {
      return NextResponse.json({ ok: false, message: "Could not start checkout." }, { status: 502 });
    }

    return NextResponse.json({
      ok: true,
      clientSecret,
      subscriptionId: sub.id,
      currentPeriodEnd: subscriptionPeriodEnd(sub),
    });
  } catch (e) {
    console.error("[medspa/oto/standard] failed:", (e as Error).message);
    return NextResponse.json({ ok: false, message: "Could not start checkout." }, { status: 502 });
  }
}
