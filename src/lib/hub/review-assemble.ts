// The AI Referral Engine's four questions, and the only transformation applied to an answer.
//
// SRT-Referral-Engine-BUILD-SPEC-v2.md. THERE IS NO MODEL IN THIS PATH. Not for drafting, not
// for cleanup, not for tone, not for spelling. That is the single most important line in
// the spec and the reason this file is pure string work with no imports.
//
// FTC 16 CFR Part 465 and the Rytr fact pattern: a tool that GENERATES review content its
// user did not write is the thing being regulated. A tool that REFORMATS what she typed is
// not. Every rule below follows from staying well behind that line.
//
// ‼️ v7 (2026-10-13) ADDED A JOINER AND THAT LINE ABOVE STILL HOLDS, BUT IT IS NO LONGER THE
// WHOLE STORY AND MUST NOT BE READ AS ONE. There is still no model, no network and no rewriter in
// this path. There are now two strings of ours that can land BETWEEN her answers, ", and " and
// "I walked out feeling ", on top of the lead line's "Got ... with ... today.". They are
// enumerable, they are exported, and scripts/_probe-review-v7.ts fails on any word in the output
// that is not in one of them or in her own text. See the v7 banner at the foot of this file for
// why a joiner is not the generator the rule reaches, and for the rules-against-a-model argument
// re-run rather than inherited.
//
// Pure and isomorphic on purpose, the same doctrine as src/lib/clients/normalize.ts: the
// client component previews the assembly as she types and the server stores from this same
// function, so what she reads and what is kept cannot drift.

// ‼️ v3 (2026-09-04) REPLACED QUESTION 3 AND THE REASON IS NOT A COPY PREFERENCE.
//
// It used to be "Had you had a bad experience somewhere before this one?", which invites a
// customer to describe A NAMED COMPETITOR'S care in a review posted on a public profile. That is
// the single review in this set most likely to draw a defamation complaint, and the clinic, not
// SRT, is the one holding it. "What surprised you?" asks about THIS visit, is still
// sentiment-neutral, and produces the specific detail that makes a review quotable.
//
// Old rows carry `before` and QUESTION_SET_VERSION "v2". They stay readable: assembleLabelled()
// and assemblePlain() iterate REVIEW_QUESTIONS, so a v2 row simply contributes no bullet for a
// key that is no longer asked. Nothing migrates and nothing is rewritten.
export const QUESTION_SET_VERSION = "v3";

export interface ReviewQuestion {
  /**
   * ‼️ `before` IS RETIRED, NOT DELETED. It is still in the union because
   * review_tool_submissions rows written under v2 hold it, and page-candidates.ts and
   * weekly-report.ts read those rows. Removing it from the type would make real stored data
   * unassignable.
   */
  key:
    // v3 and earlier.
    | "worried"
    | "hoping"
    | "before"
    | "surprised"
    | "happened"
    // v4 (2026-09-24). Every one of these is a sentence she typed.
    //
    // ‼️ NONE OF THEM IS A CHIP, AND THAT IS THE WHOLE DEFENCE. The v4 walk asks three
    // yes/no questions before three of these. Those gates live in review-script.ts and have NO KEY
    // AT ALL, so a "Yes" is not assignable to ReviewAnswers, cannot be iterated into a bullet,
    // cannot be stored by the submit route, and cannot reach the copy buffer. A gate is a branch.
    // What she types afterwards is the review.
    | "service"
    | "liked"
    | "improve"
    | "expectations"
    | "concerns"
    | "fears"
    // v5 (2026-10-05). The in-clinic walk. Also a sentence she typed.
    //
    // ‼️ `provider` IS A STAFF NAME IN A PUBLIC REVIEW AND THAT IS A REVERSAL. The comment on
    // REVIEW_QUESTIONS below says "NOT ASKED, EVER: who treated her", because Google forbids a
    // merchant soliciting specific review content and names staff names as an example. Matthew
    // decided on 2026-10-05 that it is asked and that it reaches the review text. Recorded as
    // his decision; the exposure sits on the clinic's Google profile, not on this tool's FTC
    // position, which is about GENERATED content and is untouched by it.
    //
    // ‼️ IT IS NOT PATIENT PII. The name is a member of the clinic's staff, so
    // review_tool_submissions still holds nothing that identifies HER, which is what that
    // table's no-column rule has always been about.
    | "provider"
    // v6 (2026-10-10). FOUR, AND THE ORDER IS THE ALGORITHM. See REVIEW_QUESTIONS_V6.
    | "motivation"
    | "nerves"
    | "walkout"
    | "friend";
  /** What she is asked. */
  prompt: string;
  /** The label shown beside her sentence ON SCREEN only. Never copied. */
  label: string;
}

/**
 * Fixed, sentiment-neutral, identical for every business.
 *
 * NOT ASKED, EVER: who treated her, whether she would recommend, anything that would SORT HER
 * DOWN ONE PATH OR ANOTHER. There is no staff name field in this route and there must never be
 * one — Google 2026 forbids a merchant requesting specific content, staff names included.
 *
 * ‼️ A STAR RATING IS NOW ASKED, AND THE RULE IT LOOKS LIKE IT BREAKS IS INTACT. Added
 * 2026-09-04. The prohibition in this comment was never about a number, it was about ROUTING:
 * a rating that decides whether she is shown the public review link is gating, which Google's
 * policy and FTC 16 CFR Part 465 both reach. The rating collected here decides nothing. Every
 * value 1 through 5 reaches these same four questions, the same assembly, the same editable
 * box and the same destination links. scripts/_probe-review-gating.ts asserts that byte for
 * byte, and it is the reason this paragraph is a description rather than a promise.
 *
 * The rating lives on the submission row and in the client's own reporting. It must never
 * become an argument to any function in this file.
 *
 * Question 1 is doing double duty. It is the customer-side mirror of the objection-shaped
 * questions in the audit's twenty, which is why the reviews this produces get quoted: they
 * contain the worry a future customer is typing into a chat box.
 */
export const REVIEW_QUESTIONS: ReviewQuestion[] = [
  {
    key: "worried",
    prompt: "What were you worried about before you came in?",
    label: "What I was worried about",
  },
  {
    key: "hoping",
    prompt: "What were you hoping would happen?",
    label: "What I was hoping for",
  },
  {
    key: "surprised",
    prompt: "What surprised you?",
    label: "What surprised me",
  },
  {
    key: "happened",
    prompt: "What actually happened at your appointment?",
    label: "What happened",
  },
];

/**
 * The v4 set (2026-09-24), walked by the Virtual Agent.
 *
 * Three of these six are only ever asked when a yes/no gate in review-script.ts was answered Yes.
 * That is a branch in the conversation and nothing more: a customer who says No to all three
 * reaches the same editable box, the same copy button and the same destination links as one who
 * says Yes to all three. The gates are not in this array and have no key of their own, which is
 * what keeps the word "Yes" out of a public review.
 *
 * "What surprised you?" and "What actually happened at your appointment?" are gone from the walk
 * and still in the union above, because rows written under v3 hold them.
 */
export const REVIEW_QUESTIONS_V4: ReviewQuestion[] = [
  {
    key: "service",
    prompt: "What service did you get done with us?",
    label: "What I came in for",
  },
  {
    key: "liked",
    prompt: "What did you like about our experience the most?",
    label: "What I liked most",
  },
  {
    key: "improve",
    prompt: "What did you not like about our experience?",
    label: "What could be better",
  },
  // The three behind a gate. Their prompts read as follow-ups because that is what they are: she
  // has already said Yes to the question the gate asked, and asking it again in full would read
  // as not having listened.
  {
    key: "expectations",
    prompt: "What were they?",
    label: "What I expected",
  },
  {
    key: "concerns",
    prompt: "Tell us about it.",
    label: "What I was concerned about",
  },
  {
    key: "fears",
    prompt: "Tell us about it.",
    label: "What I was afraid of",
  },
];

