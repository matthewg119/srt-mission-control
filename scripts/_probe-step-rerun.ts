// The re-run command's grammar, and that the two generated board docs still describe the board.
// No network.
//
//   bunx tsx scripts/_probe-step-rerun.ts

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseRerun } from "../src/lib/clients/step-rerun";
import { DELIVERY_STEPS, stepNumber, type StepKey } from "../src/config/delivery-steps";
import { gapLines, type Gap, type StepGaps } from "../src/lib/clients/step-gaps";
import { fieldFor, type FieldRef } from "../src/lib/clients/step-needs";
import { RERUN_UPSTREAM_ACTION, rerunGapBlocks, rerunGapLines, upstreamFills } from "../src/lib/clients/rerun-gaps";

let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
}

const here = (t: string) => {
  const r = parseRerun(t);
  return r !== null && "here" in r;
};
const range = (t: string) => {
  const r = parseRerun(t);
  return r && !("here" in r) ? `${r.from}-${r.to}` : null;
};

for (const t of ["rerun", "re-run", "restart", "  `rerun`  ", "RERUN", "rerun this step"]) {
  check(`bare: ${t}`, here(t));
}
check("rerun step 13", range("rerun step 13") === "13-13");
check("start step 13", range("start step 13") === "13-13");
check("rerun 18-21", range("rerun 18-21") === "18-21");
check("rerun steps 18 to 21", range("rerun steps 18 to 21") === "18-21");
check("rerun #18 through #21", range("rerun #18 through #21") === "18-21");
check("restart 21", range("restart 21") === "21-21");

// ‼️ CONSERVATIVE: this fires inside a client's channel, where people also type sentences.
check("a sentence is not a command", parseRerun("can we rerun the audit for this client") === null);
check("start 13 without the word step is not a command", parseRerun("start 13") === null);
check("a step past the end is refused", parseRerun(`rerun step ${DELIVERY_STEPS.length + 1}`) === null);
check("a backwards range is refused", parseRerun("rerun 21-18") === null);
check("zero is refused", parseRerun("rerun step 0") === null);

// ── A re-run carries the board on, and cannot post a wall of cards doing it ──
const rerunSrc = readFileSync(path.resolve(__dirname, "../src/lib/clients/step-rerun.ts"), "utf8");

/**
 * The same source with comments blanked out.
 *
 * ‼️ THE GREPS BELOW MUST NOT READ THE DOC COMMENTS. step-rerun.ts documents its rules by naming the
 * very thing it defers to, so "it does not re-implement reachability" failed on a file that is
 * correct BECAUSE it says `reachableCursor` is what bounds it. Same preamble _probe-lead-context.ts
 * carries, for the same reason. Newlines are preserved so line numbers still point at real lines.
 */
const RERUN_CODE = rerunSrc
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
  .replace(/\/\/[^\n]*/g, "");

check("a re-run walks the board on when it is done", /if \(args\.advance !== false\) await continueBoard/.test(RERUN_CODE));

// ‼️ THE SAME CASCADE A TRANSITION RUNS, IN THE SAME ORDER. Anchors before runners before cards:
// postReadySteps skips a step that already has a message, so running it first loses the auto step.
const cascade = ["ensureReachableAnchors", "runReadyAutoSteps", "postReadySteps"];
const at = cascade.map((fn) => RERUN_CODE.indexOf(`await ${fn}(`));
check("it runs the whole cascade", at.every((i) => i > 0), cascade.filter((_, i) => at[i] < 0).join(", "));
check("in anchors, runners, cards order", at[0] < at[1] && at[1] < at[2]);

