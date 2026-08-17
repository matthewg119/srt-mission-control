export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { parseBusinessDate } from "@/lib/business-time";
import { logCall, setLeadStatus } from "@/lib/crm";

// Log a call against a lead.
//
// THE FOLLOW-UP DATE IS MANDATORY. This route returns 400 without one, the
// log_call chat tool refuses without one, and the call form disables Save
// without one — three enforcement points for one rule, because it is the rule
// the whole call board depends on. A lead with no open follow-up task is
// exactly what /dashboard/worklist surfaces as neglected, so a call that
// leaves no next date silently drops that lead into the pile it was just
// pulled out of.

const VALID_OUTCOMES = [
  "connected",
  "voicemail",
  "no_answer",
  "bad_number",
  "not_interested",
  "booked",
];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth().catch(() => null);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: contactId } = await params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const outcome = String(body.outcome ?? "").trim();
  if (!VALID_OUTCOMES.includes(outcome)) {
    return NextResponse.json(
      { error: `outcome must be one of: ${VALID_OUTCOMES.join(", ")}` },
      { status: 400 }
    );
  }

  const raw = String(body.next_follow_up_date ?? "").trim();
  if (!raw) {
    return NextResponse.json(
      {
        error: "A follow-up date is required on every logged call.",
        field: "next_follow_up_date",
      },
      { status: 400 }
    );
  }

  // A bare date lands at 9am ET, not midnight — otherwise a follow-up set "for
  // Friday" reads as overdue for the whole of Friday morning. Vercel's clock is
  // UTC, so "local" had to become explicit; see src/lib/business-time.ts.
  const followUp = parseBusinessDate(raw);
  if (!followUp) {
    return NextResponse.json(
      { error: "next_follow_up_date is not a valid date", field: "next_follow_up_date" },
      { status: 400 }
    );
  }

  const actor = session.user.email ?? session.user.name ?? "mission_control";
  const durationMinutes = Number(body.duration_minutes);

  try {
    const res = await logCall({
      contactId,
      outcome,
      nextFollowUpAt: followUp,
      notes: body.notes ? String(body.notes) : undefined,
      durationSecs: Number.isFinite(durationMinutes)
        ? Math.round(durationMinutes * 60)
        : undefined,
      nextStep: body.next_step ? String(body.next_step) : undefined,
      actor,
      origin: "mission_control",
    });

    if (!res.ok) {
      return NextResponse.json({ error: res.error ?? "failed to log call" }, { status: 500 });
    }

    // Optional status move in the same submit, so working a lead is one action.
    let statusResult = null;
    if (body.status) {
      statusResult = await setLeadStatus({
        contactId,
        status: String(body.status),
        reason: `Call outcome: ${outcome}`,
        origin: "mission_control",
        actor,
      });
    }

    return NextResponse.json({
      ok: true,
      contactId,
      activityId: res.activityId,
      taskId: res.taskId,
      followUpAt: followUp.toISOString(),
      statusResult,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api/crm/leads/call-log]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
