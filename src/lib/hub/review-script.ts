// The Virtual Agent's walk: what it says, what it asks, and where a Yes goes.
//
// ‼️ THIS FILE IS DATA, NOT A MODEL, AND THE WHOLE POINT IS THAT IT COULD NOT BE ONE. It imports
// the question keys and nothing else. There is no fetch per turn, no generation, no branching on
// what she wrote. SRT-Referral-Engine-BUILD-SPEC-v2.md, and the same rule review-assemble.ts is
// built around: a tool that REFORMATS what she typed is not what FTC 16 CFR Part 465 reaches; a
// tool that GENERATES review content is.
//
// ‼️ A GATE IS A BRANCH. IT IS NOT A SENTENCE SHE WROTE.
//
// The three yes/no questions decide WHICH question is asked next. Their answers have no key in
// ReviewQuestion, so a "Yes" is not assignable to ReviewAnswers, cannot become a bullet, cannot
// be stored by the submit route and cannot reach the clipboard. That is enforced by the type
// system first and by scripts/_probe-review-gating.ts second. A chip whose text lands in her
// review is us writing review content with a nicer tap target, which is the thing this tool
// exists not to do.
//
// ‼️ AND A GATE ROUTES FORWARD OR NOT AT ALL. `onNo` is typed `null` and accepts no other value.
// The failure this is built against is somebody turning a "No" into a route to the private note
// box, which is the review gating funnel rebuilt with a word instead of a number, and which the
// rating probe would never see because there is no rating anywhere in it. Changing that needs a
// change to the type, which is an argument somebody has to have out loud.
//
// ===============================================================================================
// ‼️ v5 (2026-10-05) IS THE IN-CLINIC WALK, AND IT REVERSES TWO WRITTEN RULES ON MATTHEW'S CALL.
//
// Until now this was a solo, at-home flow: she took a card, scanned it that evening, and nobody
// from the clinic was involved. v5 is answered AT THE COUNTER with the front desk beside her, and
// the order is Matthew's, 2026-10-05: what she got, who treated her, the stars, would she
// recommend us, and to whom. Only then the review questions.
//
// The two reversals, recorded here because the comments they contradict are still in the files
// they belong to and a reader deserves to find out why:
//
//   1. review-assemble.ts said "NOT ASKED, EVER: who treated her, whether she would recommend".
//      Both are now asked. The ban existed because an NPS question in front of a review is the
//      classic pre-screen, so the MITIGATION IS THE WHOLE POINT: `refer` routes the REFERRAL and
//      nothing else. A Yes and a No reach the identical review questions, the identical editable
//      box, the identical copy button and the identical destination links. _probe-review-gating.ts
//      asserts that, and it is the reason this is a reversal of the wording and not of the rule.
//
//   2. review-card.ts said "no staff names". `q_provider` is a staff name and it DOES reach the
//      review text, which is Matthew's decision of 2026-10-05 against Google's prohibition on a
//      merchant soliciting specific review content. Recorded as his, not inherited as ours.
//
// ‼️ WHAT WAS NOT REVERSED, AND MUST NOT BE. The offer in the `invite` step is consideration
// for a REFERRAL, never for a review. It goes to the FRIEND, it is shown BEFORE she has written a
// word of her review, and it is not conditional on her posting anything. No line of copy in this
// file or any other may tie it to leaving a review. client-intake.ts's `incentive` question still
// exists and still flags offering anything for a review, because that is still a different thing
// and still a problem.
// ===============================================================================================

import type { ReviewQuestion } from "./review-assemble";

/**
 * How long the handover sits on screen before the agent speaks.
 *
 * ‼️ IT SAYS WHAT IT IS DOING AND NOTHING MORE. Matthew asked for "waiting for a Customer Success
 * Specialist to find the file". Nobody is looking for a file, and a page that tells a customer a
 * member of staff is doing something for her while she waits is a claim we cannot make. The pause
 * is real, it is here so the agent arriving reads as somebody joining rather than a page
 * navigating, and the line describes the pause itself. Same rule as the typing dots: the waiting
 * state never claims something is happening.
 */
