export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { parseBusinessDate } from "@/lib/business-time";
import { supabaseAdmin } from "@/lib/db";
import { completeTask, createTask, logActivity } from "@/lib/crm";

// Complete or reschedule a follow-up.
//
// Completing a task on a still-live lead can leave it with zero open
// follow-ups, which is exactly the state the call board flags. So the response
// carries a `warning` when that happens, and accepts next_follow_up_date to
// close and re-schedule in one call.

/**
 * A live lead with no open follow-up is the state the call board flags as
 * neglected. Both closing paths have to report it the same way.
 */
async function neglectWarning(contactId: string | undefined): Promise<string | undefined> {
  if (!contactId) return undefined;
  const { data } = await supabaseAdmin
    .from("contacts")
    .select("open_task_count, working_state")
    .eq("id", contactId)
    .maybeSingle();
  if (data && data.working_state !== "closed" && (data.open_task_count ?? 0) === 0) {
    return "This lead now has no follow-up scheduled and will show on the call board as neglected.";
  }
  return undefined;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const session = await auth().catch(() => null);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { taskId } = await params;
  const actor = session.user.email ?? "mission_control";

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = String(body.action ?? "complete");

  if (action === "reschedule") {
    const raw = String(body.due_at ?? "").trim();
    // parseBusinessDate resolves a bare date to 9am ET, matching every
    // follow-up the call-log form writes. A raw `T09:00:00` would be 5am ET.
    const dueAt = raw ? parseBusinessDate(raw) : null;
    if (!dueAt) {
      return NextResponse.json({ error: "due_at is required and must be valid" }, { status: 400 });
    }
    const { error } = await supabaseAdmin
      .from("lead_tasks")
      .update({ due_at: dueAt.toISOString(), updated_at: new Date().toISOString() })
      .eq("id", taskId)
      .eq("status", "open");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, dueAt: dueAt.toISOString() });
  }

  if (action === "cancel") {
    // Cancelling drops a lead into the neglected bucket exactly as completing
    // does, so it owes the same two things: a trace on the timeline, and the
    // warning. Without them a dismissed follow-up left no record anywhere that
    // the lead had stopped being worked.
    const { data: existing } = await supabaseAdmin
      .from("lead_tasks")
      .select("contact_id, deal_id, title")
      .eq("id", taskId)
      .maybeSingle();

    const { error } = await supabaseAdmin
      .from("lead_tasks")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", taskId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    if (existing?.contact_id) {
      await logActivity({
        contactId: existing.contact_id as string,
        dealId: (existing.deal_id as string | null) ?? null,
        activityType: "task_cancelled",
        direction: "internal",
        subject: existing.title as string,
        body: "Follow-up dismissed",
        actor,
        source: "mission_control",
        metadata: { taskId },
      });
    }

    return NextResponse.json({
      ok: true,
      status: "cancelled",
      contactId: existing?.contact_id ?? null,
      warning: await neglectWarning(existing?.contact_id as string | undefined),
    });
  }

  const res = await completeTask(taskId, {
    actor,
    outcome: body.outcome ? String(body.outcome) : undefined,
  });
  if (!res.ok) {
    return NextResponse.json({ error: res.error ?? "failed to complete task" }, { status: 500 });
  }

  let nextTask = null;
  const raw = String(body.next_follow_up_date ?? "").trim();
  if (raw && res.contactId) {
    const next = parseBusinessDate(raw);
    if (next) {
      nextTask = await createTask({
        contactId: res.contactId,
        title: body.next_title ? String(body.next_title) : "Follow up",
        dueAt: next,
        origin: "mission_control",
        actor,
      });
    }
  }

  // Tell the caller if this lead just fell into the neglected bucket.
  const warning = nextTask ? undefined : await neglectWarning(res.contactId ?? undefined);

  return NextResponse.json({ ok: true, contactId: res.contactId, nextTask, warning });
}
