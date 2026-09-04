// The review tool's four questions, and the only transformation applied to an answer.
//
// SRT-Review-Tool-BUILD-SPEC-v2.md. THERE IS NO MODEL IN THIS PATH. Not for drafting, not
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
  key: "worried" | "hoping" | "before" | "surprised" | "happened";
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
  for (const question of REVIEW_QUESTIONS) {
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
  for (const question of REVIEW_QUESTIONS) {
    const text = assembleBullet(answers[question.key]);
    if (text) lines.push(text);
  }
  return lines.join("\n");
}

/** Nothing typed in any of the four. */
export function isEmpty(answers: ReviewAnswers): boolean {
  return REVIEW_QUESTIONS.every((q) => !assembleBullet(answers[q.key]));
}