/**
 * The v5 addition (2026-10-05), asked at the counter with the front desk beside her.
 *
 * ‼️ IT ASKS FOR A NAME AGAIN, BECAUSE THE LEAD LINE MADE THAT SAFE. For half a day this read
 * "Who took care of you today, and how were they?", purely to stop a one-word answer assembling
 * into the review line `Sarah.` That is a two-part question at a desk where somebody is reading
 * it out loud, and it existed to work around the assembler rather than to ask anything better.
 *
 * assembleLead() consumes this key into "Got {service} with {provider}.", so a bare name is now
 * the RIGHT answer and the question is the one the front desk actually says. An answer that is a
 * sentence still works: "Sarah, she was great" gives "Got lip filler with Sarah, she was great."
 */
export const REVIEW_QUESTIONS_V5: ReviewQuestion[] = [
  {
    key: "provider",
    prompt: "Who took care of you today?",
    label: "Who took care of me",
  },
];

/**
 * v6, 2026-10-10. The four that replaced seven, and the STRUCTURE IS THE QUESTION ORDER.
 *
 * ‼️ WHAT WAS WRONG WITH v4/v5, IN MATTHEW'S WORDS: "this thing is very redundant". It asked what
 * she liked, what she did not like, whether she had expectations, whether she was concerned and
 * whether she was afraid: three near-identical worry gates and a complaint box, which produced
 * answers like "The people. Nothing. Sexo, Sex, Sara." A review assembled out of those is a form
 * somebody filled in, because the QUESTIONS had no shape, so the output could not have one either.
 *
 * ‼️ THESE FOUR ARE A NARRATIVE IN THE ORDER THEY ARE ASKED, AND THAT IS THE WHOLE TRICK.
 * Motivation, worry, outcome, recommendation. Answered honestly and joined in sequence they read
 * as a review a person wrote, with nothing added:
 *
 *   "Got lip filler with Sarah today. I kept putting off doing anything about my smile lines.
 *    I was worried it would look overdone. I felt like myself again. Just go, they talk you
 *    through everything."
 *
 * ‼️ v7 (2026-10-13) PARTLY SUPERSEDED THE TWO PARAGRAPHS BELOW. Read them, then read the v7
 * banner at the foot of this file, which says what changed and what did not. In short: still no
 * model and still no rewriter, but a JOINER now exists, the four sentences below can be offered
 * joined up as an OPTION beside hers, and the shipped copy quoted at the end of this docstring was
 * rewritten in the same commit because the joiner made it false. The reasoning in both paragraphs
 * is why the joiner is two conjunction-shaped literals and not a tidy-up button.
 *
 * ‼️ AND THAT IS WHY THIS FILE STILL CONTAINS NO MODEL, NO REWRITER AND NO POLISH STEP.
 * FTC 16 CFR Part 465 bans disseminating reviews that misrepresent a consumer's experience, and
 * the Rytr complaint turned on a generator producing "material details unrelated to user input".
 * The safe side of that line is adding no substance at all. The temptation to add one is a
 * symptom of badly shaped questions, so the fix went into the questions. assembleBullet still
 * does exactly three things to her sentence: collapse whitespace, capitalise a lowercase first
 * letter, add a full stop if there is none.
 *
 * ‼️ ONE MORE REASON NOT TO ADD A POLISH BUTTON HERE: the clinic-facing page says in as many
 * words that we never write the review and never write a replacement. A tidy-up feature would
 * make that sentence false, which is a deception problem of its own, separate from the review
 * rule, and it would spend the strongest thing the product says about itself.
 *
 * ‼️ v7 TOOK THAT COST RATHER THAN DENYING IT. "We never write a replacement. Your call, and your
 * words either way." is gone from the rail, because a joined version offered beside hers IS a
 * replacement on offer and keeping the sentence would have been the deception this paragraph
 * warns about. What replaced it claims less and is true: "We tidy the grammar and join your
 * answers up. We never add words you did not say." The half of the promise that was worth having
 * survived, and the probe fails if the old sentence returns.
 */
export const REVIEW_QUESTIONS_V6: ReviewQuestion[] = [
  {
    key: "motivation",
    prompt: "What made you start looking for a place like this?",
    label: "Why I started looking",
  },
  {
    // ‼️ THE FOLLOW-UP, NOT THE GATE. "Were you nervous about anything before coming in?" is a
    // yes/no in review-script.ts with no key at all, so a "Yes" is not assignable to
    // ReviewAnswers and cannot reach the clipboard. This is what she types after one.
    key: "nerves",
    prompt: "What were you nervous about?",
    label: "What I was nervous about",
  },
  {
    key: "walkout",
    prompt: "How did you feel walking out?",
    label: "How I felt walking out",
  },
  {
    key: "friend",
    prompt: "What would you tell a friend who is on the fence about coming in?",
    label: "What I would tell a friend",
  },
];

/**
 * Assembly order for ALL sets, and the reason nothing migrates.
 *
 * ‼️ THE ORDER OF THIS SPREAD IS LOAD BEARING AND IS PINNED BY A TEST. assembleLabelled and
 * assemblePlain iterate it, so it decides the order of the sentences she copies. No stored row has
 * ever held one v3 key and one v4 key, so a v3 row comes out byte for byte what it produced before
 * v4 existed. Reordering this would re-assemble stored reviews in an order the customer who wrote
 * them never saw, which is a thing she cannot be asked to check.
 *
 * ‼️ v5 IS APPENDED, NEVER INSERTED, AND THE READ ORDER WAS THE DECIDING ARGUMENT. `provider`
 * would read most naturally second, right after the service, but putting it there would mean
 * splitting the v4 spread in half around it, and the next person to add a question would have a
 * four-part expression to reason about instead of a list. Appended, every stored v3 and v4 row
 * comes out byte for byte unchanged (they hold no `provider` value, so they contribute no extra
 * bullet), and a v5 review ends by naming the person who did the work, which is a good last line
 * rather than a compromise.
 */
export const ALL_REVIEW_QUESTIONS: ReviewQuestion[] = [
  ...REVIEW_QUESTIONS,
  ...REVIEW_QUESTIONS_V4,
  ...REVIEW_QUESTIONS_V5,
  // ‼️ APPENDED, LIKE v5, AND HERE IT IS NOT A COMPROMISE BUT THE POINT. A v6 walk collects only
  // v6 keys plus the lead's two, so this spread's tail IS the narrative order: motivation, worry,
  // outcome, recommendation. Every stored v3, v4 and v5 row still comes out byte for byte what
  // its author approved, because none of them holds a v6 key.
  ...REVIEW_QUESTIONS_V6,
];


/** The stamp a v4 row carries. v3 rows keep QUESTION_SET_VERSION above and nothing rewrites them. */
export const QUESTION_SET_VERSION_V4 = "v4";

/** The stamp a v5 row carries. Nothing rewrites a v3 or a v4 row. */
export const QUESTION_SET_VERSION_V5 = "v5";

/** The stamp a v6 row carries. Nothing rewrites anything older. */
export const QUESTION_SET_VERSION_V6 = "v6";

/**
 * Which set was walked, read off the request body.
 *
 * Anything unrecognised is v3, which is what a client that sends nothing is. The value lands in a
 * not-null text column, so it is narrowed here rather than trusted.
 */
export function readQuestionSetVersion(raw: unknown): string {
  if (raw === QUESTION_SET_VERSION_V6) return QUESTION_SET_VERSION_V6;
  if (raw === QUESTION_SET_VERSION_V5) return QUESTION_SET_VERSION_V5;
  return raw === QUESTION_SET_VERSION_V4 ? QUESTION_SET_VERSION_V4 : QUESTION_SET_VERSION;
}

