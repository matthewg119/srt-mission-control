// /cards/v2 — the card preview with the details asked FIRST.
//
// ‼️ A SIBLING OF /cards/p, NOT A MODE OF IT. Matthew, 2026-10-15: keep the original as it is and
// build a v2 that collects first name, last name, clinic name, email and phone before it shows
// anything, then shows the card and the live walkthrough together on one page, and whose green
// button opens the chat that books the setup call. Public at srtagency.com/referralengine.
//
// ‼️ THE SAME SERVER PIECES AS /cards/p: one QR, one reviews host derivation, one Lockup, one
// insideUrl. Only the client differs. The optional token works the same way too: it prefills what
// the lead already told us and threads the answers under their existing #hot-leads card.
//
// ‼️ NOINDEX, like /cards/p. Traffic is sent here from ads and emails, not found in a search.

import type { Metadata } from "next";
import { DM_Sans, DM_Serif_Display } from "next/font/google";

import { OFFERED_DESIGNS, designByKey } from "@/config/card-designs";
import { PREVIEW_FALLBACK_NAME } from "@/config/card-preview";
import { insideUrl, leadFromCardToken } from "@/lib/cards/preview-link";
import { previewQr, reviewsHostFor } from "@/lib/cards/preview-page";
import { Lockup } from "../../lockup";
import { V2Client } from "../v2-client";
import "../../cards.css";
import "../../p/preview.css";
import "../v2.css";

// No `weight` on DM Sans: it is a variable font and asking for static instances kills the
// production build. See the same note in ../../p/[[...token]]/page.tsx.
const dmSans = DM_Sans({ subsets: ["latin"], variable: "--cd-text", display: "swap" });
const dmSerif = DM_Serif_Display({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--cd-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Your QR referral card",
  description: "Get your clinic's QR referral card.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function CardV2Page({
  params,
  searchParams,
}: {
  params: { token?: string[] };
  searchParams: { d?: string };
}) {
  const token = params.token?.[0] ?? null;
  const lead = await leadFromCardToken(token);

  const requested = typeof searchParams.d === "string" ? searchParams.d : OFFERED_DESIGNS[0];
  const design = designByKey(requested);

  const qrDataUrl = await previewQr(lead ? token : null);

  return (
    <main className={`cd-page ${dmSans.variable} ${dmSerif.variable}`}>
      <Lockup />
      <V2Client
        fallbackName={PREVIEW_FALLBACK_NAME}
        prefill={{
          firstName: lead?.firstName?.trim() || "",
          lastName: lead?.lastName?.trim() || "",
          businessName: lead?.businessName?.trim() || "",
          email: lead?.email?.trim() || "",
        }}
        reviewsHost={reviewsHostFor(lead?.website ?? null)}
        qrDataUrl={qrDataUrl}
        insideSrc={insideUrl(true)}
        initialDesign={design.key}
        token={lead ? token : null}
      />
    </main>
  );
}
