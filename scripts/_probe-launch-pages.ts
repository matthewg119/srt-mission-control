/**
 * Probe: the Launch Lane's page run keeps the rails the Slack thread kept.
 *
 *   bun run scripts/_probe-launch-pages.ts
 *
 * Needs no database, no model call and no network. It reads source text.
 *
 * WHY THIS EXISTS. src/lib/launch/pages.ts is a door onto machinery that was previously reachable
 * only by typing into a Slack thread, and the whole run is now driven from the onboarding chat.
 * Four of the things that made that thread safe have no type to defend them:
 *
 *   - publishPage() resolves the destination ITSELF. Its own header says two callers were already
 *     two chances to skip the ownership check and publish onto another client's hostname. This is
 *     the third, so it passes the raw id through and reads no hosts.
 *   - The stages are ordered on purpose. `plan approve` stopped drafting on 2026-09-14 so every
 *     decision lands before a page is written, and an action that skipped a stage would write
 *     pages off no outline.
 *   - The Day-0 waiver is never a second button, and is not on this surface at all.
 *   - client_keywords.selected_at has exactly ONE writer in the repo, keyword-decisions.ts, which
 *     step-needs.ts declares and _probe-dead-wires.ts §8 greps for. The chat can now change the
 *     selected pool, so this checks it calls that writer rather than growing a second one.
 *
 * ‼️ PUBLISHING FROM THE CHAT IS DELIBERATE AND IS CHECKED AS SUCH. It was forbidden until
 * 2026-10-05 and is here on Matthew's explicit instruction. What was removed is the surface
 * restriction; the three rails live inside publishPage and this asserts nothing grew a fourth copy.
 * Buying a domain stays forbidden, and that IS still checked.
 *
 * ‼️ THE IMPORT BAN IS NOT RE-CHECKED HERE. src/lib/launch is a LANE_ROOT in
 * _probe-launch-isolation.ts, so these files are already covered by it. A second copy of that check
 * is how the two start disagreeing.
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

const squish = (s: string): string => s.replace(/\s+/g, " ");

/**
 * One `case "name":` branch, ending at whichever case comes next.
 *
 * ‼️ IT FINDS ITS OWN END RATHER THAN BEING GIVEN THE NEXT CASE BY NAME, and the version that was
 * given one went quietly wrong the moment a stage was inserted between the two. Slicing
 * skeletons_write to research_prompt swallowed every branch added in between, so a guard planted in
 * ANY of them satisfied the check for the one being tested. The branch has to be the branch.
 */
function caseBody(src: string, name: string): string {
  const from = src.indexOf(`case "${name}"`);
  if (from < 0) return "";
  const rest = src.slice(from + `case "${name}"`.length);
  const next = rest.search(/\bcase "/);
  return squish(next < 0 ? rest : rest.slice(0, next));
}

const MODULE = "src/lib/launch/pages.ts";
const CHAT = "src/lib/launch/conversation.ts";
const FACTS = "src/lib/launch/publishing-facts.ts";
const DECISIONS = "src/lib/clients/keyword-decisions.ts";

const mod = code(MODULE);
const chat = code(CHAT);
const facts = code(FACTS);
const decisions = code(DECISIONS);

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
  !/hub\/destinations/.test(mod) && !/hub\/destinations/.test(chat),
  "neither the page module nor the chat imports @/lib/hub/destinations",
  "the choices come back inside publishPage's own refusal, which is the list it already owns"
);
check(
  /destinationId/.test(mod) && /destinationId/.test(chat),
  "the destination id is passed straight through to publishPage"
);

// ── 2. No waiver on this surface ─────────────────────────────────────────────

for (const [file, src] of [
  [MODULE, mod],
  [CHAT, chat],
] as const) {
  check(
    !/waiveDay0|waive_day_zero|waive_gate/.test(src),
    `${file} offers no Day-0 or gate waiver`,
    "the waiver is offered only after a refusal, needs a written reason, and lives on the client page"
  );
}

// ── 3. The stages cannot be skipped ──────────────────────────────────────────
//
// ‼️ IT MATCHES THE GUARD, NOT THE MESSAGE, AND THE FIRST VERSION OF THIS PROBE DID THE OPPOSITE.
// Both refusals quote the counts back in their own error text, so a check for `needHeadline.length`
// anywhere in the branch passed with the condition replaced by `if (false)`: the words were still
// there, in the sentence explaining a refusal that no longer happened. Measured by planting exactly
// that. Whitespace is squashed first so wrapping the condition over two lines is not a failure.

// ‼️ THE IDEA COMES BEFORE THE LINE, AND THIS IS THE GATE THAT WAS MISSING UNTIL 2026-10-06. The
// lane ran plan -> approve -> headlines with nothing in between deciding what each page ARGUES, so
// the generator was asked to write a line about a phrase and thirty three candidates came back
// reading as thirty three ways of saying the phrase out loud (page-angles.ts opens on exactly this).
// Matched on the CONDITION for the same reason the two below are.
const headlineCase = caseBody(mod, "headlines_write");
check(
  headlineCase.length > 0 && /if \(\s*batch\.needAngle\.length\s*\)/.test(headlineCase),
  "writing headlines is GUARDED on any page still needing an idea",
  "a headline written before anybody decided what the page argues is a line about a phrase"
);

