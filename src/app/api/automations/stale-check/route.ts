export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { processStaleDeals } from "@/lib/automation-engine";

// The "Run Stale Check" button on /dashboard/automations.
//
// This used to be GET /api/cron/stale-deals, which went with the funding
// decommission. It is not on a cron any more: Vercel Hobby allows one run per
// day per entry and the gone-quiet alerts are better fired on demand than on a
// schedule nobody is watching.
export async function POST() {
  const session = await auth().catch(() => null);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await processStaleDeals();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "stale check failed" },
      { status: 500 }
    );
  }
}
