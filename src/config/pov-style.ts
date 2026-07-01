// Meta Glasses POV format — single editable place for the look + scene list.
//
// NOTE: As of Content Engine v2 these constants are the `pest_control` vertical SEED.
// The generators (pov.ts / pov-studio.ts) read from the active vertical via
// src/config/verticals.ts; these values populate PEST_CONTROL_SEED there. Edit a
// vertical row in the DB to override per vertical; edit here to change the seed default.
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

// WTF-hook scenes: each leads with a scroll-stopping REVEAL (an infestation, a swarm
// eruption, a gross discovery) that the wearer's own gloved hands act on. The dry
// "task only" scenes were removed because they render into flat, nothing-happening
// images; every scene here has a clear visual payoff in frame. The style token carries
// the Meta-glasses look; each scene only describes the reveal + the action.
export const POV_SCENES: string[] = [
  "sliding a kitchen refrigerator out from the wall, the wearer's gloved hands gripping the sides as a dense cluster of cockroaches erupts from behind it and scatters across the tile floor.",
  "prying the cover off an outdoor electrical meter box, the wearer's gloved hand lifting it away to reveal a thick crawling ball of wasps packed over a grey paper comb.",
  "peeling a strip of baseboard away from a wall, the wearer's gloved hand pulling it back to expose a hollow termite gallery and crumbling mud tubes packed with pale termites.",
  "tipping over a chewed-open bag of dog food in a pantry, the wearer's gloved hand lifting it as a nest of mice scatters and pink pups are exposed in the shredded lining.",
  "opening an attic hatch and raising a flashlight, the wearer's gloved hand sweeping the beam across chewed insulation blanketed in rodent droppings.",
  "lifting the corner of a mattress, the wearer's gloved hand peeling back the fabric to reveal a cluster of bed bugs and dark spotting crawling along the seam.",
  "pulling a dryer vent duct off the wall, the wearer's gloved hands twisting it free as a wad of nesting material and scurrying insects tumbles out onto the floor.",
  "cutting a flap of drywall open with a utility knife, the wearer's gloved hand folding it back to expose a basketball-size paper wasp nest packed inside the wall void.",
  "reaching into a cluttered dim garage corner, the wearer's gloved hand freezing as a hand-size wolf spider darts across the glove and up the forearm.",
  "lifting a heavy floor drain cover in a basement, the wearer's gloved hand raising it as a boil of drain flies and small roaches pours up out of the dark hole.",
  "peeling back a layer of garden mulch against a house foundation, the wearer's gloved hand exposing a writhing mat of termites and eggs in the damp soil.",
  "opening a tamper-proof rodent bait station on a garage floor, the wearer's gloved hand lifting the lid to reveal it gutted with droppings everywhere and one mouse frozen mid-scurry.",
  "the wearer's gloved hand sweeping a spray nozzle along a kitchen baseboard as a cluster of roaches breaks apart and scurries out of frame.",
  "sliding a stove away from the wall, the wearer's gloved hands revealing a greasy gap where a swarm of German cockroaches pours out across the tile.",
];

// Higgsfield Soul portrait size for the Meta-glasses look — true 3:4 (1536x2048),
// matching the studio setting that produced the good images. (Reels crop to 9:16 in post.)
export const POV_SOUL_SIZE = "1536x2048";

// (Legacy) gpt-image-2 portrait size, kept for the OpenAI fallback path. POV now runs on
// Higgsfield Soul (no character), so POV_SOUL_SIZE above is the size actually used.
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
