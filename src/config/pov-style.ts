// Meta Glasses POV format — single editable place for the look + scene list.
//
// This is the POV analog of reel-style.ts. The Daily Creative Drop's belief format
// stays untouched; this drives a SECOND, first-person "personal account of a pest
// control specialist" drop, styled to look like real Ray-Ban Meta smart-glasses
// footage (the wearer's own gloved hands doing the task). The image is auto-generated
// (gpt-image-2) from POV_GLASSES_TOKEN + a scene; the creative copy comes from
// src/lib/reel/pov.ts using POV_GOLD_EXAMPLES as the consistency anchor.

// Bump when the look changes so the system_logs footer traces which version produced a drop.
export const POV_STYLE_VERSION = "pov-glasses-v1";

// The locked global style token. Woven into EVERY POV image (and animation) prompt.
// This is the POV analog of HOUSE_STYLE_PROMPT — it guarantees the "real captured
// footage" look so the scene only has to describe the action.
export const POV_GLASSES_TOKEN =
  "First-person POV as if recorded on Ray-Ban Meta smart glasses: eye-level head-mounted camera, " +
  "the wearer's own gloved hands and forearms visible in the lower frame doing the task, " +
  "mild wide-angle lens with slight barrel distortion, subtle natural handheld head-movement, " +
  "realistic natural daylight, true-to-life un-graded color, candid and authentic, " +
  "looks like real captured footage, not a studio or cinematic shot.";

// Format 1 b-roll ideas rewritten to first-person POV (the wearer's own hands do the
// task). The style token carries the look; each scene only describes the action.
export const POV_SCENES: string[] = [
  "walking out across a green suburban backyard at golden hour, the wearer's gloved hand raising a backpack-fogger wand as the first puff of mist leaves the nozzle.",
  "crouched indoors, the wearer's gloved hand drawing one clean even line of treatment along the wall-floor baseboard seam.",
  "reaching up into a shaded porch ceiling corner, the wearer's gloved hand sweeping a web-duster pole through thick cobwebs.",
  "pouring granular bait into a hand spreader, the wearer's gloved hands tilting the bag as the granules scatter across the grass.",
  "the wearer's gloved hand injecting dust from a crack-and-crevice tool into a thin gap along a wall.",
  "tracing the sprayer wand around the concrete foundation perimeter of a house, the wearer's gloved hand keeping the band even.",
  "the wearer's gloved hand feeding expanding foam into a floor drain to kill drain flies.",
  "dragging a treatment hose around a wooden deck, the wearer's gloved hand laying down clean even coverage.",
  "the wearer's gloved hands opening a tamper-proof rodent bait station on a garage floor to check the bait inside.",
  "kneeling at a home's foundation, the wearer's gloved hand running a caulk gun along a gap to seal it.",
  "the wearer's gloved hand sliding a glue board into the gap behind an oven and pulling back to check it.",
  "stepping into a dim attic, the wearer's gloved hand sweeping a flashlight beam across the insulation.",
  "the wearer's gloved hand peeling back garden mulch from the foundation to expose the soil and check for mud tubes.",
  "the wearer's gloved hand tipping a plant saucer to dump standing water off a patio table.",
  "fitting a rubber door sweep under a garage door, the wearer's gloved hands pressing it into the gap.",
];

// gpt-image-2 portrait size for the Meta-glasses look (3:4). Both edges divisible by 16,
// aspect within the model's 1:3..3:1 range. (Reels crop/letterbox to 9:16 in post.)
export const POV_IMAGE_SIZE = "1024x1536";

// One POV concept shape — matches src/lib/reel/pov.ts PovConcept and the gold examples.
export interface PovGoldExample {
  idea: string;
  image_prompt: string;
  animation_prompt: string;
  captions: { authority: string; relatable: string; curiosity: string };
  titles: string[];
}

