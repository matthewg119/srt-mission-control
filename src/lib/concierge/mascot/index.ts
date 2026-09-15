// The corner mascots, as URLs the widget can load from any page.
//
// ‼️ STATIC IMPORTS, SO THE FILES ARE SERVED FROM /_next/static AND NOT THROUGH A ROUTE. middleware.ts
// 404s everything on the concierge host except /embed.js, /w/<slug> and /api/concierge/*, and its matcher
// skips _next/static entirely. An imported image is emitted there with a content hash, cached forever by
// the CDN, and reachable from concierge.srtagency.com, a client's hub host and our own preview alike, with
// no function invocation per page view on somebody else's website.
//
// Made by scripts/mascot/key-mascot.py from the two Veo clips Matthew generated on 2026-09-15: the
// checkerboard flood-filled away, one palette, ping-pong looped, 160px tall for a ~96px launcher.

import idle from "./wizard-cat-idle.webp";
import talk from "./wizard-cat-talk.webp";
import still from "./wizard-cat-idle-still.png";

export interface MascotAssets {
  /** The animated loop while it waits. */
  idle: string;
  /** The loop while a speech bubble is showing. */
  talk: string;
  /** The first frame, for prefers-reduced-motion and as the instant placeholder. */
  still: string;
  width: number;
  height: number;
}

export const MASCOTS: Record<string, MascotAssets> = {
  "wizard-cat": { idle: idle.src, talk: talk.src, still: still.src, width: still.width, height: still.height },
};

export function mascotAssets(key: string | null): MascotAssets | null {
  return key ? (MASCOTS[key] ?? null) : null;
}
