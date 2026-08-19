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
import { waitUntil } from "@vercel/functions";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
// The step tick below can cascade into generators. 60s is generous for what is normally a
// no-op (every entry after the first) but the FIRST entry unblocks a step and runs the chain.
export const maxDuration = 60;

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

  // ‼️ THE STEP IS TICKED HERE, BY THE ROUTE THAT MAKES IT TRUE, NOT BY A RUNNER.
  //
  // Delivery step 31 is "Time log has entries from day 0". That is a PREDICATE about ongoing
  // behaviour, not a document to generate, and runReadyAutoSteps is built for generators: it
  // calls a runner once and parks a failure in `error` where nothing retries it. A runner here
  // would run the moment day_zero_archive cleared, find no entries, and sit permanently in
  // `error` saying "none yet" — a checklist reporting a failure for work that simply had not
  // happened yet. registry.ts's ROUTE_COMPLETED exists for exactly this shape.
  //
  // Deferred rather than awaited: the entry is saved either way, and a Slack or checklist
  // hiccup must not turn a successful save into a 500.
  //
  // waitUntil, NOT a bare void promise. Vercel may freeze the function the moment the response
  // returns, which would drop the tick silently — the same reason setDeliveryStep awaits its
  // own cascade rather than firing and forgetting.
  waitUntil(
    (async () => {
      const { autoCompleteStep } = await import("@/lib/clients/delivery-checklist");
      const { data: step } = await supabaseAdmin
        .from("client_delivery_steps")
        .select("status")
        .eq("client_id", id)
        .eq("step_key", "time_log_entries")
        .maybeSingle();

      // Only the first entry does anything. Re-ticking a complete step would re-run the whole
      // cascade on every single time entry somebody logs.
      if (!step || step.status === "complete" || step.status === "skipped") return;

      await autoCompleteStep(id, "time_log_entries", ":white_check_mark: Time log has its first entry.");
    })().catch((e) => console.error("[clients/time-log] step tick failed:", (e as Error).message))
  );

  return NextResponse.json({ ok: true });
}
