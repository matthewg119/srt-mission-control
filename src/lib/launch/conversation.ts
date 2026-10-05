// The onboarding conversation: one turn, from a message to executed work.
//
// ‼️ THIS IS A FRONT END ONTO THE LAUNCH LANE ENGINE. IT IS NOT A SECOND ENGINE.
// Every action below calls a function that already exists and already refuses for its own
// reasons. The steps, the verifiers, the two evidence tiers, the Day-0 wall and the publish gate
// are untouched: a tick earned here goes through setLaunchStep() and survives the same verifier a
// tick earned on the board does. If that stops being true, this file is the bug.
//
// ‼️ A CLOSED ACTION UNION, NOT A TOOL LOOP, AND THE CLOSEDNESS IS THE SAFETY.
// callClaudeJSON's `tools` are Anthropic SERVER-side tools; there is no client-side execution
// loop in this repository and this does not add a general one. The model returns a plan, the
// server executes a typed, closed list, and anything not on that list cannot be reached by any
// wording. Same posture as classifyHost(), HUB_SLUG and externalPathDecision(): deny by default,
// and widening it is an edit somebody has to make on purpose.
//
// ‼️ BUYING A DOMAIN IS DELIBERATELY ABSENT FROM THE UNION AND MUST STAY ABSENT.
// domain.ts rule 3: never called by a runner, a cron or a retry, only by a person pressing a button
// that showed them the price. It is the only code here that spends money, and a conversation is
// exactly the surface that should not be able to.
//
// ‼️ PUBLISHING WAS ALSO ABSENT UNTIL 2026-10-05 AND IS NOW HERE, ON MATTHEW'S EXPLICIT
// INSTRUCTION, after the trade-off was put to him in those words. He wants the whole onboarding
// driven from this chat and nothing else. What that removed is the SURFACE restriction, and only
// that. Every rail publishing has is inside publishPage() and is untouched:
//   - the Day-0 wall still refuses while clients.day_0_archived_at is null,
//   - the quality gate still refuses, and there is still no waiver on this surface,
//   - with more than one destination wired it still REFUSES rather than choosing, and the choice
//     comes back as a question he answers.
// So a publish started by typing is the same publish, with the same three ways to be told no. What
// is gone is "a conversation cannot start one". Do not quietly re-add a fourth rail here to
// compensate: the rails live in publishPage, one copy, for both lanes.

import { callClaudeJSON, callClaudeText, type ClaudeModel } from "@/lib/claude-calls";
import { hasBannedDash } from "@/lib/copy-guard";
import { supabaseAdmin } from "@/lib/db";
import {
  launchStepNumber,
  isLaunchStepKey,
  LAUNCH_DAY_ZERO_STEP_KEY,
} from "@/config/launch-steps";
import { launchBoard, setLaunchStep, isResolved } from "./steps";
import { refusalText, verdictDetail } from "./verify";
import { foundationStatus, FOUNDATION_LABELS, type FoundationKind } from "./documents";
import { proposeVocabulary, confirmVocabulary } from "./vocabulary";
import { proposeOfferFromDocument, confirmOffer, currentOffer } from "./offer";
import { searchDomains } from "./domain";
import { dnsFacts } from "./dns-facts";
import { slackLaneSummary } from "@/lib/clients/lane-summary";
import { publishingFacts } from "./publishing-facts";
import {
  LAUNCH_PAGE_ACTIONS,
  isLaunchPageAction,
  launchPagesState,
  pageRunText,
  runLaunchPagesAction,
} from "./pages";

const TURN_MODEL: ClaudeModel = "claude-sonnet-4-6";

/**
 * Below this, the actions are dropped and only the questions are shown.
 *
 * Matthew: "At 90 percent confidence, stop and ask. Do not act." Enforced here rather than asked
 * for in the prompt, because a number in a prompt is a suggestion and a number in a branch is not.
 */
const ACT_THRESHOLD = 0.9;

/** At most this many actions execute in one turn. A plan longer than this is a runaway. */
const MAX_ACTIONS_PER_TURN = 4;

// ─────────────────────────────────────────────────────────────────────────────
// The closed union
// ─────────────────────────────────────────────────────────────────────────────

export const ACTION_KINDS = [
  "propose_vocabulary",
  "confirm_vocabulary",
  "read_offer",
  "lock_offer",
  "search_domains",
  "hand_prompt",
  "complete_step",
  "skip_step",
  // ‼️ READ ONLY, AND IT BELONGS HERE FOR THE REASON search_domains DOES.
  // It resolves three names and writes what was SEEN. It cannot create a record, cannot spend
  // anything and cannot tick a step: recheckDnsRecords only ever writes observed/status onto
  // rows that already exist, and a name that does not resolve is deliberately left alone rather
  // than marked wrong. The alternative is the model telling him the DNS is fine because the
  // database still says `ready`, which is a claim nobody checked.
  "check_dns",
  // ‼️ READ ONLY, AND AN ACTION RATHER THAN ALWAYS-ON CONTEXT. Matthew, 2026-10-04, asked for the
  // chat to be able to quote the four foundation documents. They are 16k, 20k and 23k characters
  // on SRT alone, so loading them every turn would crowd out the board, both keyword pools and the
  // DNS, and make it answer worse about everything to answer better about one thing. As an action
  // the model asks for the one it needs, which is the same shape search_domains and check_dns use.
  "read_document",
  // ‼️ READ ONLY. Where the page run stands: what is planned, which pages still want a headline or
  // a skeleton, how many have a body, and what the next stage is. It belongs as an action rather
  // than always-on context for the reason read_document does: it is several reads and a model-free
  // gate check, and most turns are not about pages.
  "read_pages",
  // ‼️ ONE ACTION WITH A `stage`, NOT FOURTEEN FLAT ENTRIES, AND THE REASON IS THE ORDER.
  // The stages run plan, approve, headlines, a pick each, skeletons, research, draft, and the whole
  // difficulty of this lane is that they cannot be done out of order: `plan approve` stopped
  // drafting on 2026-09-14 precisely so every decision lands before a page is written. A single
  // action whose argument is an ordered list teaches that order; fourteen siblings in a prompt
  // teach nothing and invite the model to reach for the last one. The server refuses an
  // out-of-order stage anyway, off the same readBatch the Slack thread refuses on.
  "run_pages",
  // ‼️ ITS OWN KIND RATHER THAN A run_pages STAGE, BECAUSE IT USED TO BE FORBIDDEN HERE.
  // See the note at the top of this file. Giving it a name of its own keeps it visible in the
  // prompt, in the results and in this list, instead of hiding the one genuinely irreversible
  // thing in the lane inside a generic verb.
  "publish_page",
  "unpublish_page",
] as const;