// Few-shot gold examples — the consistency mechanism. pov.ts injects these verbatim
// into the creative prompt. Match this quality and style exactly when editing scenes.
export const POV_GOLD_EXAMPLES: PovGoldExample[] = [
  {
    idea: "POV walking out across the backyard at dusk, fog rolling off the machine across the grass.",
    image_prompt:
      "First-person POV through Ray-Ban Meta glasses: standing at the edge of a green suburban backyard at golden hour, the wearer's own gloved right hand gripping a backpack-fogger wand raised slightly, the first fine puff of mist leaving the nozzle, mild wide-angle lens, warm natural evening light, candid realistic footage, slight handheld movement.",
    animation_prompt:
      "Slow walk forward across the lawn with a gentle natural head-bob, thick low fog billowing out and drifting over the grass ahead, gloved hand steady on the wand.",
    captions: {
      authority:
        "One evening fog treatment knocks down the adult mosquito population before the weekend. This is how you actually get your yard back.",
      relatable:
        "Me vs. the mosquitoes that turned my own backyard against me. Spoiler: I won.",
      curiosity: "This is what mosquito season looks like ending in real time.",
    },
    titles: [
      "POV: ending mosquito season in one lap",
      "POV: taking my backyard back",
      "The fog that ruins their summer",
      "POV: one pass = a usable yard",
      "Mosquitoes hate this part",
      "POV: golden hour, zero bites",
    ],
  },
  {
    idea: "POV crouched indoors, laying one clean even line of treatment along the baseboard.",
    image_prompt:
      "First-person POV through Ray-Ban Meta glasses: crouched at floor level inside a home, the wearer's own gloved hand holding a sprayer wand at the start of a baseboard, a clean even band of treatment just beginning along the wall-floor seam, mild wide-angle lens, soft natural indoor daylight, candid realistic footage.",
    animation_prompt:
      "Hand draws the sprayer wand smoothly along the baseboard left to right, the even treatment line extending as the head follows the motion.",
    captions: {
      authority:
        "Pests travel the wall-floor line. Treat that seam correctly and you build a barrier they won't cross for 90 days.",
      relatable:
        "Oddly the most satisfying part of my whole day and I'm not even mad about it.",
      curiosity:
        "There's one line in your house bugs refuse to cross. Here's how it's made.",
    },
    titles: [
      "POV: drawing the line they won't cross",
      "POV: 90 days of protection in one pass",
      "The seam every bug travels",
      "POV: the most satisfying part of the job",
      "This line keeps them out",
      "POV: building the barrier",
    ],
  },
  {
    idea: "POV reaching up into a porch ceiling corner and sweeping away a thick web with the duster.",
    image_prompt:
      "First-person POV through Ray-Ban Meta glasses: looking up at a shaded porch ceiling corner thick with cobwebs, the wearer's own gloved hand raising a web-duster pole toward it, mild wide-angle lens, natural daylight from the side, candid realistic footage, slight handheld movement.",
    animation_prompt:
      "The duster sweeps up and across the corner, the cobwebs catching and pulling away clean as the head tilts to follow.",
    captions: {
      authority:
        "Knock down the webs and you remove the egg sacs with them. Prevention starts with the corners nobody looks at.",
      relatable:
        "POV: I finally looked up at my own porch ceiling. Should not have waited this long.",
      curiosity: "The part of your house you never look at is where it all starts.",
    },
    titles: [
      "POV: spider eviction day",
      "POV: the corner you never look at",
      "Webs gone in one sweep",
      "POV: clearing what nobody checks",
      "This is where they hide",
      "POV: porch, reclaimed",
    ],
  },
];

// Every POV image prompt is the style token + the scene + a no-text guard (text is
// added in post, never baked into the image).
export function buildPovImagePrompt(scene: string): string {
  return `${POV_GLASSES_TOKEN}\n\nScene: ${scene}\n\nNo text, captions, logos, or watermark in the image.`;
}
