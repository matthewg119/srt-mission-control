// Which three competitors the review audit and findings section 3 are built from.
//
// ‼️ THIS ROUTE EXISTS BECAUSE NOTHING WROTE competitor_candidates.selected.
// buildShortlist() has written candidates since it shipped and `selected` has always been read
// by the step 7 verifier, the review audit seed and findings.ts. Nothing ever set it. So step 7
// refused forever with "3 candidates on the shortlist, none picked" and a todo reading "Pick
// three on the client board" pointing at a control that did not exist, and step 8 sat behind it,
// and 10 and 18 behind that.
//
// AUTHENTICATED. Middleware guards /dashboard/*, not /api/*, so this route checks the session
// itself, the same pattern as the theme, hub, dns, draft and delivery-step routes.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/db";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const session = await auth().catch(() => null);
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const actor = session.user.name ?? session.user.email ?? null;
  const clientId = params.id;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request" }, { status: 400 });
  }

  if (body.action !== "select") {
    return NextResponse.json({ ok: false, error: "Unknown action." }, { status: 400 });
  }

  const ids = Array.isArray(body.ids) ? body.ids.filter((v): v is string => typeof v === "string") : [];

  // ‼️ CLEAR EVERY ROW FIRST, THEN SET THE CHOSEN ONES. A write that only SETS leaves a
  // competitor selected forever once it has been unticked, which is how a fourth business
  // survives into findings section 3 without anybody choosing it.
  const { error: clearError } = await supabaseAdmin
    .from("competitor_candidates")
    .update({ selected: false, selected_at: null, selected_by: null })
    .eq("client_id", clientId);

  if (clearError) {
    return NextResponse.json({ ok: false, error: clearError.message }, { status: 500 });
  }

  if (ids.length) {
    // Scoped by client_id as well as by id: an id from another client's shortlist must not be
    // writable through this route just because it is a valid uuid.
    const { data: written, error } = await supabaseAdmin
      .from("competitor_candidates")
      .update({
        selected: true,
        selected_at: new Date().toISOString(),
        selected_by: actor,
      })
      .eq("client_id", clientId)
      .in("id", ids)
      .select("id");

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    // An update that matched nothing is not success. Same trap setDeliveryStep documents.
    if ((written?.length ?? 0) !== ids.length) {
      return NextResponse.json(
        {
          ok: false,
          error: `only ${written?.length ?? 0} of ${ids.length} picks belong to this client, so nothing is reliable. Reload the board.`,
        },
        { status: 400 }
      );
    }
  }

  // Seeding the review grid here rather than waiting for step 8's card to be re-posted: it
  // upserts with ignoreDuplicates and never writes a number, so picking the third competitor
  // materialises that competitor's four capture rows immediately and step 8 stops reporting
  // "no review audit rows exist" for a shortlist that has just been chosen.
  //
  // Deliberately NOT setDeliveryStep: picking is not ticking. The step 7 verifier reads
  // `selected` and a person presses Done.
  let seeded: number | null = null;
  try {
    const { seedReviewAudit } = await import("@/lib/clients/review-audit");
    const res = await seedReviewAudit(clientId);
    seeded = res.ok ? res.seeded : null;
  } catch (e) {
    console.error("[clients/competitors] review audit seed failed:", (e as Error).message);
  }

  return NextResponse.json({ ok: true, picked: ids.length, reviewRowsSeeded: seeded });
}
