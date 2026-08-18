// One piece of onboarding evidence, opened.
//
// AUTHENTICATED, and it redirects to a SHORT-LIVED SIGNED URL rather than proxying the
// bytes or handing out a durable link. The `onboarding` bucket is private because it holds
// screenshots of a client's live listings; a permanent URL would undo that the first time
// somebody pasted one into a message.
//
// The docId is checked against the client in the path, so a valid session for one client's
// board cannot read another client's evidence by swapping a uuid.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/db";
import { signedDocUrl } from "@/lib/clients/onboarding-docs";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(
  _req: Request,
  { params }: { params: { id: string; docId: string } }
): Promise<NextResponse> {
  const session = await auth().catch(() => null);
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // Belongs-to check. Without it the docId alone would be the credential.
  const { data: doc } = await supabaseAdmin
    .from("client_docs")
    .select("id")
    .eq("id", params.docId)
    .eq("client_id", params.id)
    .maybeSingle();

  if (!doc) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  const url = await signedDocUrl(params.docId);
  if (!url) {
    return NextResponse.json(
      { ok: false, error: "That file has no stored object behind it." },
      { status: 404 }
    );
  }

  return NextResponse.redirect(url);
}
