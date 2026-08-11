// The one-click $299 Founding subscription.
//
// No card is re-entered. The $39 PaymentIntent carried
// setup_future_usage:'off_session', so the payment method is already on the Customer
// and this route charges it off-session.
//
// ORDER OF CLAIMS, and it is load-bearing:
//   verify HMAC -> claim the SLOT -> claim the TOKEN -> create the subscription
//
// Slot before token, because claim_founding_slot is idempotent per order: if the
// token claim then fails as already-used, the order already held that slot from the
// first attempt and nothing leaked. The reverse order can burn a token against a
// sold-out cap, which loses the buyer their seat AND their retry.

import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { supabaseAdmin } from "@/lib/db";
import {
  getStripe,
  isCheckoutEnabled,
  subscriptionPeriodEnd,
  invoiceClientSecret,
} from "@/lib/medspa/stripe";
import { verifyOtoToken, claimOtoToken, releaseOtoToken } from "@/lib/medspa/oto";
import { marketKey, findMarketConflict } from "@/lib/medspa/market";
import { clean } from "@/lib/medspa/validate";
import { PRICES } from "@/config/medspa-funnel";
import { slack } from "@/lib/slack-bot";
import { enrichLead } from "@/lib/lead-intake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 60;

async function note(message: string): Promise<void> {
  const channel = process.env.SLACK_CEO_CHANNEL;
  if (!channel) return;
  await slack.postMessage(channel, message).catch(() => {});
}

