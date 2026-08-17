export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/db";
import { runPull, PULL_ENTITIES, type PullEntity } from "@/lib/zoho-pull";

// Admin endpoint to run the Zoho → Supabase pull in bite-sized chunks.
// Auth mirrors /api/admin/zoho-backfill: authed NextAuth session OR the shared
// LEAD_THREAD_API_KEY header.
//
// Vercel caps at 60 seconds, so this deliberately takes a page budget and
// checkpoints the cursor in crm_sync_state. Call it repeatedly until
// `complete: true` — or just use the CLI for the initial import:
//   bun run scripts/pull-zoho-crm.ts --entity=all
//
//   GET  ?entity=leads              → current sync state (no work done)
//   POST ?entity=leads&pages=15&resume=1

export const maxDuration = 60;

const DEFAULT_PAGES = 15;

async function authorize(request: NextRequest): Promise<boolean> {
  const session = await auth().catch(() => null);
  if (session?.user) return true;
  const expectedKey = process.env.LEAD_THREAD_API_KEY;
  return !!expectedKey && request.headers.get("x-api-key") === expectedKey;
}

/** Read-only: what has been imported so far and where each cursor sits. */
export async function GET(request: NextRequest) {
  if (!(await authorize(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: state } = await supabaseAdmin
    .from("crm_sync_state")
    .select("entity, phase, watermark, records_seen, records_written, last_run_at, last_error")
    .order("entity");

  const [contacts, activities, tasks] = await Promise.all([
    supabaseAdmin
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .not("zoho_lead_id", "is", null),
    supabaseAdmin
      .from("lead_activities")
      .select("id", { count: "exact", head: true })
      .eq("source", "zoho"),
    supabaseAdmin
      .from("lead_tasks")
      .select("id", { count: "exact", head: true })
      .eq("source", "zoho"),
  ]);

  return NextResponse.json({
    ok: true,
    syncState: state ?? [],
    imported: {
      contactsWithZohoId: contacts.count ?? 0,
      zohoActivities: activities.count ?? 0,
      zohoTasks: tasks.count ?? 0,
    },
  });
}

export async function POST(request: NextRequest) {
  if (!(await authorize(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const entityParam = (searchParams.get("entity") || "all") as PullEntity | "all";
  const dryRun = searchParams.get("dry") === "1";
  const resume = searchParams.get("resume") !== "0"; // resumable by default here
  const since = searchParams.get("since") || undefined;

  if (entityParam !== "all" && !PULL_ENTITIES.includes(entityParam)) {
    return NextResponse.json(
      { error: `entity must be "all" or one of: ${PULL_ENTITIES.join(", ")}` },
      { status: 400 }
    );
  }

  const pagesParam = searchParams.get("pages");
  const maxPages = pagesParam ? parseInt(pagesParam, 10) : DEFAULT_PAGES;
  if (Number.isNaN(maxPages) || maxPages < 1 || maxPages > 100) {
    return NextResponse.json({ error: "pages must be between 1 and 100" }, { status: 400 });
  }

  try {
    const results = await runPull({
      entity: entityParam,
      dryRun,
      resume,
      maxPages,
      since,
    });

    const complete = results.every((r) => r.complete);

    return NextResponse.json({
      ok: true,
      complete,
      dryRun,
      results: results.map((r) => ({
        ...r,
        errors: r.errors.slice(0, 5),
        errorsTruncated: r.errors.length > 5,
      })),
      // Call again with the same params until complete === true.
      next: complete
        ? null
        : `/api/admin/zoho-pull?entity=${entityParam}&pages=${maxPages}&resume=1`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[admin/zoho-pull] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
