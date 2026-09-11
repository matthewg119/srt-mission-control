// Everything said and done about a client, in one table, in the order it happened.
//
// Matthew, 2026-09-11: "all of the data of each customer (inside Slack or Mission Control) needs
// to be saved with its specific dataset so we can create workflows around each client ... and to
// be able to pull any info I need from our current chatbot in Mission Control."
//
// ‼️ WHY A TABLE AND NOT "SLACK HAS IT". Slack HAS every message, and that is not the same as
// being able to read them. conversations.replies needs the channel, the thread ts, a token, the
// bot to be a member, and one call per thread; a client's board is 41 threads. Nothing can ask
// "what happened on this client last week" across that, and a workflow certainly cannot. Worse,
// the board DELETES its own messages: _reset-client-board removes every card by stored ts, so a
// re-onboarding erases the history of the first one. A row survives that.
//
// ‼️ NOTHING IS EVER DELETED FROM HERE, INCLUDING BY THE RESET. It is a record of what happened,
// not state that any verifier reads, so there is no step it can make tick green and no reason to
// clear it. The reset's own header draws exactly this line: "everything that is a RECORD rather
// than board state" survives.
//
// ‼️ WHAT IT IS NOT: a second source of truth. A step's status lives on client_delivery_steps, a
// document on client_docs, a keyword on client_keywords. This says a button was pressed at 14:02
// and what the card said; it never says what the board currently IS.

import { supabaseAdmin } from "@/lib/db";

/** Where it happened. */
export type EventSource = "slack" | "dashboard" | "system";

/**
 * What kind of thing it was.
 *
 * `message` and `command` are both a person typing; the difference is whether the system did
 * something because of it, which is exactly the question somebody reading back the history asks.
 */
export type EventKind =
  | "message"
  | "command"
  | "button"
  | "file"
  | "bot_post"
  | "assistant_reply";

export interface ClientEvent {
  clientId: string;
  stepKey?: string | null;
  source: EventSource;
  kind: EventKind;
  /** A Slack user id, "Mission Control", or a person's name from the dashboard. */
  author?: string | null;
  text?: string | null;
  slackChannel?: string | null;
  slackTs?: string | null;
  slackThreadTs?: string | null;
  payload?: Record<string, unknown>;
}

/** Slack messages are long; the point is what was said, not a transcript of an essay. */
const MAX_TEXT = 12_000;

/**
 * Write one event.
 *
 * ‼️ IT NEVER THROWS AND NEVER FAILS ITS CALLER. Every call site is in the middle of doing the
 * real work: posting a card, filing a screenshot, answering a question. A log that can break the
 * thing it is logging is worse than no log, so an error here is printed and swallowed.
 *
 * A duplicate (the same Slack message logged twice, which the backfill and the live path will
 * both do) is not an error at all. The unique constraint on (slack_channel, slack_ts) is what
 * makes re-running the backfill safe, and nulls compare distinct, so events with no Slack message
 * behind them never collide with each other.
 */
export async function logClientEvent(event: ClientEvent): Promise<void> {
  if (!event.clientId) return;

  const { error } = await supabaseAdmin.from("client_events").insert({
    client_id: event.clientId,
    step_key: event.stepKey ?? null,
    source: event.source,
    kind: event.kind,
    author: event.author ?? null,
    text: event.text ? event.text.slice(0, MAX_TEXT) : null,
    slack_channel: event.slackChannel ?? null,
    slack_ts: event.slackTs ?? null,
    slack_thread_ts: event.slackThreadTs ?? null,
    payload: event.payload ?? {},
  });

  if (!error) return;
  if ((error as { code?: string }).code === "23505") return;
  console.error("[client-events] not logged:", error.message);
}

/**
 * Re-label an event that turned out to be a command.
 *
 * The lane logs every message as it arrives, because the alternative is logging it in fourteen
 * branches and missing one. A branch that HANDLED it then says so, which is what makes
 * "everything he typed that the system acted on" answerable later.
 */
