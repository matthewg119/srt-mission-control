// VSL-B, the free training. Reached from the link in the guide email.
//
// Access is an HMAC over the opt-in id, carried in ?k=. Without a valid signature the
// page shows the opt-in prompt instead of the video, so a link forwarded to a
// colleague CONVERTS that colleague rather than leaking the training. Stateless on
// purpose: no DB read to render, and no expiry, because a seat someone earned should
// not evaporate.
//
// This is a gate against casual sharing, not a security boundary. The video URL
// itself is only as private as the CDN serving it.

import type { Metadata } from "next";
import { TrainingClient } from "./training-client";
import { verifyAccess } from "@/lib/medspa/links";
import { TRAINING, FUNNEL_BASE, funnelUrl } from "@/config/medspa-funnel";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export const metadata: Metadata = {
  title: "Your training | SRT Agency",
  alternates: { canonical: `${FUNNEL_BASE}/training` },
  robots: { index: false, follow: false },
};

export default function TrainingPage({
  searchParams,
}: {
  searchParams: { k?: string };
}) {
  const access = verifyAccess(searchParams.k);

  return (
    <main className="medspa-main">
      <div className="medspa-brand">
        <span className="medspa-brand-mark" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span>SRT Agency</span>
      </div>

      {access.ok ? (
        <>
          <span className="medspa-eyebrow">{TRAINING.eyebrow}</span>
          <h1 className="medspa-h1">{TRAINING.headline}</h1>
          <p className="medspa-sub">{TRAINING.subhead}</p>
          <TrainingClient accessKey={searchParams.k ?? null} />
        </>
      ) : (
        <div className="medspa-card">
          <h2>{TRAINING.lockedHeadline}</h2>
          <p>{TRAINING.lockedBody}</p>
          {/*
            A plain anchor, not a Next <Link>. The app is served under srtagency.com
            through a rewrite, so client-side routing would navigate against whatever
            casing Next emitted, and a 30x in the middle of an RSC prefetch blanks the
            page. Every cross-page move in this funnel is built from FUNNEL_BASE.
          */}
          <a className="medspa-btn" href={funnelUrl()} style={{ display: "block", textAlign: "center", textDecoration: "none" }}>
            Get the 20 questions
          </a>
        </div>
      )}

      <footer className="medspa-footer">
        <p>SRT Agency LLC, Search Retrieval Tactics</p>
        <p>Upstream of PHI. Nothing here is medical advice.</p>
      </footer>
    </main>
  );
}
