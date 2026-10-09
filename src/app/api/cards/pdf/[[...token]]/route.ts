// The clinic's own printable card, generated on demand.
//
// ‼️ IT IS THE SAME RENDERER THE DELIVERY BOARD USES, NOT A SECOND ONE. renderReviewCard() was
// already a pure function taking a name, a URL and an accent; `generateReviewCard(clientId)` is
// only its database wrapper. A lead has no clients row, so renderCardForLead calls the pure half
// directly. A second card generator would be two things to keep in step with CARD_QUESTIONS, and
// the back of this card is those questions.
//
// ‼️ AND THE ARGUMENTS LIVE IN renderCardForLead, NOT HERE. /api/cards/preview attaches the same
// card to the confirmation email, so two call sites each assembling their own accent, copy set
// and scan URL is how the download and the attachment quietly stop being the same object.
//
// ‼️ PUBLIC, AND IT HAS TO BE. The clinic taps a button in a funnel; there is no session and
// there must not be one. What the token buys is the NAME on the card. Without one, or with a
// forged one, the card still renders with the placeholder name and the demo's scan URL, which is
// a brochure rather than a leak: everything it contains is on the public preview page already.
//
// ‼️ NOTHING IS STORED AND NOTHING IS FILED. deliverArtifact writes client_docs rows against a
// clients row, and there is none. This streams bytes and ends.

import { NextRequest, NextResponse } from "next/server";

import { leadFromCardToken } from "@/lib/cards/preview-link";
import { renderCardForLead } from "@/lib/cards/render-card";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { token?: string[] } }
): Promise<NextResponse> {
  // One segment, and only the first. /api/cards/pdf/a/b is a typo, not a second parameter.
  const token = params.token?.[0] ?? null;
  const lead = await leadFromCardToken(token);

  // ‼️ THE TOKEN IS ONLY PASSED ON IF IT VERIFIED. A card printed with somebody else's code is
  // worse than one printed with the demo's.
  const card = await renderCardForLead({
    clinicName: lead?.businessName ?? null,
    token: lead ? token : null,
  });

  if (!card) {
    return NextResponse.json({ ok: false, error: "The card could not be made." }, { status: 500 });
  }

  return new NextResponse(new Uint8Array(card.bytes), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      // `attachment`, so a tap downloads it rather than opening a viewer the clinic then has to
      // work out how to save from. The funnel's button says download and this is what makes that
      // word true.
      "content-disposition": `attachment; filename="${card.filename}"`,
      // A card is regenerated in milliseconds and a stale one is a wrong name on card stock.
      "cache-control": "no-store",
    },
  });
}
