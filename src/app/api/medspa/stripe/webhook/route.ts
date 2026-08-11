// Stripe webhook. Signature verified, replay proof, idempotent.
//
// REGISTER THIS DIRECTLY at https://mission.srtagency.com/api/medspa/stripe/webhook.
// Do NOT point Stripe at the srtagency.com rewrite: the signature is computed over
// the exact request bytes and a proxy hop is a needless way to lose them.

import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import type Stripe from "stripe";
import { supabaseAdmin } from "@/lib/db";
import { getStripe, subscriptionPeriodEnd, isLiveStatus } from "@/lib/medspa/stripe";
import { provisionPaidOrder } from "@/lib/medspa/provision";
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
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[medspa/webhook] STRIPE_WEBHOOK_SECRET is not set.");
    return new NextResponse("not configured", { status: 500 });
  }

  const signature = req.headers.get("stripe-signature") ?? "";

  // The RAW body. App Router does not pre-parse, so req.text() is the exact bytes
  // Stripe signed. Never req.json() here: parsing and re-serializing changes them and
  // every signature check fails.
  const raw = await req.text();

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(raw, signature, secret);
  } catch (e) {
    console.error("[medspa/webhook] bad signature:", (e as Error).message);
    return new NextResponse("bad signature", { status: 400 });
  }

  // ── Replay guard ──
  // Insert-with-on-conflict-do-nothing is the claim. An empty result means we have
  // already handled this event id, so acknowledge and stop.
  const { data: fresh, error: ledgerError } = await supabaseAdmin
    .from("stripe_events")
    .upsert({ id: event.id, type: event.type }, { onConflict: "id", ignoreDuplicates: true })
    .select("id")
    .maybeSingle();

  // A DB ERROR and a DUPLICATE both come back with data null, and conflating them is
  // dangerous in exactly one direction: if the ledger table is missing or unreachable,
  // every event would look like a replay and be silently dropped forever, while Stripe
  // sees 200 and never retries. Fail loudly instead so the retry queue holds them.
  if (ledgerError) {
    console.error("[medspa/webhook] event ledger unavailable:", ledgerError.message);
    return new NextResponse("ledger unavailable", { status: 500 });
  }

  if (!fresh) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case "payment_intent.succeeded": {
        const pi = event.data.object as Stripe.PaymentIntent;
        // Acked immediately and finished in the background. Safe because
        // provisionPaidOrder is fully idempotent and the confirm endpoint is the
        // primary path anyway. Same doctrine as the Meta Lead Ads webhook.
        waitUntil(
          provisionPaidOrder(pi.id).then(
            () => undefined,
            (e) => console.error("[medspa/webhook] provision failed:", (e as Error).message)
          )
        );
        break;
      }

      case "payment_intent.payment_failed": {
        const pi = event.data.object as Stripe.PaymentIntent;
        const orderId = pi.metadata?.order_id;
        if (orderId) {
          // Only a not-yet-paid order can move to failed. A retry that eventually
          // succeeded must never be walked backwards by a late failure event.
          await supabaseAdmin
            .from("medspa_orders")
            .update({ status: "failed", updated_at: new Date().toISOString() })
            .eq("id", orderId)
            .eq("status", "created");
        }
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        await syncSubscriptionFromInvoice(invoice);
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const email = invoice.customer_email;
        if (email) {
          await enrichLead({
            email,
            noteTitle: "Subscription payment failed",
            headline: ":warning: A med spa subscription payment failed",
            detailLines: [
              `Invoice: ${invoice.id ?? "unknown"}`,
              `Amount due: $${((invoice.amount_due ?? 0) / 100).toFixed(2)}`,
              "Stripe will retry on its dunning schedule.",
            ],
          }).catch(() => false);
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        await syncSubscription(sub, event.type === "customer.subscription.deleted");
        break;
      }

      default:
        break;
    }
  } catch (e) {
    console.error(`[medspa/webhook] handler for ${event.type} threw:`, (e as Error).message);
    // Roll back the replay guard so Stripe's retry can have another go, rather than
    // being silently swallowed by the idempotency ledger.
    await supabaseAdmin.from("stripe_events").delete().eq("id", event.id);
    return new NextResponse("handler error", { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function syncSubscriptionFromInvoice(invoice: Stripe.Invoice): Promise<void> {
  // On this API version an invoice does not carry a top-level `subscription` field
  // any more; the link lives on the line items' parent. Resolve it defensively and
  // fall back to the subscription details on the invoice parent.
  const parent = invoice.parent as { subscription_details?: { subscription?: string | Stripe.Subscription } } | null;
  const ref = parent?.subscription_details?.subscription;
  const subId = typeof ref === "string" ? ref : ref?.id;
  if (!subId) return;

  const sub = await getStripe().subscriptions.retrieve(subId);
  await syncSubscription(sub, false);
}

async function syncSubscription(sub: Stripe.Subscription, deleted: boolean): Promise<void> {
  const status = deleted ? "canceled" : sub.status;

  const { data: existing } = await supabaseAdmin
    .from("medspa_subscriptions")
    .select("id, founding_slot_no, status")
    .eq("stripe_subscription_id", sub.id)
    .maybeSingle();

  if (!existing) {
    // Created outside our own claim route (a dashboard action, say). Record it so the
    // table never lies about what is live, but there is no order to attach.
    return;
  }

  await supabaseAdmin
    .from("medspa_subscriptions")
    .update({
      status,
      current_period_end: subscriptionPeriodEnd(sub),
      canceled_at: sub.canceled_at ? new Date(sub.canceled_at * 1000).toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", existing.id);

  // A founding subscription that just went live after a 3DS challenge is worth
  // saying out loud, because the claim route could not confirm it at the time.
  if (!isLiveStatus(existing.status as string) && isLiveStatus(status)) {
    await note(
      `:tada: Med spa subscription is now *${status}* (${sub.id})` +
        (existing.founding_slot_no ? `, founding seat ${existing.founding_slot_no}` : "")
    );
  }

  if (deleted && existing.founding_slot_no) {
    // Stamp the release for the record, but LEAVE claimed_by set. A seat that
    // silently reopens makes "only 5, ever" false, and someone who cancels in month
    // two has already consumed the scarcity. Reopening one is a deliberate manual
    // UPDATE, never something a webhook does.
    await supabaseAdmin
      .from("medspa_founding_slots")
      .update({ released_at: new Date().toISOString() })
      .eq("slot_no", existing.founding_slot_no);

    await note(
      `:warning: Founding seat ${existing.founding_slot_no} subscription was cancelled (${sub.id}). ` +
        `The seat stays consumed. Free it by hand if you mean to resell it.`
    );
  }
}
