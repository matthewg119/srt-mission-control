// One-shot: configure the 9 unconfigured draft workflows so every one is ACTIVE and
// session-ready today. Each gets the proven Local-Owner skeleton (3 shots / 13s / 6 timed
// text slots) + its own scenes, description, and visual rules (Meta-glasses POV b-roll for
// the pov ones), with images explicitly on the GPT image model (higgsfield-gpt) at 3:4.
//
// Usage:  bun run scripts/configure-draft-workflows.ts
// Safe to re-run (upsert by id). Run AFTER docs/2026-07-05-workflow-systemization.sql.
//
// The copy here is EXAMPLE copy (render_spec defaults) - every session regenerates the
// lines from the hooks, so these only exist so validateRenderSpec passes and the editor
// page shows a real timeline. Statuses: active + building (the 3-ref -> 4-variation
// onboarding still applies per workflow).

import { loadWorkflow, type Workflow, type CopyRole, type RenderSpec, type WorkflowScene } from "../src/config/workflows";
import { upsertWorkflow, setWorkflowProfile } from "../src/lib/reel/workflow-author";

// The Local-Owner timing skeleton: 3 shots, 13s, two text drops per shot (CTA rides low).
const SHOTS = [
  { i: 1, start: 0, end: 4 },
  { i: 2, start: 4, end: 8.5 },
  { i: 3, start: 8.5, end: 13 },
];

const SLOTS: CopyRole[] = [
  { key: "avatar", label: "Avatar / POV hook", guidance: "Name who this is for or open the POV.", shot: 1, at_second: 0, out_second: 4, position: "upper_middle" },
  { key: "pain_callout", label: "Pain callout", guidance: "One-line pain/curiosity that stops the scroll.", shot: 1, at_second: 0.5, out_second: 4, position: "center" },
  { key: "increase_pain", label: "Increase pain / escalate", guidance: "Twist the knife or raise the stakes.", shot: 2, at_second: 4, out_second: 8.5, position: "upper_middle" },
  { key: "logical_reason", label: "Logical reason", guidance: "The because: why this is real.", shot: 2, at_second: 4.8, out_second: 8.5, position: "center" },
  { key: "dream_outcome", label: "Dream outcome / payoff", guidance: "The desired result or the reveal.", shot: 3, at_second: 8.5, out_second: 13, position: "upper_middle" },
  { key: "cta", label: "CTA", guidance: "Single clear call to action.", shot: 3, at_second: 9.5, out_second: 13, position: "lower" },
];

const POV_RULES = [
  "Every frame is first-person POV through Ray-Ban Meta glasses; gloved hands may enter frame, never a face.",
  "Real suburban job-site settings, natural daylight, documentary look; no studio lighting.",
  "The three shots read as ONE continuous job (same house, same time of day).",
  "No text, captions, logos, or watermarks inside the image.",
];

interface Theme {
  id: string;
  description: string;
  visual_rules: string[];
  scenes: Array<{ role: string; image: string; anim: string }>;
  example: [string, string, string, string, string, string]; // one per SLOT
}

