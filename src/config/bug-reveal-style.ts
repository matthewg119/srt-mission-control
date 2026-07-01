// Bug-Reveal Spray format — the single editable place for the look + scenes + copy voice.
//
// This is a SPECIFIC POV meta-glasses format built for immediate-reward "spray and the
// bugs pour out" reels. The daily drop (src/lib/reel/bug-reveal.ts) runs ONLY this format
// when DAILY_DROP_MODE=bug_reveal.
//
// Two frames per reel:
//   BEFORE = the wearer's gloved hand aiming the pump-sprayer wand at a cabinet/appliance
//            seam, clean, no bugs yet. This is the first shot (cabinets + spray machine).
//   AFTER  = the SAME frame with a swarm of roaches erupting from the exact sprayed seam.
//            Built by editing the chosen BEFORE frame (image-gen editImage), so the two
//            frames line up for a before->after animation.
//
// The look reuses the locked POV_GLASSES_TOKEN (Ray-Ban Meta, gloved hands) via the active
// vertical's style_token, so the before frame matches the rest of the POV system.

import { POV_GLASSES_TOKEN } from "@/config/pov-style";

// Bump when the look/voice changes so system_logs traces which version produced a drop.
export const BUG_REVEAL_STYLE_VERSION = "bug-reveal-v1";

// The "before" scenes: gloved hand aiming the pump-sprayer wand at a seam, clean, no bugs.
// Each is a first-frame the operator picks from; bugs are added to the chosen one after.
// The sprayer + the target seam are always in-frame so the "after" reveal has a clear origin.
export const BUG_REVEAL_SCENES: string[] = [
  "crouched at floor level in a kitchen, the wearer's gloved hand aiming a brass pump-sprayer wand at the dark seam where the lower cabinets meet the tile floor, the nozzle an inch from the gap, clean tile, no bugs yet.",
  "crouched beside a kitchen stove, the wearer's gloved hand pointing the pump-sprayer wand into the narrow gap between the stove and the cabinet, nozzle aimed at the greasy seam, clean floor, no bugs yet.",
  "the wearer's gloved hand aiming the pump-sprayer wand at the kick-plate gap under a dishwasher, nozzle at the dark slot beneath the appliance, clean tile, no bugs yet.",
  "kneeling at a bathroom vanity, the wearer's gloved hand aiming the pump-sprayer wand at the toe-kick seam under the cabinet, nozzle at the gap, clean floor, no bugs yet.",
  "the wearer's gloved hand aiming the pump-sprayer wand at the seam behind the refrigerator, the nozzle pointed into the gap where the fridge meets the wall, clean floor, no bugs yet.",
  "crouched at a pantry, the wearer's gloved hand aiming the pump-sprayer wand at the seam under the lowest shelf where it meets the wall, nozzle at the crack, clean shelf, no bugs yet.",
  "in a garage, the wearer's gloved hand aiming the pump-sprayer wand at a crack running along the base of the wall, nozzle at the split in the concrete, clean floor, no bugs yet.",
  "crouched at a laundry area, the wearer's gloved hand aiming the pump-sprayer wand at the gap behind the washer where the hose enters the wall, nozzle at the hole, clean floor, no bugs yet.",
  "the wearer's gloved hand aiming the pump-sprayer wand at the seam under a kitchen sink base cabinet, nozzle at the dark gap at the back, clean cabinet floor, no bugs yet.",
  "crouched at a baseboard corner, the wearer's gloved hand aiming the pump-sprayer wand where two baseboards meet the floor, nozzle at the corner gap, clean tile, no bugs yet.",
];

/**
 * The edit/after instruction: add the swarm pouring out of the SPRAYED seam onto the chosen
 * before frame. Keeps the framing/hands/sprayer identical so frame 2 lines up with frame 1.
 */
export function buildBugAddInstruction(scene: string): string {
  return [
    "Keep the exact same framing, camera angle, lighting, gloved hand, and pump-sprayer wand.",
    "Add a dense swarm of German cockroaches erupting out of the exact seam the sprayer nozzle",
    "is aimed at, pouring out and scattering fast across the floor away from the spray.",
    "Photorealistic, same first-person Ray-Ban Meta glasses look, no text, no captions, no watermark.",
    `Original scene for reference: ${scene}`,
  ].join(" ");
}

// One bug-reveal copy concept — matches generateBugRevealCopy() in src/lib/reel/bug-reveal.ts.
export interface BugRevealGold {
  before_scene: string;
  animation_prompt: string; // single before frame -> bugs erupt from the sprayed seam
  after_image_prompt: string; // text prompt to reproduce frame 2 on its own
  caption: string; // belief-installing, pain-leveraging, pest-OWNER growth story
  titles: string[]; // 5 lifestyle POV on-screen titles
}