// ‼️ reachableCursor IS WHAT STOPS IT AT ONE. The cascade is deferred to rather than re-implemented,
// so there is no second opinion about what is reachable. A guard for "the step is still pending"
// would be exactly that second opinion.
check("it does not re-implement reachability", !/reachableCursor\s*\(/.test(RERUN_CODE));

// ‼️ ONLY THE LAST HOP OF A RANGE KICKS. Otherwise rerun 18-21 posts step 19's card, then re-runs
// 19, then posts it again.
check("a range does not kick after every hop", /advance: false/.test(RERUN_CODE));
check("a range kicks once at the end", /^\s*await continueBoard\(args\.clientId\);\s*$/m.test(RERUN_CODE));

// ── The generated docs have to match the board as it is now ──
const WIRING = path.resolve(__dirname, "_step-wiring.ts");
const generator = readFileSync(WIRING, "utf8");

for (const doc of ["docs/STEP-WIRING.md", "docs/ONBOARDING-MAP.md"]) {
  check(`${doc} exists`, existsSync(path.resolve(__dirname, "..", doc)));
  check(`${doc} is in CHECKED_DOCS`, generator.includes(`"${doc}"`));
}

// ‼️ THE MEASURED MAP MUST NEVER JOIN THE CHECK. It carries its measurement date on line 1, so a
// byte compare against it would fail every time production changed, on a tree nobody has touched.
const checkedList = /const CHECKED_DOCS = \[([^\]]*)\]/.exec(generator)?.[1] ?? "";
check("the measured map is not one of the checked docs", checkedList.length > 0 && !checkedList.includes("MEASURED"));
check("the generator has a --live arm", generator.includes(`"--live"`));

// ‼️ THE STATIC PATH CANNOT READ A DATABASE, AND THIS IS THE PROOF. Both checked docs are built by
// synchronous functions; the live half lives in its own module, dynamically imported. Put a query
// in here and a live number can reach a --check'ed doc, which is how this probe starts crying drift.
check("no database call in the generator itself", !/supabaseAdmin|\.from\(/.test(generator));

try {
  execFileSync("bunx", ["tsx", WIRING, "--check"], { stdio: "pipe", shell: process.platform === "win32" });
  check("both generated docs are current", true);
} catch (e) {
  check("both generated docs are current", false, (e as Error).message.split("\n")[0]);
}

// ─────────────────────────────────────────────────────────────────────────────
// What the re-run says it is missing, and which earlier step writes it
//
// ‼️ STILL NO NETWORK. The gap object is built by hand from REAL field specs, so the gap is
// deterministic instead of whatever SRT's board happens to hold today, and this probe keeps its
// "no --env-file" header. Same move _probe-suggestions.ts makes with contextWith: the cast is the
// documentation.
// ─────────────────────────────────────────────────────────────────────────────

// ‼️ THE SECOND COPY. _probe-suggestions.ts carries the same pattern and the reasoning for it;
// widened together 2026-09-22 so a cross-client basis naming a shared table passes both.
const SOURCE = /client_[a-z_]+|page_[a-z_]+|avatar_briefs|question_bank|audience_documents|dataset_suggestions|policy_documents|STEP_NEEDS/;

function gapFor(ref: string, blocking = true): Gap {
  const field = fieldFor(ref as FieldRef);
  if (!field) throw new Error(`no field spec for ${ref}`);
  const f = field.filledBy;
  const text = f.kind === "step" && f.built ? `${f.how}, on ${f.step}` : "nothing asks for this yet";
  return {
    ref: ref as FieldRef,
    field,
    blocking,
    blocks: [],
    because: "asked_unanswered",
    fill: { text, commands: [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]) },
  };
}

function gapsWith(stepKey: StepKey, gaps: Gap[], over: Partial<StepGaps> = {}): StepGaps {
  return {
    stepKey,
    number: stepNumber(stepKey),
    label: DELIVERY_STEPS.find((s) => s.key === stepKey)?.label ?? stepKey,
    have: 0,
    need: gaps.filter((x) => x.blocking).length,
    gaps,
    unreadable: [],
    nothingWhy: null,
    ...over,
  };
}

// `offer.short_offer` is written at `offer_locked` (step 10), so step 12 missing it should point back.
const twelve = gapsWith("keyword_set", [gapFor("offer.short_offer")]);
const twelveUps = upstreamFills(twelve);
const twelveLines = rerunGapLines(twelve, twelveUps);
const twelveText = twelveLines.join("\n");

