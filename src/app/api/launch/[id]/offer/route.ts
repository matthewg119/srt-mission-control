// Read the offer out of the short offer document, and lock it.
//
// Same two-verb shape as the vocabulary route, for the same reason: GET proposes and writes
// nothing, POST confirms what a person read. `locked_at` is the half everything downstream treats
// as a decision, so it is only ever set behind a person.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { proposeOfferFromDocument, confirmOffer, currentOffer } from "@/lib/launch/offer";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth().catch(() => null);
  if (!session?.user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  // ?current=1 reads the row; otherwise it proposes, which costs a model call.
  if (new URL(req.url).searchParams.get("current") === "1") {
    return NextResponse.json({ ok: true, offer: await currentOffer(id) });
  }

  const result = await proposeOfferFromDocument(id);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth().catch(() => null);
  if (!session?.user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  let body: { treatment?: unknown; outcomePromise?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }

  const result = await confirmOffer({
    clientId: id,
    treatment: typeof body.treatment === "string" ? body.treatment : "",
    outcomePromise: typeof body.outcomePromise === "string" ? body.outcomePromise : "",
    by: session.user.name ?? session.user.email ?? "the dashboard",
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