export const CONNECTING_MS = 5000;
export const CONNECTING_LINE = "Connecting you with the Virtual Agent";

/** What the agent is called, everywhere, to everyone. */
export const AGENT_NAME = "Virtual Agent";

/**
 * The token a script line may carry, replaced with the business name at render.
 *
 * A placeholder rather than a template literal so that no string in REVIEW_SCRIPT contains a
 * substitution of its own. The probe asserts that: a dollar-brace inside a scripted line is one
 * edit away from interpolating HER ANSWER into what the agent says back, and an agent quoting her
 * words to her is the shape of a tool that then offers to improve them.
 */
export const BUSINESS_TOKEN = "{business}";

export function fillBusiness(text: string, businessName: string): string {
  return text.split(BUSINESS_TOKEN).join(businessName);
}

/**
 * The offer token, replaced with the referral deal for the service she named.
 *
 * ‼️ A TOKEN AND NOT A TEMPLATE LITERAL, for the reason above, and ‼️ THE DEAL IS NEVER WRITTEN
 * HERE. It is the clinic's, one per service, set on the onboarding call and stored in
 * client_service_offers. "80% off the first month, then $299" is one clinic's example and has no
 * business being a constant in our bundle: a figure typed here would be a price we invented
 * appearing in a message a patient sends to her friend.
 */
export const OFFER_TOKEN = "{offer}";

export function fillOffer(text: string, offer: string): string {
  return text.split(OFFER_TOKEN).join(offer);
}

/**
 * What SHE gets, and the one sentence in this file that is about her rather than her friend.
 *
 * ‼️ "ONCE THEY BOOK" IS NOT SOFTENING, IT IS THE LEGAL POSITION IN FIVE WORDS. Matthew asked
 * for a two-sided deal on 2026-10-05 ("refer a friend for 20% off on your next session and the
 * friend gets 20% off also"), which puts the person writing a review inside the transaction for
 * the first time. What keeps that an ordinary refer-a-friend programme is that her reward turns
 * on an event she does not control and that has nothing to do with the review: the friend
 * claiming. Offer it for the referral itself and it is still defensible; offer it for the review
 * and it is an incentivised review with an undisclosed material connection.
 *
 * ‼️ RENDERED ONLY WHEN THE CLINIC ACTUALLY OFFERS HER SOMETHING. Plenty will only reward the
 * friend. An empty reward must produce no sentence at all rather than a line with a hole in it.
 */
export const REWARD_TOKEN = "{reward}";

export const INVITE_REWARD_LINE = "You get {reward} once they book.";

export function fillReward(text: string, reward: string): string {
  return text.split(REWARD_TOKEN).join(reward);
}

