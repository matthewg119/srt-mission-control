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
import { REVIEW_SCRIPT, GATE_IDS, NON_REVIEW_IDS } from "../src/lib/hub/review-script";
import {
  ALL_REVIEW_QUESTIONS,
  LEAD_KEYS,
  LEAD_SERVICE_ONLY,
  LEAD_WITH_PROVIDER,
  assembleLabelled,
  assembleLead,
  assemblePlain,
  isEmpty,
  type ReviewAnswers,
} from "../src/lib/hub/review-assemble";

// ‼️ STILL A LIST THOUGH IT HOLDS ONE FILE, AND THAT IS DELIBERATE.
//
// It held two until 2026-10-05: v1 and the Virtual Agent were both renderings of this regulated
// surface, and the point of the list was that "a second file is a second copy" of every rule
// below. v1 was deleted when Matthew picked one design, so there is one rendering again.
//
// Collapsing this back to a constant would save a line and lose the mechanism. The next time
// somebody builds a second chat to compare, the only thing standing between that and an
// unchecked copy of a review surface is how easy it is to add it here.
const CLIENTS = ["src/app/hub/[host]/reviews/virtual-agent-client.tsx"] as const;
const V2 = "src/app/hub/[host]/reviews/virtual-agent-client.tsx";
const TOOL = "src/app/hub/[host]/reviews/referral-engine.tsx";
const SUBMIT = "src/app/api/hub/reviews/submit/route.ts";
const ASSEMBLE = "src/lib/hub/review-assemble.ts";
const SCRIPT = "src/lib/hub/review-script.ts";
const CARD = "src/lib/clients/artifacts/review-card.ts";
const LIVE_ROUTE = "src/app/hub/[host]/page.tsx";
const CSS = "src/app/hub/[host]/hub.css";
const INVITE = "src/lib/hub/referral-invite.ts";
const EMAILS = "src/lib/hub/referral-emails.ts";

/**
 * Where a two-space-indented function body ends, used to cut one named function out of a source
 * file. Built from a char code rather than written as an escape so that no editor, formatter or
 * `core.autocrlf` checkout can turn it into something else: see stripComments below, where
 * exactly that cost three checks.
 */
const LF = String.fromCharCode(10);
const FN_END = `${LF}  }${LF}`;

let failures = 0;

/**
 * Source, with CRLF normalised to LF.
 *
 * ‼️ WITHOUT THIS THE PROBE CRIES WOLF ON EVERY WINDOWS CHECKOUT, AND IT DID. Section 9 finds the end
 * of `answerGate` with `indexOf("\n  }\n")`. `core.autocrlf=true` materialises the file with `\r\n`,
 * so that marker is never found, `indexOf` returns -1, and `slice(start, -1)` takes the WHOLE REST OF
 * THE FILE instead of one function: `store()`, `rating`, `privateNote` and `destinations` all land
 * inside what the check believes is `answerGate`, and it reports a gating leak that does not exist.
 *
 * It passes in CI, because Linux checks out LF, so the failure is invisible to the author and red on
 * the reviewer's machine. That asymmetry is worse than a plain bug: it teaches people that this probe
 * is unreliable, and this is the one probe whose whole job is an FTC compliance rail.
 *
 * Third instance of this trap in this repo. _step-wiring.ts carries `sameText` for it and
 * _probe-list-prep.ts's `normalize()` for the same reason. Fixed 2026-09-28.
 */