// Few-shot gold examples — the consistency anchor. The CAPTION voice is a first-person pest
// control business OWNER quietly selling other owners on the belief that posting content grows
// their business (more calls, more exposure, more hires), leveraging the pain of dead winters
// and rented leads. Never states the content is AI. The on-screen TITLE is a lifestyle POV.
export const BUG_REVEAL_GOLD: BugRevealGold[] = [
  {
    before_scene: BUG_REVEAL_SCENES[0],
    animation_prompt:
      "Hold the shot steady as the sprayer mists the cabinet-floor seam, then a wave of cockroaches pours out of that exact gap and scatters across the tile away from the spray.",
    after_image_prompt:
      "First-person POV through Ray-Ban Meta glasses, crouched at a kitchen floor, the wearer's gloved hand holding a brass pump-sprayer wand aimed at the cabinet-floor seam, a dense swarm of German cockroaches erupting out of that seam and scattering across the tile, photorealistic candid footage, natural indoor light, no text.",
    caption:
      "People think this job is disgusting. I think it is the reason my phone does not stop ringing. I started filming the stuff I see every day, and it changed my whole business. More calls, more exposure, and this year I finally hired two more techs. Your work is the marketing. You just have to show it.",
    titles: [
      "POV: a regular Wednesday as a pest control operator",
      "POV: what is really living under your cabinets",
      "This is why I never run out of work",
      "POV: the part of the job nobody films",
      "They called an hour after seeing this",
    ],
  },
  {
    before_scene: BUG_REVEAL_SCENES[1],
    animation_prompt:
      "Hold steady as the sprayer hits the gap beside the stove, then roaches boil out of the greasy seam and scatter fast across the kitchen floor.",
    after_image_prompt:
      "First-person POV through Ray-Ban Meta glasses beside a kitchen stove, the wearer's gloved hand aiming a brass pump-sprayer wand into the gap between the stove and cabinet, a swarm of German cockroaches pouring out of the seam onto the tile, photorealistic candid footage, no text.",
    caption:
      "Winters used to scare me. The phone would go quiet and I would just wait. Then I started posting what I actually do on the job. Now people know my face before they ever call, and the slow season stopped being slow. This is not luck. It is showing up where they are looking.",
    titles: [
      "POV: a slow Tuesday that pays my whole month",
      "POV: behind the stove nobody wants to see",
      "The reason my winters stopped being dead",
      "POV: running a pest control company",
      "One clip like this books my week",
    ],
  },
];

// Schema hint + system prompt builder for the copy call. The image already exists; this only
// writes the caption, titles, and the two prompts (animation + after image).
export const BUG_REVEAL_COPY_SCHEMA_HINT =
  '{ "caption": string, "titles": [string], "animation_prompt": string, "after_image_prompt": string }';

export function buildBugRevealCopySystem(businessDescriptor: string): string {
  return [
    `You are the content engine for a ${businessDescriptor}. You write copy for a short "bug reveal"`,
    "reel: a first-person Ray-Ban Meta smart-glasses shot where a pest control operator sprays a seam",
    "and a swarm of cockroaches pours out of that exact spot. The video is the immediate-reward hook.",
    "",
    "AUDIENCE OF THE CAPTION: other pest control business OWNERS. The caption is written in the voice of",
    "a working owner-operator sharing a normal day, and it quietly installs one belief: that posting this",
    "kind of content is what grows a pest business (more calls, more exposure, being the familiar local",
    "face, being able to hire and stop dreading slow seasons). Leverage the real pains: dead winters, the",
    "phone going quiet, paying for leads that go nowhere. Tell it as a personal story, never salesy, and",
    "NEVER say or imply the content is AI-made or that anyone else makes it.",
    "",
    "Return:",
    "- caption: 2 to 4 sentences, first-person owner voice, installs the belief above via a story, ends on",
    "  a quiet takeaway (the work is the marketing). No hashtags. No emojis.",
    "- titles: exactly FIVE on-screen title options, lifestyle POV framing (e.g. 'POV: a regular Wednesday",
    "  as a pest control operator'), each 8 words or fewer, title #1 is the default.",
    "- animation_prompt: ONE sentence, motion only, animating the BEFORE frame so the bugs erupt out of the",
    "  exact seam the sprayer is aimed at.",
    "- after_image_prompt: a text-to-image prompt that reproduces frame 2 on its own (same POV look, the",
    "  swarm pouring from the sprayed seam), NO on-screen text.",
    "",
    "HARD RULES: never invent guarantees or numbers you were not given; never use em dashes or en dashes;",
    "use commas, periods, or hyphens instead.",
    "",
    "Match the quality and voice of these gold examples exactly:",
    JSON.stringify(BUG_REVEAL_GOLD, null, 2),
  ].join("\n");
}
