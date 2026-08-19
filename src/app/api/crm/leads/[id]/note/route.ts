export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { addNote } from "@/lib/crm";

// Log a note against a lead.
//
// Deliberately NOT modelled on the sibling call-log route's mandatory follow-up
// date. That rule exists because a call that leaves no next date drops the lead
// back into the neglected pile it was just pulled out of. Writing down what
// somebody said is not a call and carries no such obligation, so requiring a
// date here would only train people to pick one at random.
//
// crm.addNote() already does the whole job: the Zoho push (while dual-write is
// on) and the lead_activities row with activity_type "note", which the timeline
// has always known how to render. Until now nothing but the AI chat tool could
// reach it.

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

  const content = String(body.content ?? "").trim();
  if (!content) {
    return NextResponse.json(
      { error: "A note needs something in it.", field: "content" },
      { status: 400 }
    );
  }

  const title = String(body.title ?? "").trim() || "Note";

  try {
    const res = await addNote({
      contactId,
      title,
      content,
      origin: "mission_control",
      actor: session.user.email ?? session.user.name ?? "mission_control",
    });

    if (!res.ok) {
      return NextResponse.json({ error: "failed to save note" }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      contactId: res.contactId,
      activityId: res.activityId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api/crm/leads/note]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