export type ActionKind = (typeof ACTION_KINDS)[number];

/**
 * The stages `run_pages` accepts: every page action except the two that publish.
 *
 * Derived from the action layer rather than retyped, so a stage added there is offered here and a
 * stage renamed there cannot go stale here.
 */
const PAGE_RUN_STAGES: readonly string[] = LAUNCH_PAGE_ACTIONS.filter(
  (a) => a !== "publish" && a !== "unpublish"
);

export interface LaunchAction {
  kind: ActionKind;
  stepKey?: string;
  reason?: string;
  /** lock_offer */
  whatIsSold?: string;
  promise?: string;
  /** search_domains */
  domains?: string[];
  /** hand_prompt, and read_document: which document to open. */
  which?: string;
  /** run_pages: which stage of the page run. One of PAGE_RUN_STAGES. */
  stage?: string;
  /** run_pages: which planned page, by the rank the plan shows. */
  rank?: number;
  /** run_pages stage=headline_pick: which of the three candidates, 1 to 3. */
  pick?: number;
  /** run_pages stage=ladder_pick: the rung, 5 (furthest from buying) to 1. */
  rung?: number;
  /** run_pages: a title, a CTA sentence, or the pasted research answer. */
  text?: string;
  /** keywords_select and keywords_unselect: phrases exactly as the pool spells them. */
  phrases?: string[];
  /** strategy_set: the pillar phrase, and the supports under it. */
  pillar?: string;
  supports?: string[];
  /** keywords_add: the cluster the new phrases join. */
  category?: string;
  /** publish_page: which page, by the rank the plan shows. */
  destinationId?: string;
}

export interface ActionResult {
  kind: string;
  ok: boolean;
  detail: string;
  /** A prompt for Matthew to run elsewhere. Rendered as a copy block, never executed here. */
  prompt?: string;
}

