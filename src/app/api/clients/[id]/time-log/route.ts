// A timing log entry.
//
// AUTHENTICATED: middleware guards /dashboard/*, not /api/*.
//
// The category list is duplicated as a constant here rather than imported from the
// client component, so a browser cannot post a category the database will reject and
// get a 500 for it. The database check constraint is still the real authority; this is
// just the polite failure in front of it.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/db";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const CATEGORIES = new Set([
  "baseline_retest",
  "pages_new",
  "pages_refresh",
  "review_tool_setup",
  "review_responses",
  "outreach",
  "reporting_video",
  "client_comms",
  "implementation",
]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth().catch(() => null);
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }

  const taskCategory = typeof body.taskCategory === "string" ? body.taskCategory : "";
  const minutes = Number(body.minutes);
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";

  if (!CATEGORIES.has(taskCategory)) {
    return NextResponse.json({ ok: false, error: "Unknown category." }, { status: 400 });
  }
  if (!Number.isInteger(minutes) || minutes <= 0 || minutes > 1440) {
    return NextResponse.json(
      { ok: false, error: "Minutes must be a whole number between 1 and 1440." },
      { status: 400 }
    );
  }

  const { error } = await supabaseAdmin.from("time_log").insert({
    client_id: id,
    task_category: taskCategory,
    minutes,
    note: note || null,
    logged_by: session.user.email ?? session.user.name ?? null,
  });

  if (error) {
    console.error("[clients/time-log] insert failed:", error.message);
    return NextResponse.json({ ok: false, error: "That did not save." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
