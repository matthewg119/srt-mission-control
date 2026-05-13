import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/sequences/eligibility?list=eligible_fu_new
 *
 * Returns contacts in a given eligibility list with their contact details.
 * If no list param, returns a summary count per list.
 */
export async function GET(req: NextRequest) {
  const listName = req.nextUrl.searchParams.get("list");

  if (!listName) {
    // Return summary counts per list
    const { data, error } = await supabaseAdmin
      .from("sequence_eligibility_lists")
      .select("list_name, computed_at")
      .order("computed_at", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const counts: Record<string, { count: number; computed_at: string }> = {};
    for (const row of (data ?? []) as Array<{ list_name: string; computed_at: string }>) {
      if (!counts[row.list_name]) {
        counts[row.list_name] = { count: 0, computed_at: row.computed_at };
      }
      counts[row.list_name].count++;
    }

    return NextResponse.json({ lists: counts });
  }

  // Return contacts in the specified list with full contact details
  const { data: eligibility, error } = await supabaseAdmin
    .from("sequence_eligibility_lists")
    .select("contact_id, reason_snapshot, computed_at")
    .eq("list_name", listName)
    .order("computed_at", { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (!eligibility || eligibility.length === 0) {
    return NextResponse.json({ contacts: [] });
  }

  const contactIds = eligibility.map((e: { contact_id: string }) => e.contact_id);

  const { data: contacts } = await supabaseAdmin
    .from("contacts")
    .select(
      "id, first_name, last_name, business_name, email, zoho_lead_id, " +
      "portal_app_completed, portal_statements_uploaded, portal_login_count, " +
      "updated_at, created_at"
    )
    .in("id", contactIds);

  const contactMap = new Map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (contacts ?? []).map((c: any) => [c.id as string, c as Record<string, unknown>])
  );

  // Check active enrollments for these contacts
  const { data: enrollments } = await supabaseAdmin
    .from("sequence_enrollments")
    .select("contact_id, sequence_id, status, enrolled_at")
    .in("contact_id", contactIds)
    .in("status", ["active"]);

  const enrolledMap = new Map<string, boolean>();
  for (const e of enrollments ?? []) {
    enrolledMap.set((e as { contact_id: string }).contact_id, true);
  }

  const result = eligibility.map((e: { contact_id: string; reason_snapshot: unknown; computed_at: string }) => ({
    contact: contactMap.get(e.contact_id) ?? null,
    reason_snapshot: e.reason_snapshot,
    computed_at: e.computed_at,
    already_enrolled: enrolledMap.has(e.contact_id),
  }));

  return NextResponse.json({ contacts: result });
}
