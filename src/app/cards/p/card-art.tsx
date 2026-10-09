// The QR card, drawn on screen.
//
// ‼️ THIS FILE DRAWS. IT DOES NOT WRITE. Every string a patient would read is HANDED IN: the
// copy set, the clinic's name and the host. The only literals in here are class names. There is
// nothing to "just tweak" on a card without opening the registry that owns its words, which is
// what stops the preview and the printer drifting apart.
// scripts/_probe-card-preview.ts fails the build if a sentence appears in this file.
//
// ‼️ ONE LAYOUT AND ONE DESIGN SINCE 2026-10-09, AND THE TWO AXES ARE STILL SEPARATE ON PURPOSE.
// src/config/card-designs.ts owns the palette and names both the arrangement and the copy KEY;
// src/config/card-preview.ts owns what those keys resolve to. A design can pick a wording and can
// never invent one. Read CARD_COPY_SETS before adding a second: the `offer` set reverses a rule
// that the rest of this lane is built on, and its header says what that costs.
//
// ‼️ THE `band` AND `edge` BRANCHES WERE DELETED WITH THE DESIGNS THAT USED THEM. Matthew picked
// the blush card carrying the offer words and asked for the picker to go, so two of the three
// arrangements became unreachable in the same message. An unreachable renderer is not free: it
// goes stale silently and the next person to need it finds it broken. The LAYOUT AXIS survives in
// the type, so a second arrangement is a branch and an entry rather than a rewrite.
//
// ‼️ WHY INLINE STYLES AND NOT CLASSES. Six of the values are data: a design is a palette, and a
// palette in a stylesheet would mean three near-identical blocks of CSS that have to be edited
// together every time a fourth design is added. Structure is in preview.css where it belongs;
// only the colours come through here.

import type { CardCopySet } from "@/config/card-preview";
import type { CardDesign } from "@/config/card-designs";

export interface CardFrontProps {
  design: CardDesign;
  /** The words, resolved from design.copy by the caller. See CARD_COPY_SETS. */
  copy: CardCopySet;
  /** The clinic's name, or the placeholder. Never empty. */
  clinicName: string;
  /** A data URL. Rendered server side by the `qrcode` package; see the page. */
  qrDataUrl: string;
  /**
   * The host printed under the code, or null.
   *
   * ‼️ IT IS THE CLINIC'S OWN FUTURE REVIEWS HOST AND NOT WHAT THE PREVIEW'S CODE RESOLVES TO,
   * because those are genuinely different things and the card is a mockup of the printed one. The
   * screen says so in PREVIEW_SCAN.qrNote rather than letting anybody work it out. With no website
   * on the lead there is no honest host to print, so the line is omitted rather than invented.
   */
  reviewsHost: string | null;
}

export function CardFront({ design, copy, clinicName, qrDataUrl, reviewsHost }: CardFrontProps) {
  const serif = design.face === "serif";
  const nameFont = serif
    ? 'var(--cd-display, Georgia), "Times New Roman", serif'
    : "inherit";

  // One code, one plate, drawn the same in all three. A QR needs a light quiet zone to scan at
  // all, which is why `plate` exists on every design including the dark one.
  const code = (size: string) => (
    <span className="cpc-plate" style={{ background: design.plate, width: size }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a data URL, already rendered; next/image would round-trip it through the optimizer for nothing */}
      <img src={qrDataUrl} alt="" className="cpc-qr" />
    </span>
  );

  const promise = (
    <p className="cpc-promise" style={{ color: design.accent }}>
      {copy.promise}
    </p>
  );
  const scanLine = (
    <p className="cpc-scan" style={{ color: design.ink }}>
      {copy.scanLine}
    </p>
  );
  const host = reviewsHost ? (
    <p className="cpc-host" style={{ color: design.muted }}>
      {reviewsHost}
    </p>
  ) : null;

  // stack, and currently the only one: the printed card's own order, centred. The clinic's name
  // sits directly over the line that sells, which is the thing Matthew picked it for.
  return (
    <article
      className="cpc-card is-stack"
      style={{ background: design.ground, color: design.ink }}
      aria-label={`${clinicName} review card`}
    >
      <div className="cpc-body">
        <h3 className="cpc-name" style={{ fontFamily: nameFont, color: design.ink }}>
          {clinicName}
        </h3>
        {promise}
        {code("54%")}
        {scanLine}
        {host}
      </div>
    </article>
  );
}

/**
 * Somebody scanning it.
 *
 * ‼️ DRAWN AND NOT PHOTOGRAPHED, AND THAT IS A DECISION RATHER THAN A SHORTCUT. Matthew asked for
 * "a picture of someone scanning a qr code". A stock photograph of a hand would be a stranger's
 * hand in a stranger's lighting sitting on top of a card in the clinic's own colours, and it would
 * be the only thing on the page that cannot follow the accent. This follows it, weighs nothing,
 * and stays sharp at any size. A real photograph is a drop-in replacement the day there is one
 * worth using: it occupies one box in preview.css.
 *
 * ‼️ AND IT IS aria-hidden. The instruction beside it is the real content; the picture repeats it.
 */
export function ScanHand({ design }: { design: CardDesign }) {
  // A silhouette on the dark design has to be lighter than the ground, and darker on the light
  // ones. The accent reads on both, so the hand is the accent at two opacities and nothing else.
  const hand = design.accent;
  return (
    <svg
      className="cpc-hand"
      viewBox="0 0 132 158"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <g transform="rotate(-11 66 79)">
        {/* The hand, behind: a wrist and one thumb. Flat, two tones of the accent. */}
        <path
          d="M34 158V116a12 12 0 0 1 12-12h42a12 12 0 0 1 12 12v42Z"
          fill={hand}
          opacity="0.45"
        />
        <path d="M34 120h-9a10 10 0 0 0 0 20h9Z" fill={hand} opacity="0.45" />
        {/* The phone. */}
        <rect x="27" y="10" width="78" height="120" rx="14" fill={hand} />
        <rect x="34" y="18" width="64" height="96" rx="8" fill={design.plate} />
        {/* The reticle on the screen: four corners and a sight line, which is what reads as
            "scanning" rather than "holding". */}
        <g stroke={hand} strokeWidth="3" strokeLinecap="round">
          <path d="M45 42v-6a4 4 0 0 1 4-4h6" />
          <path d="M87 42v-6a4 4 0 0 0-4-4h-6" />
          <path d="M45 90v6a4 4 0 0 0 4 4h6" />
          <path d="M87 90v6a4 4 0 0 1-4 4h-6" />
          <path d="M44 66h44" opacity="0.55" />
        </g>
      </g>
    </svg>
  );
}
