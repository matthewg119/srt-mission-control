// THE REVIEW JOINER'S FENCE, EXECUTABLE. v7 built it; v8 widened what it inserts and narrowed
// where those words may come from.
//
//   bun --no-env-file run scripts/_probe-review-v7.ts
//
// v7 added connective tissue between the four v6 answers: ", and " between her motivation and her
// nerves, and the question's own verb carried onto a walkout fragment. v8 added a carry for EVERY
// one of the four questions, dropped the floor from two words to one, and gave each carry
// alternate wordings for the Regenerate button. Everything this file asserts follows from one
// sentence: THE ONLY WORDS THE JOINER MAY PUT IN HER REVIEW ARE THE WORDS IN ITS OWN EXPORTED
// LITERALS. An adjective, an adverb, a treatment, a staff name, a price, a duration, a result or a
// location that she did not type is the "material details unrelated to user input" the Rytr
// complaint turned on, and disseminating a review carrying them is what FTC 16 CFR Part 465
// reaches.
//
// ‼️ THE INVARIANTS ARE A SET AND NO ONE OF THEM IS SUFFICIENT ALONE. Read them together:
//
//   NOTHING INVENTED. Every word of the output is a word of hers, or a word in
//     JOIN_MOTIVATION_NERVES / CARRIES / the lead templates. Vocabulary is built from the MODULE,
//     so adding a literal to review-assemble.ts is the only way to widen what we can say.
//   NOTHING DROPPED OR MOVED. Her own assembly's word sequence must appear in the joined output
//     AS A SUBSEQUENCE: same words, same order, insertions allowed. A joiner that quietly dropped
//     "and the wait was long" would satisfy the first invariant perfectly.
//   NOTHING FROM OUTSIDE THE QUESTION. v8's own fence, section 1b. Every content word of every
//     carry variant must appear in THAT KEY'S OWN QUESTION PROMPT. The vocabulary check above is
//     derived FROM the literals, so it cannot see a widened literal; this one can, and it is the
//     reason four carries with three wordings each is a tighter feature than one fixed verb was.
//
// The second one is doing more work than it looks. The v7 brief sketched a target output that
// moved her "honestly" out of the walkout answer and into the nerves clause. Every word in that
// string is hers, so the vocabulary check passes it; the subsequence check fails it, because
// "honestly" arrives before "worried" instead of after "again". Relocating a hedge across two
// answers changes which statement it modifies, which is a sentiment shift made out of her own
// words, and it is the failure mode a word-list check cannot see.
//
// ‼️ AND IT IS NOT FOUR HAND-CHECKED STRINGS. Section 3 runs the joiner over every subset of the
// four keys, in three answer shapes, with and without the lead line: 96 combinations, with
// nonsense tokens for her answers, so any English word the joiner inserts stands out against
// "zorble quibix" and no future literal can be added without this failing. The four named
// fixtures are the readable half; that sweep is the enforcement.
//
// SOURCE probe for the screen half, same technique and same reason as _probe-review-gating.ts:
// React Testing Library is not in this repo, and which radio is checked on first render is a fact
// about one line of source.

import fs from "node:fs";
import path from "node:path";
import {
  CARRIES,
  CARRY_VARIANTS,
  JOIN_MOTIVATION_NERVES,
  LEAD_SERVICE_ONLY,
  LEAD_WITH_PROVIDER,
  REVIEW_QUESTIONS_V6,
  assembleJoined,
  assemblePlain,
  type ReviewAnswers,
} from "../src/lib/hub/review-assemble";

/** Every wording the module can insert, flattened once. The fence's subject. */
const ALL_CARRIES: readonly string[] = Object.values(CARRIES).flat();

const CLIENT = "src/app/hub/[host]/reviews/virtual-agent-client.tsx";
const ASSEMBLE = "src/lib/hub/review-assemble.ts";

let failures = 0;

/**
 * Source, with CRLF normalised to LF.
 *
 * Same guard and the same scar as _probe-review-gating.ts's read(): `core.autocrlf=true`
 * materialises these files with CRLF on Windows, every marker search below misses, and the probe
 * reports a breach that does not exist. Green in CI and red on the author's machine is worse than
 * a plain bug, because it teaches people the probe is unreliable.
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

/**
 * A string reduced to comparable words: lowercase, apostrophes kept, everything else dropped.
 *
 * Apostrophes stay because "didn't" and "didnt" are different words of hers and neither should be
 * able to pass as the other. Case is dropped because midSentence() lowercases a fragment's first
 * letter on purpose, which is grammar and not a new word.
 */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .map((word) => word.replace(/^'+|'+$/g, ""))
    .filter((word) => word.length > 0);
}

