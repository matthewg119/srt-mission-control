/**
 * SRT Call Coach — the words for a REQUESTED script (Intro / Close), assembled per call.
 *
 * ## Why this is a per-call block and not prompt text
 *
 * The first build put the whole Intro and Close doctrine in the cached `STATIC_RULES`, with the
 * mode-specific parts written as conditionals: "on MODE COLD open with this exact stem, on MODE
 * CLOSE never use it". That failed, and it failed WORSE the harder the instruction was pushed.
 *
 * Measured, three runs each: the cold stem leaked into a close-stage intro 1 time in 3. Adding a
 * ‼️ and the words "ONLY to COLD" took it to 3 times in 3. The reason is structural, not a wording
 * problem: the same paragraph also says SUGGESTION 1 IS EXACTLY THIS LINE, VERBATIM, and a
 * verbatim order beats a conditional every time. Emphasis added to the conditional is emphasis
 * added to the whole paragraph, including the part that was already winning.
 *
 * So the stem is not in the request at all unless the call is cold. Same doctrine that fixed the
 * $349 leak in `call-coach-price-gate.ts`, and the same one the follow-up COACH NOTES run on:
 * **absent beats forbidden.** A model cannot quote a line it was never given.
 *
 * Pure, so it is testable without a call.
 */

import type { CoachCallType } from "./call-coach-price-gate";

export type ScriptKind = "intro" | "close";

/**
 * Matthew's own cold opener. It is his line, it works, and it is reproduced verbatim rather than
 * paraphrased because a rewritten version of a line that already works is just a worse line.
 */
const COLD_STEM = "Hey, I'm looking for some help here,";
const COLD_OPENER = `Hey, I'm looking for some help here. Are you using ChatGPT to attract more business?`;

function introBlock(mode: CoachCallType): string {
  if (mode === "cold") {
    return `REQUESTED SCRIPT: INTRO, on a COLD lead. He is about to dial, or they just picked up. Nothing has been said yet.

- Give 3 openers. Attention first, then interest, then desire.
- EVERY one of the three begins with this exact stem: "${COLD_STEM}"
- SUGGESTION 1 IS EXACTLY THIS LINE, verbatim, no edits and no additions:
    "${COLD_OPENER}"
- Suggestions 2 and 3 keep the stem and change what follows it, using the business in the CALL BRIEF and what they actually sell.
- ‼️ Nothing has been sent to this person and no audit has been run for them. Do not mention an audit, a report, a score or a video, not even as something you are about to send. Offer to LOOK, never claim to have looked.
- No pitch, no price, no packages. This is CLOSER stage C and its only job is to earn the next thirty seconds.`;
  }

  const seen = mode === "close" ? "they have already seen the work" : "an email has already gone out to them";
  return `REQUESTED SCRIPT: INTRO, on a lead where ${seen}. This is a RE-OPEN, not a cold open.

- Give 3 ways back in. Name himself, name the thing already sent, ask one question.
- Use the CALL BRIEF for what they have actually seen. Never invent a touch that is not in it.
- No pitch and no re-explaining the offer. He is picking up a conversation, not starting one.
- Warm, brief, and straight to a question. Three different angles, not three phrasings of one.`;
}

function closeBlock(mode: CoachCallType): string {
  const shared = `- Give 3 reframes that raise desire. Each ends in a question.
- ‼️ Stage discipline is SUSPENDED for this request only. He pressed the button, so give him closes for where the call actually is, not for the current CLOSER stage.
- Every HARD LINE still binds. A requested close is not permission to guarantee anything, invent a figure, or manufacture a deadline.`;

  if (mode === "close") {
    return `REQUESTED SCRIPT: CLOSE, on someone who has seen the work and is deciding.

${shared}
- The moves that fit here: the one-to-ten ("where are you on this, one to ten, and what gets it to a ten"), the isolate ("if that weren't an issue, would you be a yes, and is there anything else"), and the move to paperwork once they are there.
- Lead with the tier that fits what they told you they want. Do not re-pitch what they already watched.`;
  }

  if (mode === "followup") {
    return `REQUESTED SCRIPT: CLOSE, on someone an email has gone out to who has NOT engaged with it yet.

${shared}
- The target is the REPLY, and nothing else. Get them to open the email and hit reply while he is still on the phone, because that is what keeps everything after it out of spam.
- Nothing is being sold on this call and no figure exists in your context. Say plainly that nothing is being sold and the video is theirs either way.
- Shrink the ask rather than pushing. A dated callback is a real win here.`;
  }

  return `REQUESTED SCRIPT: CLOSE, on a COLD lead. Nothing has been sent to them and no audit has been run.

${shared}
- The target is getting them to accept the email, so the free implementation plan and a personalized video on getting more business through ChatGPT can go out. His own sequence is the spine and should appear close to verbatim across the three:
    "Would you be against us doing a free implementation for you, so new customers can find you using ChatGPT? The only requirement is having a website. Does your business have one?"
    "It'd take me about 20 minutes to go over everything on the phone, so I'll just send you an email with all of it. That okay?"
    "Worst case you keep the implementation plan for yourself. What's your website?"
- ‼️ The implementation plan is something he is OFFERING TO BUILD. It does not exist yet. Never say an audit was run, a report exists, or anything was already sent.
- No price. Not a range, not "a few hundred", not "depends". They have not seen anything yet.`;
}

/** The block for this request, or "" when Matthew did not press a button. */
export function scriptBlock(kind: ScriptKind | null, mode: CoachCallType): string {
  if (!kind) return "";
  return kind === "intro" ? introBlock(mode) : closeBlock(mode);
}
