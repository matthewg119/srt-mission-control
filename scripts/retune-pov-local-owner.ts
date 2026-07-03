// One-shot: retune "Local Owner Pain To CTA Hook" (pest_owner_ai) into
// "3 B-roll META POV Pest Control" — first-person Meta-glasses b-roll of real pest-control
// WORK from three different angles. The old profile demanded a human emotional subject
// ("owner sits in the cab of his truck..."), which is exactly why generated images drifted
// to truck drivers instead of the job. The id/slug, copy_structure, and render_spec stay.
//
// Usage:  bun run scripts/retune-pov-local-owner.ts
// Safe to re-run (upsert by id). Drops the old truck-cab scenes on purpose.

import { loadWorkflow, type Workflow, type WorkflowScene } from "../src/config/workflows";
import { upsertWorkflow, setWorkflowProfile } from "../src/lib/reel/workflow-author";

const ID = "pest_owner_ai__pov__local_owner_pain_to_cta_hook";
const NAME = "3 B-roll META POV Pest Control";

const DESCRIPTION =
  "13s 3-shot first-person Meta-glasses POV b-roll of real pest-control WORK: three different " +
  "angles of the job (baseboard treatment, eave/nest work, perimeter barrier) carrying the " +
  "timed pain-to-CTA copy. The work is the subject - never a person.";

const VISUAL_RULES = [
  "Every frame is first-person POV through Ray-Ban Meta glasses DOING pest-control work; the camera is the technician's eyes on the job.",
  "The subject is always the WORK itself: gloved hands, sprayer wand, baseboards, attic corners, eaves, foundation/perimeter lines, bait stations, visible treatment.",
  "Each of the 3 shots is a DIFFERENT angle or job area (low at a baseboard, looking up at an eave, walking the perimeter) - vary the angle and the job, never the subject matter.",
  "No faces and no full human figures anywhere; at most gloved hands and forearms entering the frame.",
  "BANNED subjects: truck drivers, vehicle interiors or cabs, steering wheels, dashboards, offices, desks, phones, customers, or any non-pest-control subject.",
  "No text, captions, logos, or watermarks inside the image.",
  "Real suburban job-site settings, natural daylight, handheld documentary look; no studio lighting.",
];

const SCENES: WorkflowScene[] = [
  {
    role: "baseboard treatment, low indoor angle",
    image_prompt:
      "First-person Meta-glasses POV crouched low at a kitchen baseboard, gloved hand guiding a precision spray wand along the caulk line, fine mist visible, tile floor and cabinet kicks in frame",
    animation_prompt: "Steady lateral glide tracking the wand along the baseboard.",
    duration_seconds: 4,
    image_url: null,
    image_approved: false,
  },
  {
    role: "eave nest work, looking up outdoors",
    image_prompt:
      "First-person Meta-glasses POV looking up under a roof eave, gloved hand extending a dusting pole toward a grey paper wasp nest against the fascia, blue sky beyond",
    animation_prompt: "Slow tilt up the eave toward the nest with slight handheld sway.",
    duration_seconds: 4,
    image_url: null,
    image_approved: false,
  },
  {
    role: "perimeter barrier, walking angle",
    image_prompt:
      "First-person Meta-glasses POV walking a home's foundation line, spray wand painting a visible treatment band on the concrete slab edge, lawn and downspout in frame, golden hour",
    animation_prompt: "Walking glide along the perimeter as the band is laid down.",
    duration_seconds: 4,
    image_url: null,
    image_approved: false,
  },
];

async function main() {
  const existing = await loadWorkflow(ID);
  if (!existing) throw new Error(`workflow row not found: ${ID}`);
  const wf: Workflow = {
    ...existing,
    name: NAME,
    scenes: SCENES,
    render_options: { ...existing.render_options, aspect: "3:4", provider: "higgsfield-gpt" },
  };
  const ok = await upsertWorkflow(wf);
  if (!ok) throw new Error("upsertWorkflow failed");
  await setWorkflowProfile(ID, { description: DESCRIPTION, visual_rules: VISUAL_RULES });
  console.log(`retuned ${ID} -> "${NAME}" (${VISUAL_RULES.length} visual rules, ${SCENES.length} seed scenes, higgsfield-gpt @ 3:4)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
