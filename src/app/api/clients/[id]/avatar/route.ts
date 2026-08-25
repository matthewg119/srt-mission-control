// Which customer this whole build is aimed at. Delivery step 8.
//
// ‼️ THIS ROUTE EXISTS BECAUSE clients.primary_avatar HAD A COLUMN, A CHECK CONSTRAINT AND A
// VERIFIER, AND NO WRITER ANYWHERE.
//
// Exactly the class CLAUDE.md documents for competitor_candidates.selected,
// review_audit_rows.review_count and nap_discrepancies.confirmed_status, and the consequence was
// the same shape and worse: step 11's card said "The proposal is on the board" and there was no
// such panel, on any screen, for any client. On the first real client it came out `skipped`,
// because no human being could have ticked it. page-candidates.ts still carries a comment
// asserting the column "DOES NOT EXIST", which is how long this has been dead.
//
// ‼️ THE SLOT IS CONSTRAINED AND THE LABEL IS NOT, WHICH IS WHY "TYPE A NEW ONE" NEEDS NO
// MIGRATION. clients_primary_avatar_check allows a1 / a2 / a3 and it stays. A typed avatar
// occupies a slot under the label he wrote. Matthew: "always give me the 3 default options and if
// I want a new option allow me to type it in there to create a new one."
//
// ‼️ IT IS ALWAYS A PERSON'S ACT. Nothing schedules this and no runner reaches it. Doctrine:
// confirmed_status, review_count and primary_avatar are written by a human action and by nothing
// else.
//
// AUTHENTICATED. Middleware guards /dashboard/*, not /api/*.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/db";
import { avatarCandidatesFor, confirmAvatar, confirmedAvatarFor, slotForTypedAvatar } from "@/lib/clients/avatars";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const session = await auth().catch(() => null);
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  const [candidates, confirmed] = await Promise.all([
    avatarCandidatesFor(params.id),
    confirmedAvatarFor(params.id),
  ]);

  return NextResponse.json({ ok: true, candidates, confirmed });
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const session = await auth().catch(() => null);
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  const clientId = params.id;
  const actor = session.user.name || session.user.email || "someone";

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request body." }, { status: 400 });
  }

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, day_0_archived_at")
    .eq("id", clientId)
    .maybeSingle();

  if (!client) {
    return NextResponse.json({ ok: false, error: "Client not found." }, { status: 404 });
  }

  const label = String(body.label ?? "").trim();
  if (!label) {
    return NextResponse.json(
      { ok: false, error: "An avatar needs a label. Pick one of the three or type your own." },
      { status: 400 }
    );
  }

  // ‼️ AFTER THE DAY-0 STAMP IT REFUSES, AND THAT IS THE ONE HARD RAIL IN THIS REPO.
  //
  // The custom question set frozen at Day 0 was built against whichever avatar was live then, and
  // it is the baseline the day 30, 60 and 90 numbers are measured against. Changing the target
  // afterwards does not improve the measurement, it destroys the thing being measured. Everything
  // else on the checklist warns and gets out of the way; this refuses, in code, here and in the
  // step 23 thread, and it is the same rule day-zero.ts enforces for publishing.
  const existing = await confirmedAvatarFor(clientId);
  if (client.day_0_archived_at && existing) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Day 0 is archived, so the avatar is frozen. The tracked question set was built against " +
          `${existing.label} and it is what the day 30, 60 and 90 reports are measured against. ` +
          "Changing it now would leave the case study comparing two different questions.",
      },
      { status: 409 }
    );
  }

  // A slot straight off a button; otherwise the slot a typed label lands in.
  const slot =
    typeof body.slot === "string" && body.slot.trim()
      ? body.slot.trim()
      : slotForTypedAvatar(label, (await avatarCandidatesFor(clientId)).candidates);

  const result = await confirmAvatar({ clientId, slot, label, by: actor });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    avatar: result.avatar,
    changed: result.changed ?? false,
    previous: result.previous ?? null,
  });
}
