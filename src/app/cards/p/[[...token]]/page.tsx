// /cards/p — what a lead is sent the moment they say "yes, I am interested".
//
// ‼️ AN OPTIONAL CATCH-ALL, SO THE PAGE HAS TWO LIVES AND ONE IMPLEMENTATION.
//   /cards/p            the generic version. Names no business, reads no row. This is the URL
//                       Matthew records the onboarding video against, and it has to look
//                       finished rather than look like a template with the fields showing.
//   /cards/p/<token>    the same screens wearing one lead's name, minted from their own
//                       #hot-leads thread. See src/lib/cards/preview-link.ts.
// The same precedent /dashboard/clients/[id]/preview/[[...slug]] set, for the same reason: two
// routes would be two pages that have to be edited together.
//
// ‼️ NOINDEX, like /cards. It is the middle of an outbound conversation, not a landing page, and
// a clinic finding it in a search result would arrive with no idea what the cards are.
//
// ‼️ EVERY REFUSAL RENDERS THE GENERIC PAGE RATHER THAN AN ERROR. A bad signature, an expired
// link and a deleted contact all resolve to null, and a page that says "this link is invalid" to
// somebody we asked to click it is a worse outcome than a page that simply does not know their
// name. Nothing behind the token is private enough to be worth a dead end: it is a business name
// and a town, and the thing on the other side is a demo.

import type { Metadata } from "next";
import { DM_Sans, DM_Serif_Display } from "next/font/google";

import { OFFERED_DESIGNS, designByKey } from "@/config/card-designs";
import { PREVIEW_FALLBACK_NAME } from "@/config/card-preview";
import { insideUrl, leadFromCardToken } from "@/lib/cards/preview-link";
import { previewQr, reviewsHostFor } from "@/lib/cards/preview-page";
import { Lockup } from "../../lockup";
import { PreviewClient } from "../preview-client";
import "../../cards.css";
import "../preview.css";

// ‼️ NO `weight` ON DM Sans, AND THE PRODUCTION BUILD IS WHY. It is a VARIABLE font with an
// optical-size axis as well as a weight axis, so asking next/font for static instances Google does
// not serve throws out of the loader and kills the deploy in 36 seconds after building green
// locally. That happened on 2026-10-07; see the same note in ../../page.tsx. DM Serif Display
// keeps its weight because it is a static single-weight family.
const dmSans = DM_Sans({ subsets: ["latin"], variable: "--cd-text", display: "swap" });
const dmSerif = DM_Serif_Display({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--cd-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Your QR referral cards",
  description: "The card your patients scan, and the page they land on.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function CardPreviewPage({
  params,
  searchParams,
}: {
  params: { token?: string[] };
  searchParams: { d?: string };
}) {
  // One segment, and only the first. /cards/p/a/b is a typo, not a second parameter.
  const token = params.token?.[0] ?? null;
  const lead = await leadFromCardToken(token);

  // ‼️ NARROWED AGAINST THE REGISTRY AND NEVER INTERPOLATED. ?d= reaches a palette and a layout
  // name, both of which end up in markup; designByKey falls back rather than throwing, so a
  // mistyped link opens on the first offered design instead of a 500.
  const requested = typeof searchParams.d === "string" ? searchParams.d : OFFERED_DESIGNS[0];
  const design = designByKey(requested);

  const qrDataUrl = await previewQr(lead ? token : null);

  return (
    <main className={`cd-page ${dmSans.variable} ${dmSerif.variable}`}>
      <Lockup />
      <PreviewClient
        clinicName={lead?.businessName?.trim() || PREVIEW_FALLBACK_NAME}
        reviewsHost={reviewsHostFor(lead?.website ?? null)}
        qrDataUrl={qrDataUrl}
        insideSrc={insideUrl(true)}
        initialDesign={design.key}
        token={token}
      />
    </main>
  );
}
