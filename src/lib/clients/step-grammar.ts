// What every step's thread accepts, in one table.
//
// ‼️ MEASURED 2026-09-22. Somebody standing in step 11's thread typed `letter approve`. It is a real
// command, hard-gated to offer_locked at sales-letter.ts, so every handler in the chain returned null,
// the message reached the general assistant, and the assistant invented "the Approve button on the
// delivery board at step offer_locked". No such button exists: blocks() in step-engine.ts gives every
// card [Done], [Skip - not applicable] and [I hit a problem], and nothing else. A person was sent
// hunting for a control that is not there, and the step could not be finished.
//
// Matthew: "whenever we finish a step in onboarding and we type something that is not right, make sure
// it resends the message we need to click to move forward or to give us the next steps. FOR ALL STEPS."
//
// ‼️ THE REASON IT WENT WRONG IS THAT NOTHING HELD THE WHOLE GRAMMAR. Sixteen handlers each gate on
// their own step key and return null off it, and step-commands.ts' OWNERS table, the only thing that
// catches a command typed in the wrong thread, listed six of those sixteen by hand. A seventeenth
// handler added tomorrow would have been the seventh gap. So the grammar lives here, once, every step
// has an entry, and _probe-step-grammar.ts greps the handlers' own gates back out of src/ and fails
// when one of them is not represented. That check, not this table, is what stops the drift.
//
// ‼️ EVERY STEP HAS AN ENTRY AND `[]` IS AN ASSERTION, NOT A HOLE. `Record<StepKey, ...>` fails to
// compile when a step is added without one, the mechanism STEP_VERIFIERS and STEP_ACTIONS already
// rely on. An empty array says "this thread takes buttons and nothing typed", which is true of
// twenty-five of the forty-one and is exactly what "FOR ALL STEPS" has to mean.
//
// ‼️ PURE. No database, no network, no model call. lead-brief.ts says the same of itself and has to
// import this; step-commands.ts imports supabaseAdmin at module scope and cannot hold it.

import { DELIVERY_STEPS, stepNumber, type StepKey } from "@/config/delivery-steps";