function read(file: string): string {
  const CR = String.fromCharCode(13);
  return fs.readFileSync(path.join(process.cwd(), file), "utf8").split(CR).join("");
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

// ── 10b. THE REFERRAL (v5, 2026-10-05) ROUTES THE REFERRAL AND NOTHING ELSE. ─
//
// ‼️ THIS IS THE SECTION THAT LICENSES THE WHOLE FEATURE, SO READ IT BEFORE CHANGING IT.
// review-assemble.ts used to say "NOT ASKED, EVER: ... whether she would recommend", and the
// reason was sound: an NPS question in front of a review is the industry's standard pre-screen,
// where a promoter is shown the Google link and a detractor is shown a private form. Matthew
// reversed the wording on 2026-10-05. What may NOT be reversed is the rule underneath it, and
// these checks are the difference between the two.
//
// A Yes gets a referral deal. A No gets the identical review: same questions, same editable box,
// same copy button, same destination links, same private note. The moment that stops being true
// this file fails, and it fails for the same reason check 1 exists.

// Structural, exactly as for a gate: an id that is also an assembled key is how a friend's phone
// number or the word "Yes" ends up in a public review, because assemblePlain() iterates keys.
check(
  NON_REVIEW_IDS.length >= 3,
  "the walk has its stars, recommend and invite steps",
  `${NON_REVIEW_IDS.length} found: ${NON_REVIEW_IDS.join(", ")}`
);
check(
  NON_REVIEW_IDS.every((id) => !bulletKeys.has(id)),
  "no stars, recommend or invite id is also an assembled question key",
  NON_REVIEW_IDS.filter((id) => bulletKeys.has(id)).join(", ") || undefined
);

// Behaviourally. A visitor who tapped the stars, said Yes and named a friend has typed nothing,
// and every reader downstream has to agree about that.
const referOnly = Object.fromEntries(
  NON_REVIEW_IDS.map((id) => [id, "Yes"])
) as unknown as ReviewAnswers;
check(assemblePlain(referOnly) === "", "the stars, a Yes and an invite copy nothing");
check(assembleLabelled(referOnly).length === 0, "and produce no bullet on screen");
check(isEmpty(referOnly), "and read as nothing typed, so no review row is stored at all");

// The recommend question routes FORWARD or not at all, the same shape a gate is held to.
for (const [i, step] of REVIEW_SCRIPT.entries()) {
  if (step.kind !== "refer") continue;
  const at = REVIEW_SCRIPT.findIndex((s) => s.id === step.onYes);
  check(
    at === i + 1,
    `${step.id} routes Yes to the very next step`,
    at === i + 1 ? undefined : `onYes "${step.onYes}" is at ${at}, the question is at ${i}`
  );
  check(
    step.onNo === null,
    `${step.id} routes No forward and nowhere else`,
    "a No with a destination of its own is the pre-screen this question is only allowed to exist without"
  );
}

// ‼️ AND A No MUST STILL REACH THE REVIEW. The step a No lands on has to be part of the review
// walk, not the end of it: if the recommend question were last, or if its No skipped past the
// remaining questions, then saying "no" would cost her the review she came to write and saying
// "yes" would be the price of being heard. That is the pre-screen inverted, and it is the one
// arrangement of these steps that the positional rules above would otherwise permit.
for (const [i, step] of REVIEW_SCRIPT.entries()) {
  if (step.kind !== "refer") continue;
  const after = REVIEW_SCRIPT.slice(i + 2);
  const asksLeft = after.filter((s) => s.kind === "ask").length;
  check(
    asksLeft > 0,
    `a No to ${step.id} still reaches the review questions`,
    asksLeft > 0
      ? `${asksLeft} question(s) follow it either way`
      : "a No would end the walk, which makes the review the reward for saying yes"
  );
}

// The handler, cut out by name like answerGate(). It advances and records a referral; it must not
// reveal, must not store a review, must not touch her answers and must not read the stars.
const referFnStart = v2Src.indexOf("function answerRefer(");
check(referFnStart > 0, "the v2 client answers the recommend question in one named function");
const referFn =
  referFnStart < 0 ? "" : v2Src.slice(referFnStart, v2Src.indexOf(FN_END, referFnStart));
const REFER_FORBIDDEN = ["rev-private", "privateNote", "setRevealed", "destinations", "rating", "store(", "setAnswers"];
const referFound = REFER_FORBIDDEN.filter((t) => referFn.includes(t));
check(
  referFound.length === 0,
  "and it reveals nothing, stores no review and answers nothing",
  referFound.length ? `found: ${referFound.join(", ")}` : undefined
);

// ‼️ THE FRIEND'S CONTACT NEVER TRAVELS IN THE REVIEW REQUEST. Two routes and two tables is the
// whole reason review_tool_submissions can still say it holds nothing that identifies anybody.
// The submit route's body is what writes that table, so the names must not appear in it.
const CONTACT_FIELDS = ["friendName", "friendContact", "friend_name", "friend_contact"];
const inSubmit = CONTACT_FIELDS.filter((f) => submitSrc.includes(f));
check(
  inSubmit.length === 0,
  "the review submit route has no notion of a friend's name or contact",
  inSubmit.length ? `found in ${SUBMIT}: ${inSubmit.join(", ")}` : undefined
);

// ‼️ AND THE OFFER IS NEVER DESCRIBED AS BEING FOR A REVIEW. This is the FTC line, not a copy
// preference: consideration for a referral is an ordinary refer-a-friend deal, consideration for
// a review is an incentivised review with an undisclosed material connection. The invite copy and
// the message templates are the two places a well-meaning edit would cross it.
//
// ‼️ THE EMAILS JOINED THIS FENCE ON 2026-10-05, AND THEY ARE THE RISKIEST MEMBER OF IT. Three of
// them reach a member of the public, one of them tells a patient which reward she has earned, and
// a single sentence of the shape "thanks for your review, here is your discount" would convert a
// refer-a-friend programme into a paid endorsement in writing, in an email we sent, with a copy
// in the recipient's inbox. The module's answer is to avoid the subject entirely: the check below
// is the proximity rule, and EMAILS_SAY_NOTHING_OF_IT just under it is the stronger one.
const inviteSrc = stripComments(read(INVITE));
const emailSrc = stripComments(read(EMAILS));
for (const [label, src] of [
  ["the walk", scriptSrc],
  ["the invite copy", inviteSrc],
  ["the referral email copy", emailSrc],
] as const) {
  // Same-line proximity only. Written with an explicit character class rather than a newline
  // escape, for the reason FN_END is built the way it is.
  const near = "[^\\r\\n]{0,80}";
  const tied =
    new RegExp(`review${near}(discount|offer|%|code)`, "i").test(src) ||
    new RegExp(`(discount|offer|code)${near}review`, "i").test(src);
  check(
    !tied,
    `${label} never ties the offer to leaving a review`,
    tied ? "an offer in exchange for a review is the one thing this lane may not say" : undefined
  );
}

// ‼️ AND THE EMAILS DO NOT RAISE THE SUBJECT AT ALL, which is stronger than the proximity rule
// above and much easier to keep true. Eighty characters is a judgement about how close is too
// close; "the word is not in the file" needs no judgement. The three outward-facing messages are
// about a referral and a reward earned when somebody comes in, and none of that needs the word.
{
  const saysIt = /\breview/i.test(emailSrc);
  check(
    !saysIt,
    "the referral email copy never mentions what she writes, anywhere",
    saysIt
      ? "her reward is earned when the friend comes in; mentioning the other thing is what the " +
        "FTC endorsement rules reach"
      : undefined
  );
}

// ── 10c. THE LEAD LINE: TWO WORDS OF OURS, AND A FENCE AROUND THEM. ──────
//
// ‼️ THIS IS THE ONLY SRT-AUTHORED TEXT INSIDE WHAT SHE COPIES, SO IT IS THE ONE PLACE THE
// Rytr FACT PATTERN COULD ACTUALLY REACH. assemblePlain's docstring used to promise her copied
// review was "one hundred percent her own words, with no SRT-authored text in it at all"; v5
// spends that promise on "Got" and "with". What makes two function words defensible where a
// generated sentence would not be is that they add NO MEANING: they state two facts she typed,
// in the order she typed them, and she reads and can edit the result before copying it.
//
// The fence is a word list. The day somebody writes "Had an amazing {service} with the wonderful
// {provider}", this fails, and that is the whole reason it exists.
{
  const TEMPLATES = [LEAD_WITH_PROVIDER, LEAD_SERVICE_ONLY];

  // Judgement words. An adjective or an adverb in here is us describing her visit for her.
  const BANNED = [
    "amazing", "wonderful", "great", "best", "love", "loved", "lovely", "incredible",
    "fantastic", "perfect", "excellent", "highly", "recommend", "happy", "thrilled",
    "beautiful", "natural", "painless", "professional", "friendly", "caring", "kind",
    "definitely", "absolutely", "really", "very", "so ", "such ",
  ];
  for (const template of TEMPLATES) {
    const hit = BANNED.filter((w) => template.toLowerCase().includes(w));
    check(
      hit.length === 0,
      `the lead template "${template}" carries no judgement of its own`,
      hit.length ? `found: ${hit.join(", ")}` : "connective words around facts she typed"
    );
    // Short enough that it cannot be hiding a sentence. Both are under forty characters of
    // scaffolding once the tokens are removed.
    const scaffold = template.replace(/\{[a-z]+\}/g, "").trim();
    check(
      scaffold.length <= 20,
      `and "${template}" is scaffolding rather than prose`,
      `${scaffold.length} characters of ours: "${scaffold}"`
    );
  }

  // It states facts she typed, in her words, and adds nothing when she typed nothing.
  check(assembleLead({}) === null, "no service means no lead line at all");
  check(
    assembleLead({ provider: "Sarah" }) === null,
    "and her provider alone does not manufacture one"
  );
  check(
    assembleLead({ service: "lip filler" }) === "Got lip filler today.",
    "a service alone names the service and stops",
    assembleLead({ service: "lip filler" }) ?? "null"
  );
  check(
    assembleLead({ service: "lip filler", provider: "Sarah" }) ===
      "Got lip filler with Sarah today.",
    "and both together read as one sentence",
    assembleLead({ service: "lip filler", provider: "Sarah" }) ?? "null"
  );
  // Her own punctuation is not doubled up by the template's full stop.
  check(
    assembleLead({ service: "Botox." }) === "Got Botox today.",
    "a trailing full stop of hers is not doubled",
    assembleLead({ service: "Botox." }) ?? "null"
  );

  // ‼️ CONSUMED, NOT DUPLICATED. Without this a v5 review would open with the lead line and
  // then repeat the service and the provider as the next two bullets.
  const v5 = { service: "lip filler", provider: "Sarah", liked: "it looks natural" } as ReviewAnswers;
  const plain = assemblePlain(v5, { lead: true });
  check(
    plain === "Got lip filler with Sarah today. It looks natural.",
    "the lead line replaces those two bullets rather than adding to them",
    JSON.stringify(plain)
  );
  // ‼️ ONE PARAGRAPH, NOT A COLUMN. v5 joins with a space; a stack of one-line sentences reads
  // as a filled-in form next to reviews people actually typed.
  check(!plain.includes(LF), "and a v5 review is one paragraph");
  check(
    LEAD_KEYS.every((k) => ALL_REVIEW_QUESTIONS.some((q) => q.key === k)),
    "and every key it consumes is a real question"
  );

  // ‼️ OPT IN, SO STORED ROWS AND v1 ARE UNTOUCHED. This is the check that protects reviews
  // already written: the default call must assemble exactly as it did before v5 existed.
  check(
    assemblePlain(v5) === [`Lip filler.`, `It looks natural.`, `Sarah.`].join(LF),
    "without the flag it assembles the old way, byte for byte",
    JSON.stringify(assemblePlain(v5))
  );
  check(
    assemblePlain(v5).includes(LF),
    "and still one line per answer, which is what stored v3 and v4 rows were written as"
  );
}

// ── 11. The agent says its lines. It does not compose them. ────────────────
//
// A `${` inside a scripted line is one edit away from interpolating HER ANSWER into what the
// agent says back, and an agent quoting her words to her is the shape of a tool that then offers
// to improve them. The business name is a placeholder token replaced at render instead.
const interpolated = REVIEW_SCRIPT.filter(
  (s) => (s.kind === "say" ? s.text : s.prompt).includes("${")
).map((s) => s.id);
check(interpolated.length === 0, "no scripted line interpolates anything", interpolated.join(", ") || undefined);

// ── 11b. The Virtual Agent has no audio path at all. ───────────────────────
//
// ‼️ THE MICROPHONE WAS REMOVED ON 2026-09-24 AND MUST NOT COME BACK BY HALVES. v1 spends forty
// lines of its header defending one rule: a customer's VOICE must never reach our servers, because
// review_tool_submissions has deliberately no column for a name, an email, an IP or a device, and
// a voice is more identifying than any field it refuses. v1 satisfies that with on-device
// SpeechRecognition and no MediaRecorder. v2 now satisfies it by having no audio at all.
//
// The cheapest way for this to regress is somebody restoring the permission priming without the
// button, or the button without the on-device constraint. Both are caught here.
const AUDIO = ["getUserMedia", "mediaDevices", "SpeechRecognition", "MediaRecorder", "AudioContext"];
const audioFound = AUDIO.filter((t) => v2Src.includes(t));
check(
  audioFound.length === 0,
  "the Virtual Agent asks for no microphone and holds no audio path",
  audioFound.length
    ? `found: ${audioFound.join(", ")}. Read the header of referral-engine-client.tsx before adding one back.`
    : "nothing to prime, nothing to stop, nothing to delete afterwards"
);
check(
  !/^\s*import[^\n]*voice-notes/m.test(v2Src),
  "and never imports the whisper transcriber"
);

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
