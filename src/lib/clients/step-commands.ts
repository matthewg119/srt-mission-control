// A step command typed in the wrong step's thread.
//
// ‼️ MEASURED BEFORE IT WAS WRITTEN (2026-09-11). A card keeps the number it was posted with, and
// inserting steps renumbers the board, so after the prep call moved to step 11 the channel still
// held a card reading "11. Findings written up" (now step 13) and one reading "14. Citation
// cleanup list" (now 17). Matthew replied `terms:` in the first and pasted two keyword lists into
// the second, exactly as he had been told to by number. Neither is a command in those threads, so
// both fell through to the general assistant, which answered each with an essay, and nothing was
// saved. The reply looked like the system working.
//
// So a line that is unmistakably a command for ANOTHER step now gets a pointer to that step and
// an explicit "nothing was saved", never an answer. The patterns are the same anchored forms the
// owning handlers accept, so a sentence that merely mentions keywords or a plan still reaches the
// assistant.

import { supabaseAdmin } from "@/lib/db";
import { slackThreadLink } from "@/lib/slack-bot";
import { DELIVERY_STEPS, isStepKey, stepNumber, type StepKey } from "@/config/delivery-steps";

const OWNERS: ReadonlyArray<{ test: RegExp; step: StepKey; what: string }> = [
  { test: /^\s*[`*_]*(offer|terms)\s*:/i, step: "offer_locked", what: "The offer and the words customers use for it" },
  {
    // `check` is deliberately absent: `keywords check` was removed on 2026-09-12 and is dictation
    // now, so pointing somebody at another thread for it would send them to a command that is not
    // there any more.
    test: /^\s*[`*_]*keywords\s+(approve\b|drop\s+\d|add\s*:|more\s+\S)/i,
    step: "keyword_set",
    what: "Keyword commands",
  },
  {
    test: /^\s*[`*_]*(plan(\s+(new|approve|(drop|swap)\s+\d{1,2}|edit\s+\d{1,2}\s*:.+))?|anchor(\s*:\s*\S+)?)\s*[`*_]*\s*$/i,
    step: "pre_call_pages",
    what: "Plan commands",
  },
];

/** Which step a command belongs to, or null when the text is not one. Pure, for the probe. */
export function commandOwner(text: string): { step: StepKey; what: string } | null {
  const hit = OWNERS.find((o) => o.test.test(text.trim()));
  return hit ? { step: hit.step, what: hit.what } : null;
}

/** Where a step's thread is, in words a person can click. Shared by both pointers below. */
async function whereStepLives(clientId: string, stepKey: StepKey): Promise<string> {
  const { data } = await supabaseAdmin
    .from("client_delivery_steps")
    .select("slack_anchor_ts")
    .eq("client_id", clientId)
    .eq("step_key", stepKey)
    .maybeSingle();

  const { channelFor } = await import("./step-board");
  const channel = await channelFor(clientId);
  const ts = (data as { slack_anchor_ts?: string | null } | null)?.slack_anchor_ts ?? null;

  return ts && channel
    ? `Its thread: ${slackThreadLink(channel, ts)}`
    : "That step has not been posted yet. Its card appears in this channel when the board reaches it.";
}