export async function markEventKind(args: {
  slackChannel: string;
  slackTs: string;
  kind: EventKind;
  handler?: string;
}): Promise<void> {
  if (!args.slackChannel || !args.slackTs) return;

  const patch: Record<string, unknown> = { kind: args.kind };
  if (args.handler) patch.payload = { handler: args.handler };

  const { error } = await supabaseAdmin
    .from("client_events")
    .update(patch)
    .eq("slack_channel", args.slackChannel)
    .eq("slack_ts", args.slackTs);

  if (error) console.error("[client-events] kind not updated:", error.message);
}

/**
 * Post a reply in a client's thread and log it in one call.
 *
 * The client lane answers commands with bare postThreadReply calls in a dozen places. Each one is
 * the system SAYING something to Matthew about a client, which is exactly what this log is for,
 * and wrapping them is how the log stays complete without a second list of call sites to keep in
 * step. Returns the Slack response so callers that check `ok` still can.
 */
export async function postClientReply(args: {
  clientId: string;
  stepKey?: string | null;
  channel: string;
  threadTs: string;
  text: string;
}): Promise<{ ok?: boolean; ts?: string; error?: string }> {
  const { slack } = await import("@/lib/slack-bot");
  const res = (await slack.postThreadReply(args.channel, args.threadTs, args.text)) as {
    ok?: boolean;
    ts?: string;
    error?: string;
  };

  await logClientEvent({
    clientId: args.clientId,
    stepKey: args.stepKey ?? null,
    source: "slack",
    kind: "bot_post",
    author: "Mission Control",
    text: args.text,
    slackChannel: args.channel,
    slackTs: res?.ts ?? null,
    slackThreadTs: args.threadTs,
  });

  return res;
}

export interface ClientEventRow {
  id: string;
  stepKey: string | null;
  source: EventSource;
  kind: EventKind;
  author: string | null;
  text: string | null;
  slackChannel: string | null;
  slackTs: string | null;
  slackThreadTs: string | null;
  createdAt: string;
}

/**
 * Read a client's history back. Newest first, because "what happened lately" is the question.
 *
 * The chatbot's `search_client_events` tool is the main caller, so the filters are the ones a
 * person asks in words: about this step, of this kind, containing these words.
 */
export async function readClientEvents(args: {
  clientId: string;
  stepKey?: string | null;
  kinds?: EventKind[];
  contains?: string | null;
  since?: string | null;
  limit?: number;
}): Promise<ClientEventRow[]> {
  let q = supabaseAdmin
    .from("client_events")
    .select("id, step_key, source, kind, author, text, slack_channel, slack_ts, slack_thread_ts, created_at")
    .eq("client_id", args.clientId)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(args.limit ?? 50, 1), 500));

  if (args.stepKey) q = q.eq("step_key", args.stepKey);
  if (args.kinds?.length) q = q.in("kind", args.kinds);
  if (args.since) q = q.gte("created_at", args.since);
  // A Slack message is stored verbatim, so a search for what somebody said is a text match.
  if (args.contains?.trim()) q = q.ilike("text", `%${args.contains.trim()}%`);

  const { data, error } = await q;
  if (error) {
    console.error("[client-events] read failed:", error.message);
    return [];
  }

  return (data ?? []).map((r) => ({
    id: r.id as string,
    stepKey: (r.step_key as string | null) ?? null,
    source: r.source as EventSource,
    kind: r.kind as EventKind,
    author: (r.author as string | null) ?? null,
    text: (r.text as string | null) ?? null,
    slackChannel: (r.slack_channel as string | null) ?? null,
    slackTs: (r.slack_ts as string | null) ?? null,
    slackThreadTs: (r.slack_thread_ts as string | null) ?? null,
    createdAt: r.created_at as string,
  }));
}