export type ReviewAnswers = Partial<Record<ReviewQuestion["key"], string>>;

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE LEAD LINE (v5, 2026-10-05), AND THE RULE IT BENDS
//
// ‼️ THIS IS SRT-AUTHORED TEXT INSIDE WHAT SHE COPIES, AND NOTHING ELSE IN THIS FILE IS.
// assemblePlain's own docstring says the labels are kept out so that "what gets posted to Google
// is one hundred percent her own words, with no SRT-authored text in it at all". Two words of
// ours now travel with it: "Got" and "with". Matthew's call, 2026-10-05, and the reasoning is
// his: the reviews worth having name the treatment, which is the whole pitch in the cold email
// ("Got Botox here, looks so natural"), and a patient at a counter answers "who took care of
// you?" with one word.
//
// ‼️ IT ALSO FIXES A REAL DEFECT RATHER THAN ONLY ADDING A FEATURE. Without it, `provider` had to
// be its own bullet, so "Sarah" assembled into the review line `Sarah.` To avoid that the
// question had to ask "and how were they?", which is a two-part question at a desk where the
// front desk is reading it out loud. The template lets the question be the one the front desk
// actually asks.
//
// ‼️ WHAT THE TEMPLATE MAY CONTAIN IS FENCED, AND THE FENCE IS THE DEFENCE. Connective words
// around facts she typed, and nothing else. No adjective, no adverb, no sentiment, no claim about
// a result, no business name, no superlative. "Got {service} with {provider}." states two things
// she stated. "Had an amazing {service} with the wonderful {provider}" would be us writing her
// review, which is the Rytr fact pattern and is what FTC 16 CFR Part 465 reaches.
// scripts/_probe-review-gating.ts holds that fence against a word list.
//
// ‼️ AND SHE SEES IT BEFORE IT GOES ANYWHERE. The lead line lands in the same editable box as the
// rest, above the same attestation and the same copy button, so the last hand on the text is
// hers. That is the mitigation that makes two function words defensible where a generated
// sentence would not be.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Both halves of the lead line. A full stop belongs to the template, not to her fragment.
 *
 * ‼️ "today" IS A FACT AND NOT A FLOURISH, which is the only reason it is allowed in here. She
 * is answering this at the counter on the day of the visit, so it is true by construction. It
 * earns its place because it is what makes the line read as somebody talking rather than as a
 * form: "Got lip filler with Sarah today" is a sentence, "Got lip filler with Sarah" is a label.
 * Nothing else may be added on that argument: every other candidate is an adjective.
 */
export const LEAD_WITH_PROVIDER = "Got {service} with {provider} today.";
export const LEAD_SERVICE_ONLY = "Got {service} today.";

/**
 * The keys the lead line consumes, so they are not also emitted as their own bullets.
 *
 * ‼️ CONSUMED, NOT DUPLICATED. Without this, a v5 review would open "Got lip filler with Sarah."
 * and then repeat "Lip filler." and "Sarah." as the next two lines.
 */
export const LEAD_KEYS: ReadonlyArray<ReviewQuestion["key"]> = ["service", "provider"];

/**
 * Her words, prepared to sit INSIDE a sentence rather than to be one.
 *
 * Differs from assembleBullet in exactly two ways, both because of where it lands: it does NOT
 * capitalise (the word is mid-sentence) and it strips a trailing full stop rather than adding one
 * (the template owns the punctuation). Everything else is the same single transformation: trim
 * and collapse whitespace. No spelling correction, no grammar, no reordering, no words added.
 *
 * ‼️ IT CANNOT RESCUE A SENTENCE-SHAPED ANSWER, AND IT MUST NOT TRY. A patient who answers "I got
 * lip filler" produces "Got I got lip filler with Sarah." That is a wart, it is visible in the
 * editable box, and she can fix it in one tap. The alternative is this function detecting and
 * rewriting her phrasing, which is the line the whole file refuses to cross for a cosmetic win.
 */
export function assembleFragment(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const collapsed = raw.replace(/\s+/g, " ").trim().replace(/[.]+$/, "").trim();
  // The one typo fix in the file, added in v8. See fixStandaloneI: it capitalises her lone
  // pronoun and touches nothing else.
  return collapsed ? fixStandaloneI(collapsed) : null;
}

/**
 * The opening line of a v5 review, or null when there is no service to name.
 *
 * No service means no lead line at all and her answers assemble exactly as they did before, which
 * is also why v1 and every stored v3 row are untouched by this: they have no `service` key.
 */
export function assembleLead(answers: ReviewAnswers): string | null {
  const service = assembleFragment(answers.service);
  if (!service) return null;
  const provider = assembleFragment(answers.provider);
  return provider
    ? LEAD_WITH_PROVIDER.replace("{service}", service).replace("{provider}", provider)
    : LEAD_SERVICE_ONLY.replace("{service}", service);
}

/**
 * The entire transformation, and nothing else.
 *
 * Trim. Collapse internal runs of whitespace. Capitalise the first character if it is
 * lowercase. Append a period if there is no terminal punctuation.
 *
 * NOT done, and each omission is deliberate: no spelling correction, no grammar fixing, no
 * reordering, no joining of clauses, no transitions, no adjectives, no business name
 * inserted, no service name inserted. Her words, tidied, or nothing.
 *
 * ‼️ EVERY WORD OF THAT IS STILL TRUE OF THIS FUNCTION, AND v7 DID NOT TOUCH IT. The joining
 * added in v7 lives entirely in assembleJoined, which COMPOSES this function rather than changing
 * it: it hands this one a string it has already built and relies on exactly the three
 * transformations above. Anything that joins, carries or splits belongs down there, where the
 * probe can see it. This function staying the one place her sentence is only tidied is what makes
 * "her version" and "the joined version" two different things on the screen rather than one.
 *
 * Returns null for an empty answer. An unanswered question simply produces fewer bullets;
 * none of the four is required.
 */
export function assembleBullet(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const squashed = raw.replace(/\s+/g, " ").trim();
  if (!squashed) return null;
  // ‼️ THE ONE ADDITION v8 MADE TO THIS FUNCTION, AND IT IS A TYPO FIX, NOT A TRANSFORMATION.
  // Everything the docstring above refuses is still refused. It applies here as well as in
  // assembleFragment so that HER version and the joined version agree about her pronoun: fixing
  // it in one and not the other would put a difference on the screen that she did not make.
  const collapsed = fixStandaloneI(squashed);

  const first = collapsed[0];
  // Only when it is LOWERCASE. Leaving an already-capitalised or non-alphabetic opener
  // alone means the function never changes a character she chose deliberately.
  const capitalised =
    first === first.toLowerCase() && first !== first.toUpperCase()
      ? first.toUpperCase() + collapsed.slice(1)
      : collapsed;

  return /[.!?…]$/.test(capitalised) ? capitalised : `${capitalised}.`;
}

export interface LabelledBullet {
  key: ReviewQuestion["key"];
  label: string;
  text: string;
}

/**
 * FOR THE SCREEN ONLY. Labelled bullets, so she can see the structure of what she wrote.
 *
 * Kept as a separate function from assemblePlain() and not derived from it, so that a later
 * refactor cannot quietly merge the two. That separation is the whole legal answer if the
 * tool is ever challenged.
 */
export function assembleLabelled(answers: ReviewAnswers): LabelledBullet[] {
  const out: LabelledBullet[] = [];
  for (const question of ALL_REVIEW_QUESTIONS) {
    const text = assembleBullet(answers[question.key]);
    if (text) out.push({ key: question.key, label: question.label, text });
  }
  return out;
}

