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
 */

function introBlock(mode: CoachCallType): string {
  if (mode === "cold") {
    return `REQUESTED SCRIPT: INTRO, on a COLD lead. He is about to dial, or they just picked up. Nothing has been said yet.

- Give 3 openers, and give him 3 genuinely DIFFERENT ways in. Not one line phrased three times.
- ‼️ Build every one of them out of the CALL BRIEF: this business by name, what they actually sell, who buys from them, their city, this owner. An opener that would work on any business on earth is a wasted card, and the whole reason he scanned the lead was so it would not be one.
- ‼️ HARD CAP: 30 WORDS PER CARD, question included. Count them. He is reading this with the phone already ringing, and a card he has to scan twice is a card he will not use. One long comma-spliced sentence breaks this cap exactly like three short ones would.
- Plain spoken English, the way someone actually talks on a phone. No slogans, no marketing voice, no throat-clearing before the question.
- If the brief is thin or missing, stay short and plain rather than inventing detail. Never invent a business fact to sound specific.
- ‼️ Nothing has been sent to this person and NO AUDIT HAS BEEN RUN for them. Do not mention an audit, a report, a score or a video, not even as something you are about to send. Offer to LOOK, never claim to have looked.
- ‼️ SPECIFIC MEANS THE QUESTION IS ABOUT THEIR BUSINESS. IT DOES NOT MEAN CLAIMING TO KNOW ANYTHING ABOUT THEM. You have not checked this business, so you cannot report on it, hint at a result, or imply you have already had a look. These are the two sides of the line:
    ALLOWED, because it asks: "When a parent in Orlando asks ChatGPT for a bounce house, do you know who it names?"
    BANNED, because it claims: "I was looking at how you show up", "I noticed you're not appearing", "your competitors are coming up instead", "here's what I'm seeing".
  If a card would collapse without its claim, it was never an opener, it was a fabricated finding. Ask the question instead. He is on this call to earn the right to look, not to report what he found.
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
- ‼️ The implementation plan is something he is OFFERING TO BUILD. It does not exist yet. NO AUDIT HAS BEEN RUN. Never say an audit was run, a report exists, or anything was already sent.
- ‼️ AND THEREFORE YOU HAVE NO FINDINGS. Not one. "Here's what I'm seeing", "your name isn't coming up", "your competitors are showing up instead", "I checked and" are all fabrications on this call, and the owner catches them the moment he asks how you know. Sell the LOOK, never the result of a look nobody took: what he is offering is to go and find out, for free, and send it over. That offer is stronger than an invented finding anyway, because it is true and it costs the owner nothing to accept.
- No price. Not a range, not "a few hundred", not "depends". They have not seen anything yet.`;
}

/** The block for this request, or "" when Matthew did not press a button. */
export function scriptBlock(kind: ScriptKind | null, mode: CoachCallType): string {
  if (!kind) return "";
  return kind === "intro" ? introBlock(mode) : closeBlock(mode);
}
