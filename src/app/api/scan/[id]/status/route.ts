// GET /api/scan/:id/status — what the run view polls, ~every 2s.
//
// Public and unauthenticated like the session it describes, so it returns only
// what the run page already displays. Note what is NOT here: raw engine
// responses, citations, the per-prompt appeared/missed grid. Those are the
// report, and the report is behind the email gate.

import { NextRequest, NextResponse } from "next/server";
import { buildStatusPayload, getSession } from "@/lib/scan/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// supabase-js calls the global fetch, which Next patches and caches. Without this the poll
// happily served a snapshot of the session from seconds earlier: the row had report_id set and
// the run was well underway, while this endpoint kept reporting step 1. force-dynamic alone did
// not cover it, because the route cache and the DATA cache are different things.
export const fetchCache = "force-no-store";
export const revalidate = 0;

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  // A bad id here is a 404, not a 500. Anchored to the real uuid shape: the old
  // /^[0-9a-f-]{36}$/ also matched 36 dashes, which reached Postgres and failed the cast.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.id)) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  const session = await getSession(params.id);
  if (!session) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  const payload = await buildStatusPayload(session);
  return NextResponse.json(
    { ok: true, ...payload },
    { headers: { "Cache-Control": "no-store" } }
  );
}
