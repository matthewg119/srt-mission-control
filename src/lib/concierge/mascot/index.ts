// The corner mascots, as URLs the widget can load from any page.
//
// ‼️ STATIC IMPORTS, SO THE FILES ARE SERVED FROM /_next/static AND NOT THROUGH A ROUTE. middleware.ts
// 404s everything on the concierge host except /embed.js, /w/<slug> and /api/concierge/*, and its matcher
// skips _next/static entirely. An imported image is emitted there with a content hash, cached forever by
// the CDN, and reachable from concierge.srtagency.com, a client's hub host and our own preview alike, with
// no function invocation per page view on somebody else's website.
//
// Made by scripts/mascot/key-mascot.py from the Veo clips Matthew generated on 2026-09-15 (the wizard
// cat's idle and talk) and 2026-09-16 (three cat flourishes and the blue alien): the checkerboard
// flood-filled away, one palette, 160px tall for a ~96px launcher.
//
// ‼️ A FLOURISH IS PLAYED ONCE AND IS NOT PING-PONGED, WHICH IS WHY EACH ONE CARRIES ITS OWN `ms`.
// idle and talk are loops and the browser handles them. A flourish is a gesture: the widget swaps to it,
// waits exactly this long, and swaps back to idle. The number is frames/fps of the file that sits beside
// it (80 frames at 10fps = 8000), so changing one means changing the other.

import catIdle from "./wizard-cat-idle.webp";
import catTalk from "./wizard-cat-talk.webp";
import catStill from "./wizard-cat-idle-still.png";
import catWandThrow from "./wizard-cat-wand-throw.webp";
import catTailStand from "./wizard-cat-tail-stand.webp";
import catTailHold from "./wizard-cat-tail-hold.webp";
import alienIdle from "./blue-alien-idle.webp";
import alienStill from "./blue-alien-idle-still.png";
import alienBoombox from "./blue-alien-boombox.webp";

/** One gesture, and how long it runs before the widget goes back to idle. */
export interface MascotClip {
  src: string;
  ms: number;
}

export interface MascotAssets {
  /** The animated loop while it waits. */
  idle: string;
  /** The loop while a speech bubble is showing. */
  talk: string;
  /** The first frame, for prefers-reduced-motion and as the instant placeholder. */
  still: string;
  width: number;
  height: number;
  /**
   * Gestures played occasionally between bubbles, in a random order. Empty is legitimate and means the
   * mascot simply idles, which is every mascot that shipped before 2026-09-16.
   */
  flourishes: MascotClip[];
  /**
   * The rare one. Held apart from `flourishes` rather than weighted inside it because the widget picks
   * from that list uniformly, and a one-in-sixty gesture mixed into a list of three is a one-in-three
   * gesture. Null means this mascot has no easter egg.
   */
  easterEgg: MascotClip | null;
}

const EIGHT_SECONDS = 8000;

export const MASCOTS: Record<string, MascotAssets> = {
  "wizard-cat": {
    idle: catIdle.src,
    talk: catTalk.src,
    still: catStill.src,
    width: catStill.width,
    height: catStill.height,
    flourishes: [
      { src: catWandThrow.src, ms: EIGHT_SECONDS },
      { src: catTailStand.src, ms: EIGHT_SECONDS },
      { src: catTailHold.src, ms: EIGHT_SECONDS },
    ],
    // ‼️ NO EASTER EGG YET, DELIBERATELY NULL RATHER THAN BORROWED. Matthew asked for a face-scan gesture
    // on 2026-09-16 and had not generated the clip. Pointing this at one of the flourishes above would
    // make the rare thing common and the common thing rare, which is worse than not having it.
    easterEgg: null,
  },
  "blue-alien": {
    idle: alienIdle.src,
    // ‼️ THE SAME FILE AS idle, NOT A COPY. The alien has no talking clip yet, and the honest options were
    // to send the browser a second identical download or to let both states name one file. A mascot that
    // keeps waving while it speaks reads fine; two megabytes for that would not.
    talk: alienIdle.src,
    still: alienStill.src,
    width: alienStill.width,
    height: alienStill.height,
    flourishes: [{ src: alienBoombox.src, ms: EIGHT_SECONDS }],
    easterEgg: null,
  },
};

/**
 * What a client gets when nobody chose.
 *
 * ‼️ THE COLUMN DEFAULT IS STILL 'wizard-cat' AND THIS IS NOT IT. concierge_configs.mascot defaults to
 * the cat because that is what every existing row was written against, and rewriting live rows to chase
 * a new default is how a client's widget changes character overnight. This constant is what step 18
 * WRITES for a client that has not picked, so the change applies forward and nothing already live moves.
 */
export const DEFAULT_MASCOT = "blue-alien";

export function mascotAssets(key: string | null): MascotAssets | null {
  return key ? (MASCOTS[key] ?? null) : null;
}

/** Every key a person may choose, for the step 18 menu and for validating a pick. */
export function mascotKeys(): string[] {
  return Object.keys(MASCOTS);
}
