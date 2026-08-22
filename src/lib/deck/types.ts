// Slide schema for the webinar deck builder.
//
// Port of the vsl-deck-builder JSON contract. The invariant that matters: concatenating
// every run's `t` across every slide in order must reproduce the script exactly, which is
// what parity.ts proves. Spaces live INSIDE run text ("So I called "), never between runs.

export type Emphasis = "purple" | "underline" | "purple-italic";

export interface DeckRun {
  t: string;
  e?: Emphasis | null;
}

export type VisualType = "icon" | "sketch" | "diagram" | "stat-viz" | "screenshot";

export interface DeckVisual {
  type: VisualType;
  idea: string;
  prompt: string;
  search: string[];
}

export interface DeckSlide {
  n: number;
  /** ALL-CAPS section header this slide sits under ("THE THREE PROMISES"). Never rendered. */
  section?: string | null;
  runs: DeckRun[];
  /** List slides: `runs` is the lead-in line, each entry here is one bullet. */
  bullets?: DeckRun[][] | null;
  visual?: DeckVisual | null;
  /** Bracketed delivery notes pulled out of the script. Never rendered on the slide. */
  notes?: string[] | null;
}

export const VISUAL_TYPES: readonly VisualType[] = [
  "icon",
  "sketch",
  "diagram",
  "stat-viz",
  "screenshot",
];

export const EMPHASES: readonly (Emphasis | null | undefined)[] = [
  null,
  undefined,
  "purple",
  "underline",
  "purple-italic",
];

/** Every spoken word on the slide, in reading order. */
export function slideText(slide: DeckSlide): string {
  const lines = [(slide.runs ?? []).map((r) => r.t ?? "").join("")];
  for (const bullet of slide.bullets ?? []) {
    lines.push(bullet.map((r) => r.t ?? "").join(""));
  }
  return lines.filter((l) => l.trim()).join("\n");
}