/** Her words, plus the only strings the module can insert. Nothing else may appear in an output. */
function vocabularyOf(answers: ReviewAnswers): Set<string> {
  const vocabulary = new Set<string>();
  for (const value of Object.values(answers)) {
    for (const word of words(value ?? "")) vocabulary.add(word);
  }
  // The templates' own words, with the {tokens} removed: "got", "with", "today", "and", and every
  // word in every carry wording. Read from the module so the fence cannot drift from the code.
  //
  // ‼️ EVERY VARIANT, NOT THE ONE IN USE. Regenerate can reach any of them, so the vocabulary has
  // to admit all of them. That makes this check WEAKER per variant than v7's was, which is
  // exactly why section 1b exists: the pool this builds is derived from the literals, so a
  // widened literal widens the pool and passes. 1b reads the QUESTIONS instead.
  const ours = [LEAD_WITH_PROVIDER, LEAD_SERVICE_ONLY, JOIN_MOTIVATION_NERVES, ...ALL_CARRIES]
    .join(" ")
    .replace(/\{[a-z]+\}/g, " ");
  for (const word of words(ours)) vocabulary.add(word);
  return vocabulary;
}

/** Whether `inner` appears in `outer` in order, gaps allowed. */
function isSubsequence(inner: string[], outer: string[]): boolean {
  let at = 0;
  for (const word of outer) {
    if (at < inner.length && inner[at] === word) at += 1;
  }
  return at === inner.length;
}

/** The first word of `inner` that the subsequence walk could not place, for the failure message. */
function firstUnplaced(inner: string[], outer: string[]): string | null {
  let at = 0;
  for (const word of outer) {
    if (at < inner.length && inner[at] === word) at += 1;
  }
  return at < inner.length ? inner[at] : null;
}

/** Sentences, for the position checks. Splits on terminal punctuation followed by a space. */
function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

/**
 * The two invariants, run over any answers object at any wording. Everything else in this file is
 * a special case.
 *
 * `variant` defaults to 0 so every v7-era call site still reads the same and still means the same
 * thing: the wording she sees before she touches Regenerate.
 */
