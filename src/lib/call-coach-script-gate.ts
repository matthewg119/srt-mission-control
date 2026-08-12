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
 * ## Why there is no canned opener here any more (2026-08-11, same day it was added)
 *
 * This file briefly hardcoded Matthew's cold opener: a `COLD_STEM` every card had to begin with,
 * plus a `COLD_OPENER` that suggestion 1 had to reproduce verbatim. The close block did the same
 * thing with a three-line "spine" it was told to follow close to verbatim.
 *
 * It made the coach useless on the thing it exists for. Scanning a lead resolves the business, the
 * owner, the city and what they sell, and then the intro threw all of it away and printed the same
 * three cards for everyone — the scan's entire output discarded at the last step. The close came
 * back as three long paragraphs that differed only in their preamble and ended in the same
 * sentence three times, which is one card printed three times.
 *
 * A card he could have written on a sticky note is worth nothing on screen. If a line is fixed he
 * already knows it, so the only thing worth generating is the part that changes: THIS business,
 * THIS owner, what they actually sell. The fixed script now lives where a fixed script belongs —
 * a read-only panel in the extension he opens when he wants it, never round-tripped through a
 * model that would only paraphrase it worse.
 *
 * ‼️ Do not reintroduce a verbatim line here. The failure is not that the model writes bad
 * openers, it is that a verbatim order outranks every personalization instruction in the same
 * block — which is the same structural lesson the header above already records.
 *
 * ## ‼️ COLD DOES NOT MEAN "NO AUDIT". Never assert facts the brief owns.
 *
 * Removing the canned opener left a hole, and the first patch filled it with the words
 * "NO AUDIT HAS BEEN RUN" hardcoded into both cold blocks. That is false for a whole branch of
 * `call-type.ts`, which its own comment calls "the specific trap": a report finished, a draft was
 * written, and nobody pressed send. `cold` means nothing was DELIVERED, not that nothing was
 * MEASURED. Orlando Amusements sat in exactly that state — status done, score 44/100, three named
 * competitors, `outreach_stage: drafted`, `first_sent_at: null` — so `brief.ts` handed the model
 * the full numbers block while this file told it none of it existed. The coach asked blind
 * questions on a lead we had already audited.
 *
 * The rule that came out of it: **this file may state what has been SENT, because the mode encodes
 * that. It may never state what has been MEASURED, because only the brief knows.** Defer to the
 * brief's "NUMBERS I MAY CITE" section, which is explicit in both directions — real figures when
 * `buildCoachNotes` ran, and a literal "NONE" from `zohoOnlyNumbers()` when it did not.
 */

function introBlock(mode: CoachCallType): string {
  if (mode === "cold") {
    return `REQUESTED SCRIPT: INTRO, on a COLD lead. He is about to dial, or they just picked up. Nothing has been said yet.

- Give 3 openers, and give him 3 genuinely DIFFERENT ways in. Not one line phrased three times.
- ‼️ Build every one of them out of the CALL BRIEF: this business by name, what they actually sell, who buys from them, their city, this owner. An opener that would work on any business on earth is a wasted card, and the whole reason he scanned the lead was so it would not be one.
- ‼️ HARD CAP: 30 WORDS PER CARD, question included. Count them. He is reading this with the phone already ringing, and a card he has to scan twice is a card he will not use. One long comma-spliced sentence breaks this cap exactly like three short ones would.
- Plain spoken English, the way someone actually talks on a phone. No slogans, no marketing voice, no throat-clearing before the question.
- If the brief is thin or missing, stay short and plain rather than inventing detail. Never invent a business fact to sound specific.
- ‼️ NOTHING HAS BEEN SENT to this person. No report link, no video, no email has reached them, so never refer to one as something they have or are about to receive.
- ‼️ WHETHER ANYTHING WAS MEASURED IS A SEPARATE QUESTION, AND THE CALL BRIEF ANSWERS IT. Read its "NUMBERS I MAY CITE" section and obey it literally:
    If it lists a score, a competitor or a set of questions they are absent from, those were MEASURED and they are the strongest thing you have. Open on one. A real number about their own business is worth more than any question you could invent.
    If it says NONE, then nothing has been measured for this business and you have no findings at all. Ask instead of claiming.
- ‼️ NEVER PRODUCE A FIGURE THE BRIEF DID NOT GIVE YOU, and never imply a look that the brief does not evidence. The line runs between citing and inventing, not between specific and vague:
    ALLOWED when the brief carries numbers: "You're absent from 12 of the 20 questions your buyers actually ask, and Astro Jump comes up instead. Want to see it?"
    ALLOWED when the brief says NONE: "When a parent in Orlando asks ChatGPT for a bounce house, do you know who it names?"
    BANNED either way: any score, percentage, count or competitor that is not in the brief, and any "I noticed" or "here's what I'm seeing" that the brief does not back.
  A card that would collapse without an unsupported claim was never an opener, it was a fabricated finding.
- No pitch, no price, no packages. This is CLOSER stage C and its only job is to earn the next thirty seconds.`;
  }

  const seen = mode === "close" ? "they have already seen the work" : "an email has already gone out to them";
  return `REQUESTED SCRIPT: INTRO, on a lead where ${seen}. This is a RE-OPEN, not a cold open.

- Give 3 ways back in. Three different angles, not three phrasings of one. HARD CAP 30 WORDS each.
- ‼️ THE OPENER IS THE WHOLE CALL HERE, and "following up" kills it before it starts. Build these on the NEPQ follow-up shape in the mechanics above: his name said like someone they already know, a VAGUE recall of when they last spoke with a question mark on it, their problem in THEIR words, and then the question that does the work:
    "Did you give up on [the result they wanted], or what actually happened?"
  Written for this prospect, out of the CALL BRIEF. Not that sentence verbatim — its shape.
- Being slightly unsure about when you spoke is the point, not sloppiness. It invites them to correct you, and a prospect correcting you is a prospect back in a conversation.
- Use the CALL BRIEF for what they have actually seen. Never invent a touch that is not in it.
- No pitch and no re-explaining the offer. He is picking up a conversation, not starting one.
- At least one of the three should end on a question about THEM rather than about the email. The email is the excuse for the call, not its subject.`;
}

