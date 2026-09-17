// `gaps` and `prompts`, in any of a client's threads.
//
// Matthew, 2026-09-17: "each answer we get in every thread has context on everything so it can make
// direct suggestions based on the context of the specific lead (very useful for step reruns)."
//
// Two words, and they are the doors to W2 and W2b:
//   gaps      what this step is still missing, what each one blocks, and the command that fills it
//   prompts   the thing to actually run or fill in, carrying what we already know about this client
//
// ‼️ THEY WORK IN ANY OF THE CLIENT'S THREADS, the same "come back later" door concierge-addon.ts
// opens. A person reading a card three steps back should be able to ask what is missing without
// hunting for the right thread, and the step a bare `gaps` means is the one the board is waiting on.
//
// ‼️ ONE LEAD SCOPE AROUND THE WHOLE REPLY. Both commands read the same lead, and `prompts` reads it
// again to build from. Without the scope that is two full assemblies for one message.
//
// ‼️ NOTHING HERE WRITES TO THE CLIENT. It reads, and it posts. The answers still come back through
// the commands the gap list names, which are the same ones that were always there.

import { isStepKey, stepNumber, type StepKey } from "@/config/delivery-steps";
import { withLeadScope } from "./lead-scope";
import { leadContext, isHeld } from "./lead-context";
import { gapsFrom, gapLines } from "./step-gaps";
import { gapPromptMessage, promptsFromGaps } from "./gap-prompts";

/** `gaps`, and the two ways people actually say it. */
const GAPS = /^\s*[`*_]*(gaps|missing|what is missing|whats missing)[`*_]*\s*\??\s*$/i;

/**
 * `prompts`, plural only.
 *
 * ‼️ SINGULAR `prompt` IS TAKEN, and by a command that does something else. framework-thread.ts owns
 * an exact-match /^prompt$/ on step 11 and renders the compact research prompt from it. Matching the
 * singular here would shadow it on the one step where both are most likely to be typed.
 */
const PROMPTS = /^\s*[`*_]*prompts[`*_]*\s*\??\s*$/i;

/**
 * `suggest`, and the ways a person actually asks the question.
 *
 * ‼️ NOT THE SAME QUESTION AS `gaps`. gaps answers "what does this step still need", which is about
 * one step's declared inputs. This answers "what is worth doing next", whose answers can be things
 * no step asks for: a different rung, a second audience, more keywords where the build is pointed.
 */
const SUGGEST = /^\s*[`*_]*(suggest|suggestions|what next|whats next|what now)[`*_]*\s*\??\s*$/i;

export interface GapThreadInput {
  clientId: string;
  /** The step whose thread this is, or null in the pinned header thread. */
  stepKey: string | null;
  text: string;
  by: string;
  channel: string;
  threadTs: string;
}

export type GapThreadReply = { message: string; after?: () => Promise<void> } | null;

export async function handleGapThreadReply(input: GapThreadInput): Promise<GapThreadReply> {
  const text = input.text.trim();
  const wantsGaps = GAPS.test(text);
  const wantsPrompts = PROMPTS.test(text);
  const wantsSuggestions = SUGGEST.test(text);
  if (!wantsGaps && !wantsPrompts && !wantsSuggestions) return null;

  return withLeadScope(async () => {
    // `suggest` argues from the keywords and the pages as well as the documents, so it needs more
    // than CARD_SLICES. One read either way: the scope memoizes on the slice list.
    const ctx = await leadContext(
      input.clientId,
      wantsSuggestions ? { include: ["core", "documents", "gaps", "keywords", "pages"] } : {}
    );

    // The step this is about: the thread's own, else whatever the board is waiting on. A bare `gaps`
    // in the pinned thread should answer the question a person is actually asking.
    const fromThread = input.stepKey && isStepKey(input.stepKey) ? (input.stepKey as StepKey) : null;
    const cursor = isHeld(ctx.board.cursor) ? ctx.board.cursor.value : null;
    const stepKey = fromThread ?? cursor;

    // ‼️ SUGGESTIONS DO NOT NEED A STEP. A board with everything done or blocked is exactly when
    // "what next" is worth asking, and answering it with "there is nothing this is waiting on" is
    // the wall the suggestion lane exists to replace.
    if (wantsSuggestions) {
      const { suggestionsFor, suggestionLines } = await import("./suggestions");
      return { message: suggestionLines(suggestionsFor(ctx, stepKey)).join("\n") };
    }

    if (!stepKey) {
      return {
        message:
          ":information_source: Every step is either done or blocked, so there is nothing this is " +
          "waiting on. `rerun step <n>` re-opens one.",
      };
    }

    const where = fromThread ? "" : ` (step ${stepNumber(stepKey)}, which the board is waiting on)`;
    const g = gapsFrom(ctx, stepKey);

    if (wantsGaps) {
      return { message: [...gapLines(g), ...(where ? [`_Asked from outside a step thread${where}._`] : [])].join("\n") };
    }

    // ── prompts ──────────────────────────────────────────────────────────────────────────────
    const built = await promptsFromGaps(input.clientId, g);
    if (!built.ok) {
      return { message: `:warning: No prompts: ${built.error}` };
    }
    if (!built.prompts.length) {
      return {
        message: `:white_check_mark: Nothing to research for step ${stepNumber(stepKey)}${where}. Everything it needs is on file.`,
      };
    }

    const total = built.prompts.reduce((n, p) => n + p.fills, 0);
    const summary = [
      `:page_facing_up: *${built.prompts.length} prompt${built.prompts.length === 1 ? "" : "s"} for step ${stepNumber(stepKey)}${where}*`,
      `Between them they fill ${total} declared field${total === 1 ? "" : "s"}. Each one is its own message below, ready to copy whole.`,
      "",
      ...built.prompts.map((p) => `  • *${p.title}* fills ${p.fills}`),
    ].join("\n");

    return {
      message: summary,
      // ‼️ ONE MESSAGE PER PROMPT, POSTED AFTER. A prompt runs to thousands of characters and a card
      // body over 3,000 fails the WHOLE message, so they cannot be folded into the summary above.
      after: async () => {
        const { postClientReply } = await import("./client-events");
        for (const p of built.prompts) {
          const posted = await postClientReply({
            clientId: input.clientId,
            stepKey,
            channel: input.channel,
            threadTs: input.threadTs,
            text: gapPromptMessage(p),
          });
          // slackFetch returns {ok:false} and never throws, so the body is what is checked.
          if (!posted || (posted as { ok?: boolean }).ok === false) {
            console.error(`[gap-thread] posting the ${p.key} prompt failed`);
          }
        }
      },
    };
  });
}
