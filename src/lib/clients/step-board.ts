// The delivery board: one top-level Slack message per delivery step, and a pinned header.
//
// ‼️ THIS EXISTS BECAUSE THE OLD SHAPE WAS UNWORKABLE, NOT BECAUSE IT WAS UGLY.
//
// Every message an onboarding produced went through notifyThread(), which posts to
// clients.ops_thread_ts and nothing else. One real run put roughly eighteen replies under a
// single thread inside ninety seconds: the checklist, the site and DNS intelligence, the
// baseline scan, the prompt drop, the report, the competitor shortlist, the WhatsApp drafts,
// two [Done] cards and an outreach intake block. Every one of them was correct. None of them
// corresponded to a step, so there was no way to work one step at a time.
//
// The rule this module enforces: a step's work lives in THAT STEP'S THREAD, and the channel
// carries one scannable line per step. If you are about to post something about a step to
// ops_thread_ts, you want notifyStep() instead. notifyThread() survives only for the handful
// of things that belong to the CLIENT rather than to any step (the intro draft, the monthly
// reports).
//
// ‼️ EDIT, NEVER RE-POST. Slack orders a channel by post time, so the thirty-three read in
// step order only as long as each one is posted once and then updated in place. Deleting and
// re-posting moves a step to the bottom of the channel and breaks the reading order
// permanently. Every state change here is a chat.update.
//
// ‼️ EVERY SLACK RESULT IS CHECKED. slackFetch returns { ok: false } and never throws, so a
// `.catch(() => {})` around a Slack call catches nothing and a failed post is invisible. That
// was already fixed once for the Done/Skip buttons (slackOk in the actions route); this module
// is the other place it would have come back.

import { supabaseAdmin } from "@/lib/db";
import { slack, slackThreadLink, type SlackBlock } from "@/lib/slack-bot";
import { DELIVERY_STEPS, stepNumber, type DeliveryStep } from "@/config/delivery-steps";

/**
 * The two marks, and they are never interchangeable.
 *
 * `MARK_VERIFIED` means the app observed real state: rows in a table, an answer from a
 * resolver, an HTTP 200. `MARK_CONFIRMED` means a human put an artifact in the step's thread
 * and the app read that artifact back. The second is weaker and has to LOOK weaker, which is
 * the same reasoning that makes day_0_source distinguish photograph_2 from manual_step.
 */
export const MARK_VERIFIED = "white_check_mark";
export const MARK_CONFIRMED = "ballot_box_with_check";
export const MARK_SKIPPED = "heavy_minus_sign";
export const MARK_PROBLEM = "warning";

/** Every mark the board can put on an anchor, for the clear-before-set pass. */
const ALL_MARKS = [MARK_VERIFIED, MARK_CONFIRMED, MARK_SKIPPED, MARK_PROBLEM] as const;

