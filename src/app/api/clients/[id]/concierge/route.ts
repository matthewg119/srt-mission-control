// Turn one client's AI Concierge on or off from the dashboard.
//
// AUTHENTICATED: middleware guards /dashboard/*, not /api/*, so this checks the session itself.
// Same pattern as the delivery-step and time-log routes beside it.
//
// ‼️ NOT api/concierge/*. Everything under that prefix is PUBLIC and cross-origin: it is reached
// from a client's own live website and authorises with a signed preview token, because a visitor
// has no session with us. This route is the opposite: an operator, on our dashboard, with a
// NextAuth session. Putting a config WRITE on the public prefix is how a visitor to a live site
// ends up able to switch somebody's widget off.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { setConciergeEnabled } from "@/lib/clients/concierge-enabled";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth().catch(() => null);
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  let body: { enabled?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }

  // A real boolean, not a truthy one. `"false"` from a form would switch a widget ON.
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ ok: false, error: "`enabled` must be true or false." }, { status: 400 });
  }

  const actor = session.user.name ?? session.user.email ?? "the dashboard";

  const res = await setConciergeEnabled({
    clientId: id,
    enabled: body.enabled,
    by: actor,
    source: "dashboard",
  });

  if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 400 });

  return NextResponse.json(
    { ok: true, state: res.state, line: res.lines[0] ?? null, lines: res.lines },
    { headers: { "cache-control": "no-store" } }
  );
}
