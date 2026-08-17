export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { buildWorklist, worklistSummary, type WorklistBucket } from "@/lib/worklist";

// The call board's data source. Same buildWorklist() the chatbot's
// get_worklist tool and the morning Slack digest use, so all three agree.
//
// Namespaced under /api/crm/ rather than /api/leads/, which already holds the
// public funnel intake routes (application, funnel, capture, disqualify,
// facebook) — those are unauthenticated by design and this is not.

const BUCKETS: WorklistBucket[] = [
  "replied",
  "overdue",
  "due_today",
  "unscheduled",
  "cadence",
];

export async function GET(request: NextRequest) {
  const session = await auth().catch(() => null);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const bucketParam = searchParams.get("bucket");
  const bucket =
    bucketParam && BUCKETS.includes(bucketParam as WorklistBucket)
      ? (bucketParam as WorklistBucket)
      : undefined;

  const limitParam = searchParams.get("limit");
  const limit = limitParam ? parseInt(limitParam, 10) : 50;
  if (Number.isNaN(limit) || limit < 1 || limit > 200) {
    return NextResponse.json({ error: "limit must be between 1 and 200" }, { status: 400 });
  }

  try {
    const [leads, summary] = await Promise.all([
      buildWorklist({
        bucket,
        limit,
        includeSnoozed: searchParams.get("include_snoozed") === "1",
      }),
      worklistSummary(),
    ]);

    return NextResponse.json({ ok: true, summary, count: leads.length, leads });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api/crm/worklist]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
