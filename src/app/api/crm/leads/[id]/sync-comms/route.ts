export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { syncLeadComms } from "@/lib/lead-comms";

// Pull this lead's emails and texts onto its timeline.
//
// Its own route rather than part of the page render because the Graph $search
// takes about a second, and the record, the call form and the existing history
// should not wait on Outlook to paint. The page renders from the database and a
// small client island calls this, refreshing only if something new landed.
//
// A Graph failure comes back as `graphError` with a 200. The lead page is not
// broken by an expired mailbox token; it just says the email history may be
// incomplete.

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth().catch(() => null);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const res = await syncLeadComms(id);
    return NextResponse.json({ ok: true, ...res });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api/crm/leads/sync-comms]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
