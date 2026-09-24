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
 * substitution of its own. The probe asserts that: a `${` inside a scripted line is one edit away
 * from interpolating HER ANSWER into what the agent says back, and an agent quoting her words to
 * her is the shape of a tool that then offers to improve them.
 */
export const BUSINESS_TOKEN = "{business}";

export function fillBusiness(text: string, businessName: string): string {
  return text.split(BUSINESS_TOKEN).join(businessName);
}

export type ScriptStep =
  /** The agent talking. Fixed copy, identical for every client. */
  | { kind: "say"; id: string; text: string }
  /** A question whose answer is hers, and becomes one line of the review. */
  | { kind: "ask"; id: string; key: ReviewQuestion["key"]; prompt: string }
  /**
   * A yes/no question. Its answer is a branch and is never stored.
   *
   * `onYes` names the ask that follows it, which must be the VERY NEXT STEP. A No therefore skips
   * exactly that one step. Keeping the relationship positional rather than arbitrary means a
   * reader can see where a No goes by looking at the array, and the probe can check it.
   */
  | { kind: "gate"; id: string; prompt: string; yes: string; no: string; onYes: string; onNo: null };

/**
 * The walk, in order.
 *
 * Read it top to bottom and that is the conversation. Every customer who answers Yes to all three
 * gates sees nine bubbles from the agent; every customer who answers No to all three sees six.
 * Both reach the same editable box, the same attestation, the same copy button and the same
 * destination links, because none of that is in this array.
 */
export const REVIEW_SCRIPT: ScriptStep[] = [
  {
    kind: "say",
    id: "greeting",
    text: "Hi, I am the Virtual Agent for {business}. A few short questions about your visit, and you can skip any of them.",
  },
  { kind: "ask", id: "q_service", key: "service", prompt: "What service did you get done with us?" },

  { kind: "say", id: "ack_service", text: "Thank you." },
  {
    kind: "ask",
    id: "q_liked",
    key: "liked",
    prompt: "What did you like about our experience the most?",
  },

  { kind: "say", id: "ack_liked", text: "Good to hear." },
  {
    kind: "ask",
    id: "q_improve",
    key: "improve",
    // Asked of everybody, not only of somebody who scored low. A question about what could be
    // better that is only put to unhappy customers is a sorting mechanism.
    prompt: "What did you not like about our experience? It helps us improve.",
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
  { kind: "ask", id: "q_expectations", key: "expectations", prompt: "What were they?" },

  {
    kind: "gate",
    id: "gate_concerns",
    prompt: "Were you concerned about anything before working with {business}?",
    yes: "Yes",
    no: "No",
    onYes: "q_concerns",
    onNo: null,
  },
  { kind: "ask", id: "q_concerns", key: "concerns", prompt: "Tell us about it." },

  {
    kind: "gate",
    id: "gate_fears",
    prompt: "Were you afraid of something happening before coming in?",
    yes: "Yes",
    no: "No",
    onYes: "q_fears",
    onNo: null,
  },
  { kind: "ask", id: "q_fears", key: "fears", prompt: "Tell us about it." },

  { kind: "say", id: "closing", text: "That is everything. Here are your own words, back." },
];

/** Every gate id. Used by the probe to prove none of them is also an assembled question key. */
export const GATE_IDS: string[] = REVIEW_SCRIPT.filter((s) => s.kind === "gate").map((s) => s.id);

/**
 * The step after `index`, given how a gate at `index` was answered.
 *
 * ‼️ IT ONLY EVER COUNTS FORWARD. A No skips the one ask the gate guards; a Yes walks into it.
 * There is no destination, no lookup and no table, so there is nowhere for a "somewhere else" to
 * be added without this becoming a different function.
 */
export function stepAfter(index: number, saidYes: boolean): number {
  const step = REVIEW_SCRIPT[index];
  if (step?.kind === "gate" && !saidYes) return index + 2;
  return index + 1;
}
