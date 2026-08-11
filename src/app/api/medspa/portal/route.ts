// Self-serve cancellation, via the Stripe Billing Portal.
//
// ‼️ A portal session EXPIRES, so a raw session URL must never be embedded in an
// email that sits in an inbox for days. This route is the durable link instead: it
// takes an HMAC-signed opt-in id, verifies it, then mints a FRESH session on every
// visit and 302s. The link in the email never goes stale.
//
// Cancel at period end, no penalty, no retention interstitial, and nothing is revoked
// on cancellation. Keep Everything is a product promise: the pages stay live, the
// listings stay corrected, the scorecards stay theirs. No code path here or in the
// webhook may contradict that.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { getStripe, isStripeConfigured } from "@/lib/medspa/stripe";
import { verifyAccess } from "@/lib/medspa/links";
import { funnelUrl } from "@/config/medspa-funnel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(req: NextRequest) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ ok: false, message: "Not configured." }, { status: 503 });
  }

  const k = new URL(req.url).searchParams.get("k");
  const access = verifyAccess(k);
  if (!access.ok) {
    return NextResponse.json({ ok: false, message: "This link is not valid." }, { status: 403 });
  }

  const { data: optin } = await supabaseAdmin
    .from("medspa_optins")
    .select("email")
    .eq("id", access.optinId)
    .maybeSingle();

  if (!optin?.email) {
    return NextResponse.json({ ok: false, message: "This link is not valid." }, { status: 404 });
  }

  // The customer id comes from OUR row, not from anything in the URL, so a valid
  // signature for one person can never open another person's billing portal.
  const { data: sub } = await supabaseAdmin
    .from("medspa_subscriptions")
    .select("stripe_customer_id")
    .eq("email", optin.email as string)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!sub?.stripe_customer_id) {
    return NextResponse.json(
      { ok: false, message: "We could not find a plan for that address." },
      { status: 404 }
    );
  }

  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer: sub.stripe_customer_id as string,
      return_url: funnelUrl("/get-named"),
    });
    return NextResponse.redirect(session.url, { status: 302 });
  } catch (e) {
    console.error("[medspa/portal] session create failed:", (e as Error).message);
    return NextResponse.json(
      { ok: false, message: "We could not open the billing portal. Email us and we will cancel it by hand." },
      { status: 502 }
    );
  }
}
