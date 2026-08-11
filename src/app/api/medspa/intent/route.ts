// "Run my audit, $39" before Stripe exists.
//
// This deliberately is not a disabled button or a TODO alert. It records the tap and
// the clinic website against the opt-in, and posts into that lead's existing
// #hot-leads thread. The payoff is that the $39 click-through rate and the clinic URL
// of every high-intent lead are known BEFORE a line of payment code is written, which
// is the difference between launching a price and guessing at one.
//
// When MEDSPA_CHECKOUT_ENABLED=1 the client posts to the Stripe intent route instead
// and this one is no longer on the critical path. It stays as the fallback.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { enrichLead } from "@/lib/lead-intake";
import { normalizeTarget, normalizeErrorMessage } from "@/lib/scan/normalize";
import { clean, validEmail } from "@/lib/medspa/validate";
import { PRICES, dollars } from "@/config/medspa-funnel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, message: "Bad request." }, { status: 400 });
  }

  const email = clean(payload.email, 120).toLowerCase();
  if (!validEmail(email)) {
    return NextResponse.json({ ok: false, message: "We lost your session. Reload and try again." }, { status: 400 });
  }

  // The SAME validator the client used and the SAME one the audit pipeline will use,
  // so a typo never costs a round trip, the two cannot drift, and the SSRF host rules
  // apply here for free. Do not hand-roll a second URL check.
  const check = normalizeTarget(clean(payload.website, 200));
  if (!check.ok) {
    return NextResponse.json(
      { ok: false, field: "website", message: normalizeErrorMessage(check.error) },
      { status: 400 }
    );
  }

  const { data: optin, error } = await supabaseAdmin
    .from("medspa_optins")
    .update({
      clinic_website: check.target.website,
      clinic_domain: check.target.domain,
      intent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("email", email)
    .select("id, name")
    .maybeSingle();

  if (error || !optin) {
    console.error("[medspa/intent] no opt-in row for", email, error?.message);
    return NextResponse.json({ ok: false, message: "We lost your session. Reload and try again." }, { status: 404 });
  }

  // enrichLead is the function for "append to a lead that already exists": a Zoho
  // note plus a reply in the SAME #hot-leads thread ingestLead opened. It is matched
  // on email, which is why the opt-in has to have run first.
  try {
    await enrichLead({
      email,
      noteTitle: "Wants the paid audit",
      headline: `Tapped "Run my audit, ${dollars(PRICES.audit)}"`,
      detailLines: [
        `Clinic website: ${check.target.website}`,
        `Would have paid: ${dollars(PRICES.audit)}`,
        "Checkout is not live yet, this is intent only.",
      ],
    });
  } catch (e) {
    console.error("[medspa/intent] enrichLead failed:", (e as Error).message);
  }

  return NextResponse.json({ ok: true, website: check.target.website });
}