function assertInvariants(label: string, answers: ReviewAnswers, variant = 0): string {
  const hers = assemblePlain(answers, { lead: true });
  const joined = assembleJoined(answers, variant);

  const vocabulary = vocabularyOf(answers);
  const invented = words(joined).filter((word) => !vocabulary.has(word));
  check(
    invented.length === 0,
    `${label}: nothing invented`,
    invented.length
      ? `words in the output that are in neither her text nor our literals: ${invented.join(", ")}`
      : "every word is hers or is in JOIN_MOTIVATION_NERVES / CARRIES / the lead template"
  );

  const hersWords = words(hers);
  const placed = isSubsequence(hersWords, words(joined));
  check(
    placed,
    `${label}: nothing dropped and nothing moved`,
    placed
      ? `all ${hersWords.length} of her words, in her order`
      : `could not place "${firstUnplaced(hersWords, words(joined))}" in order; joined: ${joined}`
  );

  return joined;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 1. THE FENCE AROUND OUR OWN LITERALS.
//
// These are the only strings the joiner can insert. The day somebody writes ", and the staff were
// amazing, " or "I walked out absolutely delighted ", this section is what fails. It is the same
// check, and deliberately the same word list, that _probe-review-gating.ts holds the lead template
// behind: a second place we can author text is a second copy of that rule, and the duplication is
// the point rather than an oversight.
// ════════════════════════════════════════════════════════════════════════════════════════════════

const BANNED = [
  "amazing", "wonderful", "great", "best", "love", "loved", "lovely", "incredible",
  "fantastic", "perfect", "excellent", "highly", "recommend", "happy", "thrilled",
  "beautiful", "natural", "painless", "professional", "friendly", "caring", "kind",
  "definitely", "absolutely", "really", "very", "such ", "stunning", "flawless",
];

/**
 * ‼️ 48, AND IT WAS 24 IN v7. THE CAP ROSE AND THE FENCE IS WHY.
 *
 * v7 capped its two literals at 24 characters as a crude proxy for "this is scaffolding, not
 * prose", at a time when nothing checked WHICH words were in them. Three of v8's carry wordings
 * are longer than that ("What I would tell a friend on the fence is" is 41), so the cap had to
 * move or the feature could not exist.
 *
 * Raising a cap to make a check pass is normally the wrong half of the fix, so here is the
 * argument for why this one is not: section 1b, which did not exist in v7, requires every content
 * word of every wording to appear in that key's own question prompt. A 41-character string built
 * only from the question's own words can assert strictly less than a 24-character string built
 * from any word in English. The real limit got tighter while this number got looser. The cap stays
 * only as a blunt backstop against somebody pasting a paragraph in.
 */
const CARRY_MAX_CHARS = 48;

for (const literal of [JOIN_MOTIVATION_NERVES, ...ALL_CARRIES]) {
  const hit = BANNED.filter((word) => literal.toLowerCase().includes(word));
  check(
    hit.length === 0,
    `our literal "${literal}" carries no judgement of its own`,
    hit.length ? `found: ${hit.join(", ")}` : "connective words around what she typed"
  );
  check(
    literal.trim().length <= CARRY_MAX_CHARS,
    `and "${literal}" is scaffolding rather than prose`,
    `${literal.trim().length} of ${CARRY_MAX_CHARS} characters of ours`
  );
}

// ‼️ PRESENCE, SO SECTION 3 CANNOT PASS VACUOUSLY. A fence around empty strings holds perfectly
// and permits everything, which is the trap _probe-review-gating.ts's check 1b was added for. The
// joiner has to actually be able to insert something.
check(
  JOIN_MOTIVATION_NERVES.trim().length > 0 && ALL_CARRIES.every((c) => c.trim().length > 0),
  "every literal is non-empty, so the vocabulary check is subtracting something real",
  `"${JOIN_MOTIVATION_NERVES}" and ${ALL_CARRIES.length} carry wordings`
);

// ‼️ AND THERE IS A WORDING FOR EVERY ONE OF THE FOUR QUESTIONS, WHICH IS WHAT v8 IS.
// A table that lost a key would silently fall back to v6 for that answer, which is the failure
// mode his complaint WAS: a dry answer sitting there untouched.
for (const question of REVIEW_QUESTIONS_V6) {
  const wordings = (CARRIES as Record<string, readonly string[] | undefined>)[question.key];
  check(
    Array.isArray(wordings) && wordings.length > 0,
    `the "${question.key}" question has at least one carry wording`,
    wordings ? `${wordings.length} wording(s)` : "MISSING: this answer would never be expanded"
  );
}

check(
  CARRY_VARIANTS === Math.max(...Object.values(CARRIES).map((w) => w.length)),
  "CARRY_VARIANTS is derived from the table rather than typed",
  `${CARRY_VARIANTS} wordings is the longest row, so Regenerate cannot overrun it`
);

// ‼️ ONE CONJUNCTION, AND IT IS THE ONE THAT ASSERTS NOTHING. The brief allowed and, but, so,
// because and which is why. The last four assert contrast or causation between two answers, which
// is a claim about her experience that SHE did not make and that picking between them requires
// understanding her meaning to pick. "and" asserts addition, which the question order already
// establishes. If this ever fails, the fix is a new named rule with its own fixtures, not a
// widened literal.
for (const asserting of ["but", "so", "because", "which"]) {
  check(
    !words(JOIN_MOTIVATION_NERVES).includes(asserting),
    `the joiner does not assert "${asserting}"`,
    "only addition, which is the relationship the question order already implies"
  );
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 1b. ‼️ THE v8 FENCE: EVERY CONTENT WORD OF A CARRY COMES FROM THAT CARRY'S OWN QUESTION.
//
// This is the check that makes four carries with three wordings each a TIGHTER feature than v7's
// one fixed verb, and it is the reason the character cap above was allowed to rise.
//
// Section 1's word list can only forbid the adjectives somebody thought to list. This forbids
// every word the question does not already contain. "I absolutely loved that" cannot be added to
// the walkout carry unless "How did you feel walking out?" starts containing "absolutely loved",
// which it never will. Neither can "I walked out feeling better", or "relaxed", or "pain free":
// none of them is in the question, so none of them can be in the carry.
//
// ‼️ AND IT IS WHY THIS IS NOT A REWRITER. The words we contribute are the words of a prompt that
// is fixed, identical for every clinic, and written before any patient answered anything. A
// question cannot flatter a visit it was written months before.
//
// ‼️ THE VOCABULARY CHECK IN assertInvariants CANNOT DO THIS JOB, which is why both exist. That
// one builds its pool FROM the literals, so widening a literal widens the pool and the check
// still passes. This one reads REVIEW_QUESTIONS_V6 instead, so the literals are measured against
// something they cannot move.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Words that assert nothing on their own: pronouns, forms of "to be", articles and the
 * prepositions a carry needs to be grammatical.
 *
 * ‼️ CLOSED, AND DELIBERATELY MISSING THE FOUR CONJUNCTIONS review-assemble.ts REFUSED. "so",
 * "but", "which" and "though" are not here, so no carry can be built around them even though
 * they are short function words. "because" IS here and is the one that needed an argument; see
 * the assertion below it, which confines it to the one question that asks for a cause.
 */
const FUNCTION_WORDS = new Set([
  "i", "me", "my", "you", "your", "it",
  "is", "am", "are", "was", "were", "be", "been",
  "a", "an", "the",
  "of", "to", "for", "in", "on", "at",
  "and", "if", "that", "this", "what",
  "because",
]);

/** Common inflections, so "started" counts as the question's "start". */
function stem(word: string): string {
  // The one irregular any wording needs: "felt" is the past of the walkout question's "feel".
  // A map rather than a rule, because English past tenses are not a rule.
  const IRREGULAR: Record<string, string> = { felt: "feel" };
  if (IRREGULAR[word]) return IRREGULAR[word];
  return word.replace(/(ing|ed|es|s|d)$/, "");
}

{
  const prompts = new Map(REVIEW_QUESTIONS_V6.map((q) => [q.key as string, q.prompt]));

  for (const [key, wordings] of Object.entries(CARRIES)) {
    const prompt = prompts.get(key);
    check(
      typeof prompt === "string" && prompt.length > 0,
      `the "${key}" carry has a question to be measured against`,
      prompt ?? "NO PROMPT: this key is not in REVIEW_QUESTIONS_V6"
    );
    if (!prompt) continue;

    const allowed = new Set(words(prompt).map(stem));

    for (const wording of wordings) {
      const foreign = words(wording).filter(
        (word) => !FUNCTION_WORDS.has(word) && !allowed.has(stem(word))
      );
      check(
        foreign.length === 0,
        `"${wording}" uses only the words of "${prompt}"`,
        foreign.length
          ? `NOT IN THE QUESTION: ${foreign.join(", ")} -- a carry may not introduce a word the ` +
            "question does not contain"
          : "every content word is the question's own"
      );
    }
  }

  // ‼️ "because" IS CONFINED TO THE ONE QUESTION THAT ASKS FOR A CAUSE. "What MADE you start
  // looking for a place like this?" asks why, so "I started looking because of X" restates the
  // question's own causal frame and asserts no causation she did not. The same word on the
  // walkout or the friend answer WOULD assert one, which is the thing
  // review-assemble.ts's CONJUNCTIONS docstring refuses. Hence a per-key rule rather than a
  // blanket permission.
  for (const [key, wordings] of Object.entries(CARRIES)) {
    const causal = wordings.filter((w) => words(w).includes("because"));
    check(
      key === "motivation" || causal.length === 0,
      `the "${key}" carry asserts no causation`,
      causal.length
        ? `found "because" in: ${causal.join(" | ")}`
        : "nothing here claims one answer caused another"
    );
  }

  // And the fence is not vacuous: a wording nobody could have written must actually fail it.
  const sabotage = words("I absolutely loved the amazing staff").filter(
    (word) => !FUNCTION_WORDS.has(word) && !new Set(words("How did you feel walking out?").map(stem)).has(stem(word))
  );
  check(
    sabotage.length > 0,
    "the fence rejects a wording built from words outside the question",
    `negative control: it would have flagged ${sabotage.join(", ")}`
  );
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 2. THE FOUR FIXTURES, IN ORDER OF HOW LIKELY EACH IS TO BREAK IT.
//
// The expected output of each is pinned in full. A rule change that improves one of these will
// show up as a diff on a string somebody has to read, which is the only way a reviewer can see
// what the joiner now does to a real answer.
// ════════════════════════════════════════════════════════════════════════════════════════════════

console.log("");

// ── FIXTURE 1: all four answered in full sentences. The easy case. ──────────
const F1: ReviewAnswers = {
  service: "lip filler",
  provider: "Sarah",
  motivation: "I kept putting off doing anything about my smile lines",
  nerves: "I was worried it would look overdone",
  walkout: "Like myself again, honestly",
  friend: "Just go, they talk you through everything",
};

const f1 = assertInvariants("fixture 1 (full sentences)", F1);
check(
  f1 ===
    "Got lip filler with Sarah today. I kept putting off doing anything about my smile lines, " +
      "and I was worried it would look overdone. I walked out feeling like myself again, " +
      "honestly. Just go. They talk you through everything.",
  "fixture 1: joins the motivation to the nerves, carries the walkout verb, splits the advice",
  f1
);
// ‼️ AND IT ACTUALLY DID SOMETHING. Without this the whole suite passes on a joiner that returns
// assemblePlain unchanged, which is the vacuous pass this file would otherwise be blind to.
check(
  f1 !== assemblePlain(F1, { lead: true }),
  "fixture 1: the joined version differs from hers, so the feature is not a no-op",
  `hers: ${assemblePlain(F1, { lead: true })}`
);
check(
  f1.includes(JOIN_MOTIVATION_NERVES) && f1.includes(CARRIES.walkout[0]),
  "fixture 1: and the difference is our literals, not something else"
);
// ‼️ AND v8 DID NOT MOVE IT. Four full-sentence answers clear the merge floor and overrun the
// carry ceiling, so the only rules eligible here are the three v7 already had. A fixture that
// changed when the floors changed would mean a floor was doing something other than what it says.
check(
  f1 === assembleJoined(F1, 0),
  "fixture 1: unchanged by v8, because none of the new carries is eligible on a full sentence",
  "the floor drop reaches one-word answers; it cannot reach these"
);

// ── FIXTURE 2: one-word answers. ‼️ THIS FIXTURE INVERTED IN v8 AND THAT IS THE WHOLE RELEASE. ──
//
// v7 asserted the OPPOSITE of what is below, in these words: "fixture 2: one-word answers come out
// BYTE FOR BYTE what v6 produced", on the grounds that "'I started looking because of wrinkles and
// walked out feeling good' would be a sentence we invented around two words she typed."
//
// Matthew walked that build, typed four honest answers with "Great" as the walkout, and got back a
// paragraph with `Great.` sitting dead in the middle of it. That is the form of the complaint this
// release answers. What makes the expansion legitimate is not a change of mind about inventing
// sentences; it is section 1b, which did not exist in v7: every word we add is a word of the
// question she was reading when she typed that one word.
//
// If this assertion is ever reverted, revert section 1b with it. The expansion without the fence
// is the thing v7 was right to refuse.
console.log("");
const F2: ReviewAnswers = {
  service: "botox",
  provider: "Sarah",
  motivation: "wrinkles",
  nerves: "bruising",
  walkout: "good",
  friend: "go",
};

const f2 = assertInvariants("fixture 2 (one-word answers)", F2);
check(
  f2 ===
    "Got botox with Sarah today. I started looking because of wrinkles. I was nervous about " +
      "bruising. I walked out feeling good. If you are on the fence, go.",
  "fixture 2: every one-word answer is carried into a sentence by its own question",
  f2
);
check(
  f2 !== assemblePlain(F2, { lead: true }),
  "fixture 2: and it is NOT what v6 produced, which is the point of v8",
  `v6 gave: ${assemblePlain(F2, { lead: true })}`
);
check(
  !f2.includes(JOIN_MOTIVATION_NERVES),
  "fixture 2: the MERGE still declines, because one word each is under its floor",
  "the carries fired; the merge did not. Two separate sentences, not one run-on."
);

// ‼️ AND THE REGENERATE BUTTON CHANGES OUR WORDS AND ONLY OUR WORDS.
// Every variant must hold both invariants, and her own words must come out byte for byte identical
// across all of them: the only thing a press of that button may move is scaffolding.
{
  const hersWords = words(assemblePlain(F2, { lead: true }));
  const seen = new Set<string>();
  for (let variant = 0; variant < CARRY_VARIANTS; variant += 1) {
    const out = assertInvariants(`fixture 2 at variant ${variant}`, F2, variant);
    seen.add(out);
    const mine = words(out).filter((word) => hersWords.includes(word));
    check(
      mine.join(" ") === hersWords.filter((w) => mine.includes(w)).join(" "),
      `variant ${variant}: her words are in her order and none of them changed`,
      out
    );
  }
  check(
    seen.size === CARRY_VARIANTS,
    `Regenerate produces ${CARRY_VARIANTS} genuinely different reviews`,
    `${seen.size} distinct outputs from ${CARRY_VARIANTS} variants. A button that redraws the ` +
      "same text is a button that lies about what it does."
  );
}

// ── FIXTURE 3: gaps. Only motivation and friend; nerves skipped. ─────────────
// The merge is keyed to the motivation/nerves PAIR, never to "the first two answers present", so
// there is nothing to bridge a hole with.
console.log("");
const F3: ReviewAnswers = {
  service: "lip filler",
  provider: "Sarah",
  motivation: "I was tired of hiding my hands in photos",
  friend: "Honestly, just book it",
};

const f3 = assertInvariants("fixture 3 (nerves skipped)", F3);
check(
  f3 ===
    "Got lip filler with Sarah today. I was tired of hiding my hands in photos. " +
      "If you are on the fence, honestly, just book it.",
  "fixture 3: a skipped question leaves a full stop, not a conjunction",
  f3
);
// ‼️ THE FRIEND LINE MOVED IN v8 AND THE GAP ASSERTION DID NOT. v7 gave "Honestly, just book it."
// here; the friend carry now reaches it, because her four words clear the new floor and her comma
// is a trailing aside rather than a second clause, so the split declines and the carry takes it.
// What this fixture is FOR is the hole where nerves should be, and that is the check below: a
// carry onto one answer is not a bridge between two.
check(
  !f3.includes(JOIN_MOTIVATION_NERVES),
  "fixture 3: nothing joins across the gap",
  "a conjunction spanning a question she declined asserts a relationship to nothing"
);
check(
  sentencesOf(f3).length === sentencesOf(assemblePlain(F3, { lead: true })).length,
  "fixture 3: and no middle was invented to fill it",
  `${sentencesOf(f3).length} sentences, same as hers`
);

// ── FIXTURE 4: a complaint. This fixture proves the whole thing. ─────────────
console.log("");
const COMPLAINT = "a bit sore and the wait was long";
const F4: ReviewAnswers = {
  service: "a cleaning",
  provider: "Dana",
  motivation: "I had been meaning to get my teeth looked at for years",
  nerves: "I was nervous about the needle",
  walkout: COMPLAINT,
  friend: "worth it but book the first slot of the day",
};

const f4 = assertInvariants("fixture 4 (a complaint)", F4);

// Undiluted: the sentence is hers, capitalised and stopped, and nothing was carried onto it.
check(
  f4.includes("A bit sore and the wait was long."),
  "fixture 4: the complaint survives as its own sentence, word for word",
  f4
);
check(
  !CARRIES.walkout.some((wording) => f4.includes(wording)),
  "fixture 4: no verb was carried onto it, in any of the walkout wordings",
  'routing "the wait was long" through "I walked out feeling" recasts a fact as a mood, which is a ' +
    "sentiment shift made entirely out of her own words"
);
// ‼️ AT EVERY VARIANT, AND THIS IS THE ASSERTION THE WHOLE RELEASE IS GUARDED BY. Regenerate must
// not be a way to roll the dice until a complaint reads better. The conjunction refusal in
// canCarry() is what holds it: "a bit sore AND the wait was long" contains "and", so no wording of
// any carry can ever reach it, which makes the complaint byte-identical at every index.
for (let variant = 0; variant < CARRY_VARIANTS; variant += 1) {
  const at = assembleJoined(F4, variant);
  check(
    at === f4,
    `fixture 4: identical at variant ${variant}`,
    at === f4
      ? "pressing Regenerate cannot soften it"
      : `THE COMPLAINT MOVED. variant ${variant} gave: ${at}`
  );
}
// In the same position: third sentence of four, exactly where v6 put it.
const hers4 = sentencesOf(assemblePlain(F4, { lead: true }));
const joined4 = sentencesOf(f4);
check(
  joined4.indexOf("A bit sore and the wait was long.") === 2 &&
    hers4.indexOf("A bit sore and the wait was long.") === 3,
  "fixture 4: and it sits in the same place in the narrative, after the nerves and before the advice",
  `hers: sentence ${hers4.indexOf("A bit sore and the wait was long.") + 1} of ${hers4.length}; ` +
    `joined: sentence ${joined4.indexOf("A bit sore and the wait was long.") + 1} of ${joined4.length}`
);
// Lukewarm stays lukewarm. Her "but" is hers; ours is never added.
check(
  f4.includes("Worth it but book the first slot of the day."),
  "fixture 4: the lukewarm recommendation is not upgraded either",
  "no split, because she put no clause after her comma, and nothing was appended"
);

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 3. THE SWEEP. 96 answer combinations with nonsense tokens for her answers.
//
// ‼️ THIS IS THE CHECK THAT OUTLIVES THE FOUR FIXTURES ABOVE. They are hand-written strings and a
// future rule will be written to satisfy them. This runs every subset of the four keys, with and
// without the lead, over answer shapes chosen to make every rule fire at once, and the words are
// nonsense: any English word the joiner inserts is immediately visible against "zorble quibix",
// and a third literal added to the module cannot reach an output without failing here.
// ════════════════════════════════════════════════════════════════════════════════════════════════

console.log("");

const SHAPES: Record<string, Record<string, string>> = {
  // Long enough to clear every floor, so merge, carry and split are all eligible.
  firing: {
    motivation: "zorble quibix franten dreckle",
    nerves: "plonkish wazzit grimble snoodery",
    walkout: "flembic tarnuk",
    friend: "vorp glimble, they snorkle bazzim",
  },
  // Under every floor, so every rule declines.
  bare: {
    motivation: "zorble",
    nerves: "plonkish",
    walkout: "flembic",
    friend: "vorp",
  },
  // Her own conjunctions and her own full stops inside the answers.
  awkward: {
    motivation: "zorble quibix. franten dreckle",
    nerves: "and plonkish wazzit grimble snoodery",
    walkout: "flembic and tarnuk whonk gribbet",
    friend: "vorp glimble, honestly",
  },
};

let swept = 0;
let sweepFailures = 0;

for (const [shapeName, shape] of Object.entries(SHAPES)) {
  for (let mask = 0; mask < 16; mask += 1) {
    for (const withLead of [true, false]) {
      // ‼️ EVERY WORDING, NOT JUST THE FIRST. v8 multiplied this sweep by CARRY_VARIANTS, because
      // a variant nobody swept is a variant nobody checked, and Regenerate puts all of them in
      // front of a patient. 96 cases became 96 times the wording count.
      for (let variant = 0; variant < CARRY_VARIANTS; variant += 1) {
        const answers: ReviewAnswers = {};
        if (withLead) {
          answers.service = "grumbish";
          answers.provider = "Zendrel";
        }
        const keys = ["motivation", "nerves", "walkout", "friend"] as const;
        keys.forEach((key, bit) => {
          if (mask & (1 << bit)) answers[key] = shape[key];
        });

        const joined = assembleJoined(answers, variant);
        const vocabulary = vocabularyOf(answers);
        const invented = words(joined).filter((word) => !vocabulary.has(word));
        const hersWords = words(assemblePlain(answers, { lead: true }));

        swept += 1;
        if (invented.length > 0 || !isSubsequence(hersWords, words(joined))) {
          sweepFailures += 1;
          // ‼️ THE REASON, NOT JUST THE COUNT. A probe that reports "7 cases failed" and stops
          // sends somebody back to re-derive which seven and why, which is how a real breach gets
          // filed as flaky. First ten offenders, in full.
          if (sweepFailures <= 10) {
            console.log(`      case ${shapeName}/mask ${mask}/lead ${withLead}/variant ${variant}`);
            if (invented.length > 0) console.log(`        invented: ${invented.join(", ")}`);
            const missing = firstUnplaced(hersWords, words(joined));
            if (missing) console.log(`        could not place in order: "${missing}"`);
            console.log(`        output: ${joined}`);
          }
        }
      }
    }
  }
}

check(
  sweepFailures === 0,
  `the sweep: ${swept} answer combinations invent nothing and drop nothing`,
  sweepFailures === 0
    ? `every rule fired against nonsense tokens at all ${CARRY_VARIANTS} wordings and inserted ` +
      "only our own literals"
    : `${sweepFailures} of ${swept} combinations breached, listed above`
);

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 4. NO RATING REACHES THE JOINER OR THE PANEL THAT OFFERS IT.
//
// Offering the better-reading version to five stars and withholding it from two is review shaping:
// the text she is nudged toward would depend on how happy she is. That is the funnel
// _probe-review-gating.ts exists to keep rebuilt-proof, and v7 adds a new place to rebuild it.
// ════════════════════════════════════════════════════════════════════════════════════════════════

console.log("");

const assembleSrc = stripComments(read(ASSEMBLE));
const clientSrc = stripComments(read(CLIENT));

// ‼️ v8 ADDED A SECOND PARAMETER AND THIS CHECK GOT STRICTER, NOT LOOSER.
//
// v7 pinned `assembleJoined.length === 1` and said "takes answers and nothing else", precisely so
// that a second parameter could not quietly become the rating. v8 needs a wording index, so the
// count alone can no longer carry that meaning. Three checks replace it:
//
//   1. the REQUIRED arity is still 1, which Function.length reports because a defaulted parameter
//      is not counted. Every v7-era caller and every stored-row reader is therefore untouched.
//   2. the optional parameter is NAMED in the source, and the name is `variant`. A `rating`
//      second parameter fails this by name, which a count never could.
//   3. no `rating` token anywhere in the function's body, below. That is the half that was always
//      load-bearing, and it is asserted on the body rather than the signature.
//
// ‼️ IF A THIRD PARAMETER IS EVER NEEDED, STOP. That is a decision for a plan, not a diff.
check(
  assembleJoined.length === 1,
  "assembleJoined still REQUIRES only her answers",
  `required arity ${assembleJoined.length}; the wording index is optional and defaults to 0`
);
check(
  /export function assembleJoined\(\s*answers: ReviewAnswers,\s*variant = 0\s*\)/.test(assembleSrc),
  "and its optional parameter is a wording index called `variant`, not a rating",
  "pinned by name in the source: a second parameter called anything else fails here"
);
check(
  assembleJoined({ walkout: "good" }) === assembleJoined({ walkout: "good" }, 0),
  "and omitting it gives the wording she sees on arrival",
  "a caller that does not know Regenerate exists gets variant 0"
);

const LF = String.fromCharCode(10);
const joinedStart = assembleSrc.indexOf("export function assembleJoined");
const joinedEnd = assembleSrc.indexOf(`${LF}}${LF}`, joinedStart);
const joinedBody = joinedStart >= 0 && joinedEnd > joinedStart
  ? assembleSrc.slice(joinedStart, joinedEnd)
  : "";
check(
  joinedBody.length > 200,
  "assembleJoined's body was found in the source, so the next check is reading something",
  `${joinedBody.length} characters`
);
check(
  !joinedBody.includes("rating"),
  "and there is no rating anywhere inside it",
  "every value 1 through 5 reaches the same joined text"
);

// The panel pair, sliced from its own container to the rail that follows it.
const panelStart = clientSrc.indexOf('className="rev2-versions"');
const panelEnd = clientSrc.indexOf('className="rev2-rail"', panelStart);
const panelBlock = panelStart >= 0 && panelEnd > panelStart
  ? clientSrc.slice(panelStart, panelEnd)
  : "";
check(
  panelBlock.length > 400,
  "the side-by-side panel block was found, so the next checks are reading something",
  `${panelBlock.length} characters`
);
check(
  !panelBlock.includes("rating"),
  "the joined version is offered without consulting the rating",
  "not gated, not collapsed, not withheld from a low rating"
);
check(
  !/\bdisabled\b|(?<!aria-)\bhidden\b/.test(panelBlock),
  "and neither panel is disabled or hidden",
  'both are editable at every rating. `aria-hidden` is excluded on purpose: the mirror div ' +
    "carries it because it is decorative and must not be read out twice, which is the opposite " +
    "of hiding a panel"
);

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 5. HER VERSION IS THE DEFAULT, AND IT IS FIRST.
//
// Which version is selected when the screen opens is the whole difference between offering her a
// tidier draft and replacing her review with ours. One line of source decides it.
// ════════════════════════════════════════════════════════════════════════════════════════════════

console.log("");

check(
  clientSrc.includes('useState<"hers" | "joined">("hers")'),
  "the selected version on first render is HERS",
  'useState<"hers" | "joined">("hers")'
);
check(
  clientSrc.includes('const text = version === "joined" ? joinedText : hersText;'),
  "and the selected version is the one that gets copied, by construction",
  "one variable feeds the rail, the mirror, the clipboard and the attestation"
);

const hersAt = clientSrc.indexOf('key: "hers"');
const joinedAt = clientSrc.indexOf('key: "joined"');
check(
  hersAt >= 0 && joinedAt > hersAt,
  "her words are the first panel on the screen and in the reading order on a phone",
  "reversing VERSIONS would put our draft in the reading position"
);

// Nothing persists the choice, so it is her words again on the next visit and for the next patient
// at the same counter phone.
check(
  !/localStorage|sessionStorage/.test(clientSrc),
  "the choice is not remembered, so the default cannot be worn away",
  "no localStorage or sessionStorage in this client"
);

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 6. THE SHIPPED PROMISE MATCHES THE SHIPPED FEATURE.
//
// ‼️ THIS IS A SEPARATE PROBLEM FROM THE REVIEW RULE AND IS NOT CURED BY ANY OF IT. The rail said
// "We never write a replacement. Your call, and your words either way." A joined version offered
// beside hers IS a replacement on offer, so shipping the joiner while keeping that sentence would
// be a false claim about our own product. Stripped of comments, because the old wording is quoted
// in the comment that explains why it went.
// ════════════════════════════════════════════════════════════════════════════════════════════════

console.log("");

/**
 * The client's shipped text with every run of whitespace collapsed to one space.
 *
 * ‼️ WITHOUT THIS, EVERY COPY CHECK BELOW IS A COIN FLIP ON HOW PRETTIER WRAPPED THE SENTENCE. JSX
 * breaks a line of prose wherever the print width lands, so "We never add words you did not say."
 * lives in the source as "We never\n                add words you did not say." A raw `includes`
 * reported the new promise missing while it was rendering on the screen, and would just as happily
 * report the OLD promise gone after a reflow put a newline inside it, which is the direction that
 * matters: this section exists to catch the old wording coming back.
 */
const clientFlat = clientSrc.replace(/\s+/g, " ");

check(
  !clientFlat.includes("We never write a replacement"),
  "the old promise is gone from the shipped copy",
  '"We never write a replacement. Your call, and your words either way." is false once a joined ' +
    "version is on offer"
);
check(
  !clientFlat.includes("your words either way"),
  "and so is the half of it that said her words either way"
);
check(
  clientFlat.includes("We tidy the grammar and join your answers up") &&
    clientFlat.includes("We never add words you did not say"),
  "and what replaced it is the smaller claim this file can actually hold",
  "both halves describe exactly what sections 1 to 3 assert"
);

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 7. AN OLDER STORED ROW IS NOT SILENTLY EMPTIED.
//
// assembleJoined knows four keys. A v3, v4 or v5 row holds none of them, and a v6-only
// implementation would have returned the empty string for one. Nothing calls it that way today,
// which is exactly why it is worth pinning before something does.
// ════════════════════════════════════════════════════════════════════════════════════════════════

console.log("");

const STORED_V3: ReviewAnswers = {
  worried: "I thought it would hurt",
  hoping: "I wanted to look less tired",
  surprised: "how quick it was",
  happened: "they explained every step",
};

const storedJoined = assembleJoined(STORED_V3);
assertInvariants("a stored v3 row", STORED_V3);
check(
  storedJoined.length > 0,
  "a v3 row handed to the joiner comes out as its own sentences, not as nothing",
  storedJoined
);
check(
  !storedJoined.includes(JOIN_MOTIVATION_NERVES) &&
    !ALL_CARRIES.some((wording) => storedJoined.includes(wording)),
  "and with no join and no carry applied to any of them",
  "the v6 rules are keyed to v6 questions, so an older set is passed through untouched. ‼️ v8 " +
    "added three more carries and this is the check that proves none of them leaked onto a stored " +
    "row somebody already approved."
);

console.log("");
if (failures > 0) {
  console.log(`${failures} check${failures === 1 ? "" : "s"} failed. See the reason beside each.`);
  process.exit(1);
}
console.log(
  "All checks passed. Every word in the joined version is hers or is in a literal whose every " +
    "content word comes from the question she answered, " +
    "her order survives it, the complaint survives it, and her version is still the default."
);
