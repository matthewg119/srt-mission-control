export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { runZohoBackfill } from "@/lib/zoho-backfill";

// Admin endpoint to trigger a Zoho backfill from the dashboard.
// Auth: requires authenticated NextAuth session OR LEAD_THREAD_API_KEY for cross-origin.
//
// Vercel limit: 60 seconds. For larger sweeps, use the CLI script:
//   bun run scripts/backfill-zoho-leads.ts

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  // Auth: either an authed Mission Control session, OR the shared API key
  // (so the portal admin button can call it cross-origin).
  const session = await auth().catch(() => null);
  const apiKey = request.headers.get("x-api-key");
  const expectedKey = process.env.LEAD_THREAD_API_KEY;

  const authedViaSession = !!session?.user;
  const authedViaKey = !!expectedKey && apiKey === expectedKey;

  if (!authedViaSession && !authedViaKey) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Parse query params
  const { searchParams } = new URL(request.url);
  const limitParam = searchParams.get("limit");
  const sinceParam = searchParams.get("since");
  const dryRun = searchParams.get("dry") === "1";

  const limit = limitParam ? parseInt(limitParam, 10) : 50;
  if (Number.isNaN(limit) || limit < 1 || limit > 500) {
    return NextResponse.json(
      { error: "limit must be between 1 and 500" },
      { status: 400 }
    );
  }

  try {
    const result = await runZohoBackfill({
      dryRun,
      limit,
      since: sinceParam || undefined,
    });

    return NextResponse.json({
      ok: true,
      dryRun,
      limit,
      ...result,
      // Truncate errors list in the response to avoid huge payloads
      errors: result.errors.slice(0, 10),
      errorsTruncated: result.errors.length > 10,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[admin/zoho-backfill] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
