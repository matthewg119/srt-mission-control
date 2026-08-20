// Public layout for /LHR, the med spa and laser hair removal funnel.
//
// Served at srtagency.com/LHR through a Vercel rewrite in the srt-agwb repo, exactly
// like /webflow-Aivisibility and /scan. Nothing here knows about that domain, which is
// why the page hardcodes its own canonical from LHR_BASE.
//
// The route folder is LOWERCASE on purpose. The public URL is /LHR, but a mixed-case
// app directory is the /webflow-Aivisibility casing trap that needed four redirect
// entries to clean up after; the rewrite carries the casing instead.
//
// NO auth check needed, and NO middleware entry needed either. src/middleware.ts guards
// /dashboard on internal hosts and denies by default on client-controlled ones, so /lhr
// and /api/lhr/* are reachable on mission.srtagency.com and 404 on a client's learn.
// subdomain without either being written down. Do NOT add this route to the hub
// allowlist: a public opt-in endpoint on a hostname a client's registrar controls is
// exactly the lead-injection surface that allowlist exists to refuse.
//
// It is un-chromed for a structural reason: the sidebar lives in dashboard/layout.tsx.
//
// Applies BOTH .scan-root (the token block, from scan.css) and .lhr-root. lhr.css
// therefore declares layout only and never re-declares a token. Two traps scan.css
// already solves and this inherits for free:
//   - the root layout hard-sets font-family INLINE on <body>, which beats any class,
//     so .scan-root re-declares it;
//   - globals.css paints body #0B1426, which shows through on overscroll, so
//     `body:has(.scan-root)` repaints it.

import type { Metadata } from "next";
import Script from "next/script";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { PIXEL_ID } from "@/config/lhr-funnel";
import "../scan/scan.css";
// <GatedVSL/> emits unprefixed .vsl-* classes, so its styles live beside the component
// and every route that renders it imports them.
import "@/components/gated-vsl.css";
import "./lhr.css";

export const metadata: Metadata = {
  title: "Free Training for Med Spa and Laser Hair Removal Owners | SRT Agency",
  description:
    "A free 5 minute training on the patient acquisition system we install for med spas and laser hair removal clinics.",
  // The whole subtree stays out of the index. This is a paid-traffic funnel, not a page
  // we want ranking, and its copy is written for one ad set rather than for the site.
  robots: { index: false, follow: false },
};

export default function LhrFunnelLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`scan-root lhr-root ${GeistSans.variable} ${GeistMono.variable}`}>
      {/*
        The base pixel, byte-identical to every other srtagency funnel. It fires
        PageView unconditionally ON PURPOSE: PageView is the pixel's baseline and is
        what sets the _fbp cookie in the first place, so gating it would break the
        thing the gate reads. The attribution rule applies to the CONVERSION events
        (Lead, ViewContent, CompleteRegistration), which go through track() in
        src/lib/medspa/pixel.ts and fire only on a real ad click.
      */}
      <Script id="lhr-pixel" strategy="afterInteractive">
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
