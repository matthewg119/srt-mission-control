// The faces a hub may be set in, and the only font stacks that can reach a hub's CSS from a
// screenshot.
//
// ‼️ A FONT NAME FROM A MODEL IS AN UNTRUSTED VALUE THAT ENDS UP IN CSS, SO THE MODEL NEVER
// SUPPLIES ONE. It picks a KEY from HUB_FACES and this file supplies the stack. The screenshot
// lane used to ask for a free-text `headingFamily`, which was safe only because safeFontFamily()
// is a tight character class, and it came back null on a page with an obvious heading face
// because "what font is that" is a question a model rightly refuses to guess at. "Which of these
// ten kinds of face is that" is a question it can answer, and the answer cannot carry anything.
//
// ‼️ NO WEBFONTS, AND THAT IS MATTHEW'S CALL (2026-09-11), NOT AN OMISSION.
// theme.ts already refuses to load a font on a client's behalf: the hub is sold on being cheap
// and fast to crawl. So each stack is an ordered list of faces that are INSTALLED on the devices
// that matter, arranged so a Mac, an iPhone and a Windows laptop each land on the closest one.
// A Poppins site renders as Avenir Next on a Mac and Century Gothic on Windows, which is the same
// kind of face, and srtagency.com itself uses the system face so it renders exactly.
//
// ‼️ EVERY STACK MUST PASS safeFontFamily() UNCHANGED. theme.fontFamily is gated by it, and the
// body face is written THERE on a pick, so a stack with a paren or over 120 characters would be
// dropped on the way in and the pick would silently apply no font. The artifacts test checks it.

export const HUB_FACES = [
  "system",
  "geometric",
  "grotesk",
  "humanist",
  "serif",
  "display",
  "slab",
  "mono",
  "rounded",
  "condensed",
] as const;

export type HubFace = (typeof HUB_FACES)[number];

export interface FaceInfo {
  key: HubFace;
  /** What it is called in Slack. */
  name: string;
  /** What it looks like, with fonts a model will recognise. Used in the vision prompt. */
  looks: string;
}

export const FACE_CATALOGUE: FaceInfo[] = [
  {
    key: "system",
    name: "system sans",
    looks: "the operating system's own UI face: SF Pro, Segoe UI, Roboto. Most app and agency sites.",
  },
  {
    key: "geometric",
    name: "geometric sans",
    looks: "built from circles and straight lines, round O, single-storey a: Futura, Avenir, Montserrat, Poppins, Century Gothic.",
  },
  {
    key: "grotesk",
    name: "neo-grotesk sans",
    looks: "neutral, even and tight: Helvetica, Arial, Inter.",
  },
  {
    key: "humanist",
    name: "humanist sans",
    looks: "a sans with calligraphic warmth and open curves: Gill Sans, Frutiger, Lato, Open Sans, Calibri.",
  },
  {
    key: "serif",
    name: "book serif",
    looks: "an ordinary reading serif: Georgia, Times, Merriweather, Charter.",
  },
  {
    key: "display",
    name: "display serif",
    looks: "a high-contrast fashion serif with hairline strokes: Didot, Bodoni, Playfair Display.",
  },
  {
    key: "slab",
    name: "slab serif",
    looks: "heavy square serifs: Rockwell, Roboto Slab, Arvo.",
  },
  {
    key: "mono",
    name: "monospace",
    looks: "every letter the same width, like code: SF Mono, Menlo, Consolas.",
  },
  {
    key: "rounded",
    name: "rounded sans",
    looks: "a sans with rounded stroke ends: SF Pro Rounded, Nunito, Varela Round.",
  },
  {
    key: "condensed",
    name: "condensed sans",
    looks: "tall and narrow, often all caps: Oswald, Bebas, Impact, Arial Narrow.",
  },
];

/**
 * The stacks. Code-authored, plain names only, no var() and no parens.
 *
 * The first entries are what the reference was probably set in; the later ones are what is
 * actually installed on a Mac, an iPhone and Windows, in that order of preference.
 */
export const FACE_STACKS: Record<HubFace, string> = {
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  geometric: '"Avenir Next", Avenir, Futura, "Century Gothic", Montserrat, Poppins, "Segoe UI", sans-serif',
  grotesk: '"Helvetica Neue", Helvetica, Inter, Arial, "Segoe UI", sans-serif',
  humanist: '"Gill Sans", "Gill Sans MT", Frutiger, Lato, "Open Sans", Calibri, "Segoe UI", sans-serif',
  serif: 'Charter, "Iowan Old Style", Georgia, Cambria, "Times New Roman", serif',
  display: 'Didot, "Bodoni 72", "Playfair Display", "Big Caslon", "Bodoni MT", Georgia, serif',
  slab: 'Rockwell, "Roboto Slab", "Zilla Slab", Arvo, Georgia, serif',
  mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  rounded: 'ui-rounded, "SF Pro Rounded", Nunito, "Varela Round", "Arial Rounded MT Bold", sans-serif',
  condensed: '"Avenir Next Condensed", "Arial Narrow", Oswald, "Roboto Condensed", Impact, sans-serif',
};

export function isFace(v: unknown): v is HubFace {
  return typeof v === "string" && (HUB_FACES as readonly string[]).includes(v);
}

/** A face key or null. Refused, never coerced: an unknown name is not a nearby face. */
export function safeFace(v: unknown): HubFace | null {
  return isFace(v) ? v : null;
}

export function faceStack(face: HubFace | null): string | null {
  return face ? FACE_STACKS[face] : null;
}

export function faceName(face: HubFace): string {
  return FACE_CATALOGUE.find((f) => f.key === face)?.name ?? face;
}