export interface BoardResult {
  ok: boolean;
  ts?: string;
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Loading
// ─────────────────────────────────────────────────────────────────────────────

function channelId(): string | null {
  const channel = process.env.SLACK_CLIENT_ONBOARDING_CHANNEL;
  if (!channel) {
    console.error("[step-board] SLACK_CLIENT_ONBOARDING_CHANNEL unset, nothing posted");
    return null;
  }
  return channel;
}

interface BoardClient {
  id: string;
  name: string;
  slug: string | null;
  opsThreadTs: string | null;
}

async function loadBoardClient(clientId: string): Promise<BoardClient | null> {
  const { data } = await supabaseAdmin
    .from("clients")
    .select("id, legal_name, dba_name, slug, ops_thread_ts")
    .eq("id", clientId)
    .maybeSingle();

  if (!data) return null;
  return {
    id: data.id as string,
    name: ((data.dba_name as string) || (data.legal_name as string) || "Client").trim(),
    slug: (data.slug as string | null) ?? null,
    opsThreadTs: (data.ops_thread_ts as string | null) ?? null,
  };
}

export interface BoardRow {
  step_key: string;
  status: string;
  slack_anchor_ts: string | null;
  slack_message_ts: string | null;
  verified_source: string | null;
  verified_detail: string | null;
  skipped_reason: string | null;
  error_detail: string | null;
  completed_by: string | null;
}

const ROW_COLUMNS =
  "step_key, status, slack_anchor_ts, slack_message_ts, verified_source, verified_detail, skipped_reason, error_detail, completed_by";

async function loadRow(clientId: string, stepKey: string): Promise<BoardRow | null> {
  const { data } = await supabaseAdmin
    .from("client_delivery_steps")
    .select(ROW_COLUMNS)
    .eq("client_id", clientId)
    .eq("step_key", stepKey)
    .maybeSingle();
  return (data as BoardRow | null) ?? null;
}

async function loadAllRows(clientId: string): Promise<BoardRow[]> {
  const { data } = await supabaseAdmin
    .from("client_delivery_steps")
    .select(ROW_COLUMNS)
    .eq("client_id", clientId);
  return (data ?? []) as BoardRow[];
}

/** 1-based position, which is what the channel shows. Zero means the key is not a step. */
function positionOf(stepKey: string): number {
  return stepNumber(stepKey as Parameters<typeof stepNumber>[0]);
}

function stepFor(stepKey: string): DeliveryStep | undefined {
  return DELIVERY_STEPS.find((s) => s.key === stepKey);
}

// ─────────────────────────────────────────────────────────────────────────────
// The anchor
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The anchor's one-line state, DERIVED from the row rather than passed in.
 *
 * Same doctrine as renderChecklist reading rows instead of taking a summary: a caller that
 * could pass its own idea of the state could put a checkmark on a step the database says is
 * outstanding, and the channel is the thing being trusted.
 */
function anchorText(client: BoardClient, step: DeliveryStep, row: BoardRow | null): string {
  const n = positionOf(step.key);
  const total = DELIVERY_STEPS.length;
  const status = row?.status ?? "pending";

  let mark = ":hourglass_flowing_sand:";
  let tail = "Everything for this step is in the thread.";

  if (status === "complete") {
    // The mark follows verified_source and nothing else. A row that is complete with no
    // source predates the confirmation pass; it says so rather than claiming either tier.
    if (row?.verified_source === "system") {
      mark = `:${MARK_VERIFIED}:`;
      tail = `Verified: ${row.verified_detail ?? "checked against the record."}`;
    } else if (row?.verified_source === "thread") {
      mark = `:${MARK_CONFIRMED}:`;
      tail = `Confirmed: ${row.verified_detail ?? "an artifact in this thread."}`;
    } else {
      mark = `:${MARK_CONFIRMED}:`;
      tail = "Marked done before this board recorded evidence, so nothing was checked.";
    }
    if (row?.completed_by) tail += `  _${row.completed_by}_`;
  } else if (status === "skipped") {
    mark = `:${MARK_SKIPPED}:`;
    // Not applicable is not the same as fine. The presence PDF enforces the same wording rule.
    tail = `Skipped, so it reads as not checked and never as no issues found.${
      row?.skipped_reason ? ` ${row.skipped_reason}` : ""
    }`;
  } else if (status === "error") {
    mark = `:${MARK_PROBLEM}:`;
    tail = `Stopped: ${row?.error_detail ?? "flagged as a problem."} It will not advance on its own.`;
  } else if (status === "running") {
    mark = ":gear:";
    tail = "Mission Control is doing this one now.";
  }

  return [
    `${mark} *${n}. ${step.label}*`,
    `_${step.phase} · step ${n} of ${total} · ${client.name}_`,
    tail,
  ].join("\n");
}

/**
 * Post this step's top-level message, once.
 *
 * The ts is claimed with a conditional UPDATE guarded on `is null`, the same pattern as
 * ops_thread_ts and slack_message_ts, so two concurrent cascades produce one anchor rather
 * than two. A loser deletes nothing: it returns the ts that won.
 */
export async function postStepAnchor(clientId: string, stepKey: string): Promise<BoardResult> {
  const channel = channelId();
  if (!channel) return { ok: false, error: "no_channel_env" };

  const step = stepFor(stepKey);
  if (!step) return { ok: false, error: `unknown step ${stepKey}` };

  const [client, row] = await Promise.all([loadBoardClient(clientId), loadRow(clientId, stepKey)]);
  if (!client) return { ok: false, error: "no_client" };
  if (row?.slack_anchor_ts) return { ok: true, ts: row.slack_anchor_ts };

  const res = (await slack.postMessage(channel, anchorText(client, step, row))) as {
    ok?: boolean;
    ts?: string;
    error?: string;
  };

  if (!res?.ok || !res.ts) {
    console.error(`[step-board] anchor post failed for ${stepKey}:`, res?.error ?? "no ts");
    return { ok: false, error: res?.error ?? "post_failed" };
  }

  const { data: claimed } = await supabaseAdmin
    .from("client_delivery_steps")
    .update({ slack_anchor_ts: res.ts, updated_at: new Date().toISOString() })
    .eq("client_id", clientId)
    .eq("step_key", stepKey)
    .is("slack_anchor_ts", null)
    .select("slack_anchor_ts");

  // Somebody else's anchor got there first. Ours is now an orphan message in the channel,
  // which is noise but harmless; re-reading is what keeps every later reply on ONE thread.
  if (!claimed?.length) {
    const again = await loadRow(clientId, stepKey);
    return { ok: true, ts: again?.slack_anchor_ts ?? res.ts };
  }

  return { ok: true, ts: res.ts };
}

/** Re-render an existing anchor in place. Never posts, so channel position is preserved. */
export async function refreshStepAnchor(clientId: string, stepKey: string): Promise<BoardResult> {
  const channel = channelId();
  if (!channel) return { ok: false, error: "no_channel_env" };

  const step = stepFor(stepKey);
  if (!step) return { ok: false, error: `unknown step ${stepKey}` };

  const [client, row] = await Promise.all([loadBoardClient(clientId), loadRow(clientId, stepKey)]);
  if (!client) return { ok: false, error: "no_client" };
  if (!row?.slack_anchor_ts) return { ok: false, error: "no_anchor" };

  const res = (await slack.updateMessage(
    channel,
    row.slack_anchor_ts,
    anchorText(client, step, row)
  )) as { ok?: boolean; error?: string };

  if (!res?.ok) {
    console.error(`[step-board] anchor refresh failed for ${stepKey}:`, res?.error ?? "unknown");
    return { ok: false, error: res?.error ?? "update_failed" };
  }
  return { ok: true, ts: row.slack_anchor_ts };
}

/**
 * Put the right mark on the anchor and take off any mark that is no longer true.
 *
 * Clearing first is what makes a reopen honest. Un-ticking a step writes `pending` to the row,
 * and a checkmark left behind on the message would say the opposite of the record to the one
 * person scanning the channel for what is left to do.
 *
 * `already_reacted` and `no_reaction` are both normal outcomes, not failures: the first means
 * the mark was already right, the second that there was nothing to clear.
 */
export async function markAnchor(
  clientId: string,
  stepKey: string,
  mark: string | null
): Promise<BoardResult> {
  const channel = channelId();
  if (!channel) return { ok: false, error: "no_channel_env" };

  const row = await loadRow(clientId, stepKey);
  if (!row?.slack_anchor_ts) return { ok: false, error: "no_anchor" };
  const ts = row.slack_anchor_ts;

  for (const stale of ALL_MARKS) {
    if (stale === mark) continue;
    const res = (await slack.removeReaction(channel, ts, stale)) as { ok?: boolean; error?: string };
    if (!res?.ok && res?.error !== "no_reaction") {
      // Worth a line but not worth failing on: the text of the anchor already carries the
      // state, so a stale reaction is a cosmetic disagreement rather than a wrong record.
      console.warn(`[step-board] could not clear :${stale}: on ${stepKey}:`, res?.error);
    }
  }

  if (!mark) return { ok: true, ts };

  const res = (await slack.addReaction(channel, ts, mark)) as { ok?: boolean; error?: string };
  if (!res?.ok && res?.error !== "already_reacted") {
    console.error(`[step-board] could not mark :${mark}: on ${stepKey}:`, res?.error ?? "unknown");
    return { ok: false, error: res?.error ?? "react_failed" };
  }
  return { ok: true, ts };
}

/** The anchor ts, for callers that need to thread something themselves (the audit pipeline). */
export async function anchorTsFor(clientId: string, stepKey: string): Promise<string | null> {
  const row = await loadRow(clientId, stepKey);
  if (row?.slack_anchor_ts) return row.slack_anchor_ts;
  const posted = await postStepAnchor(clientId, stepKey);
  return posted.ts ?? null;
}

/**
 * Say something in a step's thread.
 *
 * ‼️ IT CREATES THE ANCHOR RATHER THAN FALLING BACK TO ops_thread_ts. A fallback is how the
 * wall comes back: the first caller to run before its anchor exists would quietly put its card
 * at the top level again, and nothing would look broken. If the anchor cannot be created the
 * message is not posted and the failure is logged, because a message in the wrong place is
 * harder to notice than a message that is missing.
 */
export async function notifyStep(
  clientId: string,
  stepKey: string,
  text: string,
  blocks?: SlackBlock[]
): Promise<BoardResult> {
  const channel = channelId();
  if (!channel) return { ok: false, error: "no_channel_env" };

  const ts = await anchorTsFor(clientId, stepKey);
  if (!ts) {
    console.error(`[step-board] no anchor for ${stepKey}, message not posted: ${text.slice(0, 120)}`);
    return { ok: false, error: "no_anchor" };
  }

  const res = (await slack.postThreadReply(channel, ts, text, blocks)) as {
    ok?: boolean;
    ts?: string;
    error?: string;
  };
  if (!res?.ok) {
    console.error(`[step-board] reply failed on ${stepKey}:`, res?.error ?? "unknown");
    return { ok: false, error: res?.error ?? "post_failed" };
  }
  return { ok: true, ts: res.ts };
}

// ─────────────────────────────────────────────────────────────────────────────
// The header
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ‼️ THE 33-LINE CHECKLIST IS GONE AND THIS REPLACED IT.
 *
 * Thirty-three messages plus a forty-three line message listing the same thirty-three steps is
 * the wall the whole change is about, printed twice. What survives is the part a channel needs
 * that the messages themselves cannot show: a count, the ONE step to work next, a link to it,
 * and the warnings below.
 *
 * ‼️ THE WARNINGS CAME ACROSS WITH IT, DELIBERATELY. They were the one part of renderChecklist
 * that was not duplicated by the per-step messages, and CLAUDE.md documents the first of them
 * as load-bearing ("The audit gates the call"). Dropping the checklist without them would have
 * removed the only thing telling anybody they had worked out of order. Flags, never blocks —
 * same doctrine as the market-overlap check: a call booked early is a judgement somebody made,
 * and a board that refused would just get worked around. What it must not do is stay quiet.
 */
/**
 * `Before the call 12/18 · During the call 0/4 · After the call 0/11`.
 *
 * ‼️ THREE COUNTS BECAUSE THERE ARE NOW THREE PHASES (2026-08-25). They were Measure, Prepare,
 * The call, Day 0 and Build; Matthew regrouped them as before / during / after the call, because
 * the call is the only fixed point in the job and "which side of it is this" is the question a
 * board is actually being asked.
 *
 * DERIVED by grouping, never a literal list. A hardcoded set of three names would keep printing
 * the old ones after a rename, silently, and the counts would still add up.
 *
 * Complete only, never complete-or-skipped, for the same reason `isDone` is: "we decided not to"
 * and "we did it" are opposite claims and a progress count that merges them overstates the run.
 */
function phaseCounts(rows: BoardRow[]): string {
  const status = new Map(rows.map((r) => [r.step_key, r.status]));
  const order: string[] = [];
  const totals = new Map<string, { done: number; total: number }>();

  for (const step of DELIVERY_STEPS) {
    if (!totals.has(step.phase)) {
      totals.set(step.phase, { done: 0, total: 0 });
      order.push(step.phase);
    }
    const bucket = totals.get(step.phase)!;
    bucket.total += 1;
    if (status.get(step.key) === "complete") bucket.done += 1;
  }

  return order
    .map((phase) => {
      const b = totals.get(phase)!;
      return `${phase} ${b.done}/${b.total}`;
    })
    .join(" · ");
}

function headerText(client: BoardClient, rows: BoardRow[]): string {
  const status = new Map(rows.map((r) => [r.step_key, r.status]));
  const anchors = new Map(rows.map((r) => [r.step_key, r.slack_anchor_ts]));

  // ‼️ `done` IS COMPLETE ONLY, NEVER COMPLETE-OR-SKIPPED, and the warnings below depend on
  // it. "We decided not to" and "we did it" are opposite claims: a skipped baseline must not
  // satisfy the Measure gate, and a skipped Day-0 archive must not satisfy the Day-0 check.
  // `next` further down uses the other reading on purpose.
  const isDone = (key: string) => status.get(key) === "complete";

  const done = DELIVERY_STEPS.filter((s) => isDone(s.key)).length;
  const skipped = DELIVERY_STEPS.filter((s) => status.get(s.key) === "skipped").length;
  const stuck = DELIVERY_STEPS.filter((s) => status.get(s.key) === "error");

  // Resolved is complete-or-skipped, the same reading the schedulers use. A step somebody
  // decided not to do must not be the answer to "what is next" forever.
  //
  // ‼️ IT MUST NAME A WORKABLE STEP, AND IT USED TO NAME THE FIRST UNRESOLVED ONE.
  // With one anchor at a time, this line IS the board — so a header naming a step that the
  // channel is not showing (because it is blocked) leaves nothing on screen to work on and
  // nothing explaining why. `reachableCursor` breaks the walk on the first waiting step
  // whether or not it is reachable; this picks the first one that actually is.
  const resolved = (key: string) =>
    status.get(key) === "complete" || status.get(key) === "skipped";
  const unresolved = DELIVERY_STEPS.filter((s) => !resolved(s.key));
  const next =
    unresolved.find((s) => !(s.blockedBy ?? []).some((k) => !resolved(k))) ?? unresolved[0];

  const lines = [
    `:pushpin: *${client.name} · onboarding*`,
    `${done} of ${DELIVERY_STEPS.length} done.${skipped > 0 ? ` ${skipped} skipped.` : ""}`,
    // Three counts, one per phase, derived by grouping DELIVERY_STEPS rather than hardcoded —
    // so renaming a phase is one edit in config/delivery-steps.ts and not two.
    phaseCounts(rows),
  ];

  if (!next) {
    lines.push("Every step is resolved.");
  } else {
    const n = positionOf(next.key);
    const ts = anchors.get(next.key);
    const channel = process.env.SLACK_CLIENT_ONBOARDING_CHANNEL;
    // Only link to a message that exists. A blocked step has no anchor yet, and a link to
    // nothing reads as a broken channel rather than as work that has not started.
    const link = ts && channel ? ` <${slackThreadLink(channel, ts)}|open it>` : "";
    lines.push(`Next: *${n}. ${next.label}*${link}`);
  }

  if (stuck.length > 0) {
    lines.push(
      `:warning: Stopped: ${stuck.map((s) => `${positionOf(s.key)}. ${s.label}`).join(", ")}`
    );
  }

  // The MEASURE gate. The call is where we tell them what the engines are saying and agree who
  // we are going after, and both come out of the baseline. Held first, it is opinions instead
  // of screenshots and the question set gets picked against a guess at their ideal customer.
  const measureDone = ["baseline_scan", "findings_doc"].every(isDone);
  if (!measureDone && (isDone("call_booked") || isDone("call_held"))) {
    lines.push(
      ":warning: The call is on the board but the baseline is not finished. Run the audit and " +
        "write the findings up first, or the call is opinions instead of screenshots."
    );
  }

  // Out-of-order work, named. blockedBy is ADVISORY — it says so on the interface — so this is
  // the whole of its enforcement: a line that makes the gap visible on the next glance. Capped
  // at three, because a header that lists twelve complaints gets scrolled past.
  const outOfOrder = DELIVERY_STEPS.filter(
    (s) => isDone(s.key) && (s.blockedBy ?? []).some((k) => !isDone(k))
  ).slice(0, 3);
  for (const s of outOfOrder) {
    const missing = (s.blockedBy ?? [])
      .filter((k) => !isDone(k))
      .map((k) => DELIVERY_STEPS.find((d) => d.key === k)?.label ?? k)
      .join(", ");
    lines.push(`:warning: "${s.label}" is ticked but ${missing} is not.`);
  }

  // The Day-0 gate. Every later scorecard is measured against the archive, and ticking a build
  // step first does not undo that. This is the flag; day-zero.ts is the wall that really blocks.
  const gate = DELIVERY_STEPS.find((s) => s.gate);
  if (gate && !isDone(gate.key)) {
    const gateAt = DELIVERY_STEPS.indexOf(gate);
    const jumped = DELIVERY_STEPS.slice(gateAt + 1).filter((s) => isDone(s.key));
    if (jumped.length > 0) {
      lines.push(
        `:warning: ${jumped.length} build step${jumped.length > 1 ? "s are" : " is"} done but ` +
          "the Day-0 scan was never archived. Day 30, 60 and 90 have nothing to measure against."
      );
    }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  // ‼️ THE ID, NOT THE SLUG, AND THIS LINK HAS BEEN A 404 SINCE IT SHIPPED.
  // The board page is `/dashboard/clients/[id]` and it queries `.eq("id", id)` against a uuid
  // column. Handed `srt-agency-llc` that is a cast error, not a miss, so the query throws, `data`
  // comes back null and the page calls notFound(). The one navigation aid on the pinned header
  // went nowhere, and it looked like a permissions problem rather than a wrong path.
  if (appUrl) {
    lines.push(`Full checklist: ${appUrl}/dashboard/clients/${client.id}`);
  }

  return lines.join("\n");
}

/**
 * Rewrite the pinned header from current rows.
 *
 * The header IS the intake message (clients.ops_thread_ts), edited rather than replaced, so it
 * keeps its position at the top of the run and its thread keeps whatever client-level drafts
 * were posted under it.
 */
export async function refreshHeader(clientId: string): Promise<BoardResult> {
  const channel = channelId();
  if (!channel) return { ok: false, error: "no_channel_env" };

  const client = await loadBoardClient(clientId);
  if (!client?.opsThreadTs) return { ok: false, error: "no_ops_thread" };

  const rows = await loadAllRows(clientId);
  const res = (await slack.updateMessage(
    channel,
    client.opsThreadTs,
    headerText(client, rows)
  )) as { ok?: boolean; error?: string };

  if (!res?.ok) {
    console.error("[step-board] header refresh failed:", res?.error ?? "unknown");
    return { ok: false, error: res?.error ?? "update_failed" };
  }
  return { ok: true, ts: client.opsThreadTs };
}

/**
 * Pin the header once, at intake.
 *
 * With the steps posting as they unblock, the header scrolls away behind them within the
 * first minute. Pinned, it is one click from anywhere in the channel, which is what makes
 * "which step am I on" answerable without scrolling.
 *
 * `already_pinned` is success.
 */
export async function pinHeader(clientId: string): Promise<BoardResult> {
  const channel = channelId();
  if (!channel) return { ok: false, error: "no_channel_env" };

  const client = await loadBoardClient(clientId);
  if (!client?.opsThreadTs) return { ok: false, error: "no_ops_thread" };

  const res = (await slack.pinMessage(channel, client.opsThreadTs)) as {
    ok?: boolean;
    error?: string;
  };
  if (!res?.ok && res?.error !== "already_pinned") {
    console.warn("[step-board] could not pin the header:", res?.error ?? "unknown");
    return { ok: false, error: res?.error ?? "pin_failed" };
  }
  return { ok: true, ts: client.opsThreadTs };
}
