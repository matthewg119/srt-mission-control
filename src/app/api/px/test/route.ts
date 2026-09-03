// GET /api/px/test?code=CODE  ->  the Test Events feed.
//
// The Meta Test Events tab, rebuilt: put ?srt_test=CODE on any URL of a client site, trigger a
// booking, and watch it land here within a second or two. The dashboard polls this.
//
// ‼️ AUTHENTICATED, UNLIKE THE COLLECTOR. Writing telemetry is public because the pixel runs in
// a stranger's browser; READING it is not, because these rows carry a client's landing pages and
// referrers. The collector answers 204 to everybody and this answers 401 to anybody without a
// session, and the asymmetry is the point.
//
// ‼️ IT SERVES ONLY is_test ROWS AND THE FILTER IS NOT A PARAMETER. A `mode=live` option here
// would turn a debugging aid into a general traffic export, one query string away, on a route
// whose whole reason to exist is that somebody is standing at a keyboard watching it.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/** A test session is watched live. More than this on screen is not a test, it is a report. */
const LIMIT = 40;

export async function GET(req: NextRequest) {
  const session = await auth().catch(() => null);
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });

  const code = (req.nextUrl.searchParams.get("code") ?? "").trim();

  let sessions = supabaseAdmin
    .from("attribution_sessions")
    .select(
      "id, client_id, created_at, last_seen_at, landing_host, landing_path, referrer_host, referrer_kind, ai_engine, utm_source, utm_medium, utm_campaign, pageviews, test_code"
    )
    .eq("is_test", true)
    .order("created_at", { ascending: false })
    .limit(LIMIT);
  if (code) sessions = sessions.eq("test_code", code);

  let bookings = supabaseAdmin
    .from("attribution_bookings")
    .select(
      "id, client_id, session_id, count_basis, self_report, ai_evidence, qualified, booked_at, test_code"
    )
    .eq("is_test", true)
    .order("booked_at", { ascending: false })
    .limit(LIMIT);
  if (code) bookings = bookings.eq("test_code", code);

  const [s, b] = await Promise.all([sessions, bookings]);
  if (s.error || b.error) {
    return NextResponse.json(
      { ok: false, error: s.error?.message ?? b.error?.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    code: code || null,
    sessions: s.data ?? [],
    bookings: b.data ?? [],
    // ‼️ STATED IN THE PAYLOAD, NOT ONLY ON THE PAGE. Anything reading this endpoint is looking
    // at pixel rows, and the first question a pixel row invites is "does this count". It does
    // not, and the answer travels with the data rather than living in a legend somewhere else.
    note: "count_basis 'pixel_only' never qualifies. The count comes from the Concierge and from the how-did-you-hear answer.",
  });
}
