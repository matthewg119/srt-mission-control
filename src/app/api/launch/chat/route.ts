// The front door turn: which client, before one exists.
//
// ‼️ NO [id] SEGMENT, BECAUSE THERE IS NO CLIENT YET. Every other route under /api/launch takes
// the client from the URL, which is what keeps a turn from drifting onto another client. This one
// cannot, so it does the next best thing: it creates at most one client per turn through
// startLaunchClient(), and it returns an id rather than acting on one.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { runDoorTurn, type DoorMessage } from "@/lib/launch/front-door";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const actor = session.user.name ?? session.user.email ?? "the dashboard";

  let body: { message?: string; history?: DoorMessage[] };
  try {
    body = (await req.json()) as { message?: string; history?: DoorMessage[] };
  } catch {
    return NextResponse.json({ error: "That was not JSON." }, { status: 400 });
  }

  const message = (body.message ?? "").trim();
  if (!message) return NextResponse.json({ error: "Say something first." }, { status: 400 });

  // Trimmed rather than trusted whole: this history comes from the browser, and an unbounded one
  // is a way to push the system prompt out of the window.
  const history = (Array.isArray(body.history) ? body.history : [])
    .slice(-20)
    .filter((m): m is DoorMessage => !!m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string");

  try {
    const turn = await runDoorTurn({ history, message, actor });
    return NextResponse.json({ ok: true, ...turn });
  } catch (e) {
    return NextResponse.json({ error: `The turn failed: ${(e as Error).message}` }, { status: 502 });
  }
}
