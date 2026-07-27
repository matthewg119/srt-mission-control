// Probe: do the clinic's image prompts stay people-free in BOTH lanes?
//   bun run scripts/_probe-clinic-prompts.ts
// Prints every generated prompt and FAILs on person words. Posts nothing to Slack and
// writes nothing to the DB (it deliberately stops short of postMessage / logIdeas).
// This failure is probabilistic, so run it more than once before believing a clean pass.
import { loadVertical, dropOwnerVerticalId } from "../src/config/verticals";
import { loadWorkflow } from "../src/config/workflows";
import { callClaudeJSON, type ClaudeModel } from "../src/lib/claude-calls";
import { buildSystem as buildBrollSystem } from "../src/lib/reel/broll-suggestions";
import { generateStoryboardOptions } from "../src/lib/reel/hook-studio";
import { shotCount } from "../src/lib/reel/drop-studio";
import { reslotCopyToStructure } from "../src/lib/reel/creative-director";

const DROP_VERTICAL = process.env.PROBE_VERTICAL ?? "trt_clinic_ai";
const WORKFLOW_ID = process.env.PROBE_WORKFLOW ?? "pest_control__broll__funding_3tips_w7";

// Words that mean a human ended up in the frame. `hand` is included because the operator
// asked for no hands either; the napkin lane is text-only and never reaches this check.
// Deliberately NOUNS (plus "wearing" and the possessives): a prompt with a person in it
// always names the person. Posture verbs are excluded because objects take them too — "a
// chair sits empty", "a sign stands by the door" — and they fired on clean prompts.
const PERSON_WORDS = [
  "man", "woman", "men", "women", "person", "people", "owner", "doctor", "physician",
  "patient", "clinician", "nurse", "staff", "technician", "figure", "silhouette",
  "hand", "hands", "finger", "thumb", "face", "faces", "arm", "forearm", "shoulder",
  "wearing", "his", "her", "he", "she",
];

/** Scan the SCENE, not the boilerplate: the appended no-people clause is itself full of
 *  person words, and "a phone face-down" is an object, not a face. */
function scan(label: string, prompt: string, negative: string): string[] {
  const body = prompt
    .replace(negative, "") // our own "No people, faces, hands..." guard
    .replace(/no (on-screen )?text,[^.]*\./gi, "") // the no-text/logos tail
    .replace(/\bface[- ]?(down|up)\b/gi, "") // phone face-down, card face-up
    .toLowerCase();
  const hits = PERSON_WORDS.filter((w) => new RegExp(`\\b${w}\\b`).test(body));
  console.log(`\n  [${label}]\n  ${prompt}`);
  if (hits.length) console.log(`  >>> FAIL: ${hits.join(", ")}`);
  return hits;
}

const PASTED = `TRT Clinic Owners
The truth about showing up in ChatGPT.
Paid ads are banned for health advertising inside LLMs.
Which means local clinics that optimize have a real organic shot.
Only 1.2% of businesses are currently visible to AI (July 2026).
Early movers own this window.
Link in bio for a free audit`;

interface BrollIdea {
  bucket: string;
  on_screen_hook: string;
  image_prompt?: string;
  sketch_script?: string;
}

async function main() {
  const drop = await loadVertical(DROP_VERTICAL);
  const owner = await loadVertical(dropOwnerVerticalId(drop));
  const workflow = await loadWorkflow(WORKFLOW_ID);
  if (!workflow) throw new Error(`workflow ${WORKFLOW_ID} not found`);

  console.log(`vertical: ${drop.name}`);
  console.log(`visual_rules: ${drop.visual_rules?.length ?? 0} rule(s)`);
  console.log(`image_negative: ${drop.image_negative ?? "(none)"}`);
  const failures: string[] = [];
  const negative = drop.image_negative ?? "";

  // --- lane 1: the 3x/day cron drop (same system prompt runBrollSuggestionDrop uses) ---
  // Note: the per-bucket briefs are deliberately NOT sent here, so this tests the SUBJECT
  // RULES on their own. Production sends the briefs too, which only adds guidance — a pass
  // here is a harder pass than the live drop.
  console.log("\n=== LANE 1: daily b-roll drop ===");
  const plan = ["invisible", "machine", "patient"];
  const { data: gen } = await callClaudeJSON<{ ideas: BrollIdea[] }>({
    model: (process.env.ANTHROPIC_MODEL as ClaudeModel) || "claude-sonnet-4-6",
    system: buildBrollSystem(drop, []),
    user: [
      "Return exactly 3 ideas, one per slot below, in this order. Use the given bucket for each;",
      "pick a different belief for each; make the three hooks feel distinct.",
      ...plan.map((b, i) => `Slot ${i + 1}: bucket "${b}".`),
      "Return JSON only.",
    ].join("\n"),
    maxTokens: 2000,
    temperature: 0.9,
    schemaHint: '{ "ideas": [{ "bucket": string, "on_screen_hook": string, "image_prompt": string }] }',
    validate: (v: unknown): v is { ideas: BrollIdea[] } =>
      typeof v === "object" && v !== null && Array.isArray((v as { ideas: BrollIdea[] }).ideas),
  });
  gen.ideas.forEach((idea) => {
    if (!idea.image_prompt) return;
    if (scan(`${idea.bucket} | ${idea.on_screen_hook}`, idea.image_prompt, negative).length) {
      failures.push(`daily/${idea.bucket}`);
    }
  });

  // --- lane 2: Hook Studio scene prompts from locked copy ---
  console.log("\n=== LANE 2: Hook Studio scene prompts ===");
  const copy = await reslotCopyToStructure({ vertical: owner, workflow, pastedBlock: PASTED });
  const scenes = Array.from({ length: shotCount(workflow) }, (_, i) => i + 1);
  const [board] = await generateStoryboardOptions({
    owner,
    workflow,
    lookVertical: drop,
    copy,
    hookImage: null,
    scenes,
    optionCount: 1,
  });
  (board?.prompts ?? []).forEach((p, i) => {
    if (scan(`scene ${i + 1}`, p, negative).length) failures.push(`hook/scene${i + 1}`);
  });

  console.log("\n────────────────────");
  if (failures.length) {
    console.log(`FAIL: person words in ${failures.length} prompt(s): ${failures.join(", ")}`);
    process.exit(1);
  }
  console.log(`PASS: ${gen.ideas.filter((i) => i.image_prompt).length} daily + ${board?.prompts.length ?? 0} scene prompts, all people-free`);
}

main().catch((e) => {
  console.error("PROBE ERROR:", e);
  process.exit(1);
});
