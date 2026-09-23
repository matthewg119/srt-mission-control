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
import { commandish, grammarLine, ownersOf, stepPhrase, type CommandVerdict } from "./step-grammar";

/**
 * Which step a command belongs to, or null when the text is not one. Pure, for the probe.
 *
 * ‼️ THE TABLE MOVED TO step-grammar.ts ON 2026-09-22, AND THE SHAPE OF THIS DID NOT. Five probes
 * assert `commandOwner(x)?.step` directly (_probe-headline-first, _probe-keywords, _probe-mascot,
 * _probe-review-link, _probe-gaps), so it still answers with exactly one step even where several
 * accept the command. `pointAt` is which one it names; `ownersOf` knows all of them.
 *
 * The OWNERS array this replaced listed six command families by hand out of the sixteen handlers
 * that gate on a step. `letter ...` was one of the ten it did not list, which is why `letter approve`
 * typed in step 11 got no pointer, reached the assistant, and came back as an invented button.
 */
export function commandOwner(text: string): { step: StepKey; what: string } | null {
  const hit = ownersOf(text);
  if (!hit) return null;
  return { step: hit.spec.pointAt ?? hit.steps[0], what: hit.spec.what };
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
  const hit = ownersOf(input.text);
  if (!hit) return null;

  // ‼️ EVERY STEP THAT ACCEPTS IT, NOT JUST THE ONE THE POINTER NAMES. Four families are shared:
  // `review link:` is taken by four steps, the offer details by two, `avatar:` by two and the skin
  // commands by three. Comparing against the named step alone told somebody typing `review link:`
  // in step 35's thread, which takes it, that nothing was saved.
  if (input.stepKey && hit.steps.includes(input.stepKey as StepKey)) return null;

  const owner = { step: hit.spec.pointAt ?? hit.steps[0], what: hit.spec.what };
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

// ─────────────────────────────────────────────────────────────────────────────
// Anything else typed at a step, which used to reach the assistant with no guard rail
//
// ‼️ MEASURED 2026-09-22. `letter approve` in step 11's thread matched no handler, matched no entry
// in the table above, and reached the general assistant, which answered with "press the Approve
// button on the delivery board at step offer_locked". There is no Approve button on any card. The
// person was stuck, and the reply looked like the system working.
//
// Matthew: "whenever we finish a step in onboarding and we type something that is not right, make
// sure it resends the message we need to click to move forward or to give us the next steps."
//
// ‼️ IT DOES NOT CLAIM QUESTIONS, AND THAT IS THE WHOLE DIFFICULTY. A step thread takes real
// questions for the assistant, and answering one of those with a command list is worse than the
// essay this exists to prevent. commandish() in step-grammar.ts holds that line: three of its four
// arms are exact table matches and the fourth refuses six times before it claims anything.
// ─────────────────────────────────────────────────────────────────────────────

/** The step the board is actually waiting at, for a message that belongs to no step. */
async function waitingStep(clientId: string): Promise<StepKey | null> {
  const { data } = await supabaseAdmin
    .from("client_delivery_steps")
    .select("step_key, status")
    .eq("client_id", clientId)
    .in("status", ["awaiting_me", "ready", "error"]);

  const open = new Set((data ?? []).map((r) => (r as { step_key: string }).step_key));
  const hit = DELIVERY_STEPS.find((s) => open.has(s.key));
  return hit ? (hit.key as StepKey) : null;
}

/**
 * What to say when nothing took the message, or null to let the assistant answer it.
 *
 * ‼️ IT RETURNS LINES, NOT A POST. The route builds the buttons and posts, so this pointer, the
 * misrouted one and the pasted-list one all go out through one door and all three carry the same
 * three buttons. Three posting paths would eventually disagree about which of them gets them.
 */
export async function unclaimedReply(input: {
  clientId: string;
  stepKey: string | null;
  text: string;
}): Promise<{ lines: string[]; reason: CommandVerdict["kind"] } | null> {
  const key = input.stepKey && isStepKey(input.stepKey) ? (input.stepKey as StepKey) : null;
  const verdict = commandish(input.text, key);
  if (!verdict) return null;

  const typed = input.text.trim().replace(/\s+/g, " ").slice(0, 60);
  const lines: string[] = [];

  if (verdict.kind === "move_on") {
    lines.push(
      ":point_right: *Nothing here is waiting on a word from me.* A step closes on the buttons on " +
        "its card, and they are on this message."
    );
  } else if (verdict.kind === "this_thread") {
    lines.push(
      `:point_right: *Nothing happened.* \`${typed}\` is one of this thread's own commands and ` +
        "nothing took it, so either the argument is wrong or this step is not ready for it yet."
    );
  } else {
    lines.push(`:point_right: *Nothing happened, and nothing was saved.* \`${typed}\` is not a command here.`);
  }

  // The pinned header thread belongs to the CLIENT, not to any step, so it has no grammar and no
  // buttons to offer. The useful answer is where the board actually is.
  if (!key) {
    lines.push(
      "This is the client's own thread rather than a step's, and every command belongs to a step's thread."
    );
    const next = await waitingStep(input.clientId);
    if (next) {
      lines.push(`The board is waiting at *${stepPhrase(next)}*.`, await whereStepLives(input.clientId, next));
    }
    return { lines, reason: verdict.kind };
  }

  lines.push(`This thread is ${stepPhrase(key)}.`);
  lines.push(`*It takes:* ${grammarLine(key)}`);

  // ‼️ THE CARD'S OWN BULLETS, NOT A PARAPHRASE. doThisNowLines is what the step card prints, so a
  // person reading this message and a person reading the card are told the same thing in the same
  // words. A failure here costs the bullets and never the reply: being told nothing happened
  // matters more than being told what to do about it.
  try {
    const { withLeadScope } = await import("./lead-scope");
    await withLeadScope(async () => {
      const { doThisNowLines, readinessFor } = await import("./do-this-now");
      const readiness = await readinessFor(input.clientId, key);
      const todo = doThisNowLines(key, { readiness });
      if (todo.length) lines.push("", ...todo);
    });
  } catch (e) {
    console.error(`[step-commands] backstop bullets failed for ${key}: ${(e as Error).message}`);
  }

  return { lines, reason: verdict.kind };
}
