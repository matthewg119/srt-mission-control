/**
 * Probe: the Launch Lane's page run keeps the rails the Slack thread kept.
 *
 *   bun run scripts/_probe-launch-pages.ts
 *
 * Needs no database, no model call and no network. It reads source text.
 *
 * WHY THIS EXISTS. src/lib/launch/pages.ts is a door onto machinery that was previously reachable
 * only by typing into a Slack thread, and three of the things that made that thread safe have no
 * type to defend them:
 *
 *   - publishPage() resolves the destination ITSELF. Its own header says two callers means two
 *     chances to skip the ownership check and publish a page onto another client's hostname. The
 *     launch module is the third caller, so it must pass the raw id through and read no hosts.
 *   - The stages are ordered on purpose. `plan approve` stopped drafting on 2026-09-14 so every
 *     decision lands before a page is written, and an action that skipped a stage would write
 *     pages off no outline.
 *   - The Day-0 waiver is never a second button. One waiver exists, on the client page, offered
 *     only after a publish has been refused and carrying a written reason.
 *
 * ‼️ THE IMPORT BAN IS NOT RE-CHECKED HERE. src/lib/launch and src/app/api/launch are both LANE_ROOTS
 * in _probe-launch-isolation.ts, so the new module and the new route are already covered by it. A
 * second copy of that check is how the two start disagreeing.
 *
 * ‼️ EVERY GREP BELOW READS CODE, NOT COMMENTS, AND THAT IS LOAD-BEARING HERE MORE THAN USUAL: the
 * module's own header contains the sentence "IT NEVER READS client_hosts", so a probe that searched
 * raw text would fail on the comment promising the thing it is checking.
 */

import fs from "fs";
import path from "path";

let failures = 0;

function check(ok: boolean, label: string, detail?: string): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (detail) console.log(`      ${detail}`);
  if (!ok) failures += 1;
}

function read(file: string): string {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8");
}

/**
 * One file with its comments removed.
 *
 * ‼️ SPLIT ON /\r?\n/, NOT ON "\n". Same Windows CRLF trap _probe-lead-card.ts documents: a bare
 * "\n" split leaves a \r at the end of every line, `.` never matches a carriage return, and the
 * line comment is left exactly where it was. Copied in shape from that probe on purpose.
 */