export interface CommandSpec {
  /** Exactly how a person types it. Printed backticked. MUST satisfy `test`: the probe asserts it. */
  label: string;
  /**
   * Everything the owning handler accepts, lifted verbatim from the handler's own regex.
   *
   * Used to LIST the grammar and to recognise "shaped like this thread's own commands". NEVER used
   * for the wrong-thread pointer: see `unmistakable`.
   */
  test: RegExp;
  /**
   * The narrower form that is unmistakably THIS command in ANY thread. Only these earn a pointer.
   *
   * ‼️ IT IS A SECOND REGEX ON PURPOSE AND THE TWO MUST NOT BE MERGED. A handler's grammar is allowed
   * to be greedy inside its own thread, where nothing else is competing for the words. The pointer
   * speaks in threads the command does NOT belong to, where the same words are usually somebody
   * talking. Omitted means "never point": the form is too close to a sentence to claim from outside.
   */
  unmistakable?: RegExp;
  /**
   * The ONE step a pointer names, when several accept the command. Defaults to the first step in
   * board order that lists this spec.
   */
  pointAt?: StepKey;
  /** One clause for the pointer: "Sales letter commands go in step 10". */
  what: string;
  /** Path under src/ that implements it. The probe greps this file and fails if the words moved. */
  implementedIn: string;
  /**
   * The handler file that GATES this command on its step, when that is not where the regex lives.
   *
   * ‼️ THE PROBE'S §2 IS WHY THIS EXISTS. It greps every `stepKey !== "x"` gate out of src/ and
   * demands that the step it names carries a spec pointing back at that file. Four grammars are
   * written in one file and dispatched from another (`mascot` in mascot-grammar.ts is gated in
   * mascot-studio.ts; `plan` and `skeleton` live in page-plan.ts and page-batch.ts and are gated in
   * pre-call-pages.ts), and without this the check could not tell a real gap from that split.
   */
  gatedIn?: string;
  /** A card that omits this is a bug. Cross-checked against STEP_ACTIONS by the probe. */
  mustBeOnTheCard?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// The specs
//
// ‼️ A COMMAND OWNED BY SEVERAL STEPS IS ONE CONST, LISTED SEVERAL TIMES. `stepsAccepting` finds
// every step that holds it by object identity, so a shared command needs no second list to keep in
// step with the first. Four families are shared: the review links (four steps), the offer details
// (two), `avatar:` (two) and the skin commands (three).
// ─────────────────────────────────────────────────────────────────────────────

// ── The offer, step 10, and the details again on step 21 ─────────────────────

/**
 * ‼️ `offer:` AND `terms:` POINT AT STEP 10 AND THE DETAILS POINT AT STEP 21, WHICH LOOKS WRONG AND
 * IS NOT. OFFER_STEPS in offers.ts is {offer_locked, pre_call_pages} and DETAIL_ONLY_STEPS is
 * {pre_call_pages}: the prep call takes all five, the pre-call pages take only the last three. So
 * `terms:` typed in step 21 really is misrouted, and `guarantee:` typed anywhere else is far more
 * likely to be the page work than the prep call. _probe-headline-first.ts pins both directions.
 */
const OFFER: CommandSpec = {
  label: "offer: <what they sell>",
  test: /^\s*offer\s*:/i,
  unmistakable: /^\s*[`*_]*offer\s*:/i,
  pointAt: "offer_locked",
  what: "The offer and the words customers use for it",
  implementedIn: "src/lib/clients/offers.ts",
  mustBeOnTheCard: true,
};

const TERMS: CommandSpec = {
  label: "terms: <what their customers call it>",
  test: /^\s*terms\s*:/i,
  unmistakable: /^\s*[`*_]*terms\s*:/i,
  pointAt: "offer_locked",
  what: "The offer and the words customers use for it",
  implementedIn: "src/lib/clients/offers.ts",
  mustBeOnTheCard: true,
};

const OUTCOME: CommandSpec = {
  label: "outcome: <what the customer gets>",
  test: /^\s*outcome\s*:/i,
  unmistakable: /^\s*[`*_]*outcome\s*:\s*\S/i,
  pointAt: "pre_call_pages",
  what: "Offer detail commands",
  implementedIn: "src/lib/clients/offers.ts",
};

const PRICE: CommandSpec = {
  label: "price: <what it costs>",
  test: /^\s*price\s*:/i,
  unmistakable: /^\s*[`*_]*price\s*:\s*\S/i,
  pointAt: "pre_call_pages",
  what: "Offer detail commands",
  implementedIn: "src/lib/clients/offers.ts",
};

const GUARANTEE: CommandSpec = {
  label: "guarantee: <what is promised>",
  test: /^\s*guarantee\s*:/i,
  unmistakable: /^\s*[`*_]*guarantee\s*:.+/i,
  pointAt: "pre_call_pages",
  what: "Offer detail commands",
  implementedIn: "src/lib/clients/offers.ts",
};

// ── The sales letter, step 10 and step 11 ────────────────────────────────────

/**
 * ‼️ THE LETTER COMMANDS ARE LISTED UNDER BOTH STEP 10 AND STEP 11, AND THAT IS THE 2026-09-22 FIX.
 *
 * Step 11's framework script cannot be written until the letter is approved, and step 11's own
 * waiting note is what tells somebody to go and approve it. Sending them to another thread to type
 * one word, when the approve arm reads the audience and the offer and never once looks at the thread
 * it was typed in, was a hop that bought nothing. sales-letter.ts now gates on LETTER_STEPS.
 *
 * The DOCUMENT is still filed against offer_locked (fileCopy in sales-letter.ts). Only where you may
 * type it relaxed; which step owns the data did not.
 */
const LETTER_USE: CommandSpec = {
  label: "letter use",
  test: /^\s*letter\s+use\b/i,
  unmistakable: /^\s*[`*_]*letter\s+use\b/i,
  pointAt: "offer_locked",
  what: "Sales letter commands",
  implementedIn: "src/lib/clients/sales-letter.ts",
};

const LETTER_DRAFT: CommandSpec = {
  label: "letter draft",
  test: /^\s*letter\s+draft\b/i,
  unmistakable: /^\s*[`*_]*letter\s+draft\b/i,
  pointAt: "offer_locked",
  what: "Sales letter commands",
  implementedIn: "src/lib/clients/sales-letter.ts",
  mustBeOnTheCard: true,
};

const LETTER_TEXT: CommandSpec = {
  label: "letter text",
  test: /^\s*letter\s+text\b/i,
  unmistakable: /^\s*[`*_]*letter\s+text\b/i,
  pointAt: "offer_locked",
  what: "Sales letter commands",
  implementedIn: "src/lib/clients/sales-letter.ts",
};

const LETTER_APPROVE: CommandSpec = {
  label: "letter approve",
  test: /^\s*letter\s+approve\b/i,
  unmistakable: /^\s*[`*_]*letter\s+approve\b/i,
  pointAt: "offer_locked",
  what: "Sales letter commands",
  implementedIn: "src/lib/clients/sales-letter.ts",
  mustBeOnTheCard: true,
};

const LETTER_REPLACE: CommandSpec = {
  label: "letter replace:",
  test: /^\s*letter\s+replace\b/i,
  unmistakable: /^\s*[`*_]*letter\s+replace\b/i,
  pointAt: "offer_locked",
  what: "Sales letter commands",
  implementedIn: "src/lib/clients/sales-letter.ts",
};

const LETTER: readonly CommandSpec[] = [
  LETTER_USE,
  LETTER_DRAFT,
  LETTER_TEXT,
  LETTER_APPROVE,
  LETTER_REPLACE,
];

// ── The avatar and the audience, step 7, and `avatar:` again on step 28 ──────

const AVATAR: CommandSpec = {
  label: "avatar: <which customer>",
  test: /^\s*avatar\s*:/i,
  unmistakable: /^\s*[`*_]*avatar\s*:\s*\S/i,
  pointAt: "avatar_confirmed",
  what: "Avatar commands",
  implementedIn: "src/lib/clients/avatars.ts",
};

const AUDIENCE: CommandSpec = {
  label: "audience: <preset>",
  test: /^\s*audience\s*:/i,
  unmistakable: /^\s*[`*_]*audience\s*:\s*\S/i,
  pointAt: "avatar_confirmed",
  what: "Audience commands",
  implementedIn: "src/lib/clients/audiences.ts",
};

// ── Step 11: the research, the framework documents ───────────────────────────

const PROMPT: CommandSpec = {
  label: "prompt",
  test: /^\s*prompt\s*$/i,
  what: "The framework script",
  implementedIn: "src/lib/clients/framework-thread.ts",
  mustBeOnTheCard: true,
};

/** Dispatched inline in the events route rather than in a handler file, since 2026-09-15. */
const PROMPT_SHORT: CommandSpec = {
  label: "prompt short",
  test: /^\s*prompt\s+short\s*$/i,
  what: "The short research prompt",
  implementedIn: "src/app/api/slack/events/route.ts",
};

const RUN: CommandSpec = {
  label: "run",
  test: /^\s*run\s*$/i,
  what: "The thinner research pass",
  implementedIn: "src/app/api/slack/events/route.ts",
};

const SHARE: CommandSpec = {
  label: "share research",
  test: /^\s*share\s+(research|sheet)\s*$/i,
  what: "The stored research",
  implementedIn: "src/lib/clients/framework-thread.ts",
};

const RESEARCH: CommandSpec = {
  label: "research:",
  test: /^\s*research\s*:/i,
  unmistakable: /^\s*[`*_]*research\s*:/i,
  what: "The deep research answer",
  implementedIn: "src/lib/clients/research-intake.ts",
  mustBeOnTheCard: true,
};

const RESEARCH_REPLACE: CommandSpec = {
  label: "research replace:",
  test: /^\s*research\s+replace\s*:/i,
  unmistakable: /^\s*[`*_]*research\s+replace\s*:/i,
  what: "The deep research answer",
  implementedIn: "src/lib/clients/research-intake.ts",
};

const AVATAR_SHEET: CommandSpec = {
  label: "avatar sheet:",
  test: /^\s*avatar\s+sheet\s*:/i,
  unmistakable: /^\s*[`*_]*avatar\s+sheet\s*:/i,
  what: "Framework documents",
  implementedIn: "src/lib/clients/avatar-framework.ts",
  mustBeOnTheCard: true,
};

const SHORT_OFFER: CommandSpec = {
  label: "short offer:",
  test: /^\s*short\s+offer\s*:/i,
  unmistakable: /^\s*[`*_]*short\s+offer\s*:/i,
  what: "Framework documents",
  implementedIn: "src/lib/clients/avatar-framework.ts",
  mustBeOnTheCard: true,
};

const BELIEFS: CommandSpec = {
  label: "beliefs:",
  test: /^\s*beliefs\s*:/i,
  unmistakable: /^\s*[`*_]*beliefs\s*:/i,
  what: "Framework documents",
  implementedIn: "src/lib/clients/avatar-framework.ts",
  mustBeOnTheCard: true,
};

// ── Step 12: the keywords ────────────────────────────────────────────────────

/**
 * ‼️ THE BARE WORD GETS NO `unmistakable`, AND `check` IS DELIBERATELY ABSENT.
 *
 * Carried over verbatim from the OWNERS table this replaced. `keywords check` was removed on
 * 2026-09-12 and is dictation now, so pointing somebody at another thread for it would send them to
 * a command that is not there any more. And a bare `keywords` is a word people say: "keywords matter
 * less than people think" must reach the assistant, which _probe-keywords.ts pins.
 */
const KEYWORDS: CommandSpec = {
  label: "keywords",
  test: /^\s*[`*_]*keywords\b/i,
  what: "Keyword commands",
  implementedIn: "src/lib/clients/client-keywords.ts",
  mustBeOnTheCard: true,
};

/**
 * ‼️ `keywords prompt`, NOT a bare `prompt`. Step 11's framework thread owns `prompt` and
 * `prompt short`, gated on avatar_harvest. Two steps answering one bare word is how somebody types
 * it in the wrong thread, gets a plausible answer, and files research against the wrong step.
 */
const KEYWORDS_PROMPT: CommandSpec = {
  label: "keywords prompt",
  test: /^\s*[`*_]*keywords\s+prompt\b/i,
  unmistakable: /^\s*[`*_]*keywords\s+prompt\b/i,
  pointAt: "keyword_set",
  what: "Keyword commands",
  implementedIn: "src/lib/clients/client-keywords.ts",
  mustBeOnTheCard: true,
};

/**
 * ‼️ THE NARROW FORM IS ITS OWN SPEC so the card can teach it. The bare `keywords approve` approves
 * every query row, which on a fresh client is mostly the model's own expansion, and there was no way
 * to say "these thirteen" until 2026-09-23.
 */
const KEYWORDS_APPROVE_SOME: CommandSpec = {
  label: "keywords approve 411-423",
  test: /^\s*[`*_]*keywords\s+approve\s+(\d|mine|manual|ours)/i,
  unmistakable: /^\s*[`*_]*keywords\s+approve\s+(\d|mine|manual|ours)/i,
  pointAt: "keyword_set",
  what: "Keyword commands",
  implementedIn: "src/lib/clients/client-keywords.ts",
  mustBeOnTheCard: true,
};

const KEYWORDS_SHORTLIST: CommandSpec = {
  label: "keywords shortlist",
  test: /^\s*[`*_]*keywords\s+shortlist\b/i,
  unmistakable: /^\s*[`*_]*keywords\s+shortlist\b/i,
  pointAt: "keyword_set",
  what: "Keyword commands",
  implementedIn: "src/lib/clients/keyword-strategy.ts",
  mustBeOnTheCard: true,
};

const KEYWORDS_SERP: CommandSpec = {
  label: "keywords serp 12",
  test: /^\s*[`*_]*keywords\s+serp\s+\d/i,
  unmistakable: /^\s*[`*_]*keywords\s+serp\s+\d/i,
  pointAt: "keyword_set",
  what: "Keyword commands",
  implementedIn: "src/lib/clients/keyword-strategy.ts",
};

const SERP_CARDS: CommandSpec = {
  label: "serp cards",
  test: /^\s*[`*_]*serp\s+cards\b/i,
  unmistakable: /^\s*[`*_]*serp\s+cards\b/i,
  pointAt: "keyword_set",
  what: "The keyword strategy",
  implementedIn: "src/lib/clients/serp-cards.ts",
  mustBeOnTheCard: true,
};

/**
 * ‼️ `unmistakable` ON THE COLON FORM ONLY, and "magnet" alone is deliberately not a command here.
 * The word is ordinary English in a step thread ("that magnet is the one they liked"), and the
 * concierge lane owns magnets elsewhere. `magnet 7:` names a numbered row and cannot be dictation.
 */
const MAGNET_SET: CommandSpec = {
  label: "magnet 7: the front desk script",
  test: /^\s*[`*_]*magnet\s+\d{1,3}\s*:/i,
  unmistakable: /^\s*[`*_]*magnet\s+\d{1,3}\s*:/i,
  pointAt: "keyword_set",
  what: "The keyword strategy",
  implementedIn: "src/lib/clients/keyword-strategy.ts",
};

/**
 * ‼️ NO `unmistakable` ON THE BARE WORD, the same treatment bare `keywords` and bare `mascot` get.
 * "the strategy is working" and "our strategy here" are sentences somebody says in a step thread and
 * they must reach the assistant. _probe-step-grammar.ts pins that.
 */
const STRATEGY: CommandSpec = {
  label: "strategy",
  test: /^\s*[`*_]*strategy[`*_]*\s*$/i,
  pointAt: "keyword_set",
  what: "The keyword strategy",
  implementedIn: "src/lib/clients/keyword-strategy.ts",
  mustBeOnTheCard: true,
};

const STRATEGY_APPROVE: CommandSpec = {
  label: "strategy approve",
  test: /^\s*[`*_]*strategy\s+approve\b/i,
  unmistakable: /^\s*[`*_]*strategy\s+approve\b/i,
  pointAt: "keyword_set",
  what: "The keyword strategy",
  implementedIn: "src/lib/clients/keyword-strategy.ts",
  mustBeOnTheCard: true,
};

/**
 * ‼️ NAMESPACED UNDER `strategy`, AND THAT IS WHY `pillar` IS SAFE HERE. anchor-ladder.ts owns
 * `pillar: auto` and `supports auto` at step 21. A bare `pillar 4` in step 12's thread would be one
 * step's verb typed in another's room; the prefix removes the ambiguity rather than relying on which
 * handler runs first.
 */
const STRATEGY_EDIT: CommandSpec = {
  label: "strategy merge 12 under 4",
  test: /^\s*[`*_]*strategy\s+(new|merge\s+\d|pillar\s+\d|service\s+\d|post\s+\d)/i,
  unmistakable: /^\s*[`*_]*strategy\s+(new|merge\s+\d|pillar\s+\d|service\s+\d|post\s+\d)/i,
  pointAt: "keyword_set",
  what: "The keyword strategy",
  implementedIn: "src/lib/clients/keyword-strategy.ts",
};

const KEYWORDS_ADD: CommandSpec = {
  label: "keywords add:",
  test: /^\s*[`*_]*keywords\s+add\s*:/i,
  unmistakable: /^\s*[`*_]*keywords\s+add\s*:/i,
  pointAt: "keyword_set",
  what: "Keyword commands",
  implementedIn: "src/lib/clients/client-keywords.ts",
  mustBeOnTheCard: true,
};

const KEYWORDS_APPROVE: CommandSpec = {
  label: "keywords approve",
  test: /^\s*[`*_]*keywords\s+approve\b/i,
  unmistakable: /^\s*[`*_]*keywords\s+approve\b/i,
  pointAt: "keyword_set",
  what: "Keyword commands",
  implementedIn: "src/lib/clients/client-keywords.ts",
  mustBeOnTheCard: true,
};

const KEYWORDS_DROP: CommandSpec = {
  label: "keywords drop 12",
  test: /^\s*[`*_]*keywords\s+drop\s+\d/i,
  unmistakable: /^\s*[`*_]*keywords\s+drop\s+\d/i,
  pointAt: "keyword_set",
  what: "Keyword commands",
  implementedIn: "src/lib/clients/client-keywords.ts",
};

const KEYWORDS_MORE: CommandSpec = {
  label: "keywords more price",
  test: /^\s*[`*_]*keywords\s+more\s+\S/i,
  unmistakable: /^\s*[`*_]*keywords\s+more\s+\S/i,
  pointAt: "keyword_set",
  what: "Keyword commands",
  implementedIn: "src/lib/clients/client-keywords.ts",
};

// ── Step 13: the objections ──────────────────────────────────────────────────

const OBJECTION: CommandSpec = {
  label: "objection: <what they said>",
  test: /^\s*[`*_]*objection\s*:\s*([\s\S]+?)\s*[`*_]*\s*$/i,
  unmistakable: /^\s*[`*_]*objection\s*:/i,
  pointAt: "custom_question_set",
  what: "Objections heard on a sales call",
  implementedIn: "src/lib/clients/objection-mining.ts",
};

// ── Steps 16, 17 and 19: the skin ────────────────────────────────────────────

const TEMPLATE: CommandSpec = {
  label: "template",
  test: /^(template|templates|skin|design)$/i,
  what: "Design commands",
  implementedIn: "src/lib/clients/hub-skin.ts",
};

const TEMPLATE_RESET: CommandSpec = {
  label: "skin reset",
  test: /^(skin|design|template)\s+reset$/i,
  unmistakable: /^\s*[`*_]*(skin|design|template)\s+reset[`*_]*\s*$/i,
  what: "Design commands",
  implementedIn: "src/lib/clients/hub-skin.ts",
};

const TEMPLATE_PICK: CommandSpec = {
  label: "pick 2",
  test: /^pick\s+([0-9])$/i,
  what: "Design commands",
  implementedIn: "src/lib/clients/hub-skin.ts",
};

// ── Step 18: the character ───────────────────────────────────────────────────

/**
 * ‼️ THE BARE WORD IS IN AND A BARE KEY IS NOT. Carried over verbatim from the OWNERS table this
 * replaced. `mascot` and `mascot concepts` are unambiguous anywhere, so pointing at step 18 is right
 * for them. `mascot spa-otter` is a key this table cannot check the existence of, and claiming a
 * sentence like "mascot ideas please" is a command would send somebody to another thread instead of
 * answering them. mascot-grammar.ts owns the real grammar; this only has to be right about the forms
 * nothing else could be. _probe-mascot.ts pins both halves.
 */
const MASCOT: CommandSpec = {
  label: "mascot",
  test: /^mascots?$/i,
  unmistakable: /^\s*[`*_]*mascots?[`*_]*\s*$/i,
  what: "Character commands",
  implementedIn: "src/lib/clients/mascot-grammar.ts",
  gatedIn: "src/lib/clients/mascot-studio.ts",
};

const MASCOT_CONCEPTS: CommandSpec = {
  label: "mascot concepts",
  test: /^mascots?\s+concepts?$/i,
  unmistakable: /^\s*[`*_]*mascots?\s+concepts?[`*_]*\s*$/i,
  what: "Character commands",
  implementedIn: "src/lib/clients/mascot-grammar.ts",
  gatedIn: "src/lib/clients/mascot-studio.ts",
};

const MASCOT_PICK: CommandSpec = {
  label: "mascot pick 2",
  test: /^mascots?\s+pick\s+(.+)$/i,
  unmistakable: /^\s*[`*_]*mascots?\s+pick\s+\S.*$/i,
  what: "Character commands",
  implementedIn: "src/lib/clients/mascot-grammar.ts",
  gatedIn: "src/lib/clients/mascot-studio.ts",
};

const MASCOT_SKIP: CommandSpec = {
  label: "mascot skip",
  test: /^mascots?\s+(skip|default)$/i,
  unmistakable: /^\s*[`*_]*mascots?\s+(skip|default)[`*_]*\s*$/i,
  what: "Character commands",
  implementedIn: "src/lib/clients/mascot-grammar.ts",
  gatedIn: "src/lib/clients/mascot-studio.ts",
};

const MASCOT_CORNER: CommandSpec = {
  label: "mascot corner bottom-right",
  test: /^mascots?\s+corner\s+(top|bottom)[-\s]?(left|right)$/i,
  unmistakable: /^\s*[`*_]*mascots?\s+corner\s+\S+[`*_]*\s*$/i,
  what: "Character commands",
  implementedIn: "src/lib/clients/mascot-grammar.ts",
  gatedIn: "src/lib/clients/mascot-studio.ts",
};

/** ‼️ NO `unmistakable`. See the MASCOT docstring: this is the "mascot ideas please" case. */
const MASCOT_KEEP: CommandSpec = {
  label: "mascot spa-otter",
  test: /^mascots?\s+([a-z0-9][a-z0-9-]{1,38})$/i,
  what: "Character commands",
  implementedIn: "src/lib/clients/mascot-grammar.ts",
  gatedIn: "src/lib/clients/mascot-studio.ts",
};

// ── Steps 10, 17, 20 and 34: the review links ────────────────────────────────

const REVIEW_LINK: CommandSpec = {
  label: "review link: <url>",
  test: /^\s*[`*_]*review\s+link\s*:\s*(\S+)\s*[`*_]*\s*$/i,
  unmistakable: /^\s*[`*_]*review\s+link\s*:/i,
  pointAt: "review_card_pdf",
  what: "Review links",
  implementedIn: "src/lib/clients/review-link.ts",
};

const REVIEW_PLATFORM: CommandSpec = {
  label: "review platform: Google",
  test: /^\s*[`*_]*review\s+platform\s*:\s*([a-z .]{2,30})\s*[`*_]*\s*$/i,
  unmistakable: /^\s*[`*_]*review\s+platform\s*:/i,
  pointAt: "review_card_pdf",
  what: "Review links",
  implementedIn: "src/lib/clients/review-link.ts",
};

// ── Step 21: the ladder, the angles, the headlines, the plan ─────────────────

const LADDER: CommandSpec = {
  label: "ladder",
  test: /^ladder$/i,
  unmistakable: /^\s*[`*_]*ladder[`*_]*\s*$/i,
  what: "Plan commands",
  implementedIn: "src/lib/clients/anchor-ladder.ts",
  mustBeOnTheCard: true,
};

const RUNG: CommandSpec = {
  label: "ladder pick 4",
  test: /^(?:ladder\s+pick|anchor\s+at|anchor|ladder|rung)\s+#?([1-5])$/i,
  unmistakable: /^\s*[`*_]*(?:ladder\s+pick|anchor\s+at|anchor|ladder|rung)\s+#?[1-5][`*_]*\s*$/i,
  pointAt: "pre_call_pages",
  what: "Plan commands",
  implementedIn: "src/lib/clients/anchor-ladder.ts",
};

const PILLAR: CommandSpec = {
  label: "pillar: auto",
  test: /^pillar\s*:\s*(auto|#?\d{1,4})$/i,
  unmistakable: /^\s*[`*_]*pillar\s*:\s*(auto|#?\d{1,4})[`*_]*\s*$/i,
  what: "Plan commands",
  implementedIn: "src/lib/clients/anchor-ladder.ts",
};

const SUPPORTS: CommandSpec = {
  label: "supports: auto",
  test: /^supports\s*(?::\s*|\s+)(auto|[#\d,\s]+)$/i,
  unmistakable: /^\s*[`*_]*supports\s*(?::\s*|\s+)(auto|[#\d,\s]+)[`*_]*\s*$/i,
  what: "Plan commands",
  implementedIn: "src/lib/clients/anchor-ladder.ts",
};

const ANGLES: CommandSpec = {
  label: "angles",
  test: /^\s*[`*_]*(angles?|magnets?|offers?)[`*_]*\s*$/i,
  what: "Page angle commands",
  implementedIn: "src/lib/clients/page-angles.ts",
  mustBeOnTheCard: true,
};

const ANGLES_AUTO: CommandSpec = {
  label: "angles auto",
  test: /^\s*[`*_]*(angles?|magnets?|offers?)\s+auto[`*_]*\s*$/i,
  unmistakable: /^\s*[`*_]*(angles?|magnets?)\s+auto[`*_]*\s*$/i,
  what: "Page angle commands",
  implementedIn: "src/lib/clients/page-angles.ts",
};

const ANGLE_PICK: CommandSpec = {
  label: "angle 3 pick 2",
  test: /^\s*[`*_]*(angle|magnet|offer)\s+(\d+)\s+pick\s+(\d+)[`*_]*\s*$/i,
  unmistakable: /^\s*[`*_]*(angle|magnet)\s+\d+\s+pick\s+\d+[`*_]*\s*$/i,
  what: "Page angle commands",
  implementedIn: "src/lib/clients/page-angles.ts",
};

const ANGLE_MORE: CommandSpec = {
  label: "angle 3 more",
  test: /^\s*[`*_]*(angle|magnet|offer)\s+(\d+)\s+more[`*_]*\s*$/i,
  unmistakable: /^\s*[`*_]*(angle|magnet)\s+\d+\s+more[`*_]*\s*$/i,
  what: "Page angle commands",
  implementedIn: "src/lib/clients/page-angles.ts",
};

const HEADLINES: CommandSpec = {
  label: "headlines",
  test: /^headlines$/i,
  unmistakable: /^\s*[`*_]*headlines[`*_]*\s*$/i,
  what: "Headline commands",
  implementedIn: "src/lib/clients/precall-headlines.ts",
  mustBeOnTheCard: true,
};

const HEADLINES_PICK: CommandSpec = {
  label: "headlines pick 4, 9, 12",
  test: /^headlines\s+pick\s+([\d,\s#]+)$/i,
  unmistakable: /^\s*[`*_]*headlines\s+pick\s+[\d,\s#]+[`*_]*\s*$/i,
  what: "Headline commands",
  implementedIn: "src/lib/clients/precall-headlines.ts",
};

const PLAN: CommandSpec = {
  label: "plan approve",
  test: /^plan(?:\s+(new|approve|draft|(?:drop|swap)\s+[0-9]{1,2}|edit\s+[0-9]{1,2}\s*:\s*.+))?$/i,
  unmistakable:
    /^\s*[`*_]*plan(?:\s+(new|approve|draft|(?:drop|swap)\s+[0-9]{1,2}|edit\s+[0-9]{1,2}\s*:\s*.+))?[`*_]*\s*$/i,
  pointAt: "pre_call_pages",
  what: "Plan commands",
  implementedIn: "src/lib/clients/page-plan.ts",
  gatedIn: "src/lib/clients/pre-call-pages.ts",
};

const ANCHOR: CommandSpec = {
  label: "anchor: <key>",
  test: /^anchor(?:\s*:\s*(\S+))?$/i,
  unmistakable: /^\s*[`*_]*anchor(?:\s*:\s*\S+)?[`*_]*\s*$/i,
  pointAt: "pre_call_pages",
  what: "Plan commands",
  implementedIn: "src/lib/clients/page-plan.ts",
  gatedIn: "src/lib/clients/pre-call-pages.ts",
};

const HEADLINE_BATCH: CommandSpec = {
  label: "headline 3 pick 2",
  test: /^headline\s+([0-9]{1,2})\s+(?:pick\s+([0-9]{1,2})|(more))$/i,
  unmistakable: /^\s*[`*_]*headline\s+[0-9]{1,2}\s+(?:pick\s+[0-9]{1,2}|more)[`*_]*\s*$/i,
  what: "Page batch commands",
  implementedIn: "src/lib/clients/page-batch.ts",
  gatedIn: "src/lib/clients/pre-call-pages.ts",
};

const SKELETON: CommandSpec = {
  label: "skeleton",
  test: /^skeleton(?:\s+([0-9]{1,2})\s+more)?$/i,
  unmistakable: /^\s*[`*_]*skeleton(?:\s+[0-9]{1,2}\s+more)?[`*_]*\s*$/i,
  what: "Page batch commands",
  implementedIn: "src/lib/clients/page-batch.ts",
  gatedIn: "src/lib/clients/pre-call-pages.ts",
};

const EMOTIONAL: CommandSpec = {
  label: "emotional:\nthe lines",
  test: /^emotional\s*:\s*\n([\s\S]+)$/i,
  unmistakable: /^\s*[`*_]*emotional\s*:\s*\n/i,
  what: "Headline commands",
  implementedIn: "src/lib/clients/precall-headlines.ts",
};

// ── Step 28: the Day 0 photograph ────────────────────────────────────────────

const PHOTOGRAPH: CommandSpec = {
  label: "photograph",
  test: /^photograph$/i,
  unmistakable: /^\s*[`*_]*photograph[`*_]*\s*$/i,
  what: "The Day 0 photograph",
  implementedIn: "src/lib/clients/photograph.ts",
};

// ─────────────────────────────────────────────────────────────────────────────
// The table
//
// ‼️ ORDERED AS THE BOARD IS ORDERED so a reader can diff it against delivery-steps.ts by eye. Keys,
// never numbers: delivery-steps.ts renumbers every step whenever one is inserted.
// ─────────────────────────────────────────────────────────────────────────────

export const STEP_COMMANDS: Record<StepKey, readonly CommandSpec[]> = {
  // ── Before the call ───────────────────────────────────────────────────────
  intake_received: [],
  baseline_scan: [],
  site_dns_intel: [],
  nap_sweep: [],
  presence_sweep_manual: [],
  competitor_shortlist: [],
  avatar_confirmed: [AVATAR, AUDIENCE],
  review_audit: [],
  offer_proposed: [],
  offer_locked: [OFFER, TERMS, OUTCOME, PRICE, GUARANTEE, ...LETTER, REVIEW_LINK, REVIEW_PLATFORM],
  avatar_harvest: [
    PROMPT,
    PROMPT_SHORT,
    RUN,
    SHARE,
    RESEARCH,
    RESEARCH_REPLACE,
    AVATAR_SHEET,
    SHORT_OFFER,
    BELIEFS,
    ...LETTER,
  ],
  keyword_set: [
    KEYWORDS,
    KEYWORDS_PROMPT,
    KEYWORDS_ADD,
    KEYWORDS_APPROVE,
    KEYWORDS_APPROVE_SOME,
    KEYWORDS_DROP,
    KEYWORDS_MORE,
    KEYWORDS_SHORTLIST,
    KEYWORDS_SERP,
    SERP_CARDS,
    MAGNET_SET,
    STRATEGY,
    STRATEGY_APPROVE,
    STRATEGY_EDIT,
  ],
  custom_question_set: [OBJECTION],
  page_candidates: [],
  citation_cleanup_list: [],
  hub_preview: [TEMPLATE, TEMPLATE_RESET, TEMPLATE_PICK],
  referral_engine_preview: [TEMPLATE, TEMPLATE_RESET, TEMPLATE_PICK, REVIEW_LINK, REVIEW_PLATFORM],
  concierge_preview: [MASCOT, MASCOT_CONCEPTS, MASCOT_PICK, MASCOT_SKIP, MASCOT_CORNER, MASCOT_KEEP],
  site_replica: [TEMPLATE, TEMPLATE_RESET, TEMPLATE_PICK],
  review_card_pdf: [REVIEW_LINK, REVIEW_PLATFORM],
  pre_call_pages: [
    LADDER,
    RUNG,
    PILLAR,
    SUPPORTS,
    ANGLES,
    ANGLES_AUTO,
    ANGLE_PICK,
    ANGLE_MORE,
    HEADLINES,
    HEADLINES_PICK,
    EMOTIONAL,
    PLAN,
    ANCHOR,
    HEADLINE_BATCH,
    SKELETON,
    OUTCOME,
    PRICE,
    GUARANTEE,
  ],
  call_sheet: [],

  // ── On the call ───────────────────────────────────────────────────────────
  call_booked: [],
  call_held: [],
  access_granted: [],
  dns_records: [],
  agreement_signed: [],

  // ── After the call ────────────────────────────────────────────────────────
  day_zero_archive: [PHOTOGRAPH, AVATAR],
  gbp_buildout: [],
  citation_cleanup: [],
  subdomain_live: [],
  first_page: [],
  cards_printed: [],
  review_request_configured: [],
  referral_engine_handed: [REVIEW_LINK, REVIEW_PLATFORM],
  concierge_live: [],
  tracking_installed: [],
  self_report_field: [],
  time_log_entries: [],
  weekly_report: [],
  day_30_date: [],
};

/**
 * The commands that work in ANY of a client's threads.
 *
 * ‼️ THEY ARE NOT IN STEP_COMMANDS AND MUST NOT BE. Listing them under forty-one steps would make
 * every grammar line six items longer and would tell `ownersOf` that they are misroutable, which is
 * the one thing they are not.
 */
export const ANY_THREAD_COMMANDS: readonly CommandSpec[] = [
  {
    label: "rerun",
    test: /^(re-?run|restart)( this( step)?)?$/i,
    what: "Re-run this step",
    implementedIn: "src/lib/clients/step-rerun.ts",
  },
  {
    label: "gaps",
    test: /^\s*[`*_]*(gaps|missing|what is missing|whats missing)[`*_]*\s*\??\s*$/i,
    what: "What this step is still missing",
    implementedIn: "src/lib/clients/gap-thread.ts",
  },
  {
    label: "prompts",
    test: /^\s*[`*_]*prompts[`*_]*\s*\??\s*$/i,
    what: "The prompts that close the gaps",
    implementedIn: "src/lib/clients/gap-thread.ts",
  },
  {
    label: "suggest",
    test: /^\s*[`*_]*(suggest|suggestions|what next|whats next|what now)[`*_]*\s*\??\s*$/i,
    what: "What is worth doing next",
    implementedIn: "src/lib/clients/gap-thread.ts",
  },
  {
    label: "final prompt",
    test: /^\s*[`*_]*(final|full|whole|everything)\s+prompt[`*_]*\s*\??\s*$/i,
    what: "One prompt for the whole lead",
    implementedIn: "src/lib/clients/gap-thread.ts",
  },
  {
    label: "concierge install",
    test: /^\s*[`*_]*concierge\s+(install|include|decline|remove)\s*[`*_]*\s*$/i,
    what: "The concierge add-on",
    implementedIn: "src/lib/clients/concierge-addon.ts",
  },
  {
    // Where this client's PATIENTS book. Any thread, because it is a fact about the client and it
    // comes up on the prep call, not on the concierge step that eventually reads it.
    label: "booking: https://their-calendar.com/book",
    test: /^\s*[`*_]*booking\s*:\s*(.+?)\s*[`*_]*\s*$/i,
    unmistakable: /^\s*[`*_]*booking\s*:\s*\S/i,
    what: "Where their patients book",
    implementedIn: "src/lib/clients/concierge-booking.ts",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Derived. All pure.
// ─────────────────────────────────────────────────────────────────────────────

/** Every step whose thread accepts this spec, in board order. Identity, so one const covers many. */
export function stepsAccepting(spec: CommandSpec): readonly StepKey[] {
  return DELIVERY_STEPS.filter((s) => STEP_COMMANDS[s.key as StepKey]?.includes(spec)).map(
    (s) => s.key as StepKey
  );
}

/** What can be typed in this step's thread, plus what can be typed in any of them. */
export function commandsFor(stepKey: StepKey | null): readonly CommandSpec[] {
  if (!stepKey) return ANY_THREAD_COMMANDS;
  return [...(STEP_COMMANDS[stepKey] ?? []), ...ANY_THREAD_COMMANDS];
}

/**
 * Whose command is this, judged by the unmistakable forms only.
 *
 * ‼️ `unmistakable`, NEVER `test`. A handler's grammar is greedy inside its own thread; this speaks
 * in threads the command does not belong to, where the same words are usually somebody talking.
 */
export function ownersOf(text: string): { spec: CommandSpec; steps: readonly StepKey[] } | null {
  const t = text.trim();
  for (const step of DELIVERY_STEPS) {
    for (const spec of STEP_COMMANDS[step.key as StepKey] ?? []) {
      if (spec.unmistakable?.test(t)) return { spec, steps: stepsAccepting(spec) };
    }
  }
  return null;
}

/** One line naming everything this thread takes. Never a second bulleted list: the card has those. */
export function grammarLine(stepKey: StepKey | null): string {
  const own = stepKey ? STEP_COMMANDS[stepKey] ?? [] : [];
  if (!own.length) {
    return (
      "This step takes no typed commands at all. It closes on the buttons on its card, and `gaps` " +
      "says what it is still waiting for."
    );
  }
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const s of own) {
    if (seen.has(s.label)) continue;
    seen.add(s.label);
    labels.push(`\`${s.label}\``);
  }
  return labels.join(", ");
}

// ─────────────────────────────────────────────────────────────────────────────
// Is this addressed to the machine?
// ─────────────────────────────────────────────────────────────────────────────

export type CommandVerdict =
  /** The words somebody types when nothing is moving. Always answered, never sent to a model. */
  | { kind: "move_on" }
  /** This thread's own grammar, which no handler claimed. The table and the handler disagree. */
  | { kind: "this_thread"; spec: CommandSpec }
  /** Command-shaped, owned by nobody. A typo, or a command that was never built. */
  | { kind: "shaped" };

/**
 * ‼️ `what next` AND FRIENDS ARE NOT HERE. gap-thread.ts owns `suggest`, `suggestions`, `what next`,
 * `whats next` and `what now` in EVERY thread, so they are answered long before this runs. Putting
 * them here would be dead code that reads like coverage.
 */
const MOVE_ON =
  /^(approve|approved|done|next|next\s+step|finish|finished|complete|completed|continue|proceed|move\s+on|move\s+forward|ready|go|go\s+ahead|help|stuck|now\s+what)$/i;

/**
 * One of these and it is a sentence, whatever else it looks like.
 *
 * "can you approve the letter" carries three. `letter approve 3f2a1b` carries none. That is the
 * whole of the discrimination, and it is deliberately blunt: every rule in `commandish` below exists
 * to LOSE ground rather than gain it.
 */
const PROSE =
  /\b(the|a|an|is|are|am|i|we|you|it|this|that|my|our|your|can|could|should|would|will|please|how|why|when|where|who|what|do|does|did|was|were|about|for|with|think|thanks|thank)\b/i;

/** The first word of something typed AT the board rather than to a person. */
const VERBS =
  /^(letter|offer|terms|outcome|price|guarantee|keyword|keywords|objection|review|plan|anchor|ladder|rung|pillar|supports|angle|angles|magnet|magnets|headline|headlines|skeleton|mascot|mascots|avatar|audience|research|prompt|prompts|run|share|template|templates|skin|design|pick|photograph|emotional|beliefs|concierge|batch|gaps|rerun|approve|draft|publish|use|text|replace|add|drop|more|reset|new|edit|swap)$/i;

/**
 * Is this message addressed to the board, and did nothing take it?
 *
 * ‼️ CONSERVATIVE ON PURPOSE, AND THE STANDARD IS looksLikePastedList's. A step thread also takes
 * real questions for the assistant. A false positive answers one of those with a command list, which
 * is worse than the essay this exists to prevent. So three of the four arms below are exact table
 * matches, and the residual arm has to get past six separate refusals before it will claim anything.
 */
export function commandish(text: string, stepKey: StepKey | null): CommandVerdict | null {
  const raw = text.trim().replace(/^[`*_]+|[`*_]+$/g, "").trim();
  if (!raw) return null;

  // 1. Trying to move forward, with nothing moving. Matthew's own case.
  if (MOVE_ON.test(raw)) return { kind: "move_on" };

  // 2. This thread's OWN grammar, unclaimed. The table and the handler disagree about something,
  //    which at runtime is worth saying plainly. _probe-step-grammar.ts is what stops it twice.
  const mine = commandsFor(stepKey).find((s) => s.test.test(raw));
  if (mine) return { kind: "this_thread", spec: mine };

  // 3. Another step's. Unreachable: misroutedCommand claimed it upstream. Asserted by the probe.
  if (ownersOf(raw)) return null;

  // 4. The residual: a typo, or a command somebody believes in that was never built.
  if (/\r?\n/.test(raw)) return null; // Dictation. pastedListPointer owns the list shape.
  if (raw.endsWith("?")) return null; // A question is a question, always.
  if (/[.!]$/.test(raw)) return null; // Somebody talking. The same test looksLikePastedList uses.
  const words = raw.split(/\s+/);
  if (words.length > 4 || raw.length > 40) return null;
  if (PROSE.test(raw)) return null;
  if (/^[a-z][a-z ]{1,20}:/i.test(raw)) return { kind: "shaped" };
  if (VERBS.test(words[0])) return { kind: "shaped" };
  return null;
}

/** Every step has an entry. Exported so the probe can assert it without re-deriving the list. */
export function stepsWithoutGrammar(): string[] {
  return DELIVERY_STEPS.filter((s) => STEP_COMMANDS[s.key as StepKey] === undefined).map((s) => s.key);
}

/** How a step reads in a pointer: "step 10, Prep call: ...". The number is always computed. */
export function stepPhrase(key: StepKey): string {
  const step = DELIVERY_STEPS.find((s) => s.key === key);
  return step ? `step ${stepNumber(key)}, ${step.label}` : key;
}