export type ScriptStep =
  /** The agent talking. Fixed copy, identical for every client. */
  | { kind: "say"; id: string; text: string }
  /** A question whose answer is hers, and becomes one line of the review. */
  /**
   * A question whose answer is hers, and becomes one line of the review.
   *
   * `placeholder` is grey text in the box she types into. Matthew, 2026-10-05: she needs to see
   * that she can start typing, and roughly what a usable answer looks like.
   *
   * ‼️ IT IS A PLACEHOLDER AND NEVER A DEFAULT VALUE, which is the whole difference between a
   * prompt and a draft. It is not in the box, it cannot be submitted, and an empty answer stays
   * empty. The moment it became prefilled text she could simply send, this tool would be
   * generating review content she did not write, which is the Rytr fact pattern.
   *
   * `skipLabel` replaces the generic "Skip this one" where a specific phrasing is kinder. "I was
   * not concerned about anything" is a real answer to the question and it stores NOTHING, which
   * is exactly what the generic skip already did; it just reads like a person wrote it.
   */
  | {
      kind: "ask";
      id: string;
      key: ReviewQuestion["key"];
      prompt: string;
      placeholder?: string;
      skipLabel?: string;
    }
  /**
   * A yes/no question. Its answer is a branch and is never stored.
   *
   * `onYes` names the ask that follows it, which must be the VERY NEXT STEP. A No therefore skips
   * exactly that one step. Keeping the relationship positional rather than arbitrary means a
   * reader can see where a No goes by looking at the array, and the probe can check it.
   */
  | { kind: "gate"; id: string; prompt: string; yes: string; no: string; onYes: string; onNo: null }
  /**
   * The one-to-five rating, asked in the walk rather than on a screen before it.
   *
   * ‼️ IT HAS NO KEY AND IT DECIDES NOTHING. It moved into the walk on 2026-10-05 only because
   * Matthew's order puts it third; the rule it looks like it breaks has never been about WHERE the
   * stars are asked, it has been about whether the value routes. It does not. Every value 1
   * through 5 reaches the same next step, the same questions, the same box and the same links.
   */
  | { kind: "stars"; id: string; prompt: string }
  /**
   * "Would you recommend this service to a friend?"
   *
   * ‼️ SHAPED LIKE A GATE AND KEPT A SEPARATE KIND ON PURPOSE. It carries `onNo: null` for exactly
   * the reason `gate` does, so a No can only ever count forward past the invite. It is not a
   * `gate` because a `gate` guards an `ask` whose answer becomes review text, and this one guards
   * an `invite` whose answers must never go near the review. Folding the two together would put
   * the friend's name one type-widening away from the clipboard.
   */
  | { kind: "refer"; id: string; prompt: string; yes: string; no: string; onYes: string; onNo: null }
  /**
   * Who she would send our way, and the message that goes to them.
   *
   * ‼️ NOTHING THIS STEP COLLECTS IS A ReviewQuestion KEY, so none of it is assignable to
   * ReviewAnswers, iterable into a bullet, or reachable from the copy buffer. The friend's name
   * and contact are a THIRD PARTY'S details and they do not go in review_tool_submissions at all;
   * they go to referral_invites. See src/lib/hub/referral-invite.ts.
   */
  | { kind: "invite"; id: string; prompt: string };

/**
 * The walk, in order. Matthew's order, 2026-10-05.
 *
 * Read it top to bottom and that is the conversation at the counter. The service and the provider
 * come first because the front desk is standing there and the provider question is the reason she
 * is handed the card at all ("you might need my help with that third one"). The referral is
 * settled while she is still at the desk. The review questions come after, and they are the same
 * questions this tool has always asked.
 */