const skeletonCase = caseBody(mod, "skeletons_write");
check(
  skeletonCase.length > 0 && /if \(\s*batch\.needHeadline\.length\s*\)/.test(skeletonCase),
  "writing skeletons is GUARDED on any page still needing a headline",
  "a skeleton written before its headline is an outline for a page that does not know what it promises"
);

const draftCase = caseBody(mod, "draft_wave");
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
check(listed.length >= 21, `the action list was found and holds ${listed.length} entries`);
for (const action of listed) {
  check(mod.includes(`case "${action}"`), `${action} has a branch in runLaunchPagesAction`);
}

// ── 6. The chat's closed union ───────────────────────────────────────────────

check(
  /"publish_page"/.test(chat) && /"unpublish_page"/.test(chat),
  "the chat can publish, which was a deliberate 2026-10-05 reversal",
  "the rails stayed inside publishPage; only the surface restriction went"
);
check(
  !/"buy_domain"|buyDomain\(/.test(chat),
  "the chat still CANNOT buy a domain",
  "it is the only code in the lane that spends money, and a conversation must not reach it"
);

// ‼️ THE GENERIC VERB MUST NOT REACH THE IRREVERSIBLE ONE. run_pages takes a stage out of the
// action list, and publishing has its own kind precisely so it stays visible in the prompt and in
// the results. If publish leaked into the stage list it would be reachable without ever being named.
const stageFilter = squish(chat.slice(chat.indexOf("PAGE_RUN_STAGES"), chat.indexOf("PAGE_RUN_STAGES") + 400));
check(
  /a !== "publish" && a !== "unpublish"/.test(stageFilter),
  "run_pages excludes publish and unpublish from its stages",
  "publishing keeps its own action kind so it cannot be reached by a generic verb"
);

const selfProving = squish(chat.slice(chat.indexOf("const SELF_PROVING"), chat.indexOf("const proposed")));
check(
  /"read_pages"/.test(selfProving),
  "read_pages is exempt from the confidence bar, because it changes nothing"
);
check(
  !/"run_pages"/.test(selfProving) && !/"publish_page"/.test(selfProving),
  "run_pages and publish_page are NOT exempt",
  "they write rows, spend model calls, and one of them puts words on the internet under a client's name"
);

// ── 7. The one writer of selected_at ─────────────────────────────────────────

check(
  !/selected_at/.test(mod),
  "the page module never writes client_keywords.selected_at itself",
  "step-needs.ts declares keyword-decisions.ts as the writer and _probe-dead-wires.ts §8 greps it"
);
check(
  /selectKeywordIds|unselectKeywordIds/.test(mod),
  "it calls the declared writer instead"
);
check(
  !/^import \{[^}]*\} from "@\/lib\/slack-bot";$/m.test(decisions),
  "keyword-decisions.ts carries no Slack import at module scope",
  "that is what lets the Launch Lane call the one selected_at writer without tripping the import ban"
);

// ── 8. The strategy map reaches the chat ─────────────────────────────────────
//
// Asked "what is our strategy map" the chat had every selected phrase and could not name the
// pillar, because `role` was not in the select. This is that regression's guard.

check(
  /\.select\("phrase, category, role,/.test(facts),
  "publishing-facts reads client_keywords.role",
  "without it the chat has the phrases and cannot say which one the pages are built around"
);
check(/THE STRATEGY MAP/.test(facts), "publishing-facts puts the strategy map in the chat's facts");
check(
  /r\.role === "pillar"/.test(facts) && /r\.role === "support"/.test(facts),
  "both roles are read, so a pillar with no supports is visible as such"
);
check(
  /no pillar is picked yet/.test(facts),
  "with no pillar it says there is no map rather than offering the keyword list as one",
  "a person picks the pillar; it is never chosen from the scores"
);

// ‼️ THE FOUR KEYWORD VERBS ARE FOUR DIFFERENT DECISIONS AND THE CHAT MUST BE TOLD WHICH IS WHICH.
// keywords_select cannot mint, keywords_add can, drop is remembered and unselect is not. The chat
// answered "I cannot add keywords directly" on 2026-10-05 because minting genuinely did not exist;
// the opposite failure, reaching for drop when he meant unselect, is silent and permanent.
check(
  /mintKeywords/.test(mod) && /dropKeywordIds/.test(mod),
  "the lane can mint a keyword and drop one"
);
check(
  /keywords_add/.test(chat) && /keywords_drop/.test(chat) && /keywords_select/.test(chat) && /keywords_unselect/.test(chat),
  "the prompt names all four keyword verbs, so one is not used for another"
);

console.log("");
if (failures) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log("All checks passed. The page run is in the chat and the rails are where they were.");

export {};
