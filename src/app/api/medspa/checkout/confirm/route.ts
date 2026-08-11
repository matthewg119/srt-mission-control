// The PRIMARY provisioning path, called by the browser the moment
// stripe.confirmPayment resolves.
//
// Its job is to have a working OTO token ready about a second after payment, which
// webhook latency cannot guarantee. The webhook still runs and is idempotent; this
// route just gets there first.

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/db";
import { provisionPaidOrder } from "@/lib/medspa/provision";
import { clean } from "@/lib/medspa/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 60;

/** Anchored, so a string of dashes cannot reach Postgres and 500 on the uuid cast. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const orderId = clean(payload.orderId, 64);
  const confirmSecret = clean(payload.confirmSecret, 128);

  if (!UUID.test(orderId) || !confirmSecret) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const { data: order } = await supabaseAdmin
    .from("medspa_orders")
    .select("id, confirm_secret, stripe_payment_intent_id")
    .eq("id", orderId)
    .maybeSingle();

  if (!order) return NextResponse.json({ ok: false }, { status: 404 });

  // ── Authorization ──
  // Without this, pi_ ids are semi-structured enough that someone could try to mint
  // OTO tokens against other people's orders. Constant time, length-checked first
  // because timingSafeEqual throws on a length mismatch.
  const a = Buffer.from(confirmSecret);
  const b = Buffer.from((order.confirm_secret as string) ?? "");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  const result = await provisionPaidOrder(order.stripe_payment_intent_id as string);

  if (!result) {
    // The PaymentIntent is real but not succeeded yet: an async method, or 3DS still
    // settling. Not an error. The page polls and the webhook finishes the job.
    return NextResponse.json({ ok: true, pending: true });
  }

  // Buyers go to the free training next, not to an upsell. The subscription is sold
  // from /get-named after they have watched it.
  return NextResponse.json({
    ok: true,
    pending: false,
    trainingUrl: result.trainingUrl,
  });
}
