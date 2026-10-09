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
import QRCode from "qrcode";

import { OFFERED_DESIGNS, designByKey } from "@/config/card-designs";
import { PREVIEW_FALLBACK_NAME } from "@/config/card-preview";
import { cardQrTarget, insideUrl, leadFromCardToken } from "@/lib/cards/preview-link";
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

/**
 * Their own future reviews host, for the line under the code.
 *
 * ‼️ DERIVED THE SAME WAY review-card.ts DERIVES IT, which is `reviews.{domain}`. That file
 * prefers the host actually ATTACHED in client_hosts and falls back to this, because a printed QR
 * must not depend on a string staying correct. There is no client and no attached host at this
 * point in the conversation, so the derivation is all there is, and it is the right one to show:
 * it is what their card will say.
 *
 * ‼️ NULL RATHER THAN A GUESS. With no website on the lead there is no honest host to print, and
 * the card omits the line rather than inventing a domain somebody might try to visit.
 */
function reviewsHostFor(website: string | null): string | null {
  const raw = (website || "").trim().toLowerCase();
  if (!raw) return null;
  const bare = raw
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .trim();
  if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(bare)) return null;
  return `reviews.${bare}`;
}

/**
 * The code on the card.
 *
 * ‼️ ONE CODE FOR ALL THREE DESIGNS, BECAUSE THEY ALL POINT AT THE SAME PLACE AND A QR IS ALWAYS
 * DARK ON LIGHT. Rendering one per palette would be three identical images plus a temptation to
 * tint one to match, which is how a code stops scanning. See cardQrTarget for what it resolves to
 * and why that is not what a printed card carries.
 *
 * ‼️ AND IT IS MEMOISED, because the page is force-dynamic and the target is a constant. Without
 * this every visitor pays for an identical 600px PNG to be encoded from scratch. The settings are
 * review-card.ts's own, so the preview's code and the printed one are the same object: error
 * correction M with a quiet margin, which is what survives being scanned in bad light.
 */
let qrOnce: Promise<string> | null = null;
function previewQr(): Promise<string> {
  qrOnce ??= QRCode.toDataURL(cardQrTarget(), {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 600,
    color: { dark: "#0a0a0a", light: "#FFFFFF" },
  });
  return qrOnce;
}

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

  const qrDataUrl = await previewQr();

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
