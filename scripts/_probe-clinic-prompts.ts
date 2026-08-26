// Probe: what do the avatar's image prompts actually look like, in BOTH lanes?
//   bun run scripts/_probe-clinic-prompts.ts
// Prints every generated prompt for the eyeball check and FAILs when a frame stops being
// recognisable to the avatar. Posts nothing to Slack and writes nothing to the DB.
//
// WHAT THIS CHECKS CHANGED AGAIN (2026-08-26, second pass). It used to fail on person words,
// which produced a back catalogue of empty rooms. It then allowed anonymous fragments. Both
// versions were still passing drops set in a gym parking lot, at a gas pump and on a kitchen
// island, with nobody in them - technically legal, and unrecognisable to a med spa owner.
// The three things it now asserts on every non-hook prompt are:
//   1. SOMEONE IS IN IT. A frame with no person is a failure, not a style.
//   2. IT IS IN THE BUSINESS. A named off-premises location is a failure.
//   3. NOBODY PERFORMS. Eye contact, posing, smiling for the lens, a headshot: still failures.
//     Being visible is not - that was the old rule and it is what emptied every room.
//
// SCENE 1 IS EXEMPT (2026-08-26): the hook's whole job is to show a patient being treated, so
// it is checked differently - it must carry the subject the code dealt, and nothing graphic.
//
// These failures are probabilistic, so run it more than once before believing a clean pass.
import { loadVertical, dropOwnerVerticalId } from "../src/config/verticals";
import { loadWorkflow } from "../src/config/workflows";
import { buildIdeas } from "../src/lib/reel/broll-suggestions";
import { generateStoryboardOptions } from "../src/lib/reel/hook-studio";
import { shotCount } from "../src/lib/reel/drop-studio";
import { reslotCopyToStructure } from "../src/lib/reel/creative-director";
import {
  renderLookLine,
  dealHookShot,
  hookLabel,
  CAMERA_AWARE_BAN,
  PERSON_LAW,
  REALISM_TAIL,
  AI_TELL_BAN,
} from "../src/config/shot-grammar";

const DROP_VERTICAL = process.env.PROBE_VERTICAL ?? "medspa_owner_ai";
const WORKFLOW_ID = process.env.PROBE_WORKFLOW ?? "pest_control__broll__funding_3tips_w7";

// Somebody has to be in the frame. Any ONE of these words is enough - the presence axis
// always deals a person, so a prompt with none of them means the axis or the assembler broke.
const PERSON_WORDS = [
  "owner", "staff", "nurse", "injector", "practitioner", "receptionist", "technician",
  "client", "patient", "someone", "person", "worker", "hand", "hands", "shoulder", "arm",
  "silhouette", "figure", "body",
];

// Performing for the lens. This is all that is left of the old face ban, and it is the part
// that was always right: a worker caught mid-task reads as photographed, a model looking down
// the barrel reads as stock.
const PERFORMING_WORDS = [
  "eye contact", "looking at the camera", "looking into the camera", "into the lens",
  // "posed" is matched on a word boundary below, or "slightly overexposed clinical white" - a
  // real LIGHT axis value - fails every prompt it is dealt into.
  "smiling", "posed", "posing", "headshot", "stock-photo model", "stock photo model",
];

// Locations that are not this business. The subject library cannot produce these any more,
// so a hit means the writer model added one in scene_detail.
// Deliberately NOT here: "dashboard" (a marketing dashboard on the back-office monitor is one
// of this avatar's own subjects) and "bank" (so is a bank of light switches by the back door).
const OFF_PREMISES = [
  "gym", "kitchen", "gas station", "gas pump", "school", "grocery", "supermarket",
  "restaurant", "coffee shop", "apartment", "living room", "bedroom", "highway",
  "windshield", "driveway", "backyard", "warehouse", "airport", "hotel", "church",
];

/** Scan the SCENE, not our own guards: the appended clauses name the very words we test for. */
function scan(label: string, prompt: string, guards: string[]): string[] {
  let body = prompt;
  for (const g of guards) body = body.split(g).join(" ");
  body = body.replace(/no (on-screen )?text,[^.]*\./gi, "").toLowerCase();

  const hits: string[] = [];
  if (!PERSON_WORDS.some((w) => new RegExp(`\\b${w}\\b`).test(body))) hits.push("NOBODY IN FRAME");
  for (const w of PERFORMING_WORDS) if (new RegExp(`\\b${w}\\b`).test(body)) hits.push(`performing: ${w}`);
  for (const w of OFF_PREMISES) if (new RegExp(`\\b${w}\\b`).test(body)) hits.push(`off-premises: ${w}`);

  console.log(`
  [${label}]
  ${prompt}`);
  if (hits.length) console.log(`  >>> FAIL: ${hits.join(", ")}`);
  return hits;
}

