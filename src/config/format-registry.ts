// The Format Registry — the ONE place a content format is declared.
//
// Content Engine v2 collapses the per-format islands (bug-reveal / POV / studio / beliefs,
// each its own file + table + Slack-router branch) into a single pipeline (src/lib/reel/
// pipeline.ts) that reads a format's config from here. Adding the 4th/5th/20th style
// (jumpscare, attic animal removal, B-roll spraying concrete, wasp removal, ...) is now a
// NEW ROW in this file, not a new island. That is what makes ~20 videos/day reachable.
//
// A format flows through the same robotic pipeline every time:
//   IDEATE (pick ideas from scenePool, gate ✅) -> SHOT(s) (generate + pick) ->
//   CAPTION (5 options, one POV) -> [RENDER only if rendersVideo] -> DELIVER
//
// The look/voice still comes from the active vertical (src/config/verticals.ts): style_token,
// gold_examples, business_descriptor. A format only declares WHAT scenes and WHICH copy voice.

import { BUG_REVEAL_SCENES } from "@/config/bug-reveal-style";

// How a format produces its asset. Only the two single-image kinds are wired in Phase 1
// (render kinds are declared for the map + future rendering-last work).
export type FormatKind =
  | "single_shot" // one hook image + captions (POV, B-roll, jumpscare)
  | "before_after_edit" // generate a "before", reveal via editImage/fresh after (bug-reveal)
  | "reference_remake" // frames -> storyboard -> POV remake (IG-link / analyzer)
  | "script_render" // image + 4 script boxes -> MP4 (reel studio)   [rendersVideo]
  | "multi_shot_render"; // storyboard -> N images -> stitched MP4     [rendersVideo, later]

// Which caption/voice the CAPTION stage writes in.
//   owner_growth = first-person pest-business OWNER quietly selling other owners on posting content
//   pov_hook     = candid first-person WTF-hook personal account (the POV drop voice)
export type CopyStyle = "owner_growth" | "pov_hook";

export interface ContentFormat {
  id: string; // stable key, stored on content_jobs.format_id
  label: string; // human label in the Slack header
  headerEmoji: string; // leading emoji in the Slack header
  verticalId: string; // which avatar/vertical this belongs to
  kind: FormatKind;
  formatGroup: string; // style_rules scope + enrichScene grounding tag
  scenePool: string[]; // the pool of "idea" scenes for IDEATE
  shotCount: number; // how many options to offer per drop
  ideaNoun: string; // label for the ideas, e.g. "before" | "scene"
  copyStyle: CopyStyle;
  rendersVideo: boolean; // deferred: false for every Phase-1 format
  inRotation: boolean; // include in the daily cron rotation
  animationSpec?: string; // extra motion guidance woven into the animation prompt (jumpscare etc.)
}

// ---------------------------------------------------------------------------------------
// Scene pools for the NEW single_shot formats. These are data — adding more variety (wasp
// removal, trap setting, spraying concrete/plants) is just extending these arrays or adding
// another ContentFormat row. No new code path.
// ---------------------------------------------------------------------------------------

// Attic animal-removal / cleaning B-roll — first-person, gloved hands in frame, real footage.
const ATTIC_BROLL_SCENES: string[] = [
  "crawling into a dim, dusty attic on hands and knees, a headlamp beam cutting across pink insulation, following a trail of droppings toward a dark corner where something has been nesting.",
  "kneeling in an attic beside a torn air duct, the wearer's gloved hand pulling back shredded insulation to reveal a hollowed-out nest packed into the joist bay.",
  "standing at the attic hatch, the wearer's gloved hand aiming a flashlight down a low crawl run, cobwebs and chewed wiring visible along the rafters ahead.",
  "crouched under a low attic rafter, the wearer's gloved hands setting a live-catch trap baited and braced against a joist, insulation flattened where an animal has been traveling.",
  "in an attic corner, the wearer's gloved hand lifting a chewed cardboard box to reveal a matted nest of shredded paper and insulation tucked against the eave.",
  "moving along an attic catwalk with a flashlight, the beam landing on a section of ductwork torn open and scattered droppings across the boards below.",
];

// POV jumpscare — same attic look, but the scene is staged so the ANIMATION ends with the
// animal lunging at the camera. The first frame is a calm search; the reveal is the motion.
const ATTIC_JUMPSCARE_SCENES: string[] = [
  "creeping deeper into a dark attic, the headlamp beam sweeping toward a black gap behind the chimney where two eyes catch the light for a split second.",
  "leaning slowly toward a hole chewed in the attic soffit, the flashlight beam pushed right up to the opening, something shifting in the shadow just inside.",
  "peering over a stack of insulation batts into the far attic bay, a dark shape pressed low against the rafters at the edge of the light.",
  "reaching a gloved hand toward a torn duct in the attic, the flashlight catching movement in the crushed insulation right beside it.",
];

// ---------------------------------------------------------------------------------------
// THE REGISTRY. Every current + new single-image format lives here as data.
// ---------------------------------------------------------------------------------------

export const FORMAT_REGISTRY: ContentFormat[] = [
  {
    id: "bug_reveal",
    label: "Bug-Reveal Spray",
    headerEmoji: "🐛",
    verticalId: "pest_control",
    kind: "before_after_edit",
    formatGroup: "bug_reveal", // keep legacy group so existing style_rules still apply
    scenePool: BUG_REVEAL_SCENES,
    shotCount: 3,
    ideaNoun: "before",
    copyStyle: "owner_growth",
    rendersVideo: false,
    inRotation: true,
  },
  {
    id: "attic_broll",
    label: "Attic Animal-Removal B-roll",
    headerEmoji: "🔦",
    verticalId: "pest_control",
    kind: "single_shot",
    formatGroup: "attic_broll",
    scenePool: ATTIC_BROLL_SCENES,
    shotCount: 3,
    ideaNoun: "scene",
    copyStyle: "pov_hook",
    rendersVideo: false,
    inRotation: true,
  },
  {
    id: "attic_jumpscare",
    label: "Attic Jumpscare (POV)",
    headerEmoji: "🙀",
    verticalId: "pest_control",
    kind: "single_shot",
    formatGroup: "attic_jumpscare",
    scenePool: ATTIC_JUMPSCARE_SCENES,
    shotCount: 3,
    ideaNoun: "scene",
    copyStyle: "pov_hook",
    rendersVideo: false,
    inRotation: true,
    animationSpec:
      "Start on the calm search shot, then at the very end the animal lunges fast toward the camera (the jumpscare payoff). Motion only, one sentence.",
  },
];

export function getFormat(id: string): ContentFormat | undefined {
  return FORMAT_REGISTRY.find((f) => f.id === id);
}

export function listFormats(): ContentFormat[] {
  return FORMAT_REGISTRY;
}

/** Formats eligible for the daily cron rotation (optionally filtered to a vertical). */
export function rotationFormats(verticalId?: string): ContentFormat[] {
  return FORMAT_REGISTRY.filter(
    (f) => f.inRotation && (!verticalId || f.verticalId === verticalId)
  );
}
