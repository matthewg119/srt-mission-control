// Probe: does the shot grammar actually stop repeating itself?
//   bun run scripts/_probe-shot-variety.ts
//
// Offline. No API key, no DB, no Slack. It simulates N days of drops by feeding each deal's
// keys back in as history the way `broll_drops` does in production, then asserts the windows
// the dealer promises. This is the objective test for "they all look the same" - the eyeball
// check lives in scripts/_probe-clinic-prompts.ts.

import {
  dealShots,
  dealLooks,
  renderLookLine,
  renderShotBrief,
  shotKeys,
  effectiveWindow,
  grammarSize,
  SUBJECTS,
  dealHookShot,
  hookGuards,
  renderHookBrief,
  shotGuards,
  HOOK_TREATMENT_SUBJECTS,
  HOOK_GRADE,
  CAMERA_AWARE_BAN,
  PERSON_LAW,
  PRESENCE,
  REALISM_TAIL,
  AI_TELL_BAN,
  type RecentShots,
  type RecentHooks,
} from "../src/config/shot-grammar";

const PER_DROP = 3;
const DROPS = Number(process.env.PROBE_DROPS ?? 40); // ~13 days at 3 drops/day

// The windows the dealer contracts to, clamped to what each axis can actually honor at this
// deal size (a 10-entry axis drawing 3 cannot exclude the last 8 and still find three).
const AXES = ["subject", "capture", "light", "grade", "framing", "presence"] as const;
const EXPECT = Object.fromEntries(
  AXES.map((a) => [a, effectiveWindow(a, PER_DROP)])
) as Record<(typeof AXES)[number], number>;

const history: Required<RecentShots> = {
  subject: [],
  capture: [],
  light: [],
  grade: [],
  framing: [],
  presence: [],
};

const failures: string[] = [];
const lookLines: string[] = [];
const seenSubjects = new Set<string>();

function checkWindow(axis: keyof typeof EXPECT, key: string, dropIndex: number): void {
  const window = history[axis].slice(0, EXPECT[axis]);
  if (window.includes(key)) {
    failures.push(
      `drop ${dropIndex}: ${axis} "${key}" repeated inside its ${EXPECT[axis]}-deep window`
    );
  }
}

for (let d = 0; d < DROPS; d++) {
  // Same call shape production uses: two owner-lane angles and one treatment-lane angle.
  const specs = dealShots({
    lane: "owner",
    count: PER_DROP,
    recent: history,
    lanes: ["owner", "owner", "treatment"],
  });

  if (specs.length !== PER_DROP) failures.push(`drop ${d}: dealt ${specs.length}, wanted ${PER_DROP}`);
  if (specs[2] && specs[2].subject.lane !== "treatment") {
    failures.push(`drop ${d}: lane override ignored, got ${specs[2].subject.lane}`);
  }

  // Nothing may repeat INSIDE one drop either - that is the three-identical-images case.
  for (const axis of AXES) {
    const keys = specs.map((s) => shotKeys(s)[`${axis}_key`]);
    if (new Set(keys).size !== keys.length) {
      failures.push(`drop ${d}: ${axis} repeated within the same drop (${keys.join(", ")})`);
    }
  }

  for (const spec of specs) {
    const keys = shotKeys(spec);
    for (const axis of AXES) {
      checkWindow(axis, keys[`${axis}_key`], d);
    }
    // Push newest-first, exactly like the DB read does.
    history.subject.unshift(keys.subject_key);
    history.capture.unshift(keys.capture_key);
    history.light.unshift(keys.light_key);
    history.grade.unshift(keys.grade_key);
    history.framing.unshift(keys.framing_key);
    history.presence.unshift(keys.presence_key);
    seenSubjects.add(keys.subject_key);
    lookLines.push(renderLookLine(spec));
  }
}

// A look line repeating verbatim is the failure the operator actually sees.
const dupLooks = lookLines.length - new Set(lookLines).size;
if (dupLooks > 0) failures.push(`${dupLooks} identical look line(s) across ${lookLines.length} shots`);

// Storyboard options must differ from each other inside one deal (the syringe case).
for (let i = 0; i < 20; i++) {
  const looks = dealLooks({ count: 3 });
  const rendered = looks.map(renderLookLine);
  if (new Set(rendered).size !== 3) failures.push(`dealLooks deal ${i}: options were not distinct`);
}

console.log(`windows honored: ${AXES.map((a) => `${a} ${EXPECT[a]}`).join(", ")}`);
console.log(`grammar: ${SUBJECTS.length} subjects, ${grammarSize().toLocaleString("en-US")} combinations`);
console.log(`simulated: ${DROPS} drops x ${PER_DROP} shots = ${lookLines.length} shots`);
console.log(`distinct subjects used: ${seenSubjects.size}`);
console.log(`distinct look lines: ${new Set(lookLines).size}/${lookLines.length}`);
console.log("\nsample of the first drop:");
for (const spec of dealShots({ lane: "owner", count: 3, recent: history, lanes: ["owner", "owner", "treatment"] })) {
  console.log(`  - ${renderShotBrief(spec)}`);
}

