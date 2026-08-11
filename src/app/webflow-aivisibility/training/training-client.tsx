"use client";

// VSL-B, gated harder than VSL-A: no scrub, and the offer sits 15 minutes in.

import { useState } from "react";
import { GatedVSL } from "@/components/gated-vsl";
import { TRAINING_OFFER, VIDEO, VSL_B, funnelUrl } from "@/config/medspa-funnel";
import { track } from "@/lib/medspa/pixel";

export function TrainingClient({ accessKey }: { accessKey: string | null }) {
  const [revealed, setRevealed] = useState(false);

  // Carry the signed key through to the order page so it knows who this is and can
  // apply their $39 audit credit without asking them to prove they bought it.
  const orderUrl = funnelUrl(
    accessKey ? `/get-named?k=${encodeURIComponent(accessKey)}` : "/get-named"
  );

  return (
    <>
      <GatedVSL
        videoUrl={VSL_B.url}
        poster={VSL_B.poster}
        onCtaReveal={() => {
          track("CompleteRegistration");
          setRevealed(true);
        }}
        ctaRevealSeconds={VSL_B.ctaRevealSeconds}
        allowScrub={VSL_B.allowScrub}
        resumeMode={VSL_B.resumeMode}
        storageKeySuffix="vsl-b"
        unmuteLabel={VIDEO.unmuteLabel}
        playLabel={VIDEO.playLabel}
        placeholderTitle={VIDEO.placeholderTitle}
        placeholderBody={VIDEO.placeholderBody}
      />

      {revealed && (
        <section className="medspa-offer">
          <h2>{TRAINING_OFFER.headline}</h2>
          <p className="medspa-offer-body">{TRAINING_OFFER.body}</p>

          {/*
            No price here on purpose. Pricing lives on /get-named, where the
            comparison table gives the two numbers their context. A bare "$349" on
            this page would be a number without the argument that justifies it.
          */}
          {/*
            A plain anchor, not a Next <Link>. This app is served under srtagency.com
            through a rewrite, so client-side routing would navigate against whatever
            casing Next emitted and a 30x mid RSC-prefetch blanks the page.
          */}
          <a
            className="medspa-btn"
            href={orderUrl}
            style={{ display: "block", textAlign: "center", textDecoration: "none" }}
          >
            {TRAINING_OFFER.cta}
          </a>
        </section>
      )}
    </>
  );
}
