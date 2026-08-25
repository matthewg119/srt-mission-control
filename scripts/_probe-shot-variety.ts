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
  type RecentShots,
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
