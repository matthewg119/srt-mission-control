// Turning a succeeded PaymentIntent into a provisioned order. Exactly once.
//
// TWO callers race for this, deliberately:
//   1. /api/medspa/checkout/confirm, called by the browser the instant
//      stripe.confirmPayment resolves. This is the PRIMARY path, because the buyer
//      is redirected onward about a second later and webhook delivery is
//      asynchronous: p50 is quick, p99 is seconds to minutes, and a cold lambda adds
//      to it. Waiting on the webhook would strand the fastest buyers, who are exactly
//      the ones who convert.
//   2. The Stripe webhook, which is the BACKSTOP for the buyer who closes the tab
//      mid-redirect, loses their connection, or pays by a redirect-based method.
//
// Neither caller trusts its input. Not the browser's claim of success, and not the
// webhook event body either: both re-read the PaymentIntent from Stripe, which is
// the only authority on whether money actually moved. That deletes an entire class
// of replay concern for the price of one API call.

import { supabaseAdmin } from "@/lib/db";
import { ingestLead, enrichLead } from "@/lib/lead-intake";
import { getStripe } from "@/lib/medspa/stripe";
import { signAccess, isLinkSecretConfigured } from "@/lib/medspa/links";
import { sendMedspaReceipt } from "@/lib/medspa/receipt-email";
import { fulfillMedspaOrder } from "@/lib/medspa/fulfillment";
import { dollars, funnelUrl } from "@/config/medspa-funnel";
import type Stripe from "stripe";

const ZOHO_LEAD_SOURCE = "Med Spa AI Audit ($39)";

export interface ProvisionResult {
  ok: true;
  orderId: string;
  email: string;
  /** Signed /training URL, or null when the link secret is unset. */
  trainingUrl: string | null;
}

/**
 * The training link for an order, derived from the opt-in it belongs to.
 *
 * Null when the order has no opt-in (someone who reached checkout without opting in)
 * or the secret is unset. Callers must render no button rather than a dead link.
 */
function trainingUrlForOrder(optinId: string | null): string | null {
  if (!optinId || !isLinkSecretConfigured()) return null;
  return funnelUrl(`/training?k=${encodeURIComponent(signAccess(optinId))}`);
}

/** Returns null when there is nothing to provision. Never throws on a stray event. */
export async function provisionPaidOrder(
  paymentIntentId: string
): Promise<ProvisionResult | null> {
  const stripe = getStripe();

  let pi: Stripe.PaymentIntent;
  try {
    pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ["payment_method"],
    });
  } catch (e) {
    console.error("[medspa/provision] PI retrieve failed:", (e as Error).message);
    return null;
  }

  if (pi.status !== "succeeded") return null;

  // `stripe trigger payment_intent.succeeded` fires events with no order_id, and a
  // webhook that 500s on those looks permanently broken. Return quietly instead.
  const orderId = pi.metadata?.order_id;
  if (!orderId) return null;

  const paymentMethodId =
    typeof pi.payment_method === "string" ? pi.payment_method : (pi.payment_method?.id ?? null);
  const customerId = typeof pi.customer === "string" ? pi.customer : (pi.customer?.id ?? null);

  // ── THE PROVISIONING CLAIM ──
  // status 'created' -> 'paid'. Exactly one caller wins; the loser still needs the
  // order row (for the training link it returns), so it reads it back below.
  const { data: claimed } = await supabaseAdmin
    .from("medspa_orders")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      stripe_customer_id: customerId,
      stripe_payment_method_id: paymentMethodId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId)
    .neq("status", "paid")
    .select("*")
    .maybeSingle();

  const { data: order } = claimed
    ? { data: claimed }
    : await supabaseAdmin.from("medspa_orders").select("*").eq("id", orderId).maybeSingle();

  if (!order) return null;

  // Derived, not stored, and identical for the claim winner and loser: the signature
  // is a pure function of the opt-in id. Nothing here needs a database round trip or
  // a single-use ledger any more, which is the main simplification of dropping the
  // OTO.
  const result: ProvisionResult = {
    ok: true,
    orderId: order.id as string,
    email: order.email as string,
    trainingUrl: trainingUrlForOrder((order.optin_id as string | null) ?? null),
  };

  // Everything below is one-time work and belongs to the claim winner only.
  if (!claimed) return result;

  await onFirstPayment(order).catch((e) =>
    console.error("[medspa/provision] post-payment work failed:", (e as Error).message)
  );

  // The expensive half, behind its own separate claim flag.
  await fulfillMedspaOrder(order.id as string).catch((e) =>
    console.error("[medspa/provision] fulfillment kick-off failed:", (e as Error).message)
  );

  return result;
}

type OrderRow = Record<string, unknown>;

async function onFirstPayment(order: OrderRow): Promise<void> {
  const email = order.email as string;
  const name = (order.name as string | null) ?? "";
  const website = order.clinic_website as string;
  const amount = order.amount_cents as number;

  // Make the saved card the customer's default, so the one-click subscribe has something
  // unambiguous to charge off-session.
  const customerId = order.stripe_customer_id as string | null;
  const pmId = order.stripe_payment_method_id as string | null;
  if (customerId && pmId) {
    await getStripe()
      .customers.update(customerId, { invoice_settings: { default_payment_method: pmId } })
      .catch((e) => console.error("[medspa/provision] default PM failed:", (e as Error).message));
  }

  const detailLines = [
    `Paid: ${dollars(amount)}`,
    `Clinic website: ${website}`,
    `Order: ${order.id as string}`,
  ];

  // The buyer already opted in, so a contact and a #hot-leads thread exist. Append to
  // them rather than opening a second thread. If enrichLead cannot find the contact
  // (they bought without opting in, or the opt-in ingest failed) fall through to a
  // full ingestLead so the sale is never invisible.
  const enriched = await enrichLead({
    email,
    noteTitle: "Paid the $39 audit",
    headline: `:moneybag: PAID ${dollars(amount)} audit: ${name || email}`,
    detailLines,
  }).catch(() => false);

  if (!enriched) {
    const [firstName, ...rest] = name.split(/\s+/).filter(Boolean);
    await ingestLead({
      firstName: firstName || undefined,
      lastName: rest.join(" ") || undefined,
      email,
      website,
      source: "medspa_paid",
      zohoLeadSource: ZOHO_LEAD_SOURCE,
      noteTitle: "Paid the $39 audit",
      headline: `:moneybag: PAID ${dollars(amount)} audit: ${name || email}`,
      detailLines,
      // No phone is collected at checkout, so there is nothing for Speed-to-Lead to
      // dial anyway; being explicit keeps a future edit from arming an outbound call
      // from a payment webhook.
      speedToLead: false,
    }).catch((e) => console.error("[medspa/provision] ingestLead failed:", (e as Error).message));
  }

  await sendMedspaReceipt({
    to: email,
    firstName: name.split(/\s+/)[0] || null,
    clinicWebsite: website,
    amountCents: amount,
    trainingUrl: trainingUrlForOrder((order.optin_id as string | null) ?? null),
  }).catch((e) => console.error("[medspa/provision] receipt failed:", (e as Error).message));
}
