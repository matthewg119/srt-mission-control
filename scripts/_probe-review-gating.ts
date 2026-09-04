// THE ANTI-GATING RULE, EXECUTABLE.
//
//   npx tsx scripts/_probe-review-gating.ts
//
// The review tool opens on a five-star rating. The single fact that keeps that legal is that
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

import fs from "node:fs";
import path from "node:path";

const CLIENT = "src/app/hub/[host]/reviews/review-client.tsx";
const TOOL = "src/app/hub/[host]/reviews/review-tool.tsx";
const SUBMIT = "src/app/api/hub/reviews/submit/route.ts";
const ASSEMBLE = "src/lib/hub/review-assemble.ts";
const CARD = "src/lib/clients/artifacts/review-card.ts";

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

const clientSrc = stripComments(read(CLIENT));
const toolSrc = stripComments(read(TOOL));
const submitSrc = stripComments(read(SUBMIT));
const assembleSrc = stripComments(read(ASSEMBLE));

// ── 1. The rating is only ever set and sent. It is never a condition. ────────
//
// Every real use of `rating` in the client is one of: the useState pair, the aria-checked
// comparison and class on the star buttons themselves, and the field on the POST body. Any
// OTHER read is a branch, and a branch is a router.
const ALLOWED_RATING_USES = [
  "const [rating, setRating] = useState<number | null>(null)",
  "aria-checked={rating === n}",
  "className={rating !== null && n <= rating ? \"is-on\" : undefined}",
  "onClick={() => setRating(n)}",
  "rating,",
];
let residue = clientSrc;
for (const allowed of ALLOWED_RATING_USES) residue = residue.split(allowed).join("");
const strayRating = [...residue.matchAll(/\brating\b/g)].length;
check(
  strayRating === 0,
  "`rating` is set, rendered on its own stars, and posted -- and read nowhere else",
  strayRating === 0
    ? "no branch in review-client.tsx behaves differently for a 1 than for a 5"
    : `${strayRating} unaccounted use(s) of \`rating\`. A new read of it is a new router.`
);

// ── 2. The destinations do not depend on the rating, anywhere. ───────────────
for (const [file, src] of [
  [CLIENT, clientSrc],
  [TOOL, toolSrc],
  [SUBMIT, submitSrc],
] as const) {
  // `destinations` / `destinationsFor` must never appear in the same expression as `rating`.
  const coupled = /rating[^\n;]*destination|destination[^\n;]*rating/i.test(src);
  check(!coupled, `${file} never couples the rating to a destination`);
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

// ── 4. Still no model in the path. The rule the whole tool rests on. ─────────
for (const [file, src] of [
  [ASSEMBLE, assembleSrc],
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

// ── 5. The private note is offered to everyone and sits after the links. ─────
const privateIdx = clientSrc.indexOf("rev-private");
const destsIdx = clientSrc.indexOf("rev-dests");
check(
  privateIdx > 0 && destsIdx > 0 && privateIdx > destsIdx,
  "the private note renders AFTER the destination links, not instead of them"
);
check(
  !/rating[^\n]*rev-private|rev-private[^\n]*rating/i.test(clientSrc),
  "the private note is not conditioned on the rating"
);

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

console.log("");
if (failures) {
  console.error(`${failures} check(s) failed. The rating must not route.`);
  process.exit(1);
}
console.log("All checks passed. Every rating reaches the same review link.");

export {};
