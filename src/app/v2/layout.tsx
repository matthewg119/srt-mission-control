// /v2 — the explee-styled srtagency.com rebuild, PREVIEW ONLY.
//
// This does not touch the live site. srtagency.com is still served by the static
// srt-agwb repo, and nothing in that repo points here. noindex + nofollow so a
// half-finished rebuild can never outrank the real thing.
//
// Applies BOTH .scan-root (the token block, from scan.css) and .v2-root, so
// every var() in v2.css resolves and /v2 shares one design system with /scan.

import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "../scan/scan.css";
import "./v2.css";

export const metadata: Metadata = {
  title: "SRT Agency (preview) | AI Visibility for Local Businesses",
  description:
    "Preview build of the srtagency.com rebuild. Not the live site.",
  robots: { index: false, follow: false },
};

export default function V2Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`scan-root v2-root ${GeistSans.variable} ${GeistMono.variable}`}>
      <div className="v2-ribbon">
        <b>PREVIEW</b> This is a design demo at mission.srtagency.com/v2. The live site at
        srtagency.com is unchanged.
      </div>
      {children}
    </div>
  );
}