const THEMES: Theme[] = [
  {
    id: "pest_control__pov__spray_indoor",
    description: "13s 3-shot Meta-glasses POV: inside a home, find the activity, treat the baseboards, clean finish.",
    visual_rules: POV_RULES,
    scenes: [
      { role: "spot the activity indoors", image: "First-person POV through Meta glasses crouched at a kitchen baseboard, ants trailing along the caulk line toward the pantry, gloved hand pointing", anim: "Slow push in along the baseboard following the trail." },
      { role: "treat the baseboards", image: "First-person POV running a precision spray wand along the kitchen baseboard, fine mist visible, tile floor and cabinet kicks in frame", anim: "Steady lateral glide as the wand tracks the baseboard." },
      { role: "clean kitchen result", image: "First-person POV of the same spotless kitchen baseboard, no insects, morning light across the tile", anim: "Slow settle on the clean line, slight tilt up to the counter." },
    ],
    example: ["POV: the ants came back again", "You keep spraying store stuff and they keep coming", "They are nesting INSIDE the wall", "Store sprays never reach the nest", "One barrier treatment, gone for the season", "Book the free inspection, link in bio"],
  },
  {
    id: "pest_control__pov__attic_jumpscare",
    description: "13s 3-shot Meta-glasses POV attic reveal: dark climb, the jumpscare find, the cleared attic.",
    visual_rules: [...POV_RULES, "Shots 1-2 are dark flashlight-lit attic; shot 3 breaks to bright resolution."],
    scenes: [
      { role: "climb into the dark attic", image: "First-person POV pushing open an attic hatch from a ladder, flashlight beam cutting across insulation and rafters in the dark", anim: "Beam sweeps the rafters as the camera rises through the hatch." },
      { role: "the find (jumpscare)", image: "First-person POV flashlight landing on a dense cluster of droppings and a chewed wire along a rafter, insulation pushed into a nest pocket", anim: "Quick whip to the nest pocket, then a slow creep closer." },
      { role: "cleared and sealed", image: "First-person POV of the same attic corner cleaned, new insulation batts, sealed entry point patched with metal mesh, work light on", anim: "Steady reveal pan across the cleaned corner to the sealed hole." },
    ],
    example: ["POV: your attic at 7am", "You hear the scratching at night", "This is what the scratching was", "They chew wires, that is the fire risk", "Sealed, cleaned, quiet again", "Get the attic checked, link in bio"],
  },
  {
    id: "pest_control__pov__attic_regular",
    description: "13s 3-shot Meta-glasses POV attic inspection: entry, evidence walkthrough, sealed result.",
    visual_rules: POV_RULES,
    scenes: [
      { role: "enter the attic", image: "First-person POV stepping up through an attic hatch in daylight, headlamp on, insulation and trusses stretching back", anim: "Rise through the hatch and level out down the truss line." },
      { role: "walk the evidence", image: "First-person POV gloved hand lifting insulation to show a rodent runway and droppings along a top plate", anim: "Hand lifts the batt, slow tilt along the runway." },
      { role: "sealed entry point", image: "First-person POV of a gable vent freshly backed with hardware cloth, clean insulation laid back in place", anim: "Push toward the sealed vent, light flare through the mesh." },
    ],
    example: ["POV: the attic inspection you kept skipping", "That smell upstairs is not the weather", "Runways, droppings, chewed batts", "They come in through one gap you never see", "One seal, no more visitors", "Free attic check, link in bio"],
  },
  {
    id: "pest_control__pov__wasp_removal",
    description: "13s 3-shot Meta-glasses POV wasp job: the nest reveal, the removal, the clean eave.",
    visual_rules: POV_RULES,
    scenes: [
      { role: "reveal the nest", image: "First-person POV looking up at a grey paper wasp nest under a roof eave, wasps crawling over it in afternoon sun", anim: "Slow tilt up the eave, a few wasps lift off." },
      { role: "bag the nest", image: "First-person POV sliding a thick contractor bag up over the wasp nest, gloved hands cinching it closed, wasps scattering", anim: "The bag sweeps up and cinches in one motion." },
      { role: "clean eave", image: "First-person POV of the bare clean eave where the nest was, sealed bag held up in a gloved hand against blue sky", anim: "Settle on the clean eave, bag lifts into frame." },
    ],
    example: ["POV: you found this above your door", "Do NOT knock it down yourself", "Every hit makes the swarm angrier", "They rebuild unless the queen goes", "One bag, gone for good", "Same-day removal, link in bio"],
  },
  {
    id: "pest_control__pov__spray_outdoor",
    description: "13s 3-shot Meta-glasses POV perimeter treatment: the entry points, the barrier spray, the protected home.",
    visual_rules: POV_RULES,
    scenes: [
      { role: "find the entry points", image: "First-person POV crouched at a home's foundation line, gloved finger pointing at a gap under the siding with ant activity", anim: "Track along the foundation to the gap." },
      { role: "lay the barrier", image: "First-person POV sweeping a spray wand along the foundation and door threshold, visible treatment band on the concrete", anim: "Smooth walking glide as the wand paints the band." },
      { role: "protected house wide", image: "First-person POV stepping back from a tidy suburban home at golden hour, treated perimeter drying, truck at the curb", anim: "Slow pull back and tilt up the facade." },
    ],
    example: ["POV: where they actually get in", "It is never the front door", "Every gap at the slab is a highway", "The barrier stops them before the kitchen", "One treatment, a quiet season", "Get on the route, link in bio"],
  },
  {
    id: "pest_control__story__storytime",
    description: "13s 3-shot storytime: job b-roll carries a first-person story with a twist payoff.",
    visual_rules: [
      "Cinematic documentary b-roll of a real pest job; shots support a spoken story, faces avoided.",
      "The three shots escalate: setup, complication, payoff.",
      "No text, captions, logos, or watermarks inside the image.",
    ],
    scenes: [
      { role: "story setup", image: "Documentary b-roll of a service truck parking at dusk outside a suburban home, porch light on, homeowner silhouette at the door", anim: "Slow roll past the truck toward the porch." },
      { role: "the complication", image: "Close documentary b-roll of a flashlight beam over a crawlspace entry with signs of activity, tools laid out on a drop cloth", anim: "Beam settles on the entry, slow creep in." },
      { role: "the payoff", image: "Documentary b-roll of the tech's gloved fist bump with the homeowner at the door, evening, job done, bagged debris by the step", anim: "Gentle rise from the bag up to the handshake." },
    ],
    example: ["Storytime: the 9pm call we almost skipped", "She said the noise was in the walls", "It was NOT in the walls", "Crawlspace entry, wide open for months", "By 10pm the house was quiet", "Follow for part 2"],
  },
  {
    id: "pest_control__pov__day_in_life",
    description: "13s 3-shot Meta-glasses POV day-in-the-life montage: morning load-out, mid-day job, end-of-day wrap.",
    visual_rules: POV_RULES,
    scenes: [
      { role: "morning load-out", image: "First-person POV loading a sprayer tank into the service truck bed at sunrise, checklist on the tailgate, coffee on the bumper", anim: "Tank slides in, tilt up to the sunrise street." },
      { role: "mid-day job", image: "First-person POV mid-job under a deck treating a nest area, kneepads visible, bright noon light through the boards", anim: "Steady work motion, light rays shifting through the slats." },
      { role: "end of day wrap", image: "First-person POV closing the truck's rear door at dusk, route list marked complete on a clipboard, neighborhood lights coming on", anim: "Door swings shut, settle on the marked route list." },
    ],
    example: ["POV: 6am and the route is full", "Nobody sees this part", "Twelve houses before lunch", "Every stop is somebody sleeping better", "This is what booked-out looks like", "We are hiring, link in bio"],
  },
  {
    id: "pest_control__broll__indoctrination",
    description: "13s 3-shot b-roll belief-shift: six timed captions reframe how homeowners think about pests.",
    visual_rules: [
      "Clean 9:16 b-roll of homes and pest evidence; shots leave clear space for the timed captions.",
      "Muted cinematic grade, no faces, no branding.",
      "No text, captions, logos, or watermarks inside the image.",
    ],
    scenes: [
      { role: "the comfortable lie", image: "B-roll of a pristine suburban kitchen at morning, sunlight, everything spotless and still", anim: "Slow dolly across the spotless counter." },
      { role: "the hidden truth", image: "Macro b-roll of ants moving single-file inside a dark wall void along a wire, dust and insulation fibers", anim: "Macro track along the trail inside the void." },
      { role: "the reframe", image: "B-roll of a technician's treated foundation line at golden hour, visible clean barrier band, house glowing behind", anim: "Rise from the barrier band up the facade." },
    ],
    example: ["Your house is not clean", "It is just quiet", "The wall you cannot see is a highway", "Pests do not knock first", "Protected homes are chosen, not lucky", "Learn what protected means, link in bio"],
  },
  {
    id: "pest_control__pov__vent_cleaning",
    description: "13s 3-shot Meta-glasses POV vent job: the blocked vent, the clean-out, the airflow payoff.",
    visual_rules: POV_RULES,
    scenes: [
      { role: "the blocked vent", image: "First-person POV unscrewing a dusty wall vent cover, matted debris and nesting material packed behind the grille", anim: "Cover comes away revealing the packed debris." },
      { role: "the clean-out", image: "First-person POV vacuum hose pulling debris out of the duct, gloved hand steadying the hose, dust in the light beam", anim: "Hose works deeper, debris streaming out." },
      { role: "clean airflow", image: "First-person POV of the reinstalled shining vent cover, a ribbon held up fluttering in the strong clean airflow", anim: "Ribbon lifts and flutters as the airflow hits." },
    ],
    example: ["POV: why that room always smells", "It is not the carpet", "Something moved into your vents", "Every vent feeds the air you breathe", "Clean ducts, clean air, tonight", "Book the vent check, link in bio"],
  },
];

