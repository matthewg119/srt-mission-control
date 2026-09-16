// The universes' typefaces. Self-hosted at build by next/font, so a client's page never asks Google for a
// font at view time and nothing about a visitor leaves for a third party.
//
// ‼️ THE "NO WEBFONTS" RULE WAS MATTHEW'S AND HE REVERSED IT (2026-09-15, choosing "layout library + webfonts").
// faces.ts still owns the ten system stacks a SCREENSHOT may name; these belong to universes only, and are
// selected by a class, never by a value a model wrote.
//
// Each universe sets three variables on .hub-root: --u-display, --u-text and --u-mono. universes.css reads them.

import {
  Archivo,
  Archivo_Black,
  Big_Shoulders_Display,
  Cormorant_Garamond,
  DM_Serif_Display,
  Fraunces,
  IBM_Plex_Mono,
  JetBrains_Mono,
  Karla,
  Nunito_Sans,
  Playfair_Display,
  Sora,
  Source_Serif_4,
  Space_Grotesk,
  Space_Mono,
} from "next/font/google";
import type { HubUniverse } from "@/lib/hub/universes";

const bigShoulders = Big_Shoulders_Display({ subsets: ["latin"], weight: ["600", "800"], variable: "--u-display", display: "swap" });
const archivo = Archivo({ subsets: ["latin"], weight: ["400", "600"], variable: "--u-text", display: "swap" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "600"], variable: "--u-mono", display: "swap" });

const cormorant = Cormorant_Garamond({ subsets: ["latin"], weight: ["300", "500"], style: ["normal", "italic"], variable: "--u-display", display: "swap" });
const karla = Karla({ subsets: ["latin"], weight: ["400", "600"], variable: "--u-text", display: "swap" });

const playfair = Playfair_Display({ subsets: ["latin"], weight: ["700", "900"], style: ["normal", "italic"], variable: "--u-display", display: "swap" });
const sourceSerif = Source_Serif_4({ subsets: ["latin"], weight: ["400", "600"], variable: "--u-text", display: "swap" });

const archivoBlack = Archivo_Black({ subsets: ["latin"], weight: ["400"], variable: "--u-display", display: "swap" });
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], weight: ["400", "600"], variable: "--u-text", display: "swap" });
const spaceMono = Space_Mono({ subsets: ["latin"], weight: ["400", "700"], variable: "--u-mono", display: "swap" });

const sora = Sora({ subsets: ["latin"], weight: ["300", "600", "700"], variable: "--u-display", display: "swap" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "600"], variable: "--u-mono", display: "swap" });

const fraunces = Fraunces({ subsets: ["latin"], weight: ["400", "600"], variable: "--u-display", display: "swap" });
const nunito = Nunito_Sans({ subsets: ["latin"], weight: ["400", "600"], variable: "--u-text", display: "swap", adjustFontFallback: false });
const dmSerif = DM_Serif_Display({ subsets: ["latin"], weight: ["400"], variable: "--u-mono", display: "swap" });

const FONTS: Record<HubUniverse, string> = {
  blueprint: [bigShoulders.variable, archivo.variable, plexMono.variable].join(" "),
  atelier: [cormorant.variable, karla.variable, plexMono.variable].join(" "),
  magazine: [playfair.variable, sourceSerif.variable, plexMono.variable].join(" "),
  brutalist: [archivoBlack.variable, spaceGrotesk.variable, spaceMono.variable].join(" "),
  noir: [sora.variable, archivo.variable, jetbrains.variable].join(" "),
  botanica: [fraunces.variable, nunito.variable, dmSerif.variable].join(" "),
};

/** The font-variable classes for a skin's universe, or "" for the classic look. */
export function universeFontClass(universe: HubUniverse | null | undefined): string {
  return universe ? FONTS[universe] ?? "" : "";
}