function code(file: string): string {
  return read(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((l) => l.replace(/(^|\s)\/\/.*$/, ""))
    .join("\n");
}

const MODULE = "src/lib/launch/pages.ts";
const ROUTE = "src/app/api/launch/[id]/pages/route.ts";
const PANEL = "src/app/dashboard/launch/[id]/pages-panel.tsx";
const FACTS = "src/lib/launch/publishing-facts.ts";

const mod = code(MODULE);
const route = code(ROUTE);
const panel = code(PANEL);
const facts = code(FACTS);

console.log("\nLaunch Lane page run\n");

// ── 1. The destination stays publishPage's decision ──────────────────────────
//
// THE ONE WITH TEETH. A host read here is how a page ends up on the wrong client's domain, and
// nothing about the page itself would look wrong afterwards.

check(
  !/from\(\s*["']client_hosts["']\s*\)/.test(mod),
  "the page module never queries client_hosts",
  "publishPage resolves the destination and checks ownership; a second reader is a second chance to get it wrong"
);

check(
  !/hub\/destinations/.test(mod),
  "the page module does not import @/lib/hub/destinations",
  "the choices come back inside publishPage's own refusal, which is the list it already owns"
);

check(
  !/from\(\s*["']client_hosts["']\s*\)/.test(panel) && !/hub\/destinations/.test(panel),
  "the panel renders the destination picker from the refusal, not from its own query"
);

check(
  /destinationId/.test(mod) && /destinationId/.test(route),
  "the destination id is passed straight through from the route to publishPage"
);

// ── 2. No waiver on this surface ─────────────────────────────────────────────

for (const [file, src] of [
  [MODULE, mod],
  [ROUTE, route],
  [PANEL, panel],
] as const) {
  check(
    !/waiveDay0|waive_day_zero|waive_gate/.test(src),
    `${file} offers no Day-0 or gate waiver`,
    "the waiver is offered only after a refusal, needs a written reason, and lives on the client page"
  );
}

// ── 3. The stages cannot be skipped ──────────────────────────────────────────
//
// Each of these reads the condition back out of readBatch rather than re-deriving it, so the panel
// and the Slack thread refuse on the same fact.

// ‼️ IT MATCHES THE GUARD, NOT THE MESSAGE, AND THE FIRST VERSION OF THIS PROBE DID THE OPPOSITE.
// Both refusals quote the counts back in their own error text, so a check for `needHeadline.length`
// anywhere in the branch passed with the condition replaced by `if (false)`: the words were still
// there, in the sentence explaining a refusal that no longer happened. Measured by planting exactly
// that. Whitespace is squashed first so wrapping the condition over two lines is not a failure.
const squish = (s: string): string => s.replace(/\s+/g, " ");

const skeletonCase = squish(
  mod.slice(mod.indexOf('case "skeletons_write"'), mod.indexOf('case "research_prompt"'))
);
check(
  skeletonCase.length > 0 && /if \(\s*batch\.needHeadline\.length\s*\)/.test(skeletonCase),
  "writing skeletons is GUARDED on any page still needing a headline",
  "a skeleton written before its headline is an outline for a page that does not know what it promises"
);

const draftCase = squish(mod.slice(mod.indexOf('case "draft_wave"'), mod.indexOf('case "publish"')));
check(
  draftCase.length > 0 &&
    /readBatch\(/.test(draftCase) &&
    /if \(\s*batch\.needHeadline\.length\s*\|\|\s*batch\.needSkeleton\.length\s*\)/.test(draftCase),
  "drafting is GUARDED on any page lacking a headline or a skeleton",
  "this is the refusal `plan draft` gives in the thread, read off the same readBatch"
);

check(
  /autoCompleteLaunchStep\(/.test(draftCase),
  "a drafting pass ticks pages_drafted through the verifier",
  "a runner believing it succeeded is not evidence that it did"
);

// ── 4. Drafting is one wave per press, not a self-chaining job ───────────────
//
// continueDrafting() narrates only into Slack and hands the rest to itself with CRON_SECRET, which
// is absent locally: that chain silently never starts and this lane would never hear about it.

check(
  /draftWave\(/.test(mod) && !/continueDrafting|chainNextWave|CRON_SECRET/.test(mod),
  "the page module drives draftWave itself and never the Slack chain",
  "draftWave returns `remaining`, and the lease makes a second press the resume"
);

// ── 5. Every action has a branch ─────────────────────────────────────────────
//
// The switch is exhaustive by type, but a case whose string does not match its entry in the list
// compiles perfectly and then refuses forever at runtime.

const listed = [...mod.matchAll(/^\s*"([a-z_]+)",$/gm)].map((m) => m[1]);
check(listed.length >= 16, `the action list was found and holds ${listed.length} entries`);
for (const action of listed) {
  check(mod.includes(`case "${action}"`), `${action} has a branch in runLaunchPagesAction`);
}

// ── 6. The route tells a question apart from a rail ──────────────────────────

check(
  /blockedBy === "destination"[\s\S]{0,200}status: 400/.test(route),
  "a destination refusal answers 400, because it is a question and not a rail",
  "nothing is wrong with the page: somewhere to put it has not been decided"
);
check(
  /blockedBy === "day_0"[\s\S]{0,200}status: 409/.test(route),
  "a Day-0 refusal answers 409"
);
check(
  /blockedBy === "quality_gate"[\s\S]{0,300}status: 409/.test(route),
  "a quality-gate refusal answers 409, with its checks attached"
);
check(
  /maxDuration = 300/.test(route),
  "the route allows 300 seconds",
  "one drafting wave budgets 240, and a headline pass is a model call per page"
);
check(
  /onboarding_lane !== "launch"/.test(route),
  "the route refuses a Slack-lane client",
  "middleware guards /dashboard/*, not /api/*, so every route in this lane re-checks"
);

// ── 7. The strategy map reaches the chat ─────────────────────────────────────
//
// Asked "what is our strategy map" the chat had every selected phrase and could not name the
// pillar, because `role` was not in the select. This is that regression's guard.

check(
  /\.select\("phrase, category, role,/.test(facts),
  "publishing-facts reads client_keywords.role",
  "without it the chat has the phrases and cannot say which one the pages are built around"
);
check(
  /THE STRATEGY MAP/.test(facts),
  "publishing-facts puts the strategy map in the chat's facts"
);
check(
  /r\.role === "pillar"/.test(facts) && /r\.role === "support"/.test(facts),
  "both roles are read, so a pillar with no supports is visible as such"
);
check(
  /no pillar is picked yet/.test(facts),
  "with no pillar it says there is no map rather than offering the keyword list as one",
  "a person picks the pillar; it is never chosen from the scores"
);

console.log("");
if (failures) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log("All checks passed. The page run is on the board and the rails are where they were.");

export {};
