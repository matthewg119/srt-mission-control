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
// ‼️ TWO THINGS ARE DELIBERATELY ABSENT FROM THE UNION AND MUST STAY ABSENT.
//   - buying a domain. domain.ts rule 3: never called by a runner, a cron or a retry, only by a
//     person pressing a button that showed them the price. It is the only code here that spends
//     money and a conversation is exactly the surface that should not be able to.
//   - publishing a page. publishPage() is the one publisher and needs an explicit yes.
// Adding either to ACTION_KINDS is not a feature, it is the removal of a control.

import { callClaudeJSON, type ClaudeModel } from "@/lib/claude-calls";
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
] as const;

export type ActionKind = (typeof ACTION_KINDS)[number];

export interface LaunchAction {
  kind: ActionKind;
  stepKey?: string;
  reason?: string;
  /** lock_offer */
  whatIsSold?: string;
  promise?: string;
  /** search_domains */
  domains?: string[];
  /** hand_prompt */
  which?: string;
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
  const [board, docs, offer] = await Promise.all([
    launchBoard(clientId),
    foundationStatus(clientId),
    currentOffer(clientId),
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
    "- One line of context saying what you need and why, then the ask. Never more.",
    "- Never explain unless he asks.",
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
    "- You may NOT buy a domain and you may NOT publish a page. There is no action for either,",
    "  because both spend something that cannot be taken back. Tell him to press the button.",
    "- Never change keywords and never touch the concierge without him saying yes in words.",
    `- If you are less than ${Math.round(ACT_THRESHOLD * 100)} percent sure, return no actions and ask instead.`,
    "",
    "THE PROMPT MECHANIC, WHICH MATTERS MORE THAN ANYTHING ELSE YOU DO:",
    "- You do not do research. You hand him a prompt he runs in a separate session and pastes back.",
    '- Use the hand_prompt action with which="avatar_chain" when the four documents are not in hand.',
    "- Page copy ALWAYS goes through a research prompt first. Never draft it from nothing.",
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

  const result = await callClaudeJSON<TurnPlan>({
    model: TURN_MODEL,
    system: systemPrompt(ctx, args.clientName),
    user: [transcript, `MATTHEW: ${args.message}`].filter(Boolean).join("\n\n"),
    maxTokens: 2000,
    temperature: 0.3,
    validate: isTurnPlan,
    schemaHint:
      '{ "say": string, "asks": string[], "actions": [{ "kind": string, "stepKey"?: string, ' +
      '"reason"?: string, "whatIsSold"?: string, "promise"?: string, "domains"?: string[], ' +
      '"which"?: string }], "confidence": number }',
  });

  const plan = result.data;

  // ‼️ THE DASH CHECK RUNS ON MODEL OUTPUT AT RUNTIME, WHICH IS WHAT copy-guard CANNOT DO.
  // guard() throws at module load and only covers hardcoded copy. Anything a model wrote has to be
  // checked when it arrives, exactly as vocabulary.ts checks its proposal.
  const clean = (s: string) => (hasBannedDash(s) ? s.replace(/\s*[—–]\s*/g, ", ") : s);

  const say = clean(plan.say ?? "");
  const asks = (plan.asks ?? []).map((a) => clean(String(a)));

  const heldBack = plan.confidence < ACT_THRESHOLD && (plan.actions ?? []).length > 0;
  const toRun = heldBack ? [] : (plan.actions ?? []).slice(0, MAX_ACTIONS_PER_TURN);

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
