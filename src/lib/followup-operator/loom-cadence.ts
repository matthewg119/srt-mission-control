/**
 * The follow-up ladder that starts when the Loom goes out. Two rungs, and that is the whole thing.
 *
 *   D+3   email    the nudge
 *   D+7   call     the phone follow-up
 *
 * ‼️ THIS REPLACES THE COLD LADDER AS THE ONLY WAY INTO THE FOLLOW-UPS BOARD, and that is a
 * deliberate narrowing rather than a second system running alongside the first. Matthew, 2026-09-03:
 * "every message in follow ups channel should be from people we already sent the loom to."
 *
 * The old PERMISSION_SEQUENCE (D0/D+1/D+2/D+4/D+7) is the COLD ladder: five touches earning
 * permission from somebody who has never heard of us. It still exists and email-assistant.ts still
 * owns its words, but nothing enrols into it any more. A prospect is created at exactly one moment
 * now, the Loom handover, so "is this person on the board" and "did they get the Loom" are the same
 * question and cannot drift apart.
 *
 * ‼️ ANCHORED ON THE LOOM SEND, NEVER ON THE LAST TOUCH. `first_sent_at` holds the moment the Loom
 * was handed over, so a nudge approved two days late does not drag the call two days with it. Same
 * doctrine as nextTouchAt() in cadence.ts, and the reason is the same: the ladder describes the
 * prospect's experience of time, not ours.
 */
import { snapTo9amET } from "./cadence";
import type { OutreachProspectRow } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface LoomRung {
  /** Days after the Loom went out. */
  day: number;
  channel: "email" | "call";
  /** What the card says this touch is for. */
  label: string;
}

/**
 * ‼️ TWO RUNGS, AND ADDING A THIRD IS A PRODUCT DECISION, NOT A TIDY-UP. Everything below derives
 * from this array: the schedule, the channel, the label, and when the ladder is spent.
 */
export const LOOM_LADDER: readonly LoomRung[] = [
  {
    day: 3,
    channel: "email",
    label: "nudge, 3 days after the Loom",
  },
  {
    day: 7,
    channel: "call",
    label: "phone follow-up, 7 days after the Loom",
  },
] as const;

/** How many rungs there are. */
export function loomSteps(): number {
  return LOOM_LADDER.length;
}

/**
 * When the next touch is due, or null once the ladder is spent.
 *
 * `step` is how many touches have already happened, so step 0 means "the Loom just went out, the
 * next thing is rung 1". Snapped to 09:00 ET because that is when the digest runs, so anything due
 * earlier in the day is due at the top of it.
 */
export function loomNextTouch(step: number, loomSentAt: Date): Date | null {
  const rung = LOOM_LADDER[step];
  if (!rung) return null;
  return snapTo9amET(new Date(loomSentAt.getTime() + rung.day * DAY_MS));
}

/**
 * Which channel this prospect is due on.
 *
 * ‼️ READ OFF THE LADDER, NOT INFERRED FROM STATE. cadence.ts's channelFor() earns a call from
 * step count and silence, which is right for a cold sequence where a call is an escalation. Here
 * the call is not an escalation, it is rung 2, scheduled the moment the Loom went out. Deciding it
 * any other way would let a prospect reach day 7 and get another email.
 */
export function loomChannelFor(p: Pick<OutreachProspectRow, "step">): "email" | "call" {
  return LOOM_LADDER[Math.max(0, p.step)]?.channel ?? "call";
}

/** What this touch is, for the card. */
export function loomStepLabel(step: number): string {
  const rung = LOOM_LADDER[step];
  if (!rung) return "ladder spent";
  return rung.label;
}

/** True once every rung has been spent, so the row should stop appearing. */
export function loomLadderSpent(step: number): boolean {
  return step >= LOOM_LADDER.length;
}
