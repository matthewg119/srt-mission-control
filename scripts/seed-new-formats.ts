// One-shot: seed 3 NEW pest_control workflows (Matthew, 2026-07-03):
//   1. Before / After Transformation  (category before_after)
//   2. Seasonal Pest Alert            (broll)
//   3. Review Highlight               (broll)
// All non-POV: 9:16 on gpt-image-2 (higgsfield-gpt), the proven 3-shot/13s skeleton with
// 6 timed copy slots, status active. Idempotent (upsert by id). After running, regenerate
// the docs: generate-sourcing-worksheet.ts + generate-workflow-docs.ts.

import type { Workflow, WorkflowScene, CopyRole, RenderSpec } from "../src/config/workflows";
import { upsertWorkflow, setWorkflowProfile } from "../src/lib/reel/workflow-author";

const SHOTS = [
  { i: 1, start: 0, end: 4 },
  { i: 2, start: 4, end: 8.5 },
  { i: 3, start: 8.5, end: 13 },
];

const BASE_SLOTS: CopyRole[] = [
  { key: "avatar", label: "Avatar / hook", guidance: "Name who this is for or open the hook.", shot: 1, at_second: 0, out_second: 4, position: "upper_middle" },
  { key: "pain_callout", label: "Pain callout", guidance: "One-line pain/curiosity that stops the scroll.", shot: 1, at_second: 0.5, out_second: 4, position: "center" },
  { key: "increase_pain", label: "Increase pain / escalate", guidance: "Twist the knife or raise the stakes.", shot: 2, at_second: 4, out_second: 8.5, position: "upper_middle" },
  { key: "logical_reason", label: "Logical reason", guidance: "The because: why this is real.", shot: 2, at_second: 4.8, out_second: 8.5, position: "center" },
  { key: "dream_outcome", label: "Dream outcome / payoff", guidance: "The desired result or the reveal.", shot: 3, at_second: 8.5, out_second: 13, position: "upper_middle" },
  { key: "cta", label: "CTA", guidance: "Single clear call to action.", shot: 3, at_second: 9.5, out_second: 13, position: "lower" },
];

const NO_TEXT_RULE = "No text, captions, logos, or watermarks inside the image.";

interface Seed {
  id: string;
  name: string;
  category: string;
  subcategory: string;
  description: string;
  visual_rules: string[];
  slots?: CopyRole[]; // override guidance per format
  scenes: Array<{ role: string; image: string; anim: string }>;
  example: [string, string, string, string, string, string];
}

