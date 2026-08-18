export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/db";
import { updateLeadFields } from "@/lib/crm";
import { CONTACT_EDITABLE_COLUMNS } from "@/lib/field-map";
import { normalizeLeadPhone } from "@/lib/phone";

// One lead, everything about it: profile, open follow-ups, and the timeline.
//
// The PATCH allowlist is DERIVED from CONTACT_FIELD_MAP rather than typed out.
// The hand-listed version in /api/contacts/[id] drifted — it permits
// address_street, credit_score_range, funding_amount_requested, ownership_pct
// and ssn_last4, none of which are real columns (they are biz_address,
// credit_score, amount_needed, ownership, ssn4), so edits to those fields
// silently did nothing. Deriving the list means it cannot drift again.
//
// application_stage is deliberately NOT editable here — status goes through
// crm.setLeadStatus so it gets history, echo suppression and a Zoho push.

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth().catch(() => null);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const [contactRes, tasksRes, activitiesRes, historyRes] = await Promise.all([
    supabaseAdmin.from("contacts").select("*").eq("id", id).maybeSingle(),
    supabaseAdmin
      .from("lead_tasks")
      .select("*")
      .eq("contact_id", id)
      .order("status", { ascending: true })
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(50),
    supabaseAdmin
      .from("lead_activities")
      .select("*")
      .eq("contact_id", id)
      .order("occurred_at", { ascending: false })
      .limit(200),
    supabaseAdmin
      .from("lead_status_history")
      .select("*")
      .eq("contact_id", id)
      .order("occurred_at", { ascending: false })
      .limit(50),
  ]);

  if (!contactRes.data) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  // Strip the fields nobody needs in a browser payload.
  const contact = { ...(contactRes.data as Record<string, unknown>) };
  delete contact.ssn_full;

  return NextResponse.json({
    ok: true,
    lead: contact,
    tasks: tasksRes.data ?? [],
    activities: activitiesRes.data ?? [],
    statusHistory: historyRes.data ?? [],
    editableFields: CONTACT_EDITABLE_COLUMNS,
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth().catch(() => null);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  for (const col of CONTACT_EDITABLE_COLUMNS) {
    if (body[col] !== undefined) patch[col] = body[col] === "" ? null : body[col];
  }

  // A number typed by hand is a number typed by hand, whether it arrives from a
  // public funnel or from the lead form. Both go through the same door, or the
  // three-shapes-per-human problem that phone_last10 exists to clean up walks
  // straight back in through the CRM. normalizeLeadPhone never returns empty for
  // non-empty input, so a number that will not parse is stored, not dropped.
  for (const col of ["phone", "mobile_phone"] as const) {
    if (typeof patch[col] === "string") {
      const normalized = normalizeLeadPhone(patch[col] as string);
      patch[col] = normalized === "" ? null : normalized;
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: "No editable fields supplied", editableFields: CONTACT_EDITABLE_COLUMNS },
      { status: 400 }
    );
  }

  const res = await updateLeadFields({
    contactId: id,
    patch,
    origin: "mission_control",
    actor: session.user.email ?? "mission_control",
  });

  if (!res.ok) {
    return NextResponse.json({ error: res.error ?? "update failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, updated: Object.keys(patch) });
}
