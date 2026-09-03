// The /onboarding2 subtree. Base pixel, and nothing else.
//
// No CSS file. /chatgpt-ads and /onboardingfree both render black-on-reef with plain Tailwind
// literals and no layout of their own, and this page is one tap from the same brand. Adding a
// stylesheet here would mean re-learning the two traps webflow-aivisibility/layout.tsx documents
// (the root layout hard-sets font-family inline on body, and globals.css paints the overscroll
// background) for no gain.

import type { Metadata } from "next";
import Script from "next/script";
import { PIXEL_ID } from "@/config/medspa-funnel";

export const metadata: Metadata = {
  title: "Onboarding | SRT Agency",
  // Restated here rather than assumed. The root layout sets it for the whole host, but page and
  // layout metadata beat layout metadata further up, and this is a paid-traffic funnel carrying
  // a contract. /chatgpt-ads and /onboardingfree restate it for the same reason.
  robots: { index: false, follow: false },
};

export default function Onboarding2Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/*
        Byte-identical to every other srtagency funnel. PageView fires UNCONDITIONALLY on
        purpose: it is what sets the _fbp cookie in the first place, so gating it would break
        the thing the gate reads. The attribution rule applies to the CONVERSION events, which
        go through track() in src/lib/medspa/pixel.ts and fire only with fbc or fbclid present.
      */}
      <Script id="onboarding2-pixel" strategy="afterInteractive">
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
    </>
  );
}
