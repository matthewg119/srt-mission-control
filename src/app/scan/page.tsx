import type { Metadata } from "next";
import { ScanForm } from "./scan-form";

// The layout marks this whole subtree noindex, which is right for the /scan/[id] run pages
// (a stranger's scan of their own site is not ours to publish). The LANDING page is the
// opposite case: a free tool is exactly the kind of page that earns links and gets cited by
// the engines we sell visibility in, and for an AEO agency being absent from them is the
// product failing on itself. Page metadata overrides layout metadata, so this only lifts the
// landing page.
export const metadata: Metadata = {
  title: "Free AI Visibility Scan, See What ChatGPT Says About Your Business | SRT Agency",
  description:
    "Paste your website. We work out what you sell and who you compete with, write the 20 questions your buyers actually ask, then put every one to ChatGPT on a neutral account. Free, no account.",
  alternates: { canonical: "https://srtagency.com/scan" },
  robots: { index: true, follow: true },
};

export default function ScanLandingPage() {
  return (
    <main className="scan-hero">
      <h1 className="scan-h1">
        See what AI says about you <em>before</em> your customer does
      </h1>

      <div className="scan-badge">
        <span aria-hidden="true">&#9673;</span> Free, no account, takes about 3 minutes
      </div>

      <p className="scan-sub">
        Paste your website. We work out what you sell and who you compete with, write the 20
        questions your buyers actually ask, then put every one of them to ChatGPT on a neutral
        account. You watch it happen, then you get the scorecard.
      </p>

      <ScanForm />

      <div className="scan-trust">
        <span>20 buyer questions</span>
        <span>20 live answers from ChatGPT</span>
        <span>Neutral account, no personalization</span>
      </div>
    </main>
  );
}