const PASTED = `Med Spa Owners
The truth about showing up in ChatGPT.
Paid ads keep getting flagged for injectable creative.
Which means local clinics that optimize have a real organic shot.
Only 1.2% of businesses are currently visible to AI.
Early movers own this window.
Link in bio for a free audit`;

async function main() {
  const drop = await loadVertical(DROP_VERTICAL);
  const owner = await loadVertical(dropOwnerVerticalId(drop));
  const workflow = await loadWorkflow(WORKFLOW_ID);
  if (!workflow) throw new Error(`workflow ${WORKFLOW_ID} not found`);

  console.log(`vertical: ${drop.name}`);
  console.log(`visual_rules: ${drop.visual_rules?.length ?? 0} rule(s)`);
  console.log(`image_negative: ${drop.image_negative ?? "(none)"}`);
  console.log(`setting_law: ${drop.setting_law ?? "(none)"}`);
  const failures: string[] = [];
  // Our own tails, stripped before scanning so the guards don't trip their own check.
  const guards = [
    drop.image_negative ?? "",
    drop.setting_law ?? "",
    CAMERA_AWARE_BAN,
    PERSON_LAW,
    REALISM_TAIL,
    AI_TELL_BAN,
  ].filter(Boolean);

  // --- lane 1: the 3x/day cron drop, through the exact production path ---
  console.log("\n=== LANE 1: daily b-roll drop ===");
  const ideas = await buildIdeas({ vertical: drop, slot: "morning" });
  ideas.forEach((idea) => {
    if (!idea.image_prompt) return;
    const label = `${idea.bucket} | ${idea.on_screen_hook}`;
    if (scan(label, idea.image_prompt, guards).length) failures.push(`daily/${idea.bucket}`);
    if (idea.shot) console.log(`  look: ${renderLookLine(idea.shot)}`);
    if (idea.voiceover_line) console.log(`  vo: ${idea.voiceover_line}`);
  });

  // Two prompts from one drop must not share a look - that is the whole point of the rebuild.
  const looks = ideas.filter((i) => i.shot).map((i) => renderLookLine(i.shot!));
  if (new Set(looks).size !== looks.length) failures.push("daily/duplicate-look");

  // --- lane 2: Hook Studio scene prompts from locked copy ---
  console.log("\n=== LANE 2: Hook Studio storyboard options ===");
  const copy = await reslotCopyToStructure({ vertical: owner, workflow, pastedBlock: PASTED });
  const scenes = Array.from({ length: shotCount(workflow) }, (_, i) => i + 1);
  // The hook is dealt by the CALLER in production, so deal one here too or this probe measures
  // a path nobody runs.
  const hookShot = dealHookShot();
  console.log(`hook dealt: ${hookLabel(hookShot)}`);
  const boards = await generateStoryboardOptions({
    owner,
    workflow,
    lookVertical: drop,
    copy,
    hookImage: null,
    scenes,
    optionCount: 3,
    hookShot,
  });
  boards.forEach((board, b) => {
    board.prompts.forEach((p, i) => {
      // Scene 1 is the hook: a face is REQUIRED there, so the person scan would fail every
      // correct run. What it owes instead is the dealt subject and nothing graphic.
      if (i === 0) {
        console.log(`
  [option ${b + 1} / scene 1 — HOOK]
  ${p}`);
        if (!p.includes(hookShot.subject.text)) {
          console.log("  >>> FAIL: the dealt hook subject is missing");
          failures.push(`hook/o${b + 1}s1-subject`);
        }
        const body = p.slice(0, p.indexOf("Do not produce:"));
        const graphic = ["blood", "bruis", "wound", "swelling", "diagram"].filter((w) => body.toLowerCase().includes(w));
        if (graphic.length) {
          console.log(`  >>> FAIL: graphic (${graphic.join(", ")})`);
          failures.push(`hook/o${b + 1}s1-graphic`);
        }
        return;
      }
      if (scan(`option ${b + 1} / scene ${i + 1}`, p, guards).length) failures.push(`hook/o${b + 1}s${i + 1}`);
    });
  });
  // The three OPTIONS must differ, measured on SCENE 2: scene 1 is one dealt hook shared by
  // every option now, so comparing openers would fail on correct output.
  const openers = boards.map((b) => (b.prompts[1] ?? b.prompts[0] ?? "").slice(0, 120));
  if (new Set(openers).size !== openers.length) failures.push("hook/identical-options");

  console.log("\n--------------------");
  if (failures.length) {
    console.log(`FAIL (${failures.length}): ${failures.join(", ")}`);
    process.exit(1);
  }
  console.log(
    `PASS: ${ideas.filter((i) => i.image_prompt).length} daily + ${boards.reduce((n, b) => n + b.prompts.length, 0)} scene prompts, everyone at work inside the clinic, nobody performing, no repeated look`
  );
}

main().catch((e) => {
  console.error("PROBE ERROR:", e);
  process.exit(1);
});
