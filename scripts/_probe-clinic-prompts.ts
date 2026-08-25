// Probe: what do the avatar's image prompts actually look like, in BOTH lanes?
//   bun run scripts/_probe-clinic-prompts.ts
// Prints every generated prompt for the eyeball check and FAILs on identifiable-person
// words. Posts nothing to Slack and writes nothing to the DB.
//
// The rule this enforces CHANGED (2026-08-25). It used to fail on any person word at all,
// which is what produced a back catalogue of empty, perfectly composed rooms - both sad and
// the clearest tell that an image was generated. Anonymous partial presence (a cropped hand,
// a blurred body, the back of a head) is now dealt on purpose by the PRESENCE axis. What is
// still banned is an identifiable person: a face, a portrait, a posed or smiling subject.
//
// This failure is probabilistic, so run it more than once before believing a clean pass.
import { loadVertical, dropOwnerVerticalId } from "../src/config/verticals";
import { loadWorkflow } from "../src/config/workflows";
import { buildIdeas } from "../src/lib/reel/broll-suggestions";
import { generateStoryboardOptions } from "../src/lib/reel/hook-studio";
import { shotCount } from "../src/lib/reel/drop-studio";
import { reslotCopyToStructure } from "../src/lib/reel/creative-director";
import { renderLookLine } from "../src/config/shot-grammar";

const DROP_VERTICAL = process.env.PROBE_VERTICAL ?? "medspa_owner_ai";
const WORKFLOW_ID = process.env.PROBE_WORKFLOW ?? "pest_control__broll__funding_3tips_w7";

// Words that mean an IDENTIFIABLE person ended up in the frame. Deliberately NOT "hand",
// "shoulder", "silhouette" or "body": those are the anonymous fragments the grammar deals on
// purpose, and banning them is what emptied every room.
const FACE_WORDS = [
  "face", "faces", "facial expression", "portrait", "headshot", "smiling", "smile",
  "eye contact", "looking at the camera", "looking into the camera", "model", "models",
  "posed", "posing", "recognizable",
];

/** Scan the SCENE, not our own guards: the appended clause names the very words we ban. */
function scan(label: string, prompt: string, guards: string[]): string[] {
  let body = prompt;
  for (const g of guards) body = body.split(g).join(" ");
  body = body
    .replace(/no (on-screen )?text,[^.]*\./gi, "")
    .replace(/\bfaces?[- ]?(down|up|away)\b/gi, "") // "a phone face-down", "the screen faces up"
    .replace(/\bno identifiable faces?\b/gi, "")
    .toLowerCase();
  const hits = FACE_WORDS.filter((w) => new RegExp(`\\b${w}\\b`).test(body));
  console.log(`\n  [${label}]\n  ${prompt}`);
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
  const failures: string[] = [];
  // Our own tails, stripped before scanning so the guards don't trip their own check.
  const guards = [drop.image_negative ?? "", "No identifiable faces. No posed or smiling subjects. No stock-photo models."].filter(Boolean);

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
  const boards = await generateStoryboardOptions({
    owner,
    workflow,
    lookVertical: drop,
    copy,
    hookImage: null,
    scenes,
    optionCount: 3,
  });
  boards.forEach((board, b) => {
    board.prompts.forEach((p, i) => {
      if (scan(`option ${b + 1} / scene ${i + 1}`, p, guards).length) failures.push(`hook/o${b + 1}s${i + 1}`);
    });
  });
  // The three OPTIONS must open differently; scenes within an option may match on purpose.
  const openers = boards.map((b) => (b.prompts[0] ?? "").slice(0, 120));
  if (new Set(openers).size !== openers.length) failures.push("hook/identical-options");

  console.log("\n--------------------");
  if (failures.length) {
    console.log(`FAIL (${failures.length}): ${failures.join(", ")}`);
    process.exit(1);
  }
  console.log(
    `PASS: ${ideas.filter((i) => i.image_prompt).length} daily + ${boards.reduce((n, b) => n + b.prompts.length, 0)} scene prompts, no identifiable people, no repeated look`
  );
}

main().catch((e) => {
  console.error("PROBE ERROR:", e);
  process.exit(1);
});