console.log("\n--------------------");
if (failures.length) {
  console.log(`FAIL (${failures.length}):`);
  for (const f of failures.slice(0, 20)) console.log(`  ${f}`);
  process.exit(1);
}
console.log("PASS: no repeats inside any window, every look line distinct");

// ---- the hook shot (Hook Studio scene 1) --------------------------------------------------
//
// Scene 1 is the deliberate exception to everything above: its subject is a treatment in
// progress, its face ban is lifted and its realism guards are gone. Both directions are
// asserted, because the expensive regression is not the hook losing its treatment - it is the
// documentary guards quietly coming back onto it, or the face ban quietly leaving scene 2.

const hookFailures: string[] = [];
const HOOK_SESSIONS = 24;
const HOOK_WINDOW_SUBJECT = 8;

// What "not graphic" has to keep out of the frame. The syringe and the needle are deliberately
// NOT on this list: every reference has one touching skin and that is the point of the shot.
const GRAPHIC_WORDS = ["blood", "bruis", "wound", "swelling", "diagram"];

const hookHistory: Required<RecentHooks> = { subject: [], grade: [] };
const hookSubjectsUsed = new Set<string>();

for (let s = 0; s < HOOK_SESSIONS; s++) {
  const shot = dealHookShot({ recent: hookHistory });
  const prompt = `${renderHookBrief(shot)} A nurse works. ${hookGuards()}`;

  if (hookHistory.subject.slice(0, HOOK_WINDOW_SUBJECT).includes(shot.subject.key)) {
    hookFailures.push(`session ${s}: hook subject "${shot.subject.key}" repeated inside its ${HOOK_WINDOW_SUBJECT}-deep window`);
  }
  if (hookHistory.grade[0] === shot.grade.key) {
    hookFailures.push(`session ${s}: hook grade "${shot.grade.key}" repeated back to back`);
  }
  if (!prompt.includes(shot.subject.text)) {
    hookFailures.push(`session ${s}: the dealt subject is missing from the assembled prompt`);
  }
  for (const w of GRAPHIC_WORDS) {
    // The ban itself names these, so only the part BEFORE the guards may not contain them.
    const body = prompt.slice(0, prompt.indexOf("Do not produce:"));
    if (body.toLowerCase().includes(w)) hookFailures.push(`session ${s}: graphic word "${w}" in the hook body`);
  }
  // The two reversals, asserted as reversals.
  if (prompt.includes(CAMERA_AWARE_BAN)) hookFailures.push(`session ${s}: the hook carries CAMERA_AWARE_BAN`);
  if (prompt.includes(PERSON_LAW)) hookFailures.push(`session ${s}: the hook carries PERSON_LAW`);
  if (prompt.includes(REALISM_TAIL)) hookFailures.push(`session ${s}: the hook carries REALISM_TAIL`);
  if (prompt.includes(AI_TELL_BAN)) hookFailures.push(`session ${s}: the hook carries AI_TELL_BAN`);

  hookHistory.subject.unshift(shot.subject.key);
  hookHistory.grade.unshift(shot.grade.key);
  hookSubjectsUsed.add(shot.subject.key);
}

// ...and scenes 2+ must still carry every one of them. This is the half that catches a "simplification"
// that points every scene at hookGuards().
const SETTING = "Every frame is photographed inside this med spa.";
const laterScene = `A shot. ${shotGuards("No empty rooms.", SETTING)}`;
for (const [name, guard] of [
  ["CAMERA_AWARE_BAN", CAMERA_AWARE_BAN],
  ["PERSON_LAW", PERSON_LAW],
  ["REALISM_TAIL", REALISM_TAIL],
  ["AI_TELL_BAN", AI_TELL_BAN],
] as const) {
  if (!laterScene.includes(guard)) hookFailures.push(`scene 2+ lost ${name}`);
}
// The avatar's location contract has to REACH the image model, not just the writer.
if (!laterScene.includes(SETTING.replace(/[.]$/, ""))) hookFailures.push("scene 2+ dropped the setting law");

// The 2026-08-26 correction, asserted where it can actually regress: an empty-frame value
// coming back onto the presence axis would quietly restore the whole problem.
const EMPTY_PRESENCE = /nobody|no one|empty|unoccupied|deserted/i;
for (const e of PRESENCE) {
  if (EMPTY_PRESENCE.test(e.text)) hookFailures.push(`presence "${e.key}" allows an empty frame: "${e.text}"`);
}

console.log("\n--------------------");
console.log(`hook: ${HOOK_TREATMENT_SUBJECTS.length} treatment subjects x ${HOOK_GRADE.length} grades`);
console.log(`hook: ${hookSubjectsUsed.size} distinct subjects across ${HOOK_SESSIONS} sessions`);
console.log("\nsample hook prompt:");
console.log(`  ${renderHookBrief(dealHookShot({ recent: hookHistory }))} ${hookGuards()}`);

if (hookFailures.length) {
  console.log(`\nHOOK FAIL (${hookFailures.length}):`);
  for (const f of hookFailures.slice(0, 20)) console.log(`  ${f}`);
  process.exit(1);
}
console.log("\nPASS: the hook rotates, stays non-graphic, and the guard reversal is scoped to scene 1");
