// The design UNIVERSES: whole visual worlds a client's hub can live in, not three tints of one page.
//
// Matthew, 2026-09-15: "Its hard for me to see variations when all the adjuster does is change the font and
// change the colors, I want a custom design that actually excites them (like the cellunetic website example
// ... I want to see years of difference with each preview option you give me not just basic theme and font
// variations I want to see different universes in each one."
//
// ‼️ THE CONTRACT CHANGED ON THAT DAY, AND THIS IS ITS NEW WORDING: THE SEMANTICS ARE FIXED, THE LOOK IS NOT.
// skin.ts used to say the markup is not themable, and three candidates could therefore only ever differ by a
// colour, a radius and a column width. What actually has to stay fixed is what the hub SELLS: one h1, the
// JSON-LD, the heading order, the answers in order and the canonical NAP block. A universe keeps every one of
// those byte for byte, because the body components in hub-bodies.tsx are shared and untouched, and it changes
// everything around them:
//
//   - its own type system (webfonts, self-hosted at build by next/font, no request to Google at view time)
//   - its own ground, palette defaults, texture and density
//   - its own layout of the same elements (grids, title blocks, schedule rows, cards, split heroes), in CSS
//   - its own decorative chrome (a top bar, a stat strip, a closing band), aria-hidden and link-free
//
// _probe-hub-universes.ts holds the line: the chrome carries no heading, no link and no JSON-LD, and no
// universe rule hides or reorders a semantic element.
//
// The client's ACCENT still comes from the theme, so every universe is theirs in the one colour they own.

export const HUB_UNIVERSES = ["blueprint", "atelier", "magazine", "brutalist", "noir", "botanica"] as const;
export type HubUniverse = (typeof HUB_UNIVERSES)[number];

export interface UniverseInfo {
  key: HubUniverse;
  name: string;
  /** One line a person reads next to the other five. */
  blurb: string;
  /** Where it sits, for choosing three that are far apart. 0..1 each. */
  axes: { dark: number; serif: number; loud: number; ornate: number; technical: number };
}

export const UNIVERSES: readonly UniverseInfo[] = [
  {
    key: "blueprint",
    name: "Blueprint",
    blurb: "an engineering drawing: grid paper, a title block, condensed display type, a spec sheet of answers",
    axes: { dark: 0.2, serif: 0, loud: 0.6, ornate: 0.3, technical: 1 },
  },
  {
    key: "atelier",
    name: "Atelier",
    blurb: "a luxury house: cream and brass, a light italic serif at display size, silence around every line",
    axes: { dark: 0, serif: 1, loud: 0.1, ornate: 0.8, technical: 0 },
  },
  {
    key: "magazine",
    name: "Magazine",
    blurb: "a cover story: a masthead rule, a huge headline, numbered answers in two columns like a contents page",
    axes: { dark: 0, serif: 0.8, loud: 0.8, ornate: 0.5, technical: 0.2 },
  },
  {
    key: "brutalist",
    name: "Brutalist",
    blurb: "a poster: heavy black borders, uppercase slab type, answers as blocks that invert when touched",
    axes: { dark: 0.3, serif: 0, loud: 1, ornate: 0, technical: 0.5 },
  },
  {
    key: "noir",
    name: "Noir",
    blurb: "a control room: near black, a glow behind the headline, glass cards and telemetry labels",
    axes: { dark: 1, serif: 0, loud: 0.5, ornate: 0.4, technical: 0.8 },
  },
  {
    key: "botanica",
    name: "Botanica",
    blurb: "a calm clinic: sage and linen, soft rounded cards, a friendly serif and plenty of air",
    axes: { dark: 0, serif: 0.6, loud: 0.1, ornate: 0.3, technical: 0 },
  },
];

export function isUniverse(v: unknown): v is HubUniverse {
  return typeof v === "string" && (HUB_UNIVERSES as readonly string[]).includes(v);
}

export function universeInfo(key: HubUniverse): UniverseInfo {
  return UNIVERSES.find((u) => u.key === key)!;
}

function distance(a: UniverseInfo["axes"], b: UniverseInfo["axes"]): number {
  return Math.sqrt(
    (a.dark - b.dark) ** 2 + (a.serif - b.serif) ** 2 + (a.loud - b.loud) ** 2 + (a.ornate - b.ornate) ** 2 + (a.technical - b.technical) ** 2
  );
}

/** What a reference screenshot looks like on the same axes, from what skin-vision.ts read. Pure. */
export function axesOfRead(read: {
  bg: string | null;
  headingFace?: string | null;
  headingWeight?: string | null;
  headingScale?: string | null;
  surface?: string | null;
  labelFace?: string | null;
}): UniverseInfo["axes"] {
  const lum = (hex: string | null) => {
    if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return 1;
    const n = parseInt(hex.slice(1), 16);
    return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  };
  const face = (read.headingFace ?? "").toLowerCase();
  return {
    dark: 1 - lum(read.bg),
    serif: /serif|book|garamond|slab|didone|transitional/.test(face) && !/sans/.test(face) ? 1 : 0,
    loud: (read.headingScale === "display" ? 0.5 : 0) + (read.headingWeight === "heavy" || read.headingWeight === "bold" ? 0.5 : 0),
    ornate: read.surface && read.surface !== "flat" ? 0.5 : 0.2,
    technical: /mono/.test((read.labelFace ?? "").toLowerCase()) || read.surface === "grid" || read.surface === "dots" ? 1 : 0.2,
  };
}

/**
 * Three universes for one reference: the closest to what was read, then the two furthest from it and from
 * each other. Deterministic, so the same screenshot always offers the same three.
 */
export function threeUniverses(axes: UniverseInfo["axes"]): [HubUniverse, HubUniverse, HubUniverse] {
  const ranked = [...UNIVERSES].sort((a, b) => distance(a.axes, axes) - distance(b.axes, axes) || a.key.localeCompare(b.key));
  const first = ranked[0];
  const rest = ranked.slice(1);
  const second = [...rest].sort((a, b) => distance(b.axes, first.axes) - distance(a.axes, first.axes) || a.key.localeCompare(b.key))[0];
  const third = rest
    .filter((u) => u.key !== second.key)
    .sort(
      (a, b) =>
        Math.min(distance(b.axes, first.axes), distance(b.axes, second.axes)) -
          Math.min(distance(a.axes, first.axes), distance(a.axes, second.axes)) || a.key.localeCompare(b.key)
    )[0];
  return [first.key, second.key, third.key];
}
