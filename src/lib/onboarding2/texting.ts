// Sending two or three short messages in a row, the way a person texting does.
//
// ‼️ THIS IS A SEND-SHAPE RULE, NOT A PERSONA, AND THE DISTINCTION IS DELIBERATE. It decides
// where a reply breaks into bubbles. It does not decide tone, vocabulary or what gets said; that
// belongs to whatever framework Matthew hands over, and this file is written to be replaced
// wholesale by it rather than extended around it.
//
// THE RULE, AS STATED AND AGREED 2026-09-03:
//
//   - Split only on a natural beat, which here means sentence punctuation. Never mid-sentence,
//     never on a comma: a bubble that ends on half a clause reads as a dropped message rather
//     than as a person typing fast.
//   - Two to three bubbles maximum. Four is a wall of notifications.
//   - The first bubble is under eight words. That is what makes the second one feel like a
//     follow-up rather than a paragraph that happened to wrap.
//   - The question is always last and always alone. Somebody answering a question in a bubble
//     above the one they are reading is the failure this rule exists to prevent.
//
// ‼️ bot_persona IS NOT READ HERE, AND NOTHING IN /onboarding2 READS IT. Its one active row still
// describes SRT as a business funding broker, which we decommissioned in August, and it carries
// no multi-message rules at all. It is used by src/lib/sms-ai-engine.ts and src/lib/persona.ts.
// It needs rewriting and that is not this lane's job.
//
// PURE. No model, no database, no clock.

/** Above this, a first bubble is a paragraph rather than an opener. */
const FIRST_BUBBLE_MAX_WORDS = 8;
/** Two or three. Never four. */
const MAX_BUBBLES = 3;
/** Below this there is nothing to split: it is already one text message. */
const MIN_SPLIT_CHARS = 60;

/** Milliseconds between bubbles, so the client can stagger them. Read by chat-bubble.tsx. */
export const BUBBLE_GAP_MS = { min: 400, max: 900 };

function words(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Sentences, kept with their punctuation.
 *
 * Splits after . ! or ? followed by whitespace. Deliberately naive about abbreviations: the worst
 * case is one extra bubble break after "Dr." and the assistant does not write that way, whereas a
 * clever splitter is a thing that fails in ways nobody can predict from reading it.
 */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * One reply, split into the bubbles it should arrive as.
 *
 * ‼️ IT RETURNS THE WHOLE TEXT AS ONE BUBBLE WHENEVER THE RULE DOES NOT CLEANLY APPLY, and that
 * is the correct failure. Splitting something that should not be split loses meaning; not
 * splitting something that could have been costs nothing but a slightly longer message.
 */
export function splitIntoMessages(text: string): string[] {
  const whole = text.trim();
  if (!whole) return [];
  if (whole.length < MIN_SPLIT_CHARS) return [whole];

  const parts = sentences(whole);
  if (parts.length < 2) return [whole];

  // The question goes last and alone. If the final sentence is a question, it is its own bubble
  // and everything before it is the lead-up.
  const tail = parts[parts.length - 1];
  const head = parts.slice(0, -1);

  if (!tail.endsWith("?")) {
    // No question to isolate. Two bubbles at most: a short opener and the rest, and only when the
    // opener is genuinely short. Otherwise leave it alone.
    const first = parts[0];
    if (parts.length >= 2 && words(first) <= FIRST_BUBBLE_MAX_WORDS) {
      return [first, parts.slice(1).join(" ")];
    }
    return [whole];
  }

  if (!head.length) return [whole];

  // A short opener, the middle, then the question. Three bubbles, which is the ceiling.
  if (head.length >= 2 && words(head[0]) <= FIRST_BUBBLE_MAX_WORDS) {
    const rest = head.slice(1).join(" ");
    const out = [head[0], rest, tail];
    return out.length <= MAX_BUBBLES ? out : [head.join(" "), tail];
  }

  return [head.join(" "), tail];
}