/**
 * FOR THE COPY BUFFER. Her sentences, joined by line breaks. NO LABELS.
 *
 * The labels are ours; the sentences are hers. Keeping ours out of the copied artifact
 * means what gets posted to Google is one hundred percent her own words, with no
 * SRT-authored text in it at all.
 */
export function assemblePlain(answers: ReviewAnswers, opts?: { lead?: boolean }): string {
  const lines: string[] = [];

  // ‼️ OPT IN, AND THE DEFAULT IS THE OLD BEHAVIOUR BYTE FOR BYTE. Only the v5 walk passes
  // `lead`. v1 calls this with no options, so the four-question chat is untouched, and so is any
  // future reader that assembles a stored row: a v3 or v4 row read back comes out exactly what
  // its author saw and approved. The flag lives at the call site rather than being inferred from
  // the presence of a key, so "which flow was this" is a decision somebody wrote down.
  const lead = opts?.lead ? assembleLead(answers) : null;
  if (lead) lines.push(lead);

  for (const question of ALL_REVIEW_QUESTIONS) {
    // The lead line already said these two. Skipped only when it actually rendered.
    if (lead && LEAD_KEYS.includes(question.key)) continue;
    const text = assembleBullet(answers[question.key]);
    if (text) lines.push(text);
  }
  // ‼️ v5 IS ONE PARAGRAPH AND v3/v4 ARE STILL ONE LINE EACH. Matthew, 2026-10-05, wrote out what
  // he wanted it to look like and it was prose: "Got lip filler with sarah today I loved how
  // natural it looks, nobody could tell. I was worried It would look overdone." A column of
  // sentences on separate lines reads as a form somebody filled in, which is exactly how it looks
  // on a Google profile beside reviews people actually typed.
  //
  // Tied to the SAME flag as the lead line rather than to a second option, because they are one
  // decision: v5 produces a paragraph, and everything before it produces the lines its author
  // already saw and approved.
  return lines.join(opts?.lead ? " " : "\n");
}

