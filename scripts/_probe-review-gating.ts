// THE ANTI-GATING RULE, EXECUTABLE.
//
//   bun --no-env-file run scripts/_probe-review-gating.ts
//
// The AI Referral Engine opens on a five-star rating. The single fact that keeps that legal is that
// THE RATING ROUTES NOTHING: a customer who taps one star reaches the same questions, the same
// assembly and the same public review link as one who taps five.
//
// Review gating -- routing happy customers to a public profile and unhappy ones to a private
// form -- is prohibited outright by Google's Business Profile policy and is reachable by the
// FTC as review suppression under 16 CFR Part 465. It is also the single most common thing a
// reputation product does, which is why this file exists: intent in a comment is not evidence,
// and a probe that fails the moment somebody adds `if (rating < 4)` is.
//
// This is a SOURCE probe, not a render probe. React Testing Library is not in this repo and
// adding a DOM harness to assert one property would be a large dependency for a small fact.
// Reading the source for the branch is the same assertion by a cheaper route -- the same
// technique _probe-onboarding2-chat.ts uses on the tool executor.
//
// ‼️ 2026-09-24: IT READS TWO CLIENTS AND THREE GATES NOW.
//
// v2 (the Virtual Agent) is a second file rendering the same regulated surface, and it asks three
// YES/NO questions. Two new ways to rebuild the funnel this file exists to stop, so two new
// families of check:
//
//   - A SECOND FILE IS A SECOND COPY. `CLIENTS` is a list, not a constant. And check 1b is here
//     because the old check 1 passed VACUOUSLY: subtract five expressions, and a file with no
//     stars in it at all also yields no residue. Presence is what makes subtraction mean
//     something.
//   - A YES IS A BRANCH, NEVER CONTENT. A chip whose text lands in her review is us writing
//     review content with a nicer tap target, and a No that routes anywhere but forward is the
//     gating funnel rebuilt with a word instead of a number -- which check 1 would never see,
//     because there is no `rating` anywhere in it.

import fs from "node:fs";
import path from "node:path";
import { REVIEW_SCRIPT, GATE_IDS } from "../src/lib/hub/review-script";
import {
  ALL_REVIEW_QUESTIONS,
  assembleLabelled,
  assemblePlain,
  isEmpty,
  type ReviewAnswers,
} from "../src/lib/hub/review-assemble";

// ‼️ A LIST, NOT A CONSTANT. Both files open on the same stars, both assemble the same way, and
// every check below that reads "the client" reads both.
const CLIENTS = [
  "src/app/hub/[host]/reviews/referral-engine-client.tsx",
  "src/app/hub/[host]/reviews/virtual-agent-client.tsx",
] as const;
const V2 = "src/app/hub/[host]/reviews/virtual-agent-client.tsx";
const TOOL = "src/app/hub/[host]/reviews/referral-engine.tsx";
const SUBMIT = "src/app/api/hub/reviews/submit/route.ts";
const ASSEMBLE = "src/lib/hub/review-assemble.ts";
const SCRIPT = "src/lib/hub/review-script.ts";
const CARD = "src/lib/clients/artifacts/review-card.ts";
const LIVE_ROUTE = "src/app/hub/[host]/page.tsx";
const CSS = "src/app/hub/[host]/hub.css";

let failures = 0;

function read(file: string): string {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8");
}

function check(ok: boolean, label: string, detail?: string): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (detail) console.log(`      ${detail}`);
  if (!ok) failures += 1;
}

