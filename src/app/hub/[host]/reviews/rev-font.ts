// The referral walk's display face, in one place because two pages wear it.
//
// ‼️ IT IS THE LANE'S FACE AND NOT THE CLIENT'S, WHICH IS THE OPPOSITE OF THE REST OF THE HUB.
// A clinic's marketing pages take their heading family from their own skin, because those pages
// are theirs. The referral walk is a product we sell to every client, and Matthew designed it as a
// set of phone screens set in DM Serif Display (2026-10-07, the five reference pages). A different
// headline face per clinic would be a different product per clinic, which is the same argument
// that keeps the agent panel's chrome out of the client's hands and leaves only the accent in them.
//
// ‼️ ITS OWN MODULE SO THE CLAIM PAGE DOES NOT IMPORT THE WALK. /hub/{host}/r/{code} is a page a
// FRIEND opens from a text message and it renders no chat at all; importing referral-engine.tsx
// for one font constant would pull the Virtual Agent's client chunk into its graph for nothing.
//
// Self-hosted at build by next/font, like every other webfont here, so a visitor's browser never
// asks Google for it. The variable lands on .rev-frame; hub.css reads it as --rev-display with a
// Georgia fallback, so a dropped class degrades to a serif rather than to 44px of regular sans.

import { DM_Serif_Display } from "next/font/google";

export const revSerif = DM_Serif_Display({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--rev-serif",
  display: "swap",
});
