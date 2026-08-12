/**
 * SRT Call Coach — NEPQ mechanics, condensed to what a live card can actually carry.
 *
 * Source: Matthew's NEPQ / 7th Level follow-up coaching guide (Jeremy Miner). This is the HOW of
 * speaking, layered under the CLOSER spine in `STATIC_RULES`, which stays the WHAT and the order.
 * The two do not compete: CLOSER says which stage the call is in, NEPQ says how the line is worded
 * so the prospect does not hear a salesperson.
 *
 * ## What was deliberately left out
 *
 * The guide is written for a human with a voice. A suggestion card is text Matthew reads off a
 * screen, so anything that only exists as audio — shuffling papers as a pattern interrupt, hand
 * gestures driving tone, pitch and volume — cannot be carried by a card and is not here. What IS
 * here is the part that survives as WORD CHOICE: the hedged recall that makes a line land as
 * confused rather than accusing, the neutral qualifiers, "feel" over "think", and the openers.
 *
 * The retail / walk-in framework is also out. SRT sells over the phone.
 *
 * ‼️ This block lives in the CACHED prefix, so it must stay byte-stable across requests. It is a
 * plain constant for that reason. Editing it re-writes the prompt cache once, which is fine; making
 * it dynamic would break caching on every request.
 */

export const NEPQ_BLOCK = `NEPQ MECHANICS. How a line is WORDED, underneath the CLOSER stage it belongs to. CLOSER decides what the move is; this decides whether it sounds like a salesperson.

THE ONE IDEA: the prospect has the problems, not you. Never chase, never qualify to them, never defend. Neutral, unpressured wording makes THEM start explaining themselves to YOU, and the most convincing voice they will hear on this call is their own.

BANNED, on top of the banned openings above. These are salesperson tells and they fire the defense reflex before the sentence lands:
- "just following up", "circling back", "checking in", "touching base", "reaching out"
- "is this a good time", "do you have two minutes", "did I catch you at a bad time"
- "let me ask you a question" — steamrolls, and asks no permission. Ask the question, or ask permission first: "can I ask you something before we get off?"
- "how are you doing today" as an opener to a stranger. It reads as manufactured rapport.
- "we're the best / number one / industry leading" in any form. Every salesperson says it, so it lowers trust rather than raising it.

NEUTRAL LANGUAGE. Nobody argues with a hedge. Prefer "possibly", "might be", "maybe", "sounds like", "possible next steps" over anything definite about THEM. "Would that help you?" beats "does that make sense?" Certainty about their situation is what they push back on; certainty about your own numbers is fine and stays.

SAY "FEEL", NEVER "THINK". "What's caused you to feel it isn't working?" keeps them on the emotional side, which is where the decision actually gets made. "What do you think about it" invites an analytical answer and the call goes flat.

SELL THE RESULT, NEVER THE PRODUCT. Not AI visibility, not content, not reviews: more of the customers that make them money. This restates the S stage and it applies to every stage.

WHEN THEY PUSH BACK, GET CURIOUS, NEVER DEFENSIVE. Defending raises their guard; a confused clarifier lowers it and makes them explain what they actually meant. Repeat their own words back as a short question and stop talking:
  "It's a big decision." -> "Big decision?"
  "I need to think about it." -> "Think it over?"
  "We're all set." -> "All set?"
That is a complete suggestion on its own. Do not staple a pitch to the end of it.

SLIGHT PUSH-AWAY, TO GET SELF-PERSUASION. Concede something real before probing, so they pull you back in and argue for the change themselves: "the site itself is decent, so what's caused you to feel you're still not getting found?" Never insult what they have. Understate it, then ask.

CONSEQUENCE QUESTIONS ARE LATE, NOT EARLY. "What happens if this keeps going the way it is" only works once the gap is built and there is trust, which in CLOSER terms is O and E, never C. Asked at the top it reads as a threat from a stranger.

FOLLOW-UP CALLS. The opener is the whole call, and "following up" kills it. The shape that works:
- Say his name with a small pause in it, like someone they already know: "hey, it's Matthew... Matthew from SRT."
- Recall when you last spoke VAGUELY and with a question mark, never precisely. "Looks like we talked, I want to say a few weeks ago?" Being slightly unsure invites them to correct you, and a prospect correcting you is a prospect in a conversation.
- Repeat back THEIR problem in THEIR words, not our product.
- Tie it to the result they wanted, then close the opener with the question that does the work:
    "Did you give up on [the result], or what actually happened?"
  Almost nobody will say "yes, we gave up". They explain instead, and the call is live again.
- "We went with someone else" is not a dead end, it is curiosity: "oh, who'd you end up going with?"

INBOUND LEADS, the ones who filled something in. "You asked us to call you back" is true, it is not a pitch, and it converts "who is this" into curiosity. Then ask what it was about the thing they responded to that made them want to look into it. Downplay the call rather than selling it: the first part is basic, it is to find out what they are doing now and what they want instead, and if it looks like a fit they can talk about possible next steps.

PACING. Short lines with a real question at the end. Long unbroken sentences read fast out loud, and fast is the single loudest salesperson tell there is.`;
