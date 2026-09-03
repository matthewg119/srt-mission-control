// Live Calendly openings for the booking picker.
//
// PUBLIC, GET, AND IT SPENDS NOTHING. Unlike /api/scan/start it calls a rate-limited but free
// third-party read, so it does not carry the per-IP ledger those routes do. The one thing it
// must not do is leak the API token, which is why the client never talks to Calendly directly.
//
// ‼️ THE UNCONFIGURED ANSWER IS A 200, NOT AN ERROR. This ships with CALENDLY_API_TOKEN unset.
// { slots: null, reason: "unconfigured" } is a normal, expected response that tells the funnel
// to render the plain embed instead, and a 500 here would put an error state in front of a
// visitor over a env var that was always going to arrive later.

import { NextRequest, NextResponse } from "next/server";
import {
  fetchSlots,
  bucketSlots,
  bookingPageUrl,
  safeTimeZone,
  type EventKind,
  type Window,
} from "@/lib/calendly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const kind: EventKind = q.get("event") === "install" ? "install" : "15min";
  const window: Window = q.get("window") === "extended" ? "extended" : "today_tomorrow";
  const tz = safeTimeZone(q.get("tz"));

  const result = await fetchSlots(kind, window, tz);
  const bookingUrl = bookingPageUrl(kind);

  if (result.slots === null) {
    return NextResponse.json({ slots: null, reason: result.reason, bookingUrl });
  }

  return NextResponse.json({
    reason: "ok",
    bookingUrl,
    timeZone: tz,
    // Bucketed here rather than on the client so the today/tomorrow line is drawn once, by the
    // code that already had to know where the day boundary falls to build the query.
    buckets: bucketSlots(result.slots, tz),
    slots: result.slots,
  });
}