export interface TurnResult {
  say: string;
  asks: string[];
  results: ActionResult[];
  /** True when confidence was under the bar and the plan was dropped rather than run. */
  heldBack: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// What the model is allowed to see
// ─────────────────────────────────────────────────────────────────────────────

export interface BoardContext {
  text: string;
  /** Step keys that are legal to act on this turn. The model picks from this and never invents. */
  candidates: string[];
}

/**
 * The board, the documents, the audience and the offer, as text.
 *
 * ‼️ THE CANDIDATE SET IS COMPUTED HERE AND IS THE ONLY THING AN ACTION MAY NAME.
 * nextLaunchStep() returns the first unresolved step, which is a fixed march; Matthew asked for
 * adaptive. So every unsettled step whose blockers are resolved is offered, the model picks one
 * and says why, and a key outside the set is refused by executeAction rather than trusted.
 */
export async function boardContext(clientId: string): Promise<BoardContext> {
  const [board, docs, offer, dns, slack, publishing, pageRun] = await Promise.all([
    launchBoard(clientId),
    foundationStatus(clientId),
    currentOffer(clientId),
    // ‼️ ON EVERY TURN, NOT ONLY ON A DNS TURN. Nothing here knows what he is about to ask, and
    // the failure this prevents is a confident invented answer rather than a missing one. It is
    // four cheap reads and one nameserver lookup; see dns-facts.ts for why it never resolves the
    // records themselves.
    dnsFacts(clientId).catch(() => null),
    // ‼️ THE OTHER BOARD, BECAUSE A CLIENT CAN BE ON BOTH AND SRT IS. Without it this answered
    // "there is no step 21, the board ends at step 17", which is true of THIS lane and false about
    // the client being asked about. See lib/clients/lane-summary.ts for why the import is allowed.
    slackLaneSummary(clientId).catch(() => null),
    publishingFacts(clientId).catch(() => null),
    // ‼️ ON EVERY TURN, BECAUSE "0 pages" AND "nothing has started" ARE DIFFERENT FACTS.
    // publishingFacts counts client_pages, which is empty until drafting, so seven rows waiting in
    // page_plan were invisible and the chat answered "no page run has started yet" over them.
    // Measured on SRT, 2026-10-05. See pageRunText's own header.
    pageRunText(clientId).catch(() => null),
  ]);

  const byKey = new Map(board.map((e) => [e.step.key, e]));
  const candidates: string[] = [];

  const lines = board.map((e) => {
    const status = e.row?.status ?? "pending";
    const settled = isResolved(status);
    const blockers = (e.step.blockedBy ?? []).filter((b) => !isResolved(byKey.get(b)?.row?.status));
    if (!settled && blockers.length === 0) candidates.push(e.step.key);

    const mark = settled ? (status === "skipped" ? "skipped" : "done") : status;
    const why = e.row?.verified_detail ? ` (${e.row.verified_detail})` : "";
    const blocked = blockers.length ? ` [waiting on: ${blockers.join(", ")}]` : "";
    return `  ${e.number}. ${e.step.key} — ${e.step.label}: ${mark}${why}${blocked}`;
  });

  const docLines = (docs ?? []).map((d) => {
    const label = FOUNDATION_LABELS[d.kind as FoundationKind] ?? d.kind;
    return `  ${d.kind} (${label}): ${d.present ? "present" : "MISSING"}`;
  });

  const offerLine = offer
    ? `what is sold: ${offer.treatment ?? "not set"}; the promise: ${offer.outcomePromise ?? "not set"}; locked: ${offer.lockedAt ? "yes" : "no"}`
    : "no offer row";

  return {
    candidates,
    text: [
      "THE BOARD:",
      ...lines,
      "",
      "THE FOUR FOUNDATION DOCUMENTS:",
      ...(docLines.length ? docLines : ["  none recorded"]),
      "",
      `THE OFFER: ${offerLine}`,
      "",
      dns ? dns.text : "THE DNS: could not be read just now. Say that rather than answering from memory.",
      "",
      publishing ? publishing.text : "PUBLISHING: could not be read just now. Say so rather than guessing.",
      "",
      pageRun ?? "THE PAGE RUN: could not be read just now. Say so rather than guessing.",
      "",
      slack?.present
        ? slack.text
        : "THE SLACK BOARD: this client is not on it. Only the steps above exist for them.",
      "",
      `STEPS YOU MAY ACT ON THIS TURN: ${candidates.length ? candidates.join(", ") : "none"}`,
    ].join("\n"),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The system prompt
// ─────────────────────────────────────────────────────────────────────────────

function systemPrompt(ctx: BoardContext, clientName: string): string {
  return [
    `You are running the onboarding for ${clientName} with Matthew, who owns the agency.`,
    "He is the only person who will ever read you. He is terse and he is fast.",
    "",
    "HOW TO TALK:",
    "- Short by default: two or three lines and the next action. He asks when he wants the long",
    "  version, and ANSWERING below says what to do when he does.",
    "- One line of context saying what you need and why, then the ask. Never more.",
    "- Never explain unless he asks. When he does ask, answer properly: see ANSWERING below.",
    "- Batch your questions. He answers several at once by recording one voice note and pasting",
    "  the transcript back, so ask everything you need in one go and accept answers in any order.",
    "- Never use an em dash or an en dash. Use a comma or a full stop. This is a hard rule.",
    "- He may be pasting one big blob: a call transcript, a Reddit thread, a sales page, a voice",
    "  note. Pull every field you can out of it and say which ones you filled.",
    "- If something he says is malformed, correct it and say that you did. Never silently.",
    "- You may recommend and you may push back once. What he says is the default and wins.",
    "",
    "WHAT YOU MAY DO:",
    "- Return a plan of actions. The server executes them; you do not.",
    "- You may only name a step from the list of steps you may act on. Never invent a step key.",
    "- You may NOT buy a domain. There is no action for it, because it spends money that cannot be",
    "  taken back. Tell him to press the button on the board.",
    "- You MAY publish, with publish_page. It still goes through publishPage(), so the Day-0 wall,",
    "  the quality gate and the destination question all still apply and you cannot talk past any",
    "  of them. Never publish unless he asked for it in this turn or the one before.",
    "- You may change keywords and the strategy map, but ONLY when he says so in words. Never as a",
    "  tidy-up, never as a side effect of a question, and never a phrase he did not name.",
    "- Never touch the concierge without him saying yes in words.",
    `- If you are less than ${Math.round(ACT_THRESHOLD * 100)} percent sure, return no actions and ask instead.`,
    "- ‼️ THAT BAR DOES NOT APPLY TO complete_step, read_document, check_dns, search_domains or",
    "  read_offer. Those either prove themselves or change nothing: a tick runs the step's verifier",
    "  and is refused unless the database already supports it, and the rest are reads. Matthew asked",
    "  for act-then-tell-me, so when a step looks done, TICK IT and say what the verifier answered.",
    "  A skip is different and stays behind the bar: nothing verifies a skip, it is an assertion.",
    "",
    "THE JOB, AND EVERY ANSWER IS MEASURED AGAINST IT:",
    "- Get this client onboarded and their pages posted. That outcome IS the job. A step is worth",
    "  doing because it moves toward it, never because it is the next unticked row.",
    "- ‼️ WHAT IS ALREADY TRUE IS DONE, WHOEVER DID IT. The context shows what is on file: the",
    "  documents, the offer, the keywords, the evidence, the destinations, both boards. If a thing",
    "  he is asking about is already satisfied, say so and move to what is not. Never send him to",
    "  redo work the context shows finished, and never ask for something it already contains.",
    "- Lead with what is BLOCKING the outcome, not with what is incomplete. An unticked step nobody",
    "  needs is not a blocker; Day 0 is.",
    "- When a question is really a decision he is about to make, give him the material to make it",
    "  rather than a process for obtaining the material.",
    "",
    "THERE ARE TWO BOARDS AND THIS CLIENT MAY BE ON BOTH:",
    "- The LAUNCH board is the one you act on. Its steps are listed under THE BOARD and they are the",
    "  only keys you may ever name in an action.",
    "- The SLACK board is the 41-step delivery lane, worked in the client's own Slack channel. When",
    "  the context shows one, this client is on it too, and its numbering is its own: step 21 there",
    "  is a real step even though this board ends earlier.",
    "- ‼️ NEVER SAY A STEP DOES NOT EXIST BECAUSE IT IS NOT ON YOUR BOARD. Look at both lists. If he",
    "  names a number you cannot find, say which board you looked at rather than correcting him.",
    "- The two lanes share ALL the data: one set of keywords, documents, pages, evidence and",
    "  destinations. They differ only in how the work is driven. So work done in Slack is real here",
    "  and the reverse, and you must never tell him to redo something the other board already shows",
    "  as done.",
    "- You cannot tick a Slack step. Tell him which thread to type in.",
    "",
    "ANSWERING A QUESTION:",
    "- A question is a turn too. He may ask how something works, what a step means, what is left,",
    "  why something is refusing, or how to do a piece of setup. Answer it. Returning no actions",
    "  and only prose is a complete and correct turn.",
    '- When he asks for a step by step, give the steps, numbered, in order. The "one line, never',
    '  more" rule above is about not padding an ASK. It is not a word limit on an answer he asked',
    "  for. Do not make him ask twice for detail he already requested.",
    "- Answer from the context below and from how this product actually works. Everything under THE",
    "  BOARD, THE DNS and THE OFFER was read out of the database or observed moments ago.",
    "- ‼️ NEVER INVENT A VALUE. Hostnames, CNAME targets, record types, registrar screens, step",
    "  names, step numbers and COUNTS come out of the context or you do not say them. If the thing",
    "  he asked about is not in the context, say which part you do not have and what would get it.",
    "  A confident wrong DNS record costs him an hour and he cannot tell it is wrong by reading it.",
    "- ‼️ DO NOT OPEN WITH A CORRECTION UNLESS THE CONTEXT PROVES HIM WRONG. Three times on",
    "  2026-10-03 this began \"two corrections before answering\" and all of them were wrong: it",
    "  quoted the approved keyword pool at him when he meant the selected one, denied a step that",
    "  exists on the other board, and invented a blocker. Check both boards and both pools first,",
    "  and if he is right, just answer.",
    "- Keyword counts: PUBLISHING below carries two numbers and they answer different questions.",
    "  \"How many keywords\" in the context of pages means the SELECTED pool.",
    "- ‼️ THE SELECTED KEYWORDS ARE LISTED IN FULL, BY NAME, UNDER PUBLISHING. You have them. Asked",
    "  for them, print them. Saying you only have a count, or offering a prompt to reconstruct a",
    "  list that is already in front of you, is the single worst answer available: it sends him to",
    "  fetch something he already gave you.",
    "- Blockers come from the [waiting on: ...] markers, never from what sounds plausible.",
    "- The DNS block separates what somebody SAID from what the resolver SAW. Keep them separate",
    "  when you answer. If he wants to know whether it is live, use check_dns and answer from that,",
    "  rather than reading the stored status out as though it were observed.",
    "- Say the value and where it goes. The host box takes the label, never the full name: typing",
    "  the full name into a registrar creates learn.example.com.example.com, and it is the single",
    "  most common way this goes wrong.",
    "",
    "THE PROMPT MECHANIC, WHICH MATTERS MORE THAN ANYTHING ELSE YOU DO:",
    "- You do not do research. You hand him a prompt he runs in a separate session and pastes back.",
    '- Use the hand_prompt action with which="avatar_chain" when the four documents are not in hand.',
    "- Page copy ALWAYS goes through a research prompt first. Never draft it from nothing.",
    "",
    "THE PAGE RUN, WHICH IS HOW A KEYWORD BECOMES A LIVE PAGE:",
    "- ‼️ THE ORDER IS THE WHOLE DIFFICULTY AND IT CANNOT BE SHORTCUT. Approving the plan STOPPED",
    "  drafting on 2026-09-14, on purpose, so that every decision lands before a word is written:",
    "    plan_new -> plan_approve -> headlines_write -> headline_pick (one per page)",
    "    -> skeletons_write -> research_prompt -> research_file -> draft_wave -> publish_page",
    "  client_pages rows, the only thing publishable, appear at draft_wave and not before.",
    "- Run ONE stage per turn and say what came back. Do not chain the whole run in one plan: each",
    "  stage is a decision he may want to look at, and several of them are model calls.",
    "- headline_pick needs rank and pick. Every page needs its own pick before skeletons_write.",
    "- research_prompt hands back a prompt. He runs it elsewhere and pastes the answer, and you file",
    "  that with research_file and text. You never do the research yourself.",
    "- draft_wave writes one pass and tells you how many are left. If any are left, say so and offer",
    "  to run it again. That is the design, not a failure: a page with a body is never rewritten.",
    "- Before the plan exists, the strategy map is what to talk about: one pillar and six supports,",
    "  listed under PUBLISHING. Changing them with strategy_set changes every page that follows, so",
    "  re-propose the plan after.",
    "- ‼️ THE PAGES ARE NOT THE PLAN'S TITLES. plan_new writes a working title per page off the",
    "  keyword. If he says he does not recognise a title, that is the title being new, not the",
    "  keyword being wrong: read_pages shows which keyword each page aims at, and the keywords came",
    "  from his own picks. Check before agreeing something was invented.",
    "",
    "THE ACTIONS:",
    "  propose_vocabulary   read the documents and propose the words. No arguments.",
    "  confirm_vocabulary   only after he has seen a proposal and agreed.",
    "  read_offer           read the offer out of the short offer document.",
    "  lock_offer           needs whatIsSold and promise, in his words.",
    "  search_domains       needs domains: an array of names. Free and read only.",
    "  hand_prompt          needs which. Returns a prompt for him to run elsewhere.",
    "  complete_step        needs stepKey. It runs the verifier and may refuse.",
    "  skip_step            needs stepKey and reason.",
    "  read_document        needs which: deep_research, avatar_sheet, short_offer,",
    "                       necessary_beliefs, sales_letter or awareness_ladder. Free and read",
    "                       only. Use it before answering anything about the avatar, the offer,",
    "                       the beliefs or what a lead magnet should be: quoting the document",
    "                       beats describing it, and you can open it in the same turn you answer.",
    "  check_dns            resolve the records and report what is actually live. No arguments.",
    "                       Free and read only. Use it whenever he asks whether DNS is working,",
    "                       rather than reading the stored status back at him.",
    "  read_pages           where the page run stands: every planned page, the keyword it aims at,",
    "                       and what each one still needs. Free and read only. Use it before",
    "                       answering anything about the pages, and before publishing.",
    "  run_pages            needs stage, one of the stages listed above. Also takes rank and pick",
    "                       (headline_pick), rank (plan_drop, plan_swap, plan_edit, plan_cta),",
    "                       text (plan_edit, plan_cta, research_file), rung (ladder_pick),",
    "                       phrases (keywords_add, keywords_drop, keywords_select,",
    "                       keywords_unselect), category (keywords_add), and pillar plus supports",
    "                       (strategy_set).",
    "",
    "THE FOUR KEYWORD VERBS, WHICH ARE FOUR DIFFERENT DECISIONS. Do not use one for another:",
    "  keywords_add         MINTS phrases that do not exist yet, approves them and puts them in the",
    "                       page pool. Needs a category, which you propose from the ones already in",
    "                       use and he confirms. A phrase that is a marketing line rather than a",
    "                       search is stored as a hook and can never be a page's keyword.",
    "  keywords_drop        out of both pools AND remembered as unwanted, so a later expansion will",
    "                       not propose it again. This is what he means by remove.",
    "  keywords_select      puts an EXISTING approved phrase into the page pool. It cannot create",
    "                       one: a phrase that is not already in the pool is refused by name.",
    "  keywords_unselect    out of the page pool only. Still approved, still measured at Day 0.",
    "  publish_page         needs rank. Goes through publishPage(), so it can be refused three ways:",
    "                       Day 0 not archived, the quality gate, or more than one destination wired",
    "                       and none chosen. The last one is a QUESTION: it comes back with the list,",
    "                       you show him both and he picks, then you pass destinationId.",
    "  unpublish_page       needs rank. Taking a page down is never gated: it is the remedy.",
    "",
    ctx.text,
    "",
    `The Day-0 step (${LAUNCH_DAY_ZERO_STEP_KEY}) is a wall, not a checkbox. Nothing publishes until`,
    "it is ticked, and skipping it does not open it.",
  ].join("\n");
}

interface TurnPlan {
  say: string;
  asks: string[];
  actions: LaunchAction[];
  confidence: number;
}

function isTurnPlan(v: unknown): v is TurnPlan {
  const p = v as TurnPlan;
  return (
    !!p &&
    typeof p.say === "string" &&
    Array.isArray(p.asks) &&
    Array.isArray(p.actions) &&
    typeof p.confidence === "number"
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Executing one action
// ─────────────────────────────────────────────────────────────────────────────

async function executeAction(
  clientId: string,
  action: LaunchAction,
  candidates: string[],
  actor: string
): Promise<ActionResult> {
  const kind = action.kind;

  // ‼️ THE STEP KEY IS CHECKED AGAINST THE CANDIDATE SET BEFORE ANYTHING RUNS.
  // Not because setLaunchStep would do the wrong thing with a bad key (it refuses on an unknown
  // one), but because a key that is real and NOT a candidate means the model has reasoned its way
  // to a step whose blockers are unresolved, and the honest answer there is to say so rather than
  // let the verifier produce a confusing refusal about something else.
  if (kind === "complete_step" || kind === "skip_step") {
    const stepKey = (action.stepKey ?? "").trim();
    if (!stepKey) return { kind, ok: false, detail: "No step was named." };

    // ‼️ NARROWED THROUGH isLaunchStepKey RATHER THAN CAST. The cast compiles and is a lie: the
    // string came out of a model, so it can be anything, and launchStepNumber() on an unknown key
    // returns 0, which prints as "Step 0 refused" and sends somebody looking for a step that does
    // not exist. The runtime companion exists in launch-steps.ts for exactly this.
    if (!isLaunchStepKey(stepKey)) {
      return { kind, ok: false, detail: `${stepKey} is not a step on this board.` };
    }
    if (!candidates.includes(stepKey)) {
      return {
        kind,
        ok: false,
        detail: `${stepKey} is not available yet: something it waits on is unresolved.`,
      };
    }

    const res = await setLaunchStep({
      clientId,
      stepKey,
      transition: kind === "complete_step" ? "complete" : "skipped",
      skippedReason: kind === "skip_step" ? (action.reason ?? "Marked not applicable in the conversation") : null,
      actor,
    });

    if (!res.ok) {
      // ‼️ THE REFUSAL IS PASSED THROUGH WORD FOR WORD. refusalText() already says what was
      // checked, what was found and what to do. Paraphrasing it is how a board grows a second,
      // vaguer vocabulary for the same failure.
      const text = res.verdict ? refusalText(res.verdict) : (res.error ?? "It refused.");
      return { kind, ok: false, detail: `Step ${launchStepNumber(stepKey)} refused. ${text}` };
    }
    const detail = res.verdict ? verdictDetail(res.verdict) : "settled";
    return { kind, ok: true, detail: `Step ${launchStepNumber(stepKey)} ${stepKey}: ${detail}` };
  }

  if (kind === "propose_vocabulary") {
    const out = await proposeVocabulary(clientId);
    if (!out.ok) return { kind, ok: false, detail: out.error };
    const p = out.proposal;
    return {
      kind,
      ok: true,
      detail: [
        `from ${out.from}:`,
        `they are a ${p.buyerSingular}`,
        `they buy a ${p.offerSingular}`,
        `from a ${p.businessNoun}`,
        `booking a ${p.visitNoun}`,
        `the bot is called ${p.laneName}`,
        `the button says ${p.launcherLabel}`,
      ].join("; "),
    };
  }

  if (kind === "confirm_vocabulary") {
    // ‼️ IT RE-PROPOSES AND CONFIRMS THAT, RATHER THAN TAKING WORDS FROM THE MODEL'S OUTPUT.
    // confirmVocabulary writes the words a client's widget will speak. Letting a conversational
    // turn carry them means a typo in a chat message becomes what the concierge says on a live
    // domain. The proposal is deterministic for a preset vertical and re-read from the documents
    // otherwise, so this confirms something that was actually derived.
    const out = await proposeVocabulary(clientId);
    if (!out.ok) return { kind, ok: false, detail: `Nothing to confirm: ${out.error}` };
    const res = await confirmVocabulary({
      clientId,
      proposal: out.proposal,
      from: out.from,
      presetKey: out.presetKey,
      by: actor,
    });
    if (!res.ok) return { kind, ok: false, detail: res.error };
    return { kind, ok: true, detail: "The words are confirmed on the audience." };
  }

  if (kind === "read_offer") {
    const out = await proposeOfferFromDocument(clientId);
    if (!out.ok) return { kind, ok: false, detail: out.error };
    return {
      kind,
      ok: true,
      detail: `what is sold: ${out.proposal.treatment}; the promise: ${out.proposal.outcomePromise}`,
    };
  }

  if (kind === "lock_offer") {
    const whatIsSold = (action.whatIsSold ?? "").trim();
    const promise = (action.promise ?? "").trim();
    if (!whatIsSold) return { kind, ok: false, detail: "Say what is sold before locking it." };
    const res = await confirmOffer({ clientId, treatment: whatIsSold, outcomePromise: promise, by: actor });
    if (!res.ok) return { kind, ok: false, detail: res.error };
    return { kind, ok: true, detail: `Offer locked: ${whatIsSold}` };
  }

  if (kind === "search_domains") {
    const names = (action.domains ?? []).map((d) => String(d)).filter(Boolean);
    if (!names.length) return { kind, ok: false, detail: "No names to search for." };
    const out = await searchDomains(names);
    if (!out.ok) return { kind, ok: false, detail: out.error };
    const rows = out.results.map((r) =>
      r.available
        ? `${r.domain}: available${r.priceCents ? ` at ${(r.priceCents / 100).toFixed(2)} USD` : ", no price returned"}`
        : `${r.domain}: taken`
    );
    return {
      kind,
      ok: true,
      // Said every time, because the search is the step where somebody decides to spend money and
      // the button is deliberately somewhere else.
      detail: `${rows.join("; ")}. Buying is on the domain step, behind the Buy button.`,
    };
  }

  if (kind === "hand_prompt") {
    const prompt = await buildHandoffPrompt(clientId, action.which ?? "");
    if (!prompt.ok) return { kind, ok: false, detail: prompt.error };
    return { kind, ok: true, detail: prompt.label, prompt: prompt.text };
  }

  if (kind === "read_document") {
    const want = (action.which ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    const { foundationText } = await import("./documents");
    const docs = await foundationText(clientId);
    if (!docs || docs.length === 0) {
      return { kind, ok: false, detail: "No documents are on file for this client yet." };
    }
    const hit = docs.find((d) => d.kind === want);
    if (!hit) {
      return {
        kind,
        ok: false,
        detail: `There is no "${action.which ?? ""}" on file. On file: ${docs.map((d) => d.kind).join(", ")}.`,
      };
    }
    // ‼️ CLIPPED, AND THE CLIP IS DECLARED IN THE TEXT THE MODEL READS. The Slack lane learned this
    // one the expensive way: final-prompt.ts carries 12,000 characters of a document and the honest
    // answer to "does it carry the document" is "12,000 characters of it, and it says so". A silent
    // clip produces a confident summary of a document whose second half nobody read.
    const BUDGET = 12_000;
    const clipped = hit.content.length > BUDGET;
    const body = clipped ? hit.content.slice(0, BUDGET) : hit.content;
    return {
      kind,
      ok: true,
      detail:
        `${hit.kind}, ${hit.content.length} characters` +
        (clipped ? `, of which the first ${BUDGET} follow. Say so if you summarise it.` : ", in full.") +
        `

${body}`,
    };
  }

  if (kind === "check_dns") {
    const facts = await dnsFacts(clientId);
    if (!facts.domain) {
      return { kind, ok: false, detail: "There is no domain on this client yet, so there is nothing to resolve." };
    }
    if (facts.rows.length === 0) {
      return {
        kind,
        ok: false,
        detail: `No DNS record rows exist for ${facts.domain} yet, so there is nothing to check against.`,
      };
    }

    // ‼️ THE WRITE HERE IS THE OBSERVATION, WHICH IS THE WHOLE POINT OF THE ACTION.
    // recheckDnsRecords resolves each name and records what came back. It cannot promote a
    // record nobody added: a name that does not resolve keeps whatever status a human last set,
    // deliberately, because propagation takes up to an hour.
    const { recheckDnsRecords } = await import("@/lib/clients/dns-records");
    const { fqdn: toFqdn } = await import("@/lib/clients/dns-records");
    const rows = await recheckDnsRecords(clientId, facts.domain);

    const lines = rows.map((r) => {
      const name = toFqdn(r.host, facts.domain as string);
      if (r.verified_at) return `${name}: live and correct`;
      if (r.observed) return `${name}: resolves to "${r.observed}", which is not the value we want`;
      return `${name}: does not resolve at all, so the record is not in the registrar yet`;
    });

    return { kind, ok: true, detail: lines.join(". ") };
  }

  if (kind === "read_pages") {
    const state = await launchPagesState(clientId);
    if ("error" in state) return { kind, ok: false, detail: state.error };

    if (!state.plan.length) {
      return {
        kind,
        ok: true,
        detail: state.ready
          ? "No pages planned yet. run_pages stage=plan_new proposes one pillar and six supports off the selected keywords."
          : `No pages planned, and nothing can be planned yet. Waiting on: ${state.missing.join("; ")}.`,
      };
    }

    const rows = state.plan.map((p) => {
      const marks = [
        p.headline ? "headline" : null,
        p.hasOutline ? "skeleton" : null,
        p.hasBody ? "body" : null,
        p.pageStatus === "published" ? "LIVE" : null,
      ].filter(Boolean);
      return `  ${p.rank}. [${p.role}] ${p.headline ?? p.workingTitle} <- ${p.targetKeyword} (${p.status}${marks.length ? ", " + marks.join(", ") : ""})`;
    });

    return {
      kind,
      ok: true,
      detail: [
        `${state.stageText} ${state.proposed} proposed, ${state.approved} approved, ${state.drafted} with a body, ${state.outstanding} still to draft.`,
        ...rows,
        state.needHeadline.length ? `still need a headline: ${state.needHeadline.join(", ")}` : "",
        state.needSkeleton.length ? `still need a skeleton: ${state.needSkeleton.join(", ")}` : "",
        state.day0ArchivedAt ? "" : "Day 0 is not archived, so publishing will refuse. Drafting is not gated.",
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  if (kind === "run_pages") {
    const stage = (action.stage ?? "").trim();
    // ‼️ NARROWED, NOT CAST, for the reason the step key is: the string came out of a model.
    if (!isLaunchPageAction(stage) || !PAGE_RUN_STAGES.includes(stage)) {
      return {
        kind,
        ok: false,
        detail: `"${stage}" is not a stage of the page run. The stages are: ${PAGE_RUN_STAGES.join(", ")}.`,
      };
    }

    const res = await runLaunchPagesAction({
      clientId,
      action: stage,
      actor,
      rank: action.rank ?? null,
      pick: action.pick ?? null,
      stage: action.rung ?? null,
      text: action.text ?? null,
      phrases: action.phrases ?? null,
      category: action.category ?? null,
      pillar: action.pillar ?? null,
      supports: action.supports ?? null,
    });

    // ‼️ THE REFUSAL IS PASSED THROUGH WORD FOR WORD, same rule as a step refusal. These name work
    // that is owed in the order it is owed, and rewording them is how this surface starts
    // disagreeing with the engine it is a surface for.
    return res.ok
      ? { kind: `${kind}:${stage}`, ok: true, detail: res.message, ...(res.prompt ? { prompt: res.prompt } : {}) }
      : { kind: `${kind}:${stage}`, ok: false, detail: res.error };
  }

  if (kind === "publish_page" || kind === "unpublish_page") {
    const state = await launchPagesState(clientId);
    if ("error" in state) return { kind, ok: false, detail: state.error };

    // Addressed by RANK, which is what the plan shows him, and resolved to a page id here so the
    // model never carries one. A rank with no drafted page is a refusal, not a guess.
    const row = state.plan.find((p) => p.rank === action.rank);
    if (!row) {
      return { kind, ok: false, detail: `There is no page ${action.rank} in the plan. There are ${state.plan.length}.` };
    }
    if (!row.pageId) {
      return { kind, ok: false, detail: `Page ${row.rank} has no body yet, so there is nothing to publish.` };
    }

    const res = await runLaunchPagesAction({
      clientId,
      action: kind === "publish_page" ? "publish" : "unpublish",
      actor,
      pageId: row.pageId,
      destinationId: action.destinationId ?? null,
    });

    if (!res.ok) {
      // The destination refusal is a QUESTION, so it carries the list he picks from. The other two
      // are rails and say what is wrong.
      const choices =
        res.refusal?.blockedBy === "destination"
          ? ` Choose one and say which: ${res.refusal.choices.map((c) => `${c.label} (${c.id})`).join(", ")}.`
          : "";
      return { kind, ok: false, detail: `${res.error}${choices}` };
    }
    return { kind, ok: true, detail: [res.message, res.pageUrl ? `Live at ${res.pageUrl}` : ""].filter(Boolean).join(" ") };
  }

  return { kind, ok: false, detail: `${kind} is not an action this lane has.` };
}

/**
 * The prompts handed over for Matthew to run elsewhere.
 *
 * ‼️ THE AVATAR CHAIN IS buildFrameworkScript() AND IS NOT REWRITTEN HERE. That function already
 * renders his seven messages in order, deterministically, with the heading contract the parsers
 * depend on. A second copy of those prompts would drift from the parsers the day somebody reworded
 * a heading, and the symptom is a paste that silently parses as empty.
 */
async function buildHandoffPrompt(
  clientId: string,
  which: string
): Promise<{ ok: true; label: string; text: string } | { ok: false; error: string }> {
  if (which !== "avatar_chain") {
    return {
      ok: false,
      error: `There is no prompt called "${which}". The one this lane hands over is avatar_chain.`,
    };
  }

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("dba_name, legal_name, city")
    .eq("id", clientId)
    .maybeSingle();

  if (!client) return { ok: false, error: "That client could not be read." };

  const [offer, { data: audience }] = await Promise.all([
    currentOffer(clientId),
    supabaseAdmin
      .from("client_audiences")
      .select("label, buyer_noun_singular, offer_noun_singular")
      .eq("client_id", clientId)
      .eq("is_primary", true)
      .maybeSingle(),
  ]);

  const { buildFrameworkScript } = await import("@/lib/clients/avatar-framework");

  const terms = [audience?.buyer_noun_singular, audience?.offer_noun_singular].filter(
    (t): t is string => typeof t === "string" && t.trim().length > 0
  );

  const text = buildFrameworkScript({
    clientName: (client.dba_name as string) || (client.legal_name as string) || "this client",
    offer: offer?.treatment ?? "the offer",
    terms,
    outcome: offer?.outcomePromise ?? null,
    audienceLabel: (audience?.label as string) || "their main audience",
    city: (client.city as string) || null,
    // ‼️ NO SALES LETTER IN THIS LANE, AND THE SCRIPT SAYS SO RATHER THAN PRETENDING.
    // Message 1 pastes an approved letter. The Slack lane writes one at step 10; this lane has no
    // such step, so the honest thing is to tell him what to paste there. Inventing a letter would
    // make every document downstream a description of a business that does not exist.
    letter:
      "[PASTE YOUR SALES PAGE OR THE CLOSEST THING YOU HAVE. If there is none yet, describe what " +
      "this business sells and to whom, in a paragraph.]",
    headingContract: [],
    // There is no Slack anywhere in this lane. The default wording sends somebody looking for a
    // thread nobody opened.
    returnTo: "this conversation",
  });

  return { ok: true, label: "The avatar chain, seven messages, one conversation.", text };
}

// ─────────────────────────────────────────────────────────────────────────────
// One turn
// ─────────────────────────────────────────────────────────────────────────────

/** Find or create the single thread for this client. */
export async function ensureConversation(clientId: string): Promise<string | null> {
  const { data: existing } = await supabaseAdmin
    .from("launch_conversations")
    .select("id")
    .eq("client_id", clientId)
    .maybeSingle();

  if (existing?.id) return existing.id as string;

  const { data, error } = await supabaseAdmin
    .from("launch_conversations")
    .insert({ client_id: clientId })
    .select("id")
    .maybeSingle();

  if (error || !data) return null;
  return data.id as string;
}

export interface StoredMessage {
  role: "user" | "assistant" | "system";
  content: string;
  actions: ActionResult[] | null;
  createdAt: string;
}

export async function loadHistory(conversationId: string, limit = 40): Promise<StoredMessage[]> {
  const { data } = await supabaseAdmin
    .from("launch_messages")
    .select("role, content, actions, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(limit);

  return (data ?? []).map((r) => ({
    role: r.role as StoredMessage["role"],
    content: (r.content as string) ?? "",
    actions: (r.actions as ActionResult[] | null) ?? null,
    createdAt: r.created_at as string,
  }));
}

/**
 * One turn: his message in, work done and an answer out.
 *
 * Throws only when the model itself is unreachable. Every other failure is a result the thread can
 * show, because a conversation that loses a turn to an exception loses the context that made the
 * turn make sense.
 */
export async function runTurn(args: {
  clientId: string;
  clientName: string;
  conversationId: string;
  message: string;
  actor: string;
}): Promise<TurnResult> {
  const ctx = await boardContext(args.clientId);
  const history = await loadHistory(args.conversationId);

  await supabaseAdmin.from("launch_messages").insert({
    conversation_id: args.conversationId,
    role: "user",
    content: args.message,
  });

  const transcript = history
    .filter((m) => m.role !== "system")
    .map((m) => `${m.role === "user" ? "MATTHEW" : "YOU"}: ${m.content}`)
    .join("\n\n");

  const system = systemPrompt(ctx, args.clientName);
  const user = [transcript, `MATTHEW: ${args.message}`].filter(Boolean).join("\n\n");

  // !! 4000, NOT 2000, AND THE OLD NUMBER WAS SET BEFORE THIS TURN COULD ANSWER QUESTIONS.
  // The context now carries two boards, both keyword pools, the DNS records and the publishing
  // facts, and the ANSWERING rules invite a numbered walk-through when he asks for one. He asked
  // for "the bird eye view" on 2026-10-03 and the reply was cut off mid-word at `both po`, which
  // truncated the JSON and failed the parse. callClaudeJSON retries once on stop_reason
  // max_tokens, so the budget it retried INTO was not enough either.
  let plan: TurnPlan | null = null;
  try {
    const result = await callClaudeJSON<TurnPlan>({
      model: TURN_MODEL,
      system,
      user,
      maxTokens: 4000,
      temperature: 0.3,
      validate: isTurnPlan,
      schemaHint:
        '{ "say": string, "asks": string[], "actions": [{ "kind": string, "stepKey"?: string, ' +
        '"reason"?: string, "whatIsSold"?: string, "promise"?: string, "domains"?: string[], ' +
        '"which"?: string }], "confidence": number }',
    });
    plan = result.data;
  } catch (e) {
    // !! AN ENVELOPE PROBLEM MUST NOT SWALLOW A GOOD ANSWER.
    //
    // What he saw was "The turn failed: Claude JSON parse error" followed by 500 characters of a
    // reply that was answering his question correctly. The model knew the answer; the JSON wrapper
    // around it did not survive. Losing the answer and showing him the error is the worst of the
    // three possible outcomes.
    //
    // The fallback re-asks in prose, and it is SAFE because prose carries no actions: nothing can
    // tick, skip, lock or resolve down this path. That is the right trade when the structured
    // channel is the thing that broke. It answers and does nothing.
    console.error("[launch/turn] structured turn failed, prose fallback:", (e as Error).message);
    const prose = await callClaudeText({
      model: TURN_MODEL,
      system: system + "\n\nAnswer in plain prose. Do not return JSON. Take no actions: this reply only answers.",
      user,
      maxTokens: 4000,
      temperature: 0.3,
    }).catch(() => null);

    const text = (typeof prose === "string" ? prose : ((prose as { text?: string } | null)?.text ?? "")).trim();
    if (!text) throw e;
    plan = { say: text, asks: [], actions: [], confidence: 0 };
  }

  // ‼️ THE DASH CHECK RUNS ON MODEL OUTPUT AT RUNTIME, WHICH IS WHAT copy-guard CANNOT DO.
  // guard() throws at module load and only covers hardcoded copy. Anything a model wrote has to be
  // checked when it arrives, exactly as vocabulary.ts checks its proposal.
  const clean = (s: string) => (hasBannedDash(s) ? s.replace(/\s*[—–]\s*/g, ", ") : s);

  const say = clean(plan.say ?? "");
  const asks = (plan.asks ?? []).map((a) => clean(String(a)));

  // ‼️ A TICK IS NOT A GUESS, SO IT IS NOT HELD BACK. Matthew, 2026-10-04, chose "act, then tell
  // me", and `complete_step` is the one action where that is safe for a structural reason rather
  // than an optimistic one: setLaunchStep runs the step's VERIFIER and refuses anything it cannot
  // prove from the database. A confident model and a hesitant one get the same answer from it, so
  // a confidence score adds nothing except a turn of latency.
  //
  // ‼️ `skip_step` IS STILL GATED, AND THE DIFFERENCE IS THE WHOLE POINT. A skip has no verifier:
  // it is an assertion that something does not apply, recorded with a reason and nothing to check
  // it against. That is exactly the shape of claim a 90 percent confidence bar exists for.
  //
  // ‼️ `read_pages` IS ON THE LIST AND `run_pages` IS NOT, WHICH IS THE SAME LINE AS ABOVE.
  // Reading where the page run stands changes nothing. Running a stage writes rows, spends a model
  // call, and in the case of publish_page puts words on the internet under a client's name, so all
  // of those stay behind the bar: if it is not sure he asked for it, it should ask.
  const SELF_PROVING: ReadonlySet<string> = new Set([
    "complete_step",
    "read_document",
    "check_dns",
    "search_domains",
    "read_offer",
    "read_pages",
  ]);
  const proposed = plan.actions ?? [];
  const risky = proposed.filter((a) => !SELF_PROVING.has(a.kind));
  const heldBack = plan.confidence < ACT_THRESHOLD && risky.length > 0;
  const toRun = (heldBack ? proposed.filter((a) => SELF_PROVING.has(a.kind)) : proposed).slice(
    0,
    MAX_ACTIONS_PER_TURN
  );

  const results: ActionResult[] = [];
  let settled: string | null = null;
  for (const action of toRun) {
    const res = await executeAction(args.clientId, action, ctx.candidates, args.actor);
    results.push(res);
    if (res.ok && (action.kind === "complete_step" || action.kind === "skip_step")) {
      settled = action.stepKey ?? null;
    }
  }

  await supabaseAdmin.from("launch_messages").insert({
    conversation_id: args.conversationId,
    role: "assistant",
    content: [say, ...asks.map((a) => `- ${a}`)].filter(Boolean).join("\n"),
    actions: results.length ? results : null,
    step_key: settled,
  });

  await supabaseAdmin
    .from("launch_conversations")
    .update({ last_turn_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", args.conversationId);

  return { say, asks, results, heldBack };
}