export async function POST(req: NextRequest) {
  if (!isCheckoutEnabled()) {
    return NextResponse.json({ ok: false, message: "Checkout is not open." }, { status: 503 });
  }

  const priceId = process.env.STRIPE_PRICE_FOUNDING;
  if (!priceId) {
    console.error("[medspa/oto/claim] STRIPE_PRICE_FOUNDING is not set.");
    return NextResponse.json({ ok: false, message: "Not configured." }, { status: 500 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const token = clean(payload.token, 512);
  const cityRaw = clean(payload.city, 80);

  // Signature and expiry, both without touching the database.
  const verdict = verifyOtoToken(token);
  if (!verdict.ok) {
    return NextResponse.json({ ok: false, fallback: "standard", reason: verdict.reason }, { status: 400 });
  }

  const { data: order } = await supabaseAdmin
    .from("medspa_orders")
    .select("id, email, name, contact_id, stripe_customer_id, stripe_payment_method_id, clinic_website, city, market_key")
    .eq("id", verdict.orderId)
    .eq("status", "paid")
    .maybeSingle();

  if (!order) {
    return NextResponse.json({ ok: false, fallback: "standard", reason: "no_order" }, { status: 404 });
  }
  if (!order.stripe_customer_id || !order.stripe_payment_method_id) {
    // Nothing saved to charge. Send them down the normal on-session path instead of
    // failing, so the sale is still reachable.
    return NextResponse.json({ ok: false, fallback: "standard", reason: "no_saved_card" }, { status: 409 });
  }

  // ── 1. The seat, claimed in the DATABASE ──
  const { data: slotNo, error: slotErr } = await supabaseAdmin.rpc("claim_founding_slot", {
    p_order_id: order.id,
  });

  if (slotErr) {
    console.error("[medspa/oto/claim] slot rpc failed:", slotErr.message);
    return NextResponse.json({ ok: false, message: "Could not reserve a seat." }, { status: 500 });
  }
  if (slotNo === null || slotNo === undefined) {
    return NextResponse.json({ ok: false, fallback: "standard", reason: "sold_out" }, { status: 409 });
  }

  // ── 2. The token, single use ──
  const claimed = await claimOtoToken(token);
  if (!claimed.ok) {
    return NextResponse.json({ ok: false, fallback: "standard", reason: "token_used" }, { status: 409 });
  }

  // ── 3. The subscription ──
  const market = marketKey(cityRaw) ?? (order.market_key as string | null);

  try {
    const sub = await getStripe().subscriptions.create(
      {
        customer: order.stripe_customer_id as string,
        items: [{ price: priceId }],
        default_payment_method: order.stripe_payment_method_id as string,
        off_session: true,
        // 'allow_incomplete', NOT 'error_if_incomplete'. This always returns a
        // subscription object instead of throwing, so "needs 3DS" is a branch rather
        // than exception-driven control flow dug out of err.raw, and it maps cleanly
        // onto the invoice.payment_succeeded / customer.subscription.updated webhooks
        // that finish the job after the customer authenticates.
        payment_behavior: "allow_incomplete",
        // On API 2026-07-29.dahlia `invoice.payment_intent` no longer exists. The
        // client_secret comes from confirmation_secret, and ONLY if it is expanded.
        expand: ["latest_invoice.confirmation_secret"],
        metadata: { order_id: order.id as string, plan: "founding", slot_no: String(slotNo) },
      },
      { idempotencyKey: `medspa-sub-founding-${order.id}` }
    );

    const conflict = await findMarketConflict(market);

    const { data: row } = await supabaseAdmin
      .from("medspa_subscriptions")
      .insert({
        order_id: order.id,
        contact_id: order.contact_id,
        email: order.email,
        stripe_customer_id: order.stripe_customer_id,
        stripe_subscription_id: sub.id,
        plan: "founding",
        founding_slot_no: slotNo,
        amount_cents: PRICES.founding,
        status: sub.status,
        market_key: market,
        city: cityRaw || (order.city as string | null),
        market_conflict: Boolean(conflict),
        market_conflict_with: conflict?.withSubscriptionId ?? null,
      })
      .select("id")
      .single();

    await supabaseAdmin
      .from("medspa_founding_slots")
      .update({ subscription_id: row?.id ?? null })
      .eq("slot_no", slotNo);

    await supabaseAdmin
      .from("medspa_oto_tokens")
      .update({ used_for_subscription_id: row?.id ?? null })
      .eq("order_id", order.id);

    if (conflict) {
      // Flag and Slack, never block. Refunding a duplicate takes two minutes; losing
      // a real sale to a string mismatch is unrecoverable and invisible.
      await note(
        `:warning: MARKET CONFLICT. ${order.email} just subscribed for market \`${market}\`, ` +
          `which ${conflict.withEmail} already holds. Both are live. Review and refund one if needed.`
      );
    }

    await enrichLead({
      email: order.email as string,
      noteTitle: "Founding subscription started",
      headline: `:rocket: FOUNDING $299/mo started, seat ${slotNo} of 5`,
      detailLines: [
        `Subscription: ${sub.id}`,
        `Status: ${sub.status}`,
        market ? `Market: ${market}` : "",
        conflict ? `MARKET CONFLICT with ${conflict.withEmail}` : "",
      ].filter(Boolean),
    }).catch(() => false);

    // 3DS on an off-session charge. The subscription sits 'incomplete' until the
    // customer authenticates; hand the browser the secret so it can raise the
    // challenge rather than failing silently.
    if (sub.status === "incomplete") {
      const clientSecret = invoiceClientSecret(sub);
      if (clientSecret) {
        return NextResponse.json({
          ok: true,
          requiresAction: true,
          clientSecret,
          subscriptionId: sub.id,
          slotNo,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      requiresAction: false,
      subscriptionId: sub.id,
      status: sub.status,
      slotNo,
      currentPeriodEnd: subscriptionPeriodEnd(sub),
    });
  } catch (e) {
    const message = (e as Stripe.errors.StripeError).message ?? (e as Error).message;
    console.error("[medspa/oto/claim] subscription failed:", message);

    // Give the token back so they can retry. The SLOT is intentionally left claimed:
    // release_stale_founding_slots() sweeps it after an hour if no live subscription
    // ever attaches, which is safer than racing to free it here and handing the last
    // seat to someone else while this buyer is still on the page.
    await releaseOtoToken(token);

    await note(
      `:x: Founding subscription failed for ${order.email} (seat ${slotNo} held pending sweep): ${message}`
    );

    return NextResponse.json({ ok: false, message: "That card was declined." }, { status: 402 });
  }
}
