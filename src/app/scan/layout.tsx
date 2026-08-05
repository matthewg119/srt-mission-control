// Public layout for /scan. NO auth check — src/middleware.ts only matches
// /dashboard/:path*, so this subtree is open by design, same as /r/[slug].
//
// The root layout hard-sets font-family: 'General Sans' inline on <body>, which
// would win over any class here. That is why .scan-root re-declares font-family
// in scan.css rather than relying on inheritance.

import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./scan.css";

export const metadata: Metadata = {
  title: "Free AI Visibility Scan | SRT Agency",
  description:
    "Paste your website and watch us ask ChatGPT the 20 questions your customers actually ask. See whether you get named, and who gets named instead.",
  robots: { index: false, follow: false },
};

export default function ScanLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`scan-root ${GeistSans.variable} ${GeistMono.variable}`}>{children}</div>
  );
}
