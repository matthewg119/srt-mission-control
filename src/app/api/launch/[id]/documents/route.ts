// Upload one of the four foundation documents.
//
// Multipart, because these are files: a PDF, a .docx, a .md. The text is extracted here, stored
// as the framework document AND filed in the client evidence library, which is what replaces the
// website crawl for a client who has no website. See src/lib/launch/documents.ts.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/db";
import { ingestFoundationDocument, isFoundationKind, foundationStatus } from "@/lib/launch/documents";
import { kindBelongsToOffer, type DocumentKind } from "@/lib/clients/audience-documents";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/** Comfortably above a long research PDF and well under the body limit. */
const MAX_BYTES = 20 * 1024 * 1024;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth().catch(() => null);
  if (!session?.user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const status = await foundationStatus(id);
  if (status === null) {
    return NextResponse.json({ ok: false, error: "The documents could not be read." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, documents: status });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth().catch(() => null);
  if (!session?.user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Send this as multipart form data." }, { status: 400 });
  }

  const kind = String(form.get("kind") ?? "");
  if (!isFoundationKind(kind)) {
    return NextResponse.json(
      { ok: false, error: `"${kind}" is not one of the four foundation documents.` },
      { status: 400 }
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "No file was attached." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { ok: false, error: `That file is ${Math.round(file.size / 1024 / 1024)}MB. The limit is 20MB.` },
      { status: 400 }
    );
  }

  // ‼️ THE ADDRESS IS RESOLVED HERE AND NOT TAKEN FROM THE REQUEST.
  // audience_documents is keyed on (audience, offer, kind), and a caller-supplied audience id
  // would let one client's document be filed against another client's audience. Both are read
  // from this client's own rows.
  const { data: audience, error: audErr } = await supabaseAdmin
    .from("client_audiences")
    .select("id")
    .eq("client_id", id)
    .eq("is_primary", true)
    .maybeSingle();

  if (audErr) {
    return NextResponse.json({ ok: false, error: `Audiences unreadable: ${audErr.message}` }, { status: 500 });
  }
  if (!audience) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "This client has no audience yet, and a document is filed against one. Confirm the " +
          "audience first. The deep research and avatar sheet are what the proposal reads, so " +
          "upload those two after the audience exists and the rest follows.",
      },
      { status: 409 }
    );
  }

  let offerId: string | null = null;
  if (kindBelongsToOffer(kind as DocumentKind)) {
    const { data: offer } = await supabaseAdmin
      .from("client_offers")
      .select("id")
      .eq("client_id", id)
      .eq("is_primary", true)
      .maybeSingle();
    if (!offer) {
      return NextResponse.json(
        {
          ok: false,
          error: `The ${kind.replace(/_/g, " ")} hangs off an offer, and this client has none yet.`,
        },
        { status: 409 }
      );
    }
    offerId = offer.id as string;
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const result = await ingestFoundationDocument({
    clientId: id,
    audienceId: audience.id as string,
    offerId,
    kind,
    filename: file.name,
    contentType: file.type || "application/octet-stream",
    bytes,
    by: session.user.name ?? session.user.email ?? "the dashboard",
  });

  if (!result.ok) return NextResponse.json(result, { status: 400 });
  return NextResponse.json(result);
}
