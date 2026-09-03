// Read-only window onto the market dataset and the ammo ledger.
//
//   GET /api/ammo?prospect=<uuid>                     what is unspent for this prospect, and why
//   GET /api/ammo?city=Austin,%20TX&service=trt       who the engines name in one market
//
// ‼️ READ ONLY, AND GATED. It returns CRM rows and competitor intelligence. On production that
// means a secret; on a preview, Vercel's own Deployment Protection is the gate. See authorized().
// Nothing here writes, sends, or spends: recording a piece of ammo as spent is recordAmmoSpent(),
// called by whatever actually puts the line in a message, never by a route that merely displayed it.
//
// This exists because the alternative way to check that the whole chain works is to read four
// tables by hand. It is the thing to open on a preview deploy to see the lane end to end.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { ammoForProspect } from "@/lib/ammo/for-prospect";
import { competitorAmmo } from "@/lib/ammo/supply";
import { parseCityCell, fromCityState, displayPlace } from "@/lib/market/place";
import { marketKeys } from "@/lib/market/service-synonyms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ‼️ ON PRODUCTION THIS NEEDS A SECRET. ON A PREVIEW IT DOES NOT, AND THAT IS NOT A HOLE.
 *
 * A Vercel preview deployment is already behind the team's Deployment Protection: an unauthenticated
 * request to this URL is bounced to vercel.com/sso before it ever reaches Next, which was verified
 * against this exact route before the rule was written. So on a preview the boundary is "a member
 * of this Vercel team, signed in", which is a stronger check than a shared bearer token, and it is
 * the only one a browser can actually pass by clicking a link.
 *
 * Production is the opposite case: the URL is public, so it requires the secret and there is no
 * environment fallback. Checked positively against "production" rather than negatively against
 * "preview", so an unset or unexpected VERCEL_ENV fails CLOSED and takes the secret path.
 *
 * Two names are accepted because neither is guaranteed to exist: this project has
 * AUDIT_INTERNAL_SECRET in Production and no CRON_SECRET anywhere. With neither set, production
 * refuses every request, which is the correct way to be misconfigured.
 */
function authorized(req: NextRequest): boolean {
  if (process.env.VERCEL_ENV !== "production") return true;

  const secrets = [process.env.CRON_SECRET, process.env.AUDIT_INTERNAL_SECRET].filter(
    (s): s is string => !!s && s.length > 0
  );
  if (!secrets.length) return false;

  const header = req.headers.get("authorization") ?? "";
  const xheader = req.headers.get("x-srt-secret") ?? "";
  const key = new URL(req.url).searchParams.get("key") ?? "";

  return secrets.some((s) => header === `Bearer ${s}` || xheader === s || key === s);
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const prospectId = searchParams.get("prospect");

  if (prospectId) {
    const result = await ammoForProspect(prospectId);
    return NextResponse.json({
      prospect: prospectId,
      market: result.place ? displayPlace(result.place) : null,
      service: result.service,
      // The reason is returned rather than swallowed. An empty list with no explanation is
      // indistinguishable from a broken query, and this lane has already been bitten once by
      // exactly that: a raw city join returned zero rows and read like "we have no data".
      reason: result.reason,
      unspent: result.candidates,
      spent: result.spent,
    });
  }

  const cityParam = searchParams.get("city");
  const service = searchParams.get("service");
  if (!cityParam || !service) {
    return NextResponse.json(
      { error: "pass ?prospect=<uuid>, or ?city=<City, ST>&service=<slug>" },
      { status: 400 }
    );
  }

  // Accepts either shape: "Austin, TX" the way an audit writes it, or city plus a separate state
  // the way every lead table writes it.
  const place =
    parseCityCell(cityParam) ?? fromCityState(cityParam, searchParams.get("state"));
  if (!place) {
    return NextResponse.json({ error: "could not read that city" }, { status: 400 });
  }

  const [ammo, rows] = await Promise.all([
    competitorAmmo({ place, service }),
    supabaseAdmin
      .from("market_competitors")
      .select("display_name, times_named, run_count, report_count, engines, cited_domains, last_seen")
      .eq("city", place.city)
      .in("service_key", marketKeys(service))
      .order("times_named", { ascending: false })
      .limit(25),
  ]);

  return NextResponse.json({
    market: displayPlace(place),
    service: service.trim().toLowerCase(),
    ammo,
    competitors: rows.data ?? [],
  });
}
