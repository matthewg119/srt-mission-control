// Does the angle layer refuse what it claims to refuse?
//
//   bunx tsx scripts/_probe-page-angles.ts
//
// Pure. No database, no model call, no env needed. Everything here is a validator, and the reason
// the validators matter is Matthew's complaint on 2026-09-17: the thirty-three headline candidates
// were not individually bad, they all argued the same thing, so picking between them decided
// nothing. MAX_OVERLAP is the check that makes three options worth offering, and this probe is
// what stops somebody relaxing it later because the model kept failing.

import {
  angleFaults,
  overlap,
  contentWords,
  parseAngleCommand,
  isAngleCommand,
  toAngles,
  ANGLES_PER_PAGE,
  MAX_OVERLAP,
  IDEA_MAX,
  type AngleInputs,
} from "@/lib/clients/page-angles";

let failed = 0;
function check(what: string, ok: boolean, detail = ""): void {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${detail && !ok ? `  (${detail})` : ""}`);
  if (!ok) failed++;
}

const INPUTS: AngleInputs = {
  clientName: "A Clinic",
  keyword: "answer engine optimization for med spas",
  workingTitle: "Answer engine optimization for med spas",
  role: "pillar",
  keywordCategory: "Price and ROI",
  rung: null,
  anchorStage: 4,
  treatment: "AI visibility for med spas",
  terms: ["ai visibility", "chatgpt visibility"],
  outcome: "more booked consults",
  guarantee: null,
  buyer: "a med spa owner",
  beliefs: ["search has moved into chat"],
  objections: ["it sounds like SEO with a new name"],
  taken: [],
};

function angle(over: Partial<Record<string, unknown>> = {}) {
  return {
    idea: "Owners assume ranking on Google still decides who gets found, and the page argues that a chat answer now decides it instead.",
    promise: "She can tell whether her clinic is being named in chat answers today.",
    narrative: "A clinic that ranks first and still loses the booking, and the reason it does.",
    indoctrination: "Being on page one is not the same as being the answer.",
    awareness_entry: 4,
    awareness_target: 3,
    proof_needed: ["a chat answer naming a competitor"],
    rationale: "It reaches somebody who thinks she is already covered.",
    ...over,
  };
}

/** Three genuinely different arguments, for the happy path. */
const THREE = {
  angles: [
    angle(),
    angle({
      idea: "Price is the first thing a buyer asks a chatbot, and this page argues the clinic that publishes its range wins that conversation.",
      promise: "She can decide whether to publish pricing.",
      narrative: "Two clinics, one silent about cost, and which one the assistant recommends.",
      indoctrination: "Hiding the price does not delay the question, it hands the answer to somebody else.",
    }),
    angle({
      idea: "Referrals feel safe until the referrer starts asking an assistant first, and the page argues word of mouth now runs through a model.",
      promise: "She can see where her referral traffic actually begins.",
      narrative: "The friend who recommended her, checking with a chatbot before passing the name on.",
      indoctrination: "Word of mouth has an intermediary now, and it has never heard of her.",
      awareness_entry: 5,
      awareness_target: 4,
    }),
  ],
};

console.log("\n1. a good set passes");
check("three different arguments pass", angleFaults(THREE, INPUTS).length === 0, angleFaults(THREE, INPUTS).join(" "));
check("toAngles reads them back", toAngles(THREE).length === ANGLES_PER_PAGE);
check("the awareness pair survives", toAngles(THREE)[2].awarenessEntry === 5 && toAngles(THREE)[2].awarenessTarget === 4);

console.log("\n2. the overlap rule, which is the whole reason for three options");
const SAME = "Owners think Google ranking decides who gets found, but the chat answer decides it.";
const REWORD = "Owners believe Google ranking decides who gets found, when really the chat answer decides it.";
const DIFFERENT = "Publishing a price range is what wins the conversation a buyer has with an assistant.";
check("a reworded idea scores high", overlap(SAME, REWORD) > MAX_OVERLAP, String(overlap(SAME, REWORD).toFixed(2)));
check("a different idea scores low", overlap(SAME, DIFFERENT) <= MAX_OVERLAP, String(overlap(SAME, DIFFERENT).toFixed(2)));
check("overlap with itself is 1", overlap(SAME, SAME) === 1);
check("overlap with nothing is 0", overlap(SAME, "") === 0);
check("stopwords do not count as content", !contentWords("the and of your").size);

const rewordedSet = { angles: [angle(), angle({ idea: REWORD }), THREE.angles[2]] };
const rewordFaults = angleFaults({ angles: [angle({ idea: SAME }), angle({ idea: REWORD }), THREE.angles[2]] }, INPUTS);
check(
  "two rewordings of one idea are refused",
  rewordFaults.some((f) => /same idea reworded/.test(f)),
  rewordFaults.join(" ")
);
check("the refusal names both option numbers", rewordFaults.some((f) => /angles 1 and 2/.test(f)));
void rewordedSet;

console.log("\n3. nothing may be invented");
const invented = angleFaults({ angles: [angle({ idea: "It lifts bookings by 47 percent for every clinic." }), THREE.angles[1], THREE.angles[2]] }, INPUTS);
check("a number that appears nowhere is refused", invented.some((f) => /appears nowhere/.test(f)), invented.join(" "));

const guaranteed = angleFaults({ angles: [angle({ promise: "Results guaranteed or your money back." }), THREE.angles[1], THREE.angles[2]] }, INPUTS);
check(
  "a guarantee with none on file is refused",
  guaranteed.some((f) => /has none on file/.test(f)),
  guaranteed.join(" ")
);
const withGuarantee = angleFaults(
  { angles: [angle({ promise: "Results guaranteed or your money back." }), THREE.angles[1], THREE.angles[2]] },
  { ...INPUTS, guarantee: "money back in 90 days" }
);
check("the same line passes when the client has one", !withGuarantee.some((f) => /has none on file/.test(f)));

const dashed = angleFaults({ angles: [angle({ idea: "Ranking is not the answer — the assistant is." }), THREE.angles[1], THREE.angles[2]] }, INPUTS);
check("an em dash is refused", dashed.some((f) => /em dash/.test(f)));

console.log("\n4. the awareness pair");
const backwards = angleFaults({ angles: [angle({ awareness_entry: 2, awareness_target: 4 }), THREE.angles[1], THREE.angles[2]] }, INPUTS);
check(
  "a page that makes the reader less aware is refused",
  backwards.some((f) => /further from the sale/.test(f)),
  backwards.join(" ")
);
const offScale = angleFaults({ angles: [angle({ awareness_entry: 9 }), THREE.angles[1], THREE.angles[2]] }, INPUTS);
check("a stage outside 1 to 5 is refused", offScale.some((f) => /must be 1 to 5/.test(f)));
const same = angleFaults({ angles: [angle({ awareness_entry: 3, awareness_target: 3 }), THREE.angles[1], THREE.angles[2]] }, INPUTS);
check("entry equal to target is allowed", !same.some((f) => /further from the sale/.test(f)));

console.log("\n5. shape and length");
check("two angles are refused", angleFaults({ angles: [angle(), THREE.angles[1]] }, INPUTS).some((f) => /exactly 3/.test(f)));
check("no angles at all are refused", angleFaults({ angles: [] }, INPUTS).some((f) => /exactly 3/.test(f)));
check("a non-object is refused", angleFaults(null, INPUTS).length > 0);
const long = angleFaults({ angles: [angle({ idea: "x".repeat(IDEA_MAX + 1) }), THREE.angles[1], THREE.angles[2]] }, INPUTS);
check(`an idea over ${IDEA_MAX} characters is refused`, long.some((f) => /over 240 characters/.test(f)));
const missing = angleFaults({ angles: [angle({ indoctrination: "" }), THREE.angles[1], THREE.angles[2]] }, INPUTS);
check("a missing indoctrination is refused", missing.some((f) => /indoctrination is required/.test(f)));

console.log("\n6. a page may not repeat one already planned");
// The exact idea, which is the case that matters most: a rerun must not re-propose a page the
// client already has planned.
const takenExact = angleFaults(THREE, { ...INPUTS, taken: [THREE.angles[0].idea] });
check(
  "an idea already planned is refused",
  takenExact.some((f) => /repeats a page already planned/.test(f)),
  takenExact.join(" ")
);
check("the refusal names which option clashed", takenExact.some((f) => /^angle 1 repeats/.test(f)));

// A paraphrase of it, because a rerun re-asks the model and gets different words for the same page.
const takenParaphrase = angleFaults(THREE, {
  ...INPUTS,
  taken: ["Owners assume ranking on Google decides who gets found, when the chat answer decides it instead."],
});
check(
  "a paraphrase of a planned page is refused too",
  takenParaphrase.some((f) => /repeats a page already planned/.test(f)),
  takenParaphrase.join(" ")
);

// ‼️ AND AN UNRELATED PLANNED PAGE MUST NOT TRIP IT. A `taken` check that refuses everything is
// indistinguishable from one that works, until seven pages cannot be planned at all.
const takenUnrelated = angleFaults(THREE, {
  ...INPUTS,
  taken: ["Aftercare instructions for a first filler appointment, and what bruising is normal."],
});
check("an unrelated planned page does not trip it", takenUnrelated.length === 0, takenUnrelated.join(" "));
check("with nothing taken it passes", angleFaults(THREE, INPUTS).length === 0);

console.log("\n7. the commands");
check("`angles` lists", parseAngleCommand("angles")?.kind === "list");
check("`angle` singular also lists", parseAngleCommand("angle")?.kind === "list");
check("`angles auto` is auto, not a list", parseAngleCommand("angles auto")?.kind === "auto");
check("`angle auto` is auto too", parseAngleCommand("angle auto")?.kind === "auto");
const pick = parseAngleCommand("angle 3 pick 2");
check("`angle 3 pick 2` picks", pick?.kind === "pick" && pick.page === 3 && pick.option === 2);
const more = parseAngleCommand("angle 3 more");
check("`angle 3 more` regenerates one page", more?.kind === "more" && more.page === 3);
check("Slack's backticks and bold do not break it", parseAngleCommand("`angle 3 pick 2`")?.kind === "pick");
check("leading and trailing space is fine", parseAngleCommand("  angles auto  ")?.kind === "auto");
check("something else is not a command", parseAngleCommand("angles are hard") === null);
check("a bare number is not a command", parseAngleCommand("3") === null);
check("isAngleCommand agrees", isAngleCommand("angles auto") && !isAngleCommand("hello"));

console.log(failed === 0 ? "\nAll checks passed.\n" : `\n${failed} FAILED\n`);
if (failed) process.exit(1);