function closeBlock(mode: CoachCallType): string {
  const shared = `- Give 3 reframes that raise desire. Each ends in a question.
- ‼️ HARD CAP: 30 WORDS PER CARD, question included. Count them before you return it. He reads these out loud mid-call, and a close that takes a paragraph to arrive has lost the room before it lands.
- ‼️ One sentence does NOT mean one enormous sentence. A 60-word line held together by commas and dashes is three sentences in a trench coat and it breaks the cap just the same. Say one thing, then ask.
- Pick ONE angle per card and let the other cards carry the rest. Stacking the whole offer into a single card (free, and twenty minutes, and a one-page plan, and no sales call, and worst case you keep it) is what makes them unreadable, and it leaves the other two cards nothing to be.
- No throat-clearing. "Here's what I'm thinking, and tell me if it lands" is six words spent before the sentence starts.
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
- The target is getting them to hand over the website so the free implementation plan can go out. Everything here serves that one ask.
- ‼️ Three DIFFERENT routes to it, built from the CALL BRIEF and from what this owner has actually said on the call so far. Offering it, shrinking it, and removing the risk from it are three routes. The same offer worded three ways is not.
- His own language for this is plain and low pressure: it is free, it is not a sales call, worst case they keep the plan themselves, the only thing needed is a website. Use that register. Do not recite it as a script and do not stack all of it into one card.
- ‼️ NOTHING HAS BEEN SENT to them. The implementation plan and the video are things he is OFFERING TO HAND OVER, never things they already have.
- ‼️ WHAT HE MAY POINT AT IS DECIDED BY THE CALL BRIEF, in its "NUMBERS I MAY CITE" section, and by nothing else:
    If it carries a score, competitors or absent questions, they were MEASURED. Lead with one. "You're absent from 12 of 20 questions and these three come up instead, want me to send you the breakdown" is a far stronger close than any offer to go and look, because the gap is already proven and the ask is only to receive it.
    If it says NONE, nothing has been measured. Then sell the LOOK, not a result: he is offering to go and find out, free, and send it over. That is true and it costs the owner nothing to accept.
- ‼️ Either way, NEVER invent a figure, a percentage or a competitor name that is not in the brief. "Here's what I'm seeing" with nothing behind it is caught the moment the owner asks how you know.
- No price. Not a range, not "a few hundred", not "depends". They have not seen anything yet.`;
}

/** The block for this request, or "" when Matthew did not press a button. */
export function scriptBlock(kind: ScriptKind | null, mode: CoachCallType): string {
  if (!kind) return "";
  return kind === "intro" ? introBlock(mode) : closeBlock(mode);
}