/** The pointer to post, or null when the command is in the right thread or is not a command. */
export async function misroutedCommand(input: {
  clientId: string;
  stepKey: string | null;
  text: string;
}): Promise<string | null> {
  const owner = commandOwner(input.text);
  if (!owner || input.stepKey === owner.step) return null;

  const label = DELIVERY_STEPS.find((s) => s.key === owner.step)?.label ?? owner.step;
  const here = input.stepKey && isStepKey(input.stepKey) ? ` This thread is step ${stepNumber(input.stepKey)}.` : "";

  return [
    `:point_right: *Nothing was saved.* ${owner.what} go in *step ${stepNumber(owner.step)}, ${label}*, not here.${here}`,
    await whereStepLives(input.clientId, owner.step),
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// A pasted LIST, which is not a command anywhere and used to reach the assistant
//
// ‼️ MEASURED ON SRT, 2026-09-11 AND AGAIN 2026-09-12. Matthew pasted two lists of keyword and
// hook ideas into the PREP CALL's thread. `commandOwner` matches the anchored command forms
// (`keywords add:`, `keywords approve`, ...) and a bare list matches none of them, so nothing
// claimed it, it fell through to the general assistant, and the answer was a "Strategic
// Assessment" essay about his own list. Nothing was stored: client_keywords still had zero rows.
//
// The failure is not that the guard was wrong, it is that a list with no prefix is unmistakable in
// INTENT and lands nowhere. So it gets the same treatment a misrouted command gets: say plainly
// that nothing was saved, and say where it goes.
//
// ‼️ IT NEVER SAVES THE LIST ITSELF, and that is deliberate rather than lazy. `keywords add:` runs
// inside the keyword step's context: this client's audience, the offer fingerprint the expansion
// was written for, and the ranked set a person then approves. Storing phrases from another
// thread would put rows in client_keywords that belong to no fingerprint and that nobody approved,
// which is the one thing the whole keyword step exists to prevent.
// ─────────────────────────────────────────────────────────────────────────────

/** Five is a list. Fewer is a sentence with line breaks in it. */
const LIST_MIN_LINES = 5;

/** Longer than this is prose, whatever else it looks like. */
const PHRASE_MAX_CHARS = 90;
const PHRASE_MAX_WORDS = 14;

export interface PastedList {
  /** The lines with their bullets and numbers stripped, in order. */
  lines: string[];
  numbered: boolean;
}

/**
 * Does this message look like a pasted list of phrases?
 *
 * ‼️ CONSERVATIVE ON PURPOSE. This thread also takes dictation: research pastes, call notes, and
 * questions somebody is actually asking the assistant. A false positive answers a real question
 * with a pointer, which is worse than the essay this exists to prevent. So it wants FIVE or more
 * phrase-shaped lines, and at least seventy per cent of what was pasted has to be phrase-shaped
 * before it will claim the message at all.
 *
 * A line ending in a full stop or an exclamation mark is somebody TALKING. A question mark is not:
 * half the keyword set is questions ("why isn't my med spa on ChatGPT").
 */
export function looksLikePastedList(text: string): PastedList | null {
  const raw = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (raw.length < LIST_MIN_LINES) return null;

  // A heading ("Mechanism-led (AEO / visibility angle):") is not a phrase and is not counted
  // against the list either. addList() in keyword-expansion.ts drops these the same way.
  const body = raw.filter((l) => !/:\s*$/.test(l));
  if (body.length < LIST_MIN_LINES) return null;

  const bulletted = body.filter((l) => /^(\d+[.)]|[-*•])\s+/.test(l)).length;
  const stripped = body.map((l) => l.replace(/^(\d+[.)]|[-*•])\s+/, "").trim()).filter(Boolean);

  const phrases = stripped.filter(
    (l) =>
      l.length >= 4 &&
      l.length <= PHRASE_MAX_CHARS &&
      !/[.!]$/.test(l) &&
      l.split(/\s+/).length <= PHRASE_MAX_WORDS
  );

  if (phrases.length < LIST_MIN_LINES) return null;
  if (phrases.length < Math.ceil(stripped.length * 0.7)) return null;

  return { lines: stripped, numbered: bulletted >= LIST_MIN_LINES };
}

/**
 * The pointer for a pasted list, or null when the message is not one.
 *
 * In the keyword step's OWN thread it is a missing prefix rather than a wrong room, and the answer
 * says so: the list is right, put three words in front of it.
 */
export async function pastedListPointer(input: {
  clientId: string;
  stepKey: string | null;
  text: string;
}): Promise<string | null> {
  // Anything that IS a command is already handled, including in the wrong thread.
  if (commandOwner(input.text)) return null;

  const list = looksLikePastedList(input.text);
  if (!list) return null;

  const count = list.lines.length;
  const label = DELIVERY_STEPS.find((s) => s.key === "keyword_set")?.label ?? "Keywords";

  if (input.stepKey === "keyword_set") {
    return [
      `:point_right: *Nothing was saved.* That looks like ${count} phrases, and a list on its own is ` +
        `dictation even here.`,
      "Put `keywords add:` on the line above it and every one of them is stored, ranked against " +
        "this client's offer, and waiting for `keywords approve`.",
    ].join("\n");
  }

  const here =
    input.stepKey && isStepKey(input.stepKey) ? ` This thread is step ${stepNumber(input.stepKey)}.` : "";

  return [
    `:point_right: *Nothing was saved.* That looks like ${count} phrases. Keyword lists go in ` +
      `*step ${stepNumber("keyword_set")}, ${label}*, with \`keywords add:\` in front of them.${here}`,
    await whereStepLives(input.clientId, "keyword_set"),
  ].join("\n");
}
