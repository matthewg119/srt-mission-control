export const dynamic = "force-dynamic";
// Stale-reply nudge cron — finds conversations where the lead texted and Matthew
// hasn't replied in ~24h, and posts a Vektor nudge + drafted reply (✅ Send only).
// See src/lib/stale-replies.ts.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { runStaleReplyNudges } from "@/lib/stale-replies";

export const runtime = "nodejs";
export const maxDuration = 60;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { nudged, candidates } = await runStaleReplyNudges();

  await supabaseAdmin.from("system_logs").insert({
    event_type: "cron_stale_replies",
    description: `Stale-reply nudges: ${nudged} posted (${candidates} candidates)`,
    metadata: { nudged, candidates },
  });

  return NextResponse.json({ ok: true, nudged, candidates });
}
