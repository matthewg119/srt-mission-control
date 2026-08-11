// Public layout for the med spa AEO funnel.
//
// Served at srtagency.com/webflow-Aivisibility through a Vercel rewrite in the
// srt-agwb repo, exactly like /scan. Nothing here knows about that domain, which is
// why each page hardcodes its own canonical.
//
// NO auth check needed: src/middleware.ts matches only /dashboard/:path*, so this
// subtree is open by design, same as /scan and /r/[slug]. It is also un-chromed for
// the same structural reason, the sidebar lives in dashboard/layout.tsx.
//
// Applies BOTH .scan-root (the token block, from scan.css) and .medspa-root, the
// /v2 composition. funnel.css therefore declares layout only and never re-declares a
// token. Two traps that scan.css already solves and this inherits for free:
//   - the root layout hard-sets font-family INLINE on <body>, which beats any class,
//     so .scan-root re-declares it;
//   - globals.css paints body #0B1426, which shows through on overscroll, so
//     `body:has(.scan-root)` repaints it.

import type { Metadata } from "next";
import Script from "next/script";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { PIXEL_ID } from "@/config/medspa-funnel";
import "../scan/scan.css";
import "./funnel.css";

export const metadata: Metadata = {
  title: "The 20 Questions Your Patients Ask ChatGPT | SRT Agency",
  description:
    "A free training for med spa owners on how AI search decides which clinics it names.",
  // The whole subtree stays out of the index. This is a paid-traffic funnel, not a
  // page we want ranking, and /training is somebody's private seat.
  robots: { index: false, follow: false },
};

export default function MedspaFunnelLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`scan-root medspa-root ${GeistSans.variable} ${GeistMono.variable}`}>
      {/*
        The base pixel, byte-identical to every other srtagency funnel. It fires
        PageView unconditionally ON PURPOSE: PageView is the pixel's baseline and is
        what sets the _fbp cookie in the first place, so gating it would break the
        thing the gate reads. The attribution rule applies to the CONVERSION events
        (ViewContent, Lead, InitiateCheckout, Purchase), which go through
        track() in src/lib/medspa/pixel.ts and fire only on a real ad click.
      */}
      <Script id="medspa-pixel" strategy="afterInteractive">
        {`!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${PIXEL_ID}');
fbq('track', 'PageView');`}
      </Script>
      {children}
    </div>
  );
}
