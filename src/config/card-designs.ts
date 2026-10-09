// The QR card's looks. PALETTE AND LAYOUT ONLY.
//
// ‼️ THERE IS NOT ONE STRING OF CARD COPY IN THIS FILE AND THERE MUST NEVER BE ONE.
// A design here is six colours, a layout name, a face, and the KEY of a copy set. It never carries
// a sentence of its own. scripts/_probe-card-preview.ts fails the build if anything in this file
// looks like one.
//
// ‼️ "A DESIGN IS A PALETTE AND NEVER A WORDING" BECAME "A DESIGN NAMES ONE OF A FIXED SET OF
// WORDINGS" ON 2026-10-09, AND THAT IS A REAL LOOSENING. Matthew asked for a second card that
// leads with the clinic's offer instead of with the question count. The rule that survives, and
// that the probe still holds, is that a design cannot INVENT copy: CARD_COPY_SETS in
// card-preview.ts is the registry, it is small, every set in it is checked, and `neutral` is the
// printed card's own words read straight out of review-card-copy.ts. What is gone is the
// guarantee that every card on earth says the same thing. See CARD_COPY_SETS for what that costs.
//
// ‼️ THE PALETTES ARE THE MED SPA ONE, WHICH IS DELIBERATE FOR v1. Matthew, 2026-10-09: "help me
// build a first version that takes them to the med spa template pink." #d6809c and #fdeef3 are the
// exact two values MEDSPA_CLIENT carries in src/app/demo/agent/page.tsx, so the card a clinic
// looks at and the page behind its QR are visibly one product rather than two pink things. When
// this goes per client, the accent comes off clients.theme the same way the printed card's does,
// and these become the fallback rather than the answer.

import { guard } from "@/lib/copy-guard";

/**
 * Which set of words a design puts on the card.
 *
 * ‼️ A KEY AND NOT THE WORDS. The strings live in CARD_COPY_SETS in src/config/card-preview.ts,
 * which is also where the one offer figure lives. Declared HERE rather than there because it is an
 * attribute of a design, and that keeps the import one-way: card-preview reads this file, never
 * the reverse.
 */
export type CardCopyKey = "neutral" | "offer";

/**
 * How the front of the card is arranged.
 *
 * `stack`  centred, in the printed card's own order: name, promise, code, instruction, url.
 * `band`   the name in an accent band across the top, the rest on the ground below it.
 * `edge`   everything left aligned inside a hairline frame, the code sitting on the bottom rule.
 */
export type CardLayout = "stack" | "band" | "edge";

export interface CardDesign {
  key: string;
  /**
   * What the toggle calls it. One word.
   *
   * ‼️ THE ONE PIECE OF PROSE ALLOWED IN HERE, AND IT IS A LABEL ON A CONTROL RATHER THAN
   * ANYTHING PRINTED. It never reaches the card and never reaches a patient.
   */
  label: string;
  layout: CardLayout;
  /** The card's own ground. */
  ground: string;
  /** Body ink on that ground. */
  ink: string;
  /** The small print, one step down from the ink. */
  muted: string;
  /** The clinic's colour. On v1 this is the med spa pink, per the header. */
  accent: string;
  /** Ink that is legible ON the accent, for the band layout. */
  onAccent: string;
  /**
   * What sits behind the code.
   *
   * ‼️ IT IS ALWAYS LIGHT AND THAT IS NOT A STYLE CHOICE. A QR needs a light quiet zone to scan
   * at all, which is why the printed card draws a white plate under it even though that page is
   * midnight. A dark design that skipped this would be a card that photographs beautifully and
   * does not work.
   */
  plate: string;
  /** A display serif on the clinic's name, or the body sans throughout. */
  face: "serif" | "sans";
  /** Which entry of CARD_COPY_SETS this card says. Never the words themselves. */
  copy: CardCopyKey;
}

export const CARD_DESIGNS: readonly CardDesign[] = [
  {
    key: "blush",
    label: guard("design blush", "Blush"),
    layout: "stack",
    ground: "#fdeef3",
    ink: "#2d2026",
    muted: "#7d6a72",
    accent: "#c26b89",
    onAccent: "#ffffff",
    plate: "#ffffff",
    face: "serif",
    copy: "neutral",
  },
  {
    // ‼️ THE OFFER CARD. Added 2026-10-09 at Matthew's request and it is the one design whose
    // words differ; see CARD_COPY_SETS.offer for what that costs and why the probe no longer
    // forbids it. The look is deliberately the loudest of the three, because a card leading with a
    // deal that looks like the quiet one is a deal nobody reads.
    key: "offer",
    label: guard("design offer", "Offer"),
    layout: "band",
    ground: "#ffffff",
    ink: "#241a1f",
    muted: "#7c6b72",
    accent: "#c26b89",
    onAccent: "#ffffff",
    plate: "#ffffff",
    face: "serif",
    copy: "offer",
  },
  {
    // Not offered on the landing. ?d=clean opens it, for comparing and for the onboarding video.
    key: "clean",
    label: guard("design clean", "Clean"),
    layout: "edge",
    ground: "#ffffff",
    ink: "#191717",
    muted: "#7c7472",
    accent: "#d6809c",
    onAccent: "#2d1620",
    plate: "#ffffff",
    face: "sans",
    copy: "neutral",
  },
];

/**
 * The two offered on the landing.
 *
 * ‼️ TWO, BECAUSE HE ASKED FOR TWO: "i want 2 options in the new landing with the preview".
 * Three chips on a phone is a survey; two is a preference.
 *
 * ‼️ `ink` WAS DELETED ON 2026-10-09, not merely dropped from this list. Matthew: "also remove
 * the ink version". A dark card kept in the registry but shown to nobody is a fourth thing to keep
 * working, and this repo has already paid for that once ("get rid of absolutely all of those old
 * pages"). `clean` survives because it is still reachable at ?d=clean and he has not seen it yet.
 */
export const OFFERED_DESIGNS: readonly string[] = ["blush", "offer"];

/** A design by key, falling back to the first offered one. Never throws, never returns undefined. */
export function designByKey(key: string | null | undefined): CardDesign {
  const found = CARD_DESIGNS.find((d) => d.key === key);
  if (found) return found;
  return CARD_DESIGNS.find((d) => d.key === OFFERED_DESIGNS[0]) ?? CARD_DESIGNS[0];
}

/** The two the landing draws, in the order OFFERED_DESIGNS names them. */
export function offeredDesigns(): CardDesign[] {
  return OFFERED_DESIGNS.map((k) => designByKey(k));
}
