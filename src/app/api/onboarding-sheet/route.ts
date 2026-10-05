// The printed setup sheet, on demand, for the call that is about to happen.
//
// ‼️ IT GENERATES FRESH BYTES AND FILES NOTHING, WHICH IS WHAT KEEPS THE CHAT TOOL A READ.
// storeGeneratedDoc() would have worked and was rejected: its own header says it is "NOT
// IDEMPOTENT, ON PURPOSE", so every time Matthew asked for the sheet it would file another
// client_docs row and another storage object. A blank form is not evidence of anything. It would
// also need a delivery_step_key, and there is no honest value for a clinic that is ABOUT to be
// onboarded. client-tools.ts says every client tool is a read; this is how that stays true.
//
// ‼️ TWO MODES, AND THE SECOND ONE IS THE POINT. `?client=` prefills from the clients row.
// `?clinic=` renders a blank sheet with a typed name on the masthead and TOUCHES NO DATABASE --
// the same path scripts/_onboarding-sheet.ts --blank takes. "I am about to onboard Med Spa 123"
// usually means there is no clients row yet, so a tool that could only do the first mode would
// fail on the exact sentence it was built for.
//
// ‼️ BEHIND THE DASHBOARD SESSION, like every other file-returning GET here. The precedent and
// the reasoning are in src/app/api/clients/[id]/hub/export/route.ts: the document is about a
// client, but the person downloading it is SRT, and a tokenless GET is the shape of a scraper.

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { resolveClient } from "@/lib/clients/client-reads";

// jsPDF, so never the edge runtime. The same declaration api/onboarding2/document/[id] carries.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// supabase-js calls the global fetch, which Next patches, so the prefill read would otherwise
// land in the DATA cache. The sheet is printed and written on during a call: a prefill that is
// minutes stale is a clinic name or a service list somebody reads aloud as current.
export const fetchCache = "force-no-store";

export async function GET(req: Request): Promise<NextResponse> {
  const session = await auth().catch(() => null);
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const clientRef = (url.searchParams.get("client") ?? "").trim();
  const sheet = await import("@/lib/clients/artifacts/onboarding-sheet");

  // ‼️ CLAMPED BEFORE IT IS DRAWN, AND THAT IS WHY THIS ROUTE EXISTS AS THE ONLY TYPED-NAME
  // PATH. The masthead and the page-2 running header draw the name with a bare doc.text(); see
  // MAX_CLINIC_NAME in the sheet module for the measurement. A chat message is caller-controlled
  // text, so an unclamped name would run through the "Date" rule beside it and off the paper.
  const clinicParam = sheet.clampClinicName(url.searchParams.get("clinic") ?? "");

  if (clientRef) {
    const found = await resolveClient(clientRef);
    // ‼️ AMBIGUITY IS A 400 HERE AND A QUESTION IN THE TOOL. The assistant resolves first and
    // builds this URL with a uuid, so reaching this branch means somebody typed the link by
    // hand. Picking one of two clinics would hand them the wrong clinic's sheet, which is the
    // one failure this whole resolve path exists to prevent.
    if (!found.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: found.error,
          candidates: found.candidates.map((c) => ({ name: c.name, slug: c.slug })),
        },
        { status: 400 }
      );
    }

    // The resolved name travels as the FALLBACK, so a prefill read that fails cannot hand back a
    // sheet mastheaded "Clinic" for a client we just looked up by name.
    const buffer = await sheet.generateOnboardingSheet(found.client.id, {
      clinicName: found.client.name,
    });
    return fileResponse(sheet.sheetFilename(found.client.slug ?? found.client.name), buffer);
  }

  if (clinicParam) {
    // No database at all on this path. See the header.
    const buffer = sheet.renderOnboardingSheet({
      clinicName: clinicParam,
      services: [],
      bookingSoftware: null,
      reviewPlatform: null,
    });
    return fileResponse(sheet.sheetFilename(clinicParam), buffer);
  }

  return NextResponse.json(
    { ok: false, error: "Name a client (?client=slug) or a clinic (?clinic=Med Spa 123)." },
    { status: 400 }
  );
}

/**
 * ‼️ attachment, ALWAYS, AND THE FILENAME IS QUOTED. hub/export/route.ts's helper, same
 * reasoning: a header built by concatenation is a header somebody eventually gets to write.
 */
function fileResponse(filename: string, body: Buffer): NextResponse {
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, "-");
  // Buffer is a Uint8Array view, and NextResponse's BodyInit does not accept Node's Buffer type
  // directly under this TS lib. The bytes are the same; only the declared type changes.
  const bytes = new Uint8Array(body);
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${safe}"`,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