check("an earlier writer is found", twelveUps.length === 1, twelveUps.map((u) => u.step).join(", "));
check("it is the step dataset-spec declares", twelveUps[0]?.step === "offer_locked");
check(
  "the number is stepNumber's, not a literal",
  twelveUps[0]?.number === stepNumber("offer_locked"),
  String(twelveUps[0]?.number)
);
check("it carries the step's own label", twelveUps[0]?.label === DELIVERY_STEPS.find((s) => s.key === "offer_locked")?.label);

// ‼️ THE GAP BULLETS MUST BE gapLines' OWN, BYTE FOR BYTE. Same rule _probe-lead-brief.ts enforces:
// a second rendering of the same gap is a second set of words for it.
const bullets = gapLines(twelve);
check("the bullets are the board's own sentences", twelveLines.slice(0, bullets.length).join("\n") === bullets.join("\n"));
check("it names the gap itself", twelveText.includes("the offer, named"));
check("it says to re-run the earlier step", /`rerun 10`/.test(twelveText), twelveText.split("\n").find((l) => l.includes("rerun ")) ?? "");
check("it says nothing has been re-run", /Proposals only\. Nothing above has been re-run\./.test(twelveText));

// ‼️ EVERY `rerun N` IT PRINTS HAS TO BE A COMMAND THE PARSER ACCEPTS. The _probe-gaps.ts rule is
// that a card never invents a command; a literal grep of src/ cannot prove it for this one because
// the number is computed, so the parser above is asked directly.
const printed = [...twelveText.matchAll(/`(rerun [^`]+)`/g)].map((m) => m[1]);
check("it prints at least one rerun command", printed.length > 0);
check(
  "every rerun command it prints parses to the step it named",
  printed.every((cmd) => {
    const r = parseRerun(cmd);
    return r !== null && !("here" in r) && r.from === stepNumber("offer_locked") && r.to === r.from;
  }),
  printed.join(" | ")
);

// ‼️ A LATER STEP IS NOT AN UPSTREAM STEP. `offer.lead_magnet` is minted at `pre_call_pages` (21),
// so a re-run of 13 proposing 21 would be pointing at work that cannot run yet.
const magnet = gapsWith("custom_question_set", [gapFor("offer.lead_magnet")]);
check("a later writer is not proposed", upstreamFills(magnet).length === 0, upstreamFills(magnet).map((u) => u.step).join(", "));

// The step being re-run is never its own upstream: gapLines already says to type it here.
const ten = gapsWith("offer_locked", [gapFor("offer.short_offer")]);
check("the step being re-run is not its own upstream", upstreamFills(ten).length === 0);

// Two gaps, one writer: one proposal carrying both field names, not two proposals.
const twoGaps = gapsWith("keyword_set", [gapFor("offer.short_offer"), gapFor("offer.customer_terms")]);
const twoUps = upstreamFills(twoGaps);
check("two gaps with one writer are one proposal", twoUps.length === 1);
check("and it counts both fields", twoUps[0]?.fields.length === 2, (twoUps[0]?.fields ?? []).join(", "));

// ‼️ AN OWED WRITER IS NOT A DOOR. `built: false` means nothing writes the field yet, and step-gaps
// already renders it with no arrow; a button offering to re-run that step would be the invented door.
const owedField = fieldFor("offer.short_offer" as FieldRef)!;
const owed = gapsWith("keyword_set", [
  {
    ...gapFor("offer.short_offer"),
    field: { ...owedField, filledBy: { kind: "step", step: "offer_locked", how: "nothing writes it yet", built: false } },
  },
]);
const owedUps = upstreamFills(owed);
check("an owed writer is not proposed", owedUps.length === 0);
check("and it gets no button", rerunGapBlocks("c", owed, owedUps).every((b) => b.type !== "actions"));

// Nothing missing: it says so rather than going quiet.
const clean = gapsWith("keyword_set", [], { have: 1, need: 1 });
const cleanText = rerunGapLines(clean, upstreamFills(clean)).join("\n");
check("a step with everything on file says so", cleanText.includes("has everything it needs on file"));
check("and proposes nothing upstream", !cleanText.includes("Fill it upstream first"));

// ‼️ UNREADABLE IS NOT MISSING (rule 1). A failed select must never render as an ask.
const blind = gapsWith("keyword_set", [], { unreadable: ["offer.short_offer", "offer.price"] });
const blindText = rerunGapLines(blind, upstreamFills(blind)).join("\n");
check("unreadable datasets are reported, not asked about", blindText.includes("could not be read"));
check("and nothing is asked for", !blindText.includes("→") && !blindText.includes("Fill it upstream first"));

// D9, the same assertion _probe-suggestions.ts makes: a source, and deliberately not a digit.
for (const [name, text] of [
  ["a gap block", twelveText],
  ["a clean block", cleanText],
  ["an unreadable block", blindText],
] as const) {
  const basis = text.split("\n").find((l) => l.startsWith("_Read from:")) ?? "";
  check(`${name} cites what it read`, SOURCE.test(basis), basis);
}

// The buttons: one per proposal, and Slack rejects a message whose buttons share an action_id.
const blocks = rerunGapBlocks("client-1", twelve, twelveUps);
const actions = blocks.find((b) => b.type === "actions");
const buttons = (actions?.elements ?? []) as Array<{ action_id: string; value: string }>;
check("one button per proposal", buttons.length === twelveUps.length);
check("the action ids are distinct", new Set(buttons.map((b) => b.action_id)).size === buttons.length);
check("each strips back to the one handled action id", buttons.every((b) => b.action_id.replace(/#\d+$/, "") === RERUN_UPSTREAM_ACTION));
check("the value is clientId:stepKey", buttons[0]?.value === "client-1:offer_locked", buttons[0]?.value ?? "");
check("the route handles that action id", readFileSync(path.resolve(__dirname, "../src/app/api/slack/actions/route.ts"), "utf8").includes("case RERUN_UPSTREAM_ACTION:"));

// ‼️ A BODY OVER 3,000 CHARACTERS FAILS THE WHOLE MESSAGE, and notifyStep does not chunk.
const SECTION_BUDGET = 2900;
for (const b of blocks) {
  if (b.type !== "section") continue;
  const len = b.text?.text.length ?? 0;
  check("each section is under the budget", len < SECTION_BUDGET, String(len));
}
check("no single line can blow a section on its own", twelveLines.every((l) => l.length < SECTION_BUDGET));

// House style, and it applies to anything a person reads.
//
// ‼️ BUILT FROM A CHAR CODE, NOT WRITTEN OUT. A literal em dash in the file that bans em dashes is
// the one false positive every later sweep of this repo would trip over.
const EM_DASH = String.fromCharCode(0x2014);
check("no em dash in the block", ![twelveText, cleanText, blindText].join("\n").includes(EM_DASH));
check(
  "no em dash in the module",
  !readFileSync(path.resolve(__dirname, "../src/lib/clients/rerun-gaps.ts"), "utf8").includes(EM_DASH)
);

// ‼️ PURE, AND THE PROBE IS WHAT KEEPS IT THAT WAY. The moment this module reads a table, a card
// render pays for it, which is the exact cost gap-prompts.ts split gapPromptsAvailable out to avoid.
const GAPS_SRC = readFileSync(path.resolve(__dirname, "../src/lib/clients/rerun-gaps.ts"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
  .replace(/\/\/[^\n]*/g, "");
check("no database handle in rerun-gaps", !/supabaseAdmin|\.from\(/.test(GAPS_SRC));
check("nothing is awaited in rerun-gaps", !/\bawait\b/.test(GAPS_SRC));
check("it does not re-implement the inversion", !/stepsNeeding|stepsBlockedBy/.test(GAPS_SRC));

// The re-run posts it, and posts it for every card path rather than only the ones with a card.
check("the re-run says what is missing", /await sayWhatIsMissing\(args\.clientId, args\.stepKey\)/.test(RERUN_CODE));
check("it is said before the board walks on", RERUN_CODE.indexOf("sayWhatIsMissing(args.clientId") < RERUN_CODE.indexOf("if (args.advance !== false)"));
check("it cannot fail the re-run", /catch \(e\) \{[\s\S]{0,200}could not say what/.test(RERUN_CODE));

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nall re-run checks pass");
