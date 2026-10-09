// One place that turns a lead into printable card bytes.
//
// ‼️ IT EXISTS SO THE DOWNLOAD AND THE EMAIL CANNOT DIVERGE. /api/cards/pdf streams it and
// /api/cards/preview attaches it; two call sites each assembling their own arguments is how a
// clinic ends up with one card on screen and a different one in their inbox. Everything that
// decides what the card looks like is decided here, once.
//
// ‼️ IT NEVER THROWS. Both callers treat a null as "no attachment" or "500 once", and neither
// should lose a lead because jsPDF had a bad day.

import { CARD_COPY_SETS, PREVIEW_FALLBACK_NAME } from "@/config/card-preview";
import { designByKey } from "@/config/card-designs";
import { renderLeadCard } from "./card-pdf";
import { cardQrTarget } from "./preview-link";

/** A filename a clinic can find again in their downloads folder. */
export function cardFilename(clinicName: string): string {
  const slug =
    clinicName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "clinic";
  return `SRT-referral-card-${slug}.pdf`;
}

export interface RenderedCard {
  filename: string;
  bytes: Buffer;
  clinicName: string;
}

/**
 * The card for one lead, or null.
 *
 * ‼️ THE TOKEN IS ONLY PASSED IN WHEN IT ALREADY VERIFIED. A card printed with somebody else's
 * code is worse than one printed with the demo's, so callers resolve the lead first and hand over
 * the token only then.
 *
 * ‼️ IT RENDERS THE CARD THEY LOOKED AT: the blush design, the offer wording, their name. Not
 * renderReviewCard, which is the delivery board's midnight card; see the header of card-pdf.ts for
 * why those are two renderers and what stops them drifting.
 */
export async function renderCardForLead(args: {
  clinicName: string | null;
  token: string | null;
}): Promise<RenderedCard | null> {
  const clinicName = args.clinicName?.trim() || PREVIEW_FALLBACK_NAME;
  try {
    const design = designByKey("blush");
    const bytes = await renderLeadCard({
      clinicName,
      scanUrl: cardQrTarget(args.token),
      copy: CARD_COPY_SETS[design.copy],
      design,
    });
    return { filename: cardFilename(clinicName), bytes, clinicName };
  } catch (e) {
    console.error("[cards/render-card] render failed:", (e as Error).message);
    return null;
  }
}
