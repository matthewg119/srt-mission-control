// Set the offer, draft the agreement email, or mint the signing link. The board's half of the
// two actions the Slack step card carries.
//
// ‼️ IT CALLS THE SAME FUNCTIONS THE SLACK HANDLER CALLS AND IMPLEMENTS NEITHER OF THEM. Matthew
// asked for both surfaces, and two surfaces with two implementations is two things that drift:
// one of them learns that the free plan has no contract and the other does not. Everything real
// is in src/lib/clients/send-agreement.ts.
//
// AUTHENTICATED. Middleware guards /dashboard/*, not /api/*, so this checks auth() itself, the
// same as every other /api/clients/* route.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/db";
import { isOfferKey } from "@/config/pitch";
import { draftAgreementEmail, mintSigningLink } from "@/lib/clients/send-agreement";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const session = await auth();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? "");

  if (action === "set_offer") {
    const raw = body.offerKey;
    // ‼️ NULL IS ALLOWED AND AN UNKNOWN STRING IS NOT. Clearing the offer back to "not recorded"
    // is a legitimate correction; writing an offer that does not exist would pass the column's
    // CHECK constraint nowhere and fail at the database with an opaque message.
    const offerKey = raw === null || raw === "" ? null : isOfferKey(raw) ? raw : undefined;
    if (offerKey === undefined) {
      return NextResponse.json({ ok: false, error: "unknown offer" }, { status: 400 });
    }
    const { error } = await supabaseAdmin
      .from("clients")
      .update({ offer_key: offerKey })
      .eq("id", id);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, offerKey });
  }

  if (action === "draft") {
    const res = await draftAgreementEmail(id);
    return res.ok
      ? NextResponse.json({ ok: true, webLink: res.webLink })
      : NextResponse.json({ ok: false, error: res.error }, { status: 400 });
  }

  if (action === "link") {
    const res = await mintSigningLink(id);
    return res.ok
      ? NextResponse.json({ ok: true, url: res.url, templateVersion: res.templateVersion })
      : NextResponse.json({ ok: false, error: res.error }, { status: 400 });
  }

  return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
}
