"use client";

// VSL-B, gated harder than VSL-A: no scrub, and the offer sits 15 minutes in.

import { useState } from "react";
import { GatedVSL } from "@/components/gated-vsl";
import { TRAINING_OFFER_PLACEHOLDER, VIDEO, VSL_B } from "@/config/medspa-funnel";
import { track } from "@/lib/medspa/pixel";

export function TrainingClient() {
  const [revealed, setRevealed] = useState(false);

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
          <h2>{TRAINING_OFFER_PLACEHOLDER.headline}</h2>
          <p className="medspa-offer-body">{TRAINING_OFFER_PLACEHOLDER.body}</p>

          {/*
            PLACEHOLDER: the $299 Founding / $499 Standard checkout mounts here in
            Phase 2.

            It deliberately prints NO price today. A price on a page that cannot take
            the money is a promise with no mechanism behind it, which is the same
            reason LOOM_CLIENT_COUNT_CLAIM ships null rather than a plausible number.
            PRICES.founding and PRICES.standard already exist in the config and are
            the single source for both the copy and the Stripe amount when this is
            wired up.
          */}
          <button className="medspa-btn" type="button" disabled>
            {TRAINING_OFFER_PLACEHOLDER.cta}
          </button>
        </section>
      )}
    </>
  );
}
