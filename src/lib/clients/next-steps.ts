// Every card ends by saying what can be done next.
//
// Matthew called this out by name and it is acceptance criteria, not a nice-to-have: "every
// Mission Control button that starts something, and every workflow card that completes, ends by
// printing what can be done next. A card that completes and offers nothing is the bug."
//
// ─────────────────────────────────────────────────────────────────────────────
// ‼️ ONE FUNCTION, BECAUSE THE ALTERNATIVE ALREADY WENT WRONG ONCE IN THIS REPO.
//
// designSection() in hub-skin.ts is the precedent and its docstring is the argument: two steps
// printed the same options, the wording drifted between them, and there was nowhere for a fourth
// version to appear. The same shape is about to be added to roughly thirty `instructionsFor`
// arms, three confirmation replies, two refusal renderers and one card resolver. Copying it
// thirty times guarantees thirty dialects of it.
//
// ‼️ IT IS DERIVED FROM DELIVERY_STEPS, NEVER TYPED. What comes next is a function of what is
// done and what each step is blockedBy, which is exactly what reachableCursor already answers.
// A hand-written "next" would be a step number in a sentence, which is the thing
// _probe-step-numbers.ts exists to stop.
//
// ‼️ EVERY LINE HERE ENDS UP INSIDE bodySections(). A card body over 3,000 characters fails the
// WHOLE Slack message, silently, so this is deliberately short: at most a handful of lines, and
// the caller's own content always comes first.
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseAdmin } from "@/lib/db";
import { DELIVERY_STEPS, stepNumber, type StepKey } from "@/config/delivery-steps";

/** The same fallback step-engine.ts uses. A second one would send half the links elsewhere. */
function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";
}

/** How a step reads in a sentence: "16. Hub preview". The number is always computed. */
export function stepLabel(key: StepKey): string {
  const step = DELIVERY_STEPS.find((s) => s.key === key);
  return step ? `${stepNumber(key)}. ${step.label}` : key;
}

interface BoardState {
  done: Set<string>;
  /** step_key to status, for everything on the board. */
  status: Map<string, string>;
}

async function boardState(clientId: string): Promise<BoardState> {
  const { data } = await supabaseAdmin
    .from("client_delivery_steps")
    .select("step_key, status")
    .eq("client_id", clientId);

  const status = new Map<string, string>();
  const done = new Set<string>();
  for (const row of data ?? []) {
    const key = row.step_key as string;
    const s = row.status as string;
    status.set(key, s);
    if (s === "complete" || s === "skipped") done.add(key);
  }
  return { done, status };
}

/**
 * The step that becomes workable once `key` is done, if any.
 *
 * ‼️ IT ASKS WHAT IS BLOCKED ON THIS STEP, NOT WHAT IS NEXT IN THE ARRAY. Those differ constantly:
 * the array is one order and the dependency graph is another, and printing "next: 17" for a step
 * that unblocks nothing is how a card sends somebody to work that is not ready. If nothing is
 * waiting on this step, that is a real answer and this returns null rather than the next index.
 */
function unblockedBy(key: StepKey, done: Set<string>): StepKey | null {
  for (const step of DELIVERY_STEPS) {
    if (done.has(step.key) || step.key === key) continue;
    const blockers = step.blockedBy ?? [];
    if (!blockers.includes(key)) continue;
    // Only if THIS step is the last thing holding it up. A step still blocked by two others is
    // not what happens next, and saying it is would be a card promising work that will refuse.
    if (blockers.every((b) => b === key || done.has(b))) return step.key as StepKey;
  }
  return null;
}

/** The first step that is neither done nor blocked. What the board would open on. */
function firstOpen(done: Set<string>): StepKey | null {
  for (const step of DELIVERY_STEPS) {
    if (done.has(step.key)) continue;
    if ((step.blockedBy ?? []).some((b) => !done.has(b))) continue;
    return step.key as StepKey;
  }
  return null;
}

export interface NextStepOptions {
  /** Lines the caller wants above the derived ones. Its own commands, its own links. */
  own?: string[];
  /** Treat this step as finished when working out what follows. Set on a completion card. */
  asDone?: boolean;
  /** Where the board should open. Defaults to the client page. */
  panel?: string;
}

/**
 * The `*Next:*` block for one step's card.
 *
 * Returns [] rather than a heading with nothing under it: a "Next" that lists nothing is worse
 * than no heading, and the last step on the board legitimately has nothing after it.
 */
export async function nextStepLines(
  clientId: string,
  key: StepKey,
  opts: NextStepOptions = {}
): Promise<string[]> {
  const { done } = await boardState(clientId);
  if (opts.asDone) done.add(key);

  const lines: string[] = [...(opts.own ?? [])];

  const following = unblockedBy(key, done);
  if (following) {
    lines.push(`  • Then *${stepLabel(following)}*, which this one unblocks.`);
  } else if (opts.asDone) {
    const open = firstOpen(done);
    // ‼️ "NOTHING IS WAITING ON THIS" IS SAID OUT LOUD RATHER THAN LEFT BLANK. A completion card
    // that simply stops reads as though the board ended, and on a step that unblocks nothing
    // (most of the reporting ones) that is wrong every time.
    lines.push(
      open && open !== key
        ? `  • Nothing was waiting on this one. The board's next open step is *${stepLabel(open)}*.`
        : "  • Nothing else is waiting on this one."
    );
  }

  lines.push(`  • The whole board: ${appUrl()}/dashboard/clients/${clientId}${opts.panel ? `#${opts.panel}` : ""}`);

  return lines.length ? ["*Next:*", ...lines] : [];
}

/**
 * The same block for somewhere that has no client to look up, or must not hit the database.
 *
 * ‼️ refusalText AND confirmationText ARE SYNCHRONOUS AND ARE CALLED INSIDE THE BUTTON PATH.
 * Making them async to add a board read would put a query between a person's tap and the reply
 * Slack is waiting three seconds for. They get this instead: no derived next step, just the
 * caller's own lines and the board link, which is the half that is always true.
 */
export function nextStepLinesSync(clientId: string, own: string[] = [], panel?: string): string[] {
  const lines = [...own, `  • The whole board: ${appUrl()}/dashboard/clients/${clientId}${panel ? `#${panel}` : ""}`];
  return ["*Next:*", ...lines];
}