const SEEDS: Seed[] = [
  {
    id: "pest_control__before_after__transformation",
    name: "Before / After Transformation",
    category: "before_after",
    subcategory: "transformation",
    description:
      "13s 3-shot before/after: the visible infestation or damage, the treatment moment, then the SAME angle spotless. The evidence is the subject; the locked repeat angle sells the transformation.",
    visual_rules: [
      "Shot 1 (before) and shot 3 (after) are the SAME location from the SAME camera angle and height - a locked repeat frame; only the pest evidence changes.",
      "The evidence is the subject: visible infestation, damage, droppings, nests, trails - never a person.",
      "Shot 2 is the work: gloved hands and equipment mid-treatment, documentary and real.",
      "Real lived-in homes, natural daylight, documentary grade; no staging, no studio light.",
      "No faces or full human figures; gloved hands and forearms at most.",
      NO_TEXT_RULE,
    ],
    scenes: [
      { role: "the BEFORE (locked angle)", image: "Documentary photo of a kitchen corner baseboard with a visible ant trail and scattered droppings along the caulk line, morning light, eye-level locked angle", anim: "Static hold with a slow subtle push toward the trail." },
      { role: "the treatment moment", image: "Gloved hands applying gel bait along the same kitchen baseboard with a precision applicator, equipment case open on the tile floor", anim: "Close working motion following the applicator tip." },
      { role: "the AFTER (same locked angle)", image: "The exact same kitchen corner baseboard, spotless and clean, same eye-level locked angle and morning light, no insects anywhere", anim: "Static hold mirroring shot 1, slow settle." },
    ],
    example: ["Your kitchen, 3 weeks ago", "You stopped putting food on that counter", "It was worse inside the wall", "One targeted treatment finds the nest", "Same corner today. Nothing.", "Book the free inspection, link in bio"],
  },
  {
    id: "pest_control__broll__seasonal_alert",
    name: "Seasonal Pest Alert",
    category: "broll",
    subcategory: "seasonal_alert",
    description:
      "13s 3-shot seasonal warning: the season cue (weather turning), the pest surge it triggers, the protected home. News-alert urgency over documentary b-roll.",
    visual_rules: [
      "Urgent news-alert energy carried by the b-roll: weather turning, activity surging, then calm.",
      "Shot 1 is the SEASON, not a pest: first warm day, spring rain, falling leaves, snow melt on a suburban street.",
      "Shot 2 is the surge: dramatic close-up of seasonal pest activity (swarm, trail, nest building).",
      "Shot 3 is the protected home: calm suburban house, subtle evidence of treatment (barrier band, tech leaving).",
      "Muted documentary grade, region-neutral suburbs; no faces.",
      NO_TEXT_RULE,
    ],
    scenes: [
      { role: "the season cue", image: "Cinematic b-roll of the first warm spring day on a suburban street, snow patches melting on lawns, bright low sun, dew on grass", anim: "Slow drift down the street as heat shimmer rises." },
      { role: "the pest surge", image: "Macro b-roll of winged termite swarmers emerging from a crack at a home's foundation, dozens taking flight in warm light", anim: "Macro hold as the swarm intensifies." },
      { role: "the protected home", image: "Calm b-roll of a tidy suburban home at golden hour with a fresh treatment band visible along the foundation line, quiet street", anim: "Gentle rise from the barrier band up the facade." },
    ],
    example: ["It hit 70 this week", "That number means something is waking up", "Swarm season starts at your foundation", "Every warm snap triggers the next wave", "Protected homes do not notice the season", "Get ahead of it, link in bio"],
  },
  {
    id: "pest_control__broll__review_highlight",
    name: "Review Highlight",
    category: "broll",
    subcategory: "review_highlight",
    description:
      "13s 3-shot customer-review reel: the review quote leads over warm job b-roll - arrival context, the careful detail work, the happy result at the door.",
    visual_rules: [
      "Warm, authentic job b-roll that a real customer's words sit on top of - trust, not drama.",
      "Shot 1 sets context: service truck arriving, tech walking up, morning suburban street.",
      "Shot 2 is the care: close detail work done carefully (dusting an eave, sealing a gap), gloved hands ok.",
      "Shot 3 is the happy ending: the clean result at the front door, welcoming light, job done.",
      "No faces (framing crops at shoulders or shoots from behind); warm natural grade.",
      NO_TEXT_RULE,
    ],
    slots: [
      { key: "avatar", label: "Review quote (verbatim)", guidance: "The customer's line, word for word, quotes on.", shot: 1, at_second: 0, out_second: 4, position: "upper_middle" },
      { key: "pain_callout", label: "Their problem", guidance: "What they were dealing with before the call.", shot: 1, at_second: 0.5, out_second: 4, position: "center" },
      { key: "increase_pain", label: "What we found", guidance: "The real cause, in one plain line.", shot: 2, at_second: 4, out_second: 8.5, position: "upper_middle" },
      { key: "logical_reason", label: "What we did", guidance: "The fix, no jargon.", shot: 2, at_second: 4.8, out_second: 8.5, position: "center" },
      { key: "dream_outcome", label: "The result", guidance: "Their outcome in their words if possible.", shot: 3, at_second: 8.5, out_second: 13, position: "upper_middle" },
      { key: "cta", label: "CTA", guidance: "Single clear call to action.", shot: 3, at_second: 9.5, out_second: 13, position: "lower" },
    ],
    scenes: [
      { role: "arrival context", image: "Warm b-roll of a clean service truck parked at the curb of a suburban home, technician walking up the driveway carrying a kit, framed from behind, morning light", anim: "Slow follow up the driveway." },
      { role: "the careful detail work", image: "Close warm b-roll of gloved hands carefully sealing a small gap at a home's foundation with precision tools, unhurried and thorough", anim: "Steady close-in on the careful hand work." },
      { role: "the happy result", image: "Warm b-roll of a spotless front porch and door at soft evening light, welcome mat neat, house calm and protected", anim: "Gentle push toward the glowing doorway." },
    ],
    example: ["\"They found what two other companies missed\"", "Ants every spring for three years", "A gap behind the hose bib the whole time", "Sealed it and treated the trail line", "\"First spring with zero ants\"", "Read our reviews, link in bio"],
  },
];

function buildSpec(seed: Seed, slots: CopyRole[]): RenderSpec {
  return {
    mode: "static_images",
    song_ref: null,
    duration_seconds: 13,
    shots: SHOTS.map((s) => ({ ...s })),
    texts: slots.map((r, i) => ({
      n: i + 1,
      text: seed.example[i],
      at_second: r.at_second!,
      out_second: r.out_second,
      position: r.position,
      role: r.key,
    })),
  };
}

async function main() {
  for (const seed of SEEDS) {
    const slots = seed.slots ?? BASE_SLOTS;
    const scenes: WorkflowScene[] = seed.scenes.map((s) => ({
      role: s.role,
      image_prompt: s.image,
      animation_prompt: s.anim,
      duration_seconds: 4,
      image_url: null,
      image_approved: false,
    }));
    const wf: Workflow = {
      id: seed.id,
      vertical_id: "pest_control",
      name: seed.name,
      category: seed.category,
      subcategory: seed.subcategory,
      status: "active",
      scenes,
      captions: slots.map((r, i) => ({ text: seed.example[i], at_second: r.at_second! })),
      copy_structure: slots.map((r) => ({ ...r })),
      render_spec: buildSpec(seed, slots),
      song_ref: null,
      render_sequences: [],
      render_options: { min_shots: 3, max_shots: 3, aspect: "9:16", provider: "openai" },
      example_video_url: null,
      example_storyboard: null,
      shot_screenshots: [],
      source_kind: "seeded",
      source_example_id: null,
    };
    const ok = await upsertWorkflow(wf);
    if (ok) {
      await setWorkflowProfile(seed.id, { description: seed.description, visual_rules: seed.visual_rules });
      console.log(`seeded ${seed.id} (${seed.category}, 9:16)`);
    } else {
      console.log(`FAILED ${seed.id}`);
    }
  }
  console.log("Done. Re-run generate-sourcing-worksheet.ts + generate-workflow-docs.ts.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