export const REVIEW_SCRIPT: ScriptStep[] = [
  {
    kind: "say",
    id: "greeting",
    text: "Hi, I am the Virtual Agent for {business}. A few short questions about your visit, and you can skip any of them.",
  },
  {
    kind: "ask",
    id: "q_service",
    key: "service",
    prompt: "What service did you get done with us?",
    // ‼️ A NOUN, BECAUSE assembleLead() PUTS IT MID-SENTENCE. "Got lip filler with Sarah today."
    // The placeholder is where she learns that, and it is cheaper than a rule in the assembler.
    placeholder: "Lip filler",
  },

  { kind: "say", id: "ack_service", text: "Thank you." },
  {
    // The front desk's opening. Whoever is on the desk asks "who took care of you?" out loud,
    // says she might want a hand with it, and hands over the card. It is a real question with a
    // real answer and it is also the choreography.
    //
    // ‼️ A NAME IS THE RIGHT ANSWER, BECAUSE assembleLead() CONSUMES IT INTO A SENTENCE.
    // "Got {service} with {provider}." is the opening line of the review, so "Sarah" lands
    // mid-sentence instead of becoming the bullet `Sarah.` Keep this prompt identical to
    // REVIEW_QUESTIONS_V5's: the printed card is derived from this one.
    kind: "ask",
    id: "q_provider",
    key: "provider",
    prompt: "Who took care of you today?",
    placeholder: "Sarah",
    skipLabel: "I would rather not say",
  },

  { kind: "stars", id: "q_stars", prompt: "How would you rate your visit?" },

  {
    kind: "refer",
    id: "refer_gate",
    prompt: "Would you recommend this service to a friend?",
    yes: "Yes",
    no: "No",
    onYes: "invite",
    onNo: null,
  },
  {
    // ‼️ THE PROMPT NAMES THE FRIEND'S DEAL ONLY. Hers, when she has one, is appended from
    // INVITE_REWARD_LINE by the component, because a clinic that rewards only the friend must not
    // be made to render half a sentence about a reward that does not exist.
    kind: "invite",
    id: "invite",
    prompt: "Who would you recommend us to? They get {offer}.",
  },

  {
    // ‼️ THIS LINE HAS TO WORK ON THREE PATHS, WHICH IS WHY IT THANKS HER FOR NOTHING.
    // It is reached after a Yes and an invite, after a No (stepAfter counts past the invite onto
    // this step), and on a clinic with no deals at all, where the driver skips the two referral
    // steps and lands here. It read "That means a lot. Now your review..." first, which is warm
    // after a Yes and tone deaf after a No. A line that reports where she is in the walk is true
    // on all three; a line that reacts to her answer would need the answer, and the answer is a
    // branch we deliberately do not keep.
    kind: "say",
    id: "ack_refer",
    text: "Now your review, in your own words.",
  },
  {
    kind: "ask",
    id: "q_liked",
    key: "liked",
    prompt: "What did you like about our experience the most?",
    // Matthew's own example, and it does two jobs: it shows the sentence SHAPE ("I loved...") so
    // her answer reads on from the lead line, and it shows the level of detail that makes a
    // review quotable. It is grey text she types over, never a draft she can send.
    placeholder: "I loved how natural it looks, nobody could tell",
  },

  { kind: "say", id: "ack_liked", text: "Good to hear." },
  {
    kind: "ask",
    id: "q_improve",
    key: "improve",
    // Asked of everybody, not only of somebody who scored low. A question about what could be
    // better that is only put to unhappy customers is a sorting mechanism.
    prompt: "What did you not like about our experience? It helps us improve.",
    placeholder: "Honestly nothing, the wait was short",
    skipLabel: "Nothing I can think of",
  },

  { kind: "say", id: "ack_improve", text: "That is useful, and it is the part we act on." },
  {
    kind: "gate",
    id: "gate_expectations",
    prompt: "Did you have any expectations before you came in?",
    yes: "Yes",
    no: "No",
    onYes: "q_expectations",
    onNo: null,
  },
  {
    kind: "ask",
    id: "q_expectations",
    key: "expectations",
    prompt: "What were they?",
    placeholder: "I expected it to take a few visits",
    skipLabel: "Nothing specific",
  },

  {
    kind: "gate",
    id: "gate_concerns",
    prompt: "Were you concerned about anything before working with {business}?",
    yes: "Yes",
    no: "No",
    onYes: "q_concerns",
    onNo: null,
  },
  {
    kind: "ask",
    id: "q_concerns",
    key: "concerns",
    prompt: "Tell us about it.",
    placeholder: "I was worried it would look overdone",
    // ‼️ THE SKIP THAT MATTHEW ASKED FOR BY NAME, and it stores nothing, exactly as the
    // generic skip did. She has already said Yes to the gate by the time she is here, so the
    // honest escape is one that lets her change her mind without typing an apology.
    skipLabel: "I was not concerned about anything",
  },

  {
    kind: "gate",
    id: "gate_fears",
    prompt: "Were you afraid of something happening before coming in?",
    yes: "Yes",
    no: "No",
    onYes: "q_fears",
    onNo: null,
  },
  {
    kind: "ask",
    id: "q_fears",
    key: "fears",
    prompt: "Tell us about it.",
    placeholder: "I was afraid it would hurt",
    skipLabel: "I was not afraid of anything",
  },

  { kind: "say", id: "closing", text: "That is everything. Here are your own words, back." },
];

/** Every gate id. Used by the probe to prove none of them is also an assembled question key. */
export const GATE_IDS: string[] = REVIEW_SCRIPT.filter((s) => s.kind === "gate").map((s) => s.id);

/**
 * Every step whose answer must never become review text: the stars, the recommend question and
 * the invite.
 *
 * ‼️ EXPORTED FOR THE PROBE, which asserts that not one of these ids is a ReviewQuestion key and
 * that none of what they collect survives assemblePlain(). Three kinds that each hold something
 * the clipboard must never see: a number, the word "Yes", and somebody else's phone number.
 */