/** Nothing typed in any of the four. */
export function isEmpty(answers: ReviewAnswers): boolean {
  return ALL_REVIEW_QUESTIONS.every((q) => !assembleBullet(answers[q.key]));
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// v7 (2026-10-13): CONNECTIVE TISSUE, AND THE ARGUMENT DIRECTLY ABOVE THAT IT AMENDS
//
// ‼️ READ THE v6 DOCSTRING FIRST. It says this file contains no model, no rewriter and no polish
// step, and it is right about two of those three. v7 adds a JOINER. The difference is not a
// shading of the same idea, it is the whole reason this is allowed to exist:
//
//   A REWRITER takes her sentence and emits a better one. It decides what she meant.
//   A JOINER takes two sentences she typed and names the relationship THE ORDER ALREADY IMPLIES.
//
// v6 made the questions a narrative and the output still read as four disconnected sentences,
// because nothing carried across the full stops:
//
//   "Got lip filler with Sarah today. I kept putting off doing anything about my smile lines.
//    I was worried it would look overdone. Like myself again, honestly. Just go, they talk you
//    through everything."
//
// and with the joins below it reads as one person talking, with no word added that is not in a
// literal in this file:
//
//   "Got lip filler with Sarah today. I kept putting off doing anything about my smile lines,
//    and I was worried it would look overdone. I walked out feeling like myself again, honestly.
//    Just go. They talk you through everything."
//
// ‼️ "THERE IS NO MODEL IN THIS PATH" AT THE TOP OF THIS FILE SURVIVED v7, AND IT WAS RE-ARGUED
// RATHER THAN INHERITED. Rules against a model was the open question on the v7 brief. A model
// writes better prose over the long tail of answer shapes and the rule table below handles eight.
// It lost on three things, in increasing order of how much they matter:
//
//   1. The header's isomorphic doctrine. The client previews the assembly AS SHE TYPES from this
//      same function, so what she reads and what the server stores cannot drift. A network call
//      cannot run in that path, so a model puts the drift back.
//   2. The guarantee changes kind. "No adjective she did not write" is a property of a rule table
//      and a hope about a model. A probe over four fixtures in CI is not a runtime validator over
//      every live submission, and when a validator trips, the fallback is her raw text anyway.
//   3. "Nothing varies by star rating" is provable while no rating argument exists, and becomes an
//      argument about a prompt the moment one does. scripts/_probe-review-gating.ts asserts that
//      byte for byte today. It would be asserting a weaker thing tomorrow.
//
// What a model would buy is prose quality. What it would cost is the one property this surface is
// built to be ABLE TO PROVE. If a model is ever wanted here, it belongs behind a second explicit
// choice with a runtime validator in front of it, not inside this function.
//
// ‼️ THE CONSERVATIVE DEFAULT IS THE DESIGN, NOT A FALLBACK. Every rule below has to EARN her
// sentence. When any precondition misses, the sentence is emitted by assembleBullet exactly as v6
// emitted it, so the worst case of the whole feature is today's output. All the fuzziness in the
// closed word lists is therefore biased in one direction on purpose: a list that is too long makes
// a rule DECLINE, and declining is free.
//
// ‼️ THE SHIPPED COPY CHANGED IN THE SAME COMMIT, AND THAT IS A CONDITION OF THE FEATURE, NOT
// POLISH. The rail in virtual-agent-client.tsx promised "We never write a replacement. Your call,
// and your words either way." A joined version offered beside hers makes the first half of that
// false, which is a deception problem of its own, separate from the review rule and not cured by
// any of it. It now reads "We tidy the grammar and join your answers up. We never add words you
// did not say." Shipping the joiner without that edit would be a false claim about our own
// product. scripts/_probe-review-v7.ts fails if the old sentence comes back.
//
// ‼️ WHAT MAKES CONNECTIVE WORDS THE SAFE ZONE, WHICH IS THE SAME ARGUMENT THE LEAD LINE WON ON.
// FTC 16 CFR Part 465 bans disseminating a review that misrepresents a consumer's experience, and
// the Rytr complaint turned on a generator producing "material details unrelated to user input".
// ", and" asserts no detail. It names a relationship between two answers she gave in the order she
// gave them. An adjective, a result, a duration, a price or a staff name she did not type is a
// detail, and none of them can reach the output: the only words this section can insert are in
// JOIN_MOTIVATION_NERVES and CARRIES below, and the probe reads them out of this module to build
// its vocabulary.
//
// ‼️ v8 WIDENED WHAT THIS SECTION INSERTS AND NARROWED WHERE IT MAY COME FROM, IN THE SAME
// COMMIT. There are now four carries with alternate wordings instead of one fixed verb, which is
// more of our words in her review than v7 put there. What makes that the safer trade is the fence
// on CARRIES: every one of those words has to appear in the question she was answering. v7 could
// have put any 24-character string in that literal and only a hand-written list of banned
// adjectives stood in the way. v8 cannot put a word there that the question does not contain.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ‼️ EVERY STRING THIS FILE CAN PUT IN HER REVIEW IS EXPORTED SO A PROBE CAN FENCE IT.
 * scripts/_probe-review-v7.ts builds its allowed vocabulary out of this constant plus CARRIES
 * plus the lead templates plus her own answers, and fails on any other word in the output. That
 * makes adding a word to this file the only way to widen what we can say, which is a line in a
 * diff somebody reviews rather than a behaviour somebody discovers.
 *
 * ‼️ "and" IS THE ONLY CONJUNCTION, AND THE BRIEF ALLOWED FIVE. "but" asserts contrast, "so",
 * "because" and "which is why" assert causation: each of them is a claim about the relationship
 * between two answers that SHE did not make, and picking between them needs a reader who
 * understands her meaning, which is the rewriter this is not. "and" asserts addition, which is
 * the one relationship the question order already establishes. Narrowing five to one is the
 * single most load-bearing decision in this section.
 *
 * ‼️ AND IT IS THE ONE LITERAL REGENERATE DOES NOT VARY. v8 offers alternate wordings for every
 * carry below, because a carry is built from its own question's words and a question has more
 * than one grammatical shape. There is no alternate for ", and ": the four other conjunctions
 * are the ones this docstring just refused, so a "synonym" here could only be a word that
 * asserts something she did not. One wording, permanently.
 */
export const JOIN_MOTIVATION_NERVES = ", and ";

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * THE CARRIES: one question's own words, lent back to a dry answer so it becomes a sentence.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ‼️ v8 REVERSES v7's REFUSAL TO TOUCH ONE-WORD ANSWERS, AND THE REVERSAL WAS DELIBERATE. Both
 * positions, because the next reader deserves the argument and not just the outcome:
 *
 *   v7 (the original brief's own words): "A joiner that produces 'I started looking because of
 *   wrinkles and walked out feeling good' has invented a sentence around two words. Decide what
 *   it does here; most likely, leave them alone." v7 left them alone, and said so in capitals.
 *
 *   v8 (Matthew, 2026-10-13, having walked the v7 preview): "where the customer said 'great only'
 *   we can add something for that section if the customer is not specific we can add context from
 *   the same question, how did you feel leaving? 'great' so we transform that in the review to 'I
 *   felt great after leaving'". He typed four honest answers, and `Great.` sat in the middle of
 *   his own paragraph as a dead one-word sentence. That is what the review reading like a form
 *   actually looks like.
 *
 * ‼️ THIS IS STILL NOT A REWRITER, AND THE REASON IS LOAD BEARING. The words that turn "great"
 * into "I walked out feeling great" come from THE QUESTION SHE WAS ANSWERING. "How did you feel
 * walking out?" is fixed, sentiment-neutral, identical for every business, and contains no
 * adjective about her visit. Carrying its own verb back onto her answer asserts nothing she did
 * not assert. It is the transformation the v7 brief named BY EXAMPLE, and v7 already did it for
 * the walkout: v8 changes two parameters, not the principle. The floor drops from two words to
 * one, and there is a carry per question instead of only the walkout.
 *
 * ‼️ THE FENCE, WHICH IS WHAT MAKES THIS SAFE AND IS STRICTER THAN THE BANNED-WORD LIST IT SITS
 * BESIDE. Every content word in every variant below must appear in THAT KEY'S OWN QUESTION
 * PROMPT (inflection allowed: start/started, feel/felt/feeling), plus a closed list of function
 * words. scripts/_probe-review-v7.ts asserts it against REVIEW_QUESTIONS_V6, so nobody can add
 * "I absolutely loved that {x}" unless the question itself contains "absolutely loved", which it
 * never will. A hand-written list of banned adjectives can only forbid the adjectives somebody
 * thought of; this forbids every word the question does not already contain.
 *
 * ‼️ AND IT IS WHY THE OLD 24-CHARACTER CAP ON SCAFFOLDING ROSE RATHER THAN BEING DELETED.
 * That cap was a crude proxy for "this is scaffolding, not prose" at a time when nothing checked
 * WHICH words were in it. The fence is the real thing, and it is tighter: a 42-character string
 * built only from the question's own words can say less than a 24-character string built from
 * anything. The cap stays as a blunt backstop against a paragraph, at 48.
 *
 * ‼️ ONE TABLE FOR EVERY CLIENT, WHICH IS WHAT HE ASKED FOR. "it should give sinonims in
 * connection words for every client". Nothing here is per clinic, and nothing can be: this module
 * imports nothing, so it cannot read a client row even by accident. One fence over one set of
 * literals is also the only version of this a probe can hold.
 *
 * ‼️ FIXTURE 4 IS THE REGRESSION GUARD FOR ALL OF IT. "a bit sore and the wait was long" holds a
 * conjunction, so no carry ever reaches it. See CONJUNCTIONS below.
 */
export const CARRIES: Readonly<Record<"motivation" | "nerves" | "walkout" | "friend", readonly string[]>> = {
  // "What made you start looking for a place like this?"
  motivation: [
    "I started looking because of ",
    "What made me start looking was ",
    "I was looking for a place like this because of ",
  ],
  // "What were you nervous about?"
  //
  // Two wordings, not three, and an unequal row is fine: assembleJoined indexes each key modulo
  // its own length. A third variant here would have to reach outside five short question words
  // for a word the fence would then refuse, which is the fence working rather than a gap.
  nerves: [
    "I was nervous about ",
    "What I was nervous about was ",
  ],
  // "How did you feel walking out?"
  //
  // Variant 0 is v7's CARRY_WALKOUT byte for byte, so the wording she saw before this change is
  // still the one she sees first.
  walkout: [
    "I walked out feeling ",
    "Walking out, I felt ",
    "I felt ",
  ],
  // "What would you tell a friend who is on the fence about coming in?"
  //
  // ‼️ "If you are on the fence," IS THE HALF OF HIS ORIGINAL TARGET OUTPUT v7 DECLINED TO BUILD,
  // on the grounds that it is a CLAUSE lifted from our question rather than "a verb carried". The
  // fence is what changed: a clause made only of the question's own words is the same kind of
  // thing as a verb made of them, and it is checkable in a way "is this a verb" was not.
  friend: [
    "If you are on the fence, ",
    "What I would tell a friend on the fence is ",
    "If you are on the fence about coming in, ",
  ],
};

/**
 * The keys in the order their digits are read out of a variant number. V6 narrative order.
 *
 * ‼️ CHANGING THIS ORDER RE-MAPS EVERY VARIANT NUMBER, which is harmless today (nothing stores a
 * variant) and would not be if one were ever persisted.
 */
const CARRY_ORDER = ["motivation", "nerves", "walkout", "friend"] as const;

/**
 * How many distinct shapes a review can take: 3 x 2 x 3 x 3 = 54.
 *
 * ‼️ EVERY KEY PICKS ITS WORDING INDEPENDENTLY, AND THAT IS THE WHOLE POINT OF THIS NUMBER.
 * Matthew, 2026-10-13, looking at the preview: "all of the reviews will have the same format, the
 * dots are in the same spot and the commas, so we need to create some randommness in that
 * formatting to not create a pattern".
 *
 * He is right, and it is not only a cosmetic problem. Every review this tool produced opened with
 * the same lead line and then ran four sentences in the same order with the same punctuation
 * rhythm, because a single wording index moved all four carries together and everybody started at
 * index 0. A clinic's profile would have filled with reviews sharing a visible skeleton, which is
 * what a reader and a spam filter both call a template.
 *
 * A single index gave 3 shapes. Reading the number as a MIXED-RADIX digit string, one digit per
 * key, gives 54: "I walked out feeling good." and "Walking out, I felt good." put the full stop
 * and the comma in different places, and they now vary independently of the sentence before them.
 *
 * ‼️ THE ORDER OF THE SENTENCES CANNOT BE PART OF THE VARIATION, AND THAT IS A HARD CONSTRAINT
 * RATHER THAN A CHOICE. scripts/_probe-review-v7.ts requires her own assembly's word sequence to
 * survive in the output AS A SUBSEQUENCE, so shuffling her answers would fail the invariant that
 * proves nothing was moved. What varies is how each answer is dressed, never where it sits.
 *
 * Derived from the table, so adding a wording to any row widens the space without anybody
 * remembering to update a number (onboarding2's scar: it typed "Six" over an array of seven).
 */
export const CARRY_COMBINATIONS: number = CARRY_ORDER.reduce(
  (total, key) => total * CARRIES[key].length,
  1
);

/**
 * How far Regenerate jumps.
 *
 * ‼️ NOT 1, AND IT HAS TO BE COPRIME WITH CARRY_COMBINATIONS. Adding 1 changes only the first
 * digit most of the time, so the review would look almost identical to the one before it and the
 * button would read as broken. 7 is coprime with 54, so repeated presses still reach all 54 shapes
 * before repeating, and each press moves more than one key.
 */
export const CARRY_STRIDE = 7;

/**
 * The orders her four answers may appear in.
 *
 * ‼️ CURATED, NOT ALL 24 PERMUTATIONS, AND THAT IS THE POINT RATHER THAN A SHORTCUT. Matthew asked
 * to "randomize the order in which we say the started looking nervous about and how it felt and
 * then fence, mix it up". All 24 would include orders that read like a shuffled deck ("If you are
 * on the fence, just go. I was nervous about bruising. I started looking because of wrinkles."),
 * and a review that reads wrong is the same problem as a review that reads templated. These six
 * are orders a person actually writes in.
 *
 * ‼️ REORDERING WHOLE ANSWERS IS NOT THE SAME THING AS MOVING HER WORDS, AND THE DIFFERENCE IS THE
 * WHOLE LICENCE FOR THIS. Each answer stays intact and entire; nothing is lifted out of one
 * sentence and dropped into another. The thing v7's subsequence check was built to catch was the
 * brief's own suggestion of moving her "honestly" from the walkout answer into the nerves clause,
 * which changes what the hedge modifies. That is still impossible: scripts/_probe-review-v7.ts now
 * requires every answer to appear as a CONTIGUOUS run of words, which is stricter within an answer
 * than the subsequence rule it replaced, and separately requires that nothing is dropped.
 *
 * ‼️ THE RECOMMENDATION CLOSES FIVE OF THE SIX. It is the sentence a reader acts on, and burying
 * it mid-review is the one reordering that costs the clinic something real.
 */
export const SENTENCE_ORDERS: ReadonlyArray<ReadonlyArray<(typeof CARRY_ORDER)[number]>> = [
  // The order the questions are asked in: why I came, what worried me, how it went, what I'd say.
  ["motivation", "nerves", "walkout", "friend"],
  // Opens on the worry, which is the shape of a reassurance review.
  ["nerves", "motivation", "walkout", "friend"],
  // Opens on the outcome. A great many real reviews start with how it turned out.
  ["walkout", "motivation", "nerves", "friend"],
  // Why, then how it went, with the worry as an aside before the advice.
  ["motivation", "walkout", "nerves", "friend"],
  // Outcome first, then the backstory behind it.
  ["walkout", "nerves", "motivation", "friend"],
  // The one that opens on the recommendation, which is also a shape people write in.
  ["friend", "walkout", "motivation", "nerves"],
];

/**
 * Every distinct review this module can produce from one set of answers: 54 wordings x 6 orders.
 *
 * ‼️ 324, AND HE ASKED FOR 52. The number is not the point; the absence of a repeating skeleton is.
 * Two reviews on the same clinic's profile now differ in which sentence opens, whether the first
 * two are merged into one, and where the commas fall inside each.
 */
export const REVIEW_SHAPES: number = CARRY_COMBINATIONS * SENTENCE_ORDERS.length;

/** The four keys v7 joins. Derived, so it cannot drift from the question set. */
export const V6_KEYS: ReadonlyArray<ReviewQuestion["key"]> = REVIEW_QUESTIONS_V6.map((q) => q.key);

/**
 * Words meaning "she has already started a clause here".
 *
 * A verb carried onto one of these produces a double subject ("I walked out feeling I felt fine"),
 * and a merge onto one reads as a run-on. Over-inclusion only makes a rule decline, so "the" and
 * "that" are in here even though they open plenty of fragments too.
 *
 * Apostrophes are stripped before the lookup, so "it" plus "s" and "I" plus "m" both arrive bare.
 */
const CLAUSE_OPENERS: ReadonlySet<string> = new Set([
  "i", "im", "ive", "id", "ill",
  "we", "weve", "were", "well", "our", "us",
  "it", "its", "they", "theyre", "theyve", "he", "hes", "she", "shes", "you", "youre", "youve",
  "my", "mine", "his", "her", "hers", "their", "your",
  "everything", "everyone", "everybody", "something", "someone", "nobody", "nothing", "none",
  "there", "that", "this", "these", "those", "the", "when", "after", "before", "since", "if",
]);

/**
 * Conjunctions, used for two different refusals.
 *
 * ‼️ THE SECOND REFUSAL IS WHAT KEEPS A COMPLAINT INTACT, AND IT IS THE REASON FIXTURE 4 PASSES.
 * "a bit sore and the wait was long" carries its own second clause. Carrying a verb onto it gives
 * "I walked out feeling a bit sore and the wait was long", which routes a FACT about the clinic
 * ("the wait was long") through "feeling" and recasts it as a mood. Every word of hers would still
 * be there and the sentiment would have moved, which is the prohibition that is easiest to break
 * without noticing. So an answer holding a conjunction is never carried; it is emitted as she
 * typed it, in the position v6 put it.
 */
const CONJUNCTIONS: ReadonlySet<string> = new Set([
  "and", "but", "so", "because", "which", "though", "although", "plus", "also", "then", "however",
]);

/**
 * The two carries whose wording ends in a preposition and therefore takes a noun phrase.
 *
 * "I started looking because of ___" and "I was nervous about ___". A determiner is the natural
 * next word in both. The other two take a complement ("I walked out feeling ___") or a clause
 * ("If you are on the fence, ___"), where a determiner reads as a fragment.
 */
const NOUN_FRAME_KEYS: ReadonlySet<string> = new Set(["motivation", "nerves"]);

/**
 * Determiners, which open a noun phrase rather than a clause.
 *
 * ‼️ EVERY ONE OF THESE IS ALSO IN CLAUSE_OPENERS, AND THAT IS NOT A CONTRADICTION. There they are
 * refused because they open a clause in the walkout and friend frames; here they are allowed back
 * in the two frames that want a noun. No PRONOUN appears below, so the double-subject failure
 * CLAUSE_OPENERS exists to prevent is untouched in all four frames.
 */
const DETERMINERS: ReadonlySet<string> = new Set([
  "the", "this", "that", "these", "those",
  "my", "our", "his", "her", "their", "your",
]);

/** A word reduced to letters for a closed-list lookup, so a trailing comma cannot miss. */
function token(word: string): string {
  return word.toLowerCase().replace(/[^a-z]/g, "");
}

/** Her answer's words, after assembleFragment has already collapsed the whitespace. */
function wordsOf(text: string): string[] {
  return text.split(" ").filter(Boolean);
}

/**
 * True when the whole answer is ONE sentence.
 *
 * Anything with sentence-final punctuation inside it is left alone: two sentences merged with
 * ", and " is a run-on, and "Dr. Smith" would be read as two. Both refusals are the safe direction.
 */
function isSingleSentence(text: string): boolean {
  return !/[.!?…]/.test(text.replace(/[.!?…]+$/, ""));
}

/**
 * Her fragment, prepared to sit after a conjunction or a carried verb.
 *
 * Lowercasing a sentence-initial capital mid-sentence is grammar, which the brief allows. The
 * three exceptions are the ones where the capital is hers and means something: the pronoun I, an
 * acronym she typed in capitals (IPL, PRP, CO2), and the provider's name, which is the one proper
 * noun this flow knows by name because she typed it into a different question.
 *
 * Beyond those three a lowercased proper noun is possible and is a visible wart in a box she is
 * reading and editing, exactly like the one in assembleFragment's docstring. The alternative is
 * this function deciding which of her words are names, which is a guess about her meaning for a
 * cosmetic win.
 */
function midSentence(fragment: string, answers: ReviewAnswers): string {
  const first = wordsOf(fragment)[0] ?? "";
  const bare = first.replace(/[^A-Za-z']/g, "");
  if (bare === "I" || bare.startsWith("I" + "'")) return fragment;
  if (bare.length > 1 && bare === bare.toUpperCase()) return fragment;

  const provider = (answers.provider ?? "").trim().toLowerCase();
  const providerFirst = provider.split(" ")[0] ?? "";
  if (providerFirst.length > 1 && bare.toLowerCase() === providerFirst) return fragment;

  const head = fragment[0];
  return head === head.toUpperCase() && head !== head.toLowerCase()
    ? head.toLowerCase() + fragment.slice(1)
    : fragment;
}

/** Below this, a merge would be building a sentence around two words rather than joining two. */
const MERGE_MIN_WORDS = 4;

/**
 * Whether motivation and nerves may become one sentence.
 *
 * ‼️ THE PAIR IS NAMED, NOT ADJACENT, AND THAT IS WHAT STOPS IT BRIDGING A GAP. This asks about
 * motivation and nerves specifically, never "the first two answers present". With nerves skipped,
 * motivation stands alone and nothing joins across the hole, because a conjunction spanning a
 * question she declined to answer asserts a relationship between her answer and nothing.
 *
 * ‼️ AND THE WORD FLOOR IS WHY ONE-WORD ANSWERS ARE LEFT ALONE. motivation "wrinkles" and nerves
 * "bruising" joined would be "Wrinkles, and bruising", a sentence we built around two words she
 * typed. Under the floor, both come out as the bullets v6 produced.
 */
function canMergeMotivationAndNerves(motivation: string, nerves: string): boolean {
  if (!isSingleSentence(motivation) || !isSingleSentence(nerves)) return false;
  if (wordsOf(motivation).length < MERGE_MIN_WORDS) return false;

  const nerveWords = wordsOf(nerves);
  if (nerveWords.length < MERGE_MIN_WORDS) return false;
  // A nerves answer that already opens with a conjunction would double it after ", and ".
  if (CONJUNCTIONS.has(token(nerveWords[0]))) return false;
  return true;
}

/**
 * A carried phrase is for a short complement. Longer than this and she wrote a sentence.
 *
 * ‼️ THE FLOOR IS 1 IN v8 AND WAS 2 IN v7, AND THAT ONE DIGIT IS THE WHOLE OF HIS COMPLAINT.
 * v7's docstring here read: "One word ('good') is left alone: 'I walked out feeling good' is a
 * sentence built around one word she typed." That is exactly the output he walked into and
 * rejected. The answer to "is this a sentence we invented" is no longer the word count; it is the
 * fence on CARRIES, which proves every word we contribute came from the question she was reading
 * when she typed that one word. See the CARRIES docstring for both positions.
 */
const CARRY_MIN_WORDS = 1;
const CARRY_MAX_WORDS = 6;

/**
 * Whether a question may lend its own words to her answer.
 *
 * ‼️ KEY-INDEPENDENT ON PURPOSE. The four preconditions are about the SHAPE of what she typed,
 * not about which question she was answering, so one function serves all four carries and there
 * is no per-key loophole to audit. Seven or more words, two sentences, a conjunction anywhere, or
 * a first word that already opens a clause: each means she wrote a sentence and gets nothing
 * added. What is left is the shape the carry was designed for: "great", "like myself again,
 * honestly", "go for it".
 *
 * ‼️ CLAUSE_OPENERS STAYS GLOBAL AND THEREFORE DECLINES SOME CARRIES THAT WOULD HAVE READ WELL.
 * "my smile lines" is refused because "my" is in that set, even though "I started looking because
 * of my smile lines" is good English. Over-inclusion only ever makes a rule DECLINE, and a
 * declined carry is v6 byte for byte, so the conservative direction is the safe one. Per-key
 * opener lists would buy a few nicer sentences and cost the one-function guarantee above.
 */
function canCarry(answer: string, key: (typeof CARRY_ORDER)[number]): boolean {
  const words = wordsOf(answer);
  if (words.length < CARRY_MIN_WORDS || words.length > CARRY_MAX_WORDS) return false;
  if (!isSingleSentence(answer)) return false;
  if (words.some((word) => CONJUNCTIONS.has(token(word)))) return false;

  const first = token(words[0]);
  if (!CLAUSE_OPENERS.has(first)) return true;
  // ‼️ A DETERMINER IS NOT A CLAUSE OPENER IN A NOUN FRAME, AND TREATING IT AS ONE LEFT BARE
  // FRAGMENTS ON THE SCREEN. Matthew answered "the food" to the nerves question and got back the
  // sentence `The food.` sitting on its own, which is the same defect as the `Great.` this release
  // was built to fix.
  //
  // The reason is that CLAUSE_OPENERS was tuned for ONE carry. "I walked out feeling the food" is
  // nonsense, so "the" belongs on that list; but the four carries do not all end in the same part
  // of speech. The motivation and nerves wordings end in a preposition and take a NOUN PHRASE
  // ("because of the food", "nervous about the food"), where a determiner is exactly what should
  // follow. The walkout and friend wordings take a complement or a clause, where it should not.
  //
  // So the list is per frame rather than global. What it still refuses everywhere is the thing it
  // was always for: a pronoun subject, which would make a double subject ("I walked out feeling I
  // felt fine", "I was nervous about we were late").
  return NOUN_FRAME_KEYS.has(key) && DETERMINERS.has(first);
}

/**
 * The wording this key uses at this variant number.
 *
 * ‼️ THE VARIANT IS A MIXED-RADIX NUMBER, NOT AN INDEX, AND THAT IS WHAT BREAKS THE PATTERN. Each
 * key reads its OWN digit: divide out the radices of the keys before it, then take the remainder
 * modulo this key's own row length. So variant 17 might be motivation wording 2, nerves 0,
 * walkout 2, friend 0, and variant 18 a different combination again. See CARRY_COMBINATIONS.
 *
 * Before this, one index moved all four carries in lockstep and there were three possible reviews.
 *
 * Negative and out-of-range numbers are folded back in, so no caller can land on undefined however
 * it arrives at a number.
 */
function carryFor(key: (typeof CARRY_ORDER)[number], variant: number): string {
  const wordings = CARRIES[key];
  let divisor = 1;
  for (const earlier of CARRY_ORDER) {
    if (earlier === key) break;
    divisor *= CARRIES[earlier].length;
  }
  const whole = Math.trunc(variant);
  const folded = ((whole % CARRY_COMBINATIONS) + CARRY_COMBINATIONS) % CARRY_COMBINATIONS;
  return wordings[Math.floor(folded / divisor) % wordings.length];
}

/**
 * Her lone lowercase "i", capitalised.
 *
 * He typed "i was nervous about if it would hurt my skin" and the review printed the lowercase i.
 * MAY ADD covers obvious typos, and this is the most obvious one there is.
 *
 * ‼️ ONLY THE STANDALONE PRONOUN. Not "i'm", not "ive", not the i in a word: the lookahead
 * excludes letters AND apostrophes, so the only thing that matches is the single-letter word.
 * Widening it to contractions would mean deciding that "ive" is "I've" rather than a word she
 * meant, which is a guess about her meaning rather than a typo nobody disputes.
 *
 * Invisible to both probe invariants by construction: the probe's words() lowercases before it
 * compares, so this changes no word and moves nothing.
 */
function fixStandaloneI(text: string): string {
  return text.replace(/(^|[^A-Za-z'])i(?=[^A-Za-z']|$)/g, (_m, before: string) => `${before}I`);
}

const SPLIT_MIN_HEAD_WORDS = 2;
const SPLIT_MIN_TAIL_WORDS = 3;

/**
 * "Just go, they talk you through everything" becomes "Just go. They talk you through everything."
 *
 * A full stop and a capital, and nothing else: the only transformation in this file that adds no
 * word at all. It is kept to the friend answer rather than applied generally because that is where
 * the advise-then-explain shape occurs, and one named rule is easier to audit than a general
 * sentence-splitter running over every answer.
 *
 * Requires exactly one comma and a tail that opens its own clause, so a list ("the staff, the
 * rooms, everything") and a trailing aside ("just go, honestly") are both left alone.
 */
function splitFriendClause(friend: string, answers: ReviewAnswers): string | null {
  if (!isSingleSentence(friend)) return null;

  const parts = friend.replace(/[.]+$/, "").split(",");
  if (parts.length !== 2) return null;

  const head = parts[0].trim();
  const tail = parts[1].trim();
  if (wordsOf(head).length < SPLIT_MIN_HEAD_WORDS) return null;

  const tailWords = wordsOf(tail);
  if (tailWords.length < SPLIT_MIN_TAIL_WORDS) return null;
  if (!CLAUSE_OPENERS.has(token(tailWords[0]))) return null;

  const first = assembleBullet(head);
  const second = assembleBullet(tail);
  return first && second ? first + " " + second : null;
}

/**
 * HER ANSWERS, JOINED. The v7 option, offered beside the version this file has always produced.
 *
 * ‼️ IN v8 THIS IS THE VERSION SHE COPIES, AND IN v7 IT WAS NOT. THE REVERSAL WAS DELIBERATE.
 * v7's docstring here read: "IT IS AN OPTION AND assemblePlain IS STILL THE DEFAULT, IN THIS FILE
 * AND ON THE SCREEN. The component holds both, hers is selected, and the joined one is a radio
 * she has to choose." Matthew, 2026-10-13: "I want them to see original, and retouched version so
 * they can copy the retouched only. and modify if they want in that same box where the retouched
 * is".
 *
 * ‼️ WHAT SURVIVES OF THE OLD RULE IS THE MITIGATION, NOT THE WORDING, AND IT IS WHY THIS IS
 * STILL NOT THE THING FTC 16 CFR Part 465 REACHES. The original stays on the screen beside this
 * one, read-only, so the difference between what she typed and what she is about to post is
 * always visible rather than remembered. This box is fully editable, so her exact words are one
 * deletion away. And she ticks an attestation before the clipboard will take it. A tool that
 * SILENTLY replaces her words is what the rule reaches; one that shows her both and asks her to
 * approve one is not.
 *
 * ‼️ OFFERED AT EVERY RATING, AND THE FUNCTION CANNOT KNOW THE RATING. There is no rating
 * argument here and there must never be one. Offering a better-reading review to five stars and
 * not to two is review shaping with a nicer name, and it is the exact funnel
 * scripts/_probe-review-gating.ts exists to keep rebuilt-proof.
 *
 * ‼️ THE SECOND PARAMETER IS A WORDING INDEX AND IT IS NOT THE RATING. v7 had arity 1 and a probe
 * asserted it, precisely so that a second argument could not become a rating without somebody
 * arguing for it. This is that argument: `variant` selects which of CARRIES' wordings each key
 * uses, it comes from a button she presses, and nothing derives it from the stars. The probe now
 * asserts arity 2 AND that this function's body contains no `rating` at all, which is the half
 * that was ever load-bearing.
 *
 * ‼️ NOTHING SHE TYPED IS EVER DROPPED, INCLUDING A KEY THIS FUNCTION HAS NEVER HEARD OF. The
 * non-v6 loop runs first in ALL_REVIEW_QUESTIONS order, so a stored v3, v4 or v5 row handed to
 * this comes out as its own sentences with no join applied to any of them, rather than as the
 * empty string a v6-only implementation would have returned. Nothing calls it that way today.
 *
 * Pure, no network, no imports: ReviewAnswers in, a string out.
 */
export function assembleJoined(answers: ReviewAnswers, variant = 0): string {
  const sentences: string[] = [];

  // One fold for the whole number, so the order digit and the wording digits are read off the
  // same value. Negatives and out-of-range numbers come back inside the space.
  const whole = Math.trunc(variant);
  const folded = ((whole % REVIEW_SHAPES) + REVIEW_SHAPES) % REVIEW_SHAPES;

  /**
   * One key's sentence: her answer with its own question's words carried onto it when the shape
   * allows, and the bullet v6 produced when it does not.
   *
   * ‼️ THE FALLBACK IS THE POINT. Every precondition that fails lands on assembleBullet, which
   * is v6 byte for byte, so the worst case of this whole feature is today's output.
   */
  const carried = (key: (typeof CARRY_ORDER)[number]): string | null => {
    const fragment = assembleFragment(answers[key]);
    if (!fragment) return null;
    return canCarry(fragment, key)
      ? assembleBullet(carryFor(key, folded) + midSentence(fragment, answers))
      : assembleBullet(answers[key]);
  };

  const lead = assembleLead(answers);
  if (lead) sentences.push(lead);

  // Everything outside the v6 narrative, in the pinned order, untouched. See the docstring: this
  // is what keeps an older stored row readable rather than empty.
  for (const question of ALL_REVIEW_QUESTIONS) {
    if (V6_KEYS.includes(question.key)) continue;
    if (lead && LEAD_KEYS.includes(question.key)) continue;
    const text = assembleBullet(answers[question.key]);
    if (text) sentences.push(text);
  }

  // ── Her four answers, in one of the orders a person writes in ──
  //
  // ‼️ THE ORDER IS PART OF THE VARIANT NUMBER, which is what stops every review on a clinic's
  // profile sharing a skeleton. See SENTENCE_ORDERS for why six curated orders and not all 24.
  const order = SENTENCE_ORDERS[Math.floor(folded / CARRY_COMBINATIONS) % SENTENCE_ORDERS.length];

  // ‼️ THE MERGE NEEDS THE PAIR ADJACENT AND IN THAT ORDER, AND NOW IT IS NOT ALWAYS. ", and "
  // asserts addition between two answers the question order already put side by side. Across a
  // gap, or reversed, it would be asserting a relationship she did not make and the reader cannot
  // check. So the merge fires only in the orders that keep motivation immediately before nerves,
  // and in the others both answers simply get their own sentence. That is not a loss: it is one
  // more axis on which two reviews differ.
  const motivationAt = order.indexOf("motivation");
  const pairIsAdjacent = motivationAt >= 0 && order[motivationAt + 1] === "nerves";

  const motivation = assembleFragment(answers.motivation);
  const nerves = assembleFragment(answers.nerves);
  const merging =
    pairIsAdjacent &&
    Boolean(motivation) &&
    Boolean(nerves) &&
    canMergeMotivationAndNerves(motivation as string, nerves as string);

  for (const key of order) {
    // The merged pair is emitted once, at the motivation's position, and the nerves slot is then
    // already spent.
    if (merging && key === "nerves") continue;

    if (merging && key === "motivation") {
      const merged = assembleBullet(
        (motivation as string) + JOIN_MOTIVATION_NERVES + midSentence(nerves as string, answers)
      );
      if (merged) sentences.push(merged);
      continue;
    }

    if (key === "friend") {
      // The split is tried first because it adds NO word at all, so where both are eligible the
      // cheaper transformation wins.
      const friend = assembleFragment(answers.friend);
      if (friend) {
        const split = splitFriendClause(friend, answers) ?? carried("friend");
        if (split) sentences.push(split);
      }
      continue;
    }

    const sentence = carried(key);
    if (sentence) sentences.push(sentence);
  }

  return sentences.join(" ");
}
