// Tick, skip or reopen one Launch Lane step, and record a note against it.
//
// ‼️ THE REFUSAL IS THE PRODUCT, NOT AN ERROR. setLaunchStep() verifies BEFORE it writes and
// writes nothing on a refusal, so a 400 here carries the verdict and the route hands it back
// whole. The surface renders `todo` for work that is owed and `fix` for a code fault, because
// re-checking a code fault only reproduces it.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/db";
import { setLaunchStep } from "@/lib/launch/steps";
import { refusalText } from "@/lib/launch/verify";
import { isLaunchStepKey } from "@/config/launch-steps";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const TRANSITIONS = new Set(["complete", "skipped", "reopened"]);

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth().catch(() => null);
  if (!session?.user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  let body: { stepKey?: unknown; transition?: unknown; skippedReason?: unknown; note?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }

  const stepKey = typeof body.stepKey === "string" ? body.stepKey : "";
  if (!isLaunchStepKey(stepKey)) {
    return NextResponse.json({ ok: false, error: `"${stepKey}" is not a Launch Lane step.` }, { status: 400 });
  }

  const actor = session.user.name ?? session.user.email ?? "the dashboard";

  // A note is stored without touching the step's status. day_30_date's verifier reads it, which
  // is how a date gets recorded on a lane that has no thread to type it into.
  if (typeof body.note === "string") {
    const note = body.note.trim().slice(0, 2000);
    const { error } = await supabaseAdmin
      .from("client_launch_steps")
      .update({ note: note || null, updated_at: new Date().toISOString() })
      .eq("client_id", id)
      .eq("step_key", stepKey);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    if (body.transition === undefined) return NextResponse.json({ ok: true, noted: true });
  }

  const transition = typeof body.transition === "string" ? body.transition : "";
  if (!TRANSITIONS.has(transition)) {
    return NextResponse.json(
      { ok: false, error: "`transition` must be complete, skipped or reopened." },
      { status: 400 }
    );
  }

  const result = await setLaunchStep({
    clientId: id,
    stepKey,
    transition: transition as "complete" | "skipped" | "reopened",
    skippedReason: typeof body.skippedReason === "string" ? body.skippedReason.slice(0, 500) : null,
    actor,
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: result.error,
        // The whole verdict, so the surface can show what was checked and what to do about it,
        // and can tell "there is work to do" from "this check is broken".
        verdict: result.verdict ?? null,
        detail: result.verdict ? refusalText(result.verdict) : null,
      },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true, verdict: result.verdict ?? null });
}