/** Comments say what we intend; code says what happens. Only code is evidence. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const clientSrcs = CLIENTS.map((file) => [file, stripComments(read(file))] as const);
const v2Src = stripComments(read(V2));
const toolSrc = stripComments(read(TOOL));
const submitSrc = stripComments(read(SUBMIT));
const assembleSrc = stripComments(read(ASSEMBLE));
const scriptSrc = stripComments(read(SCRIPT));

// ── 1. The rating is only ever set and sent. It is never a condition. ────────
//
// Every real use of `rating` in a client is one of: the useState pair, the aria-checked
// comparison and class on the star buttons themselves, and the field on the POST body. Any
// OTHER read is a branch, and a branch is a router.
const ALLOWED_RATING_USES = [
  "const [rating, setRating] = useState<number | null>(null)",
  "aria-checked={rating === n}",
  "className={rating !== null && n <= rating ? \"is-on\" : undefined}",
  "onClick={() => setRating(n)}",
  "rating,",
];
for (const [file, src] of clientSrcs) {
  let residue = src;
  for (const allowed of ALLOWED_RATING_USES) residue = residue.split(allowed).join("");
  const strayRating = [...residue.matchAll(/\brating\b/g)].length;
  check(
    strayRating === 0,
    `${file} sets, renders and posts the rating -- and reads it nowhere else`,
    strayRating === 0
      ? "no branch in it behaves differently for a 1 than for a 5"
      : `${strayRating} unaccounted use(s) of \`rating\`. A new read of it is a new router.`
  );
}

// ── 1b. The five expressions are PRESENT, not merely unaccounted for. ────────
//
// ‼️ THIS IS THE CHECK THAT MAKES CHECK 1 MEAN ANYTHING. Subtraction alone is satisfied by a
// file that never mentions the rating, which is exactly the shape a second client file would
// take if somebody collected the stars a different way. It also pins the v2 stars to the v1
// stars byte for byte, so the advance cannot quietly move off the row and onto the buttons,
// where it would learn WHICH star rather than THAT one was tapped.
for (const [file, src] of clientSrcs) {
  const missing = ALLOWED_RATING_USES.filter((s) => !src.includes(s));
  check(
    missing.length === 0,
    `${file} carries all five star expressions byte for byte`,
    missing.length ? `missing: ${missing.join("  |  ")}` : undefined
  );
}

// ── 2. The destinations do not depend on the rating, anywhere. ───────────────
for (const [file, src] of [...clientSrcs, [TOOL, toolSrc], [SUBMIT, submitSrc], [SCRIPT, scriptSrc]] as const) {
  // `destinations` must never appear in the same expression as `rating`, and neither must the
  // two axes added in 2026-09: which flow is rendered, and which way a gate was answered.
  const coupled =
    /rating[^\n;]*destination|destination[^\n;]*rating/i.test(src) ||
    /rating[^\n;]*\bengine\b|\bengine\b[^\n;]*rating/i.test(src) ||
    /rating[^\n;]*\bgate\b|\bgate\b[^\n;]*rating/i.test(src);
  check(!coupled, `${file} never couples the rating to a destination, a flow or a gate`);
}

// ── 3. The assembler cannot see a rating at all. ─────────────────────────────
//
// The strongest form of the guarantee: the code that turns her answers into the text she posts
// has no access to the number, so it cannot vary by it even by accident.
check(
  !/\brating\b/i.test(assembleSrc),
  "review-assemble.ts has no reference to a rating",
  "the assembly is a pure function of her words and nothing else"
);
check(!/\brating\b/i.test(scriptSrc), "review-script.ts has no reference to a rating either");

// ── 4. Still no model in the path. The rule the whole tool rests on. ─────────
for (const [file, src] of [
  [ASSEMBLE, assembleSrc],
  [SCRIPT, scriptSrc],
  [SUBMIT, submitSrc],
] as const) {
  const hasImport = /^\s*import\s/m.test(src);
  const modelish = /claude-calls|@anthropic|openai|runConversation|transcribeAudio/i.test(src);
  check(
    !modelish,
    `${file} imports no model`,
    file === ASSEMBLE && !hasImport ? "it imports nothing at all, which is the point" : undefined
  );
}
// The script is conversational copy, so it is the file most likely to grow a dependency. It may
// have exactly one, on the question keys.
const scriptImports = [...read(SCRIPT).matchAll(/^\s*import[^"']+["']([^"']+)["']/gm)].map((m) => m[1]);
check(
  scriptImports.every((m) => m === "./review-assemble"),
  "review-script.ts imports the question keys and nothing else",
  scriptImports.join(", ") || "nothing"
);

// ── 5. The private note is offered to everyone and sits after the links. ─────
for (const [file, src] of clientSrcs) {
  const privateIdx = src.indexOf("rev-private");
  const destsIdx = src.indexOf("rev-dests");
  check(
    privateIdx > 0 && destsIdx > 0 && privateIdx > destsIdx,
    `${file} renders the private note AFTER the destination links, not instead of them`
  );
  check(
    !/rating[^\n]*rev-private|rev-private[^\n]*rating/i.test(src),
    `${file} does not condition the private note on the rating`
  );
}

// ── 6. The printed card still has no rating. ────────────────────────────────
//
// On screen the rating can be proven to route nothing. On card stock there is nothing to prove
// it with, so a star handed to a patient on paper is a pre-screen by construction.
// ‼️ IT LOOKS FOR A CONTROL, NOT FOR THE WORD. The card DOES print "No stars, no staff names,
// nothing offered", which is the desired state said out loud to the patient. An earlier version
// of this check banned the substring and failed on that line, which would have pushed somebody
// to delete the very sentence that documents the rule.
const cardSrc = stripComments(read(CARD));
const cardGlyph = /[★☆]/.test(cardSrc); // filled or hollow star
const cardScale = /\bout of (five|5)\b|\brate (your|this)\b|\[1, ?2, ?3, ?4, ?5\]/i.test(cardSrc);
check(
  !cardGlyph && !cardScale,
  "the printed review card carries no rating CONTROL",
  cardGlyph || cardScale
    ? "a star on card stock is a pre-screen by construction: nothing can prove it routed nothing"
    : "every patient gets the same card"
);

// ── 7. A Yes is a branch. It is not a sentence she wrote. ───────────────────
//
// Structural first: a gate id that is also an assembled question key is how the word "Yes" ends
// up in somebody's Google review, because assemblePlain() iterates keys.
const bulletKeys = new Set(ALL_REVIEW_QUESTIONS.map((q) => String(q.key)));
check(GATE_IDS.length >= 3, "the script has its three yes/no gates", `${GATE_IDS.length} found`);
check(
  GATE_IDS.every((id) => !bulletKeys.has(id)),
  "no gate id is also an assembled question key",
  GATE_IDS.filter((id) => bulletKeys.has(id)).join(", ") || undefined
);

// Then behaviourally, because a type is not a runtime. Somebody who tapped nothing but chips has
// typed nothing, and every reader downstream has to agree about that.
const yesOnly = Object.fromEntries(GATE_IDS.map((id) => [id, "Yes"])) as unknown as ReviewAnswers;
check(assemblePlain(yesOnly) === "", "a Yes on every gate copies nothing");
check(assembleLabelled(yesOnly).length === 0, "and produces no bullet on screen");
check(isEmpty(yesOnly), "and reads as nothing typed, so no row is stored at all");

// ── 8. A gate routes FORWARD or not at all. ─────────────────────────────────
//
// The failure this exists for: somebody turns "No" into a route to the private note. That is the
// gating funnel rebuilt with a word instead of a number.
for (const [i, step] of REVIEW_SCRIPT.entries()) {
  if (step.kind !== "gate") continue;
  const at = REVIEW_SCRIPT.findIndex((s) => s.id === step.onYes);
  check(
    at === i + 1,
    `gate ${step.id} routes Yes to the very next step`,
    at === i + 1 ? undefined : `onYes "${step.onYes}" is at ${at}, gate is at ${i}`
  );
  check(
    step.onNo === null,
    `gate ${step.id} routes No forward and nowhere else`,
    "a No with a destination of its own is a router, and the destination it grows into is the private box"
  );
}

// ── 9. Answering a gate advances the walk and touches nothing else. ─────────
//
// Same technique as the five expressions: cut the one named function out of the source and deny
// what may be inside it. `setAnswers` is on the list deliberately -- the free-text follow-up is
// committed by the ordinary commit(), never by a chip.
const gateFnStart = v2Src.indexOf("function answerGate(");
check(gateFnStart > 0, "the v2 client answers a gate in exactly one named function");
const gateFn = gateFnStart < 0 ? "" : v2Src.slice(gateFnStart, v2Src.indexOf("\n  }\n", gateFnStart));
const FORBIDDEN = ["rev-private", "privateNote", "setRevealed", "destinations", "rating", "store(", "setAnswers"];
const found = FORBIDDEN.filter((t) => gateFn.includes(t));
check(
  found.length === 0,
  "and that function reveals nothing, stores nothing and answers nothing",
  found.length ? `found: ${found.join(", ")}` : undefined
);

// ── 10. "Yes" is never written into ReviewAnswers. ─────────────────────────
//
// The type is the first line of defence: gate ids are not in ReviewQuestion["key"], so
// `tsc --noEmit` rejects it. This is the second, because a cast gets past a type.
check(
  !/setAnswers[\s\S]{0,240}?(["'](Yes|No)["'])/.test(v2Src),
  "no setAnswers call has a Yes or a No anywhere near it"
);
check(
  !/\bas\s+(unknown\s+as\s+)?ReviewAnswers\b/.test(v2Src),
  "and nothing in the v2 client casts its way into ReviewAnswers"
);

// ── 11. The agent says its lines. It does not compose them. ────────────────
//
// A `${` inside a scripted line is one edit away from interpolating HER ANSWER into what the
// agent says back, and an agent quoting her words to her is the shape of a tool that then offers
// to improve them. The business name is a placeholder token replaced at render instead.
const interpolated = REVIEW_SCRIPT.filter(
  (s) => (s.kind === "say" ? s.text : s.prompt).includes("${")
).map((s) => s.id);
check(interpolated.length === 0, "no scripted line interpolates anything", interpolated.join(", ") || undefined);

// ── 12. A real customer cannot reach an unfinished flow. ───────────────────
//
// The live host renders the default engine because it never reads the parameter. Wiring
// readEngine() into the live route would let anybody put ?engine= on reviews.{domain}.
check(
  !/readEngine/.test(stripComments(read(LIVE_ROUTE))),
  "the live reviews route does not read an engine parameter",
  "only the two previews choose a flow; a client host always gets the default"
);

// ── 13. Nothing HIDES the public path in CSS. ──────────────────────────────
//
// ‼️ THE ONE HOLE EVERY CHECK ABOVE LEAVES OPEN. All of them read source for a branch. A
// stylesheet needs no branch: one rule setting display:none on .rev-dests hides the public
// review link from everybody and every source probe still passes. This does not close the hole
// -- layout can bury a link without hiding it -- but it closes the cheap version of it.
const cssSrc = read(CSS).replace(/\/\*[\s\S]*?\*\//g, "");
const hidden: string[] = [];
for (const m of cssSrc.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
  const selector = m[1];
  const body = m[2];
  if (!/rev-dests|rev-private/.test(selector)) continue;
  if (/(^|[\s;{])(display\s*:\s*none|visibility\s*:\s*hidden)/.test(body)) hidden.push(selector.trim());
}
check(
  hidden.length === 0,
  "no stylesheet rule hides the destination links or the private note",
  hidden.length ? `hidden by: ${hidden.join(" | ")}` : "the public path is reachable on screen too"
);

console.log("");
if (failures) {
  console.error(`${failures} check(s) failed. The rating must not route, and neither may a Yes.`);
  process.exit(1);
}
console.log("All checks passed. Every rating reaches the same review link, and every Yes is only a branch.");

export {};
