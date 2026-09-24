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
    | "fears";
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
 * Assembly order for BOTH sets, and the reason nothing migrates.
 *
 * ‼️ THE ORDER OF THIS SPREAD IS LOAD BEARING AND IS PINNED BY A TEST. assembleLabelled and
 * assemblePlain iterate it, so it decides the order of the sentences she copies. No stored row has
 * ever held one v3 key and one v4 key, so a v3 row comes out byte for byte what it produced before
 * v4 existed. Reordering this would re-assemble stored reviews in an order the customer who wrote
 * them never saw, which is a thing she cannot be asked to check.
 */
export const ALL_REVIEW_QUESTIONS: ReviewQuestion[] = [...REVIEW_QUESTIONS, ...REVIEW_QUESTIONS_V4];


/** The stamp a v4 row carries. v3 rows keep QUESTION_SET_VERSION above and nothing rewrites them. */
export const QUESTION_SET_VERSION_V4 = "v4";

/**
 * Which set was walked, read off the request body.
 *
 * Anything unrecognised is v3, which is what a client that sends nothing is. The value lands in a
 * not-null text column, so it is narrowed here rather than trusted.
 */
export function readQuestionSetVersion(raw: unknown): string {
  return raw === QUESTION_SET_VERSION_V4 ? QUESTION_SET_VERSION_V4 : QUESTION_SET_VERSION;
}

export type ReviewAnswers = Partial<Record<ReviewQuestion["key"], string>>;

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
 * Returns null for an empty answer. An unanswered question simply produces fewer bullets;
 * none of the four is required.
 */
export function assembleBullet(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (!collapsed) return null;

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
export function assemblePlain(answers: ReviewAnswers): string {
  const lines: string[] = [];
  for (const question of ALL_REVIEW_QUESTIONS) {
    const text = assembleBullet(answers[question.key]);
    if (text) lines.push(text);
  }
  return lines.join("\n");
}

/** Nothing typed in any of the four. */
export function isEmpty(answers: ReviewAnswers): boolean {
  return ALL_REVIEW_QUESTIONS.every((q) => !assembleBullet(answers[q.key]));
}