export const NON_REVIEW_IDS: string[] = REVIEW_SCRIPT.filter(
  (s) => s.kind === "stars" || s.kind === "refer" || s.kind === "invite"
).map((s) => s.id);

/**
 * What she is asked, in order, for anything that has to READ ON ITS OWN.
 *
 * ‼️ THIS IS NOT REVIEW_QUESTIONS_V5, AND PRINTING THAT INSTEAD WOULD BE NONSENSE ON CARD STOCK.
 * Three of those are FOLLOW-UPS: "What were they?" and "Tell us about it." twice. On screen
 * they arrive after she has already said Yes and they read as somebody listening. In a numbered
 * list on the back of a card at a clinic counter they read as a bug. So a gate stands in for the
 * pair it guards: "Did you have any expectations before you came in?" is the question she is
 * actually asked, and the follow-up only exists if she says yes.
 *
 * ‼️ DERIVED FROM THE WALK, NEVER RETYPED. The printed card is the one surface that cannot be
 * redeployed: a stack of it sits on a counter for months. A hand-kept copy of the questions is a
 * copy that drifts, and the drift is discovered by a customer reading one thing on paper and being
 * asked another on her phone. Change the script and the card follows in the same commit.
 *
 * ‼️ THE STARS, THE RECOMMEND QUESTION AND THE INVITE ARE EXCLUDED, AND NOT BY ACCIDENT. Only
 * `ask` and `gate` steps are read below, so the three v5 kinds cannot reach card stock:
 *
 *   - A rating printed on paper is a pre-screen. On screen it routes nothing and the probe proves
 *     it; on card stock there is nothing to prove it with. This is the same reasoning that kept
 *     the stars off the card when they were added on 2026-09-04, and it did not change when they
 *     moved into the walk.
 *   - An OFFER printed on the card would be the clinic promising a discount to every person who
 *     is handed one, months after the deal changed, with no way to withdraw it.
 */
export const CARD_QUESTIONS: string[] = (() => {
  const guarded = new Set(
    REVIEW_SCRIPT.filter((s): s is Extract<ScriptStep, { kind: "gate" }> => s.kind === "gate").map(
      (s) => s.onYes
    )
  );
  const out: string[] = [];
  for (const step of REVIEW_SCRIPT) {
    if (step.kind === "gate") out.push(step.prompt);
    else if (step.kind === "ask" && !guarded.has(step.id)) out.push(step.prompt);
  }
  return out;
})();

/**
 * How many questions the opening card promises, as a word.
 *
 * ‼️ DERIVED FROM CARD_QUESTIONS, NEVER TYPED, AND onboarding2 CARRIES THE SCAR. Its intro read
 * "Six questions" while the array held seven, which its own comment calls "a small lie told at the
 * exact moment somebody has just signed something". The same number is printed on card stock, so
 * a hand-kept copy would also be the screen and the card disagreeing.
 *
 * Spelled out rather than rendered as a digit because it sits in a sentence on a page a patient
 * reads, and falls back to the digit past twelve rather than inventing more words than the design
 * will ever need.
 */
const NUMBER_WORDS = [
  "Zero", "One", "Two", "Three", "Four", "Five", "Six",
  "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
];

export const QUESTION_COUNT_WORD: string =
  NUMBER_WORDS[CARD_QUESTIONS.length] ?? String(CARD_QUESTIONS.length);

/**
 * The step after `index`, given how a gate or the recommend question at `index` was answered.
 *
 * ‼️ IT ONLY EVER COUNTS FORWARD. A No skips the one step the branch guards; a Yes walks into it.
 * There is no destination, no lookup and no table, so there is nowhere for a "somewhere else" to
 * be added without this becoming a different function. `refer` is handled beside `gate` and not
 * instead of it: a No to "would you recommend us" skips the invite and lands on the review
 * questions, which is the same place a Yes lands once the invite is done.
 */
export function stepAfter(index: number, saidYes: boolean): number {
  const step = REVIEW_SCRIPT[index];
  if ((step?.kind === "gate" || step?.kind === "refer") && !saidYes) return index + 2;
  return index + 1;
}
