// Create the $39 (or $56) PaymentIntent and the order row behind it.
//
// setup_future_usage: 'off_session' is the whole point of this route beyond taking
// the money: it saves the card to the Customer so the one-click $299 OTO can charge
// it later with no re-entry.

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/db";
import { getStripe, isCheckoutEnabled } from "@/lib/medspa/stripe";
import { normalizeTarget, normalizeErrorMessage } from "@/lib/scan/normalize";
import { clean, validEmail } from "@/lib/medspa/validate";
import { marketKey } from "@/lib/medspa/market";
import { PRICES } from "@/config/medspa-funnel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  if (!isCheckoutEnabled()) {
    return NextResponse.json(
      { ok: false, message: "Checkout is not open yet." },
      { status: 503 }
    );
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, message: "Bad request." }, { status: 400 });
  }

  const email = clean(payload.email, 120).toLowerCase();
  if (!validEmail(email)) {
    return NextResponse.json(
      { ok: false, message: "We lost your session. Reload and try again." },
      { status: 400 }
    );
  }

  const check = normalizeTarget(clean(payload.website, 200));
  if (!check.ok) {
    return NextResponse.json(
      { ok: false, field: "website", message: normalizeErrorMessage(check.error) },
      { status: 400 }
    );
  }

  // ── The amount is a SERVER CONSTANT ──
  // A single flat line item, so the client has no input into the charged amount at
  // all: not a price, not an amount, not a currency, not even a bump boolean. If an
  // add-on is ever reintroduced, it must arrive as a server-validated product id and
  // never as an amount.
  const amount = PRICES.audit;

  const cityRaw = clean(payload.city, 80);
  const market = marketKey(cityRaw);

  // The opt-in row, if there is one. A buyer can in principle reach checkout without
  // it, so this is a link and not a requirement.
  const { data: optin } = await supabaseAdmin
    .from("medspa_optins")
    .select("id, name, contact_id")
    .eq("email", email)
    .maybeSingle();

  const name = clean(payload.name, 80) || ((optin?.name as string | null) ?? "");
  const confirmSecret = crypto.randomBytes(24).toString("base64url");

  // The order row is inserted BEFORE the Stripe calls, so its id can key the
  // idempotency below. A double-tapped button then cannot create two customers or
  // two PaymentIntents.
  const { data: order, error } = await supabaseAdmin
    .from("medspa_orders")
    .insert({
      optin_id: (optin?.id as string | null) ?? null,
      contact_id: (optin?.contact_id as string | null) ?? null,
      email,
      name: name || null,
      clinic_website: check.target.website,
      clinic_domain: check.target.domain,
      city: cityRaw || null,
      market_key: market,
      amount_cents: amount,
      status: "created",
      confirm_secret: confirmSecret,
      // Placeholder: replaced immediately below. The column is NOT NULL because an
      // order without a PaymentIntent is meaningless once this route returns.
      stripe_payment_intent_id: `pending_${confirmSecret}`,
      fbclid: clean(payload.fbclid, 255) || null,
      fbc: clean(payload.fbc, 255) || null,
    })
    .select("id")
    .single();

  if (error || !order) {
    console.error("[medspa/checkout/intent] insert failed:", error?.message);
    return NextResponse.json({ ok: false, message: "Could not start checkout." }, { status: 500 });
  }

  const orderId = order.id as string;
  const stripe = getStripe();

  try {
    const customer = await stripe.customers.create(
      { email, name: name || undefined, metadata: { order_id: orderId } },
      { idempotencyKey: `medspa-cust-${orderId}` }
    );

    const pi = await stripe.paymentIntents.create(
      {
        amount,
        currency: "usd",
        customer: customer.id,
        // Saves the card for the off-session founding subscription. Without this the
        // one-click OTO is impossible and the whole back end of the funnel dies.
        setup_future_usage: "off_session",
        automatic_payment_methods: { enabled: true },
        description: "SRT AI Visibility Audit",
        receipt_email: email,
        metadata: {
          order_id: orderId,
          clinic_domain: check.target.domain,
        },
      },
      { idempotencyKey: `medspa-pi-${orderId}` }
    );

    await supabaseAdmin
      .from("medspa_orders")
      .update({
        stripe_customer_id: customer.id,
        stripe_payment_intent_id: pi.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderId);

    return NextResponse.json({
      ok: true,
      orderId,
      confirmSecret,
      clientSecret: pi.client_secret,
      amountCents: amount,
    });
  } catch (e) {
    console.error("[medspa/checkout/intent] stripe failed:", (e as Error).message);
    await supabaseAdmin
      .from("medspa_orders")
      .update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("id", orderId);
    return NextResponse.json({ ok: false, message: "Could not start checkout." }, { status: 502 });
  }
}