function buildSpec(theme: Theme): RenderSpec {
  return {
    mode: "static_images",
    song_ref: null,
    duration_seconds: 13,
    shots: SHOTS.map((s) => ({ ...s })),
    texts: SLOTS.map((r, i) => ({
      n: i + 1,
      text: theme.example[i],
      at_second: r.at_second!,
      out_second: r.out_second,
      position: r.position,
      role: r.key,
    })),
  };
}

async function main() {
  for (const theme of THEMES) {
    const existing = await loadWorkflow(theme.id);
    if (!existing) {
      console.log(`  SKIP ${theme.id} (row not found)`);
      continue;
    }
    const scenes: WorkflowScene[] = theme.scenes.map((s) => ({
      role: s.role,
      image_prompt: s.image,
      animation_prompt: s.anim,
      duration_seconds: 4,
      image_url: null,
      image_approved: false,
    }));
    const isPov = String(existing.category) === "pov";
    const wf: Workflow = {
      ...existing,
      status: "active",
      scenes,
      captions: SLOTS.map((r, i) => ({ text: theme.example[i], at_second: r.at_second! })),
      copy_structure: SLOTS.map((r) => ({ ...r })),
      render_spec: buildSpec(theme),
      render_options: {
        min_shots: 3,
        max_shots: 3,
        aspect: isPov ? "3:4" : "9:16",
        provider: "higgsfield-gpt",
      },
    };
    const ok = await upsertWorkflow(wf);
    if (ok) {
      await setWorkflowProfile(theme.id, { description: theme.description, visual_rules: theme.visual_rules });
      console.log(`  configured ${theme.id}`);
    } else {
      console.log(`  FAILED ${theme.id}`);
    }
  }
  console.log("Done. All drafts are ACTIVE with the 3-shot/13s skeleton. Onboarding gates still apply.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
