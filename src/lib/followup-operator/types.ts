// Row shapes for the Follow-Up Operator. Mirrors docs/2026-07-31-followup-operator.sql.

/**
 * Where a prospect sits after the pitch went out.
 *
 * SENT_NO_REPLY      the permission ladder is running, nobody has answered
 * REPLIED_INTERESTED they said yes / asked for the breakdown
 * ASKED_PRICE_HOT    they asked what it costs. Answered the SAME day, always.
 * OBJECTION          they pushed back or asked a question
 * CLOSED             bought, said no, asked to stop, or the ladder ran out
 */
export type ProspectState =
  | "SENT_NO_REPLY"
  | "REPLIED_INTERESTED"
  | "ASKED_PRICE_HOT"
  | "OBJECTION"
  | "CLOSED";

export type TouchChannel = "email" | "call" | "sms" | "note";
export type TouchDirection = "outbound" | "inbound";

export type PendingKind =
  | "email_options"
  | "permission"
  | "call_pitch"
  | "escalation";

export interface AmmoSpent {
  kind: "finding" | "competitor" | "signal";
  detail: string;
  step: number;
}

export interface PendingDraft {
  label: string;
  subject: string;
  body: string;
}

export interface OutreachProspectRow {
  id: string;
  email: string;
  name: string | null;
  company: string | null;
  website: string | null;
  city: string | null;
  phone: string | null;

  audit_report_id: string | null;
  contact_id: string | null;

  state: ProspectState;
  closed_reason: string | null;
  step: number;
  next_channel: "email" | "call" | "sms";

  first_sent_at: string | null;
  last_touch_at: string | null;
  last_reply_at: string | null;
  next_touch_at: string | null;
  last_call_at: string | null;
  call_attempts: number;

  conversation_id: string | null;
  thread_subject: string | null;
  last_message_id: string | null;

  ammo_used: AmmoSpent[];

  slack_channel_id: string | null;
  slack_thread_ts: string | null;

  confirmed: boolean;
  /**
   * How this row got onto the board.
   *
   * ‼️ "loom" IS THE ONLY ONE THAT STILL ENROLS. Since 2026-09-03 a prospect is created at exactly
   * one moment, the Loom handover, so the board can promise that everybody on it already has the
   * video. The other three are history on rows that predate that, and on the sweeps that may fill
   * blanks on an existing row without ever creating one.
   */
  source: "audit" | "outlook_sweep" | "manual" | "reachinbox" | "loom";
  paused: boolean;

  pending_drafts: PendingDraft[] | null;
  pending_kind: PendingKind | null;
  last_digest_at: string | null;

  created_at: string;
  updated_at: string;
}

export interface OutreachTouchRow {
  id: string;
  prospect_id: string;
  direction: TouchDirection;
  channel: TouchChannel;
  step: number | null;
  subject: string | null;
  body: string | null;
  outcome: string | null;
  graph_message_id: string | null;
  /** RFC5322 Message-ID. Stable across the send AND across mailboxes, unlike
   *  graph_message_id, which Graph scopes to one mailbox. */
  internet_message_id: string | null;
  /** Generated: coalesce(internet_message_id, graph_message_id). Never written by a client. */
  message_key: string | null;
  /** The mailbox this left from or arrived in. NULL means the connected account. */
  mailbox: string | null;
  conversation_id: string | null;
  occurred_at: string;
  created_at: string;
  metadata: Record<string, unknown>;
}

export const PROSPECT_COLUMNS =
  "id, email, name, company, website, city, phone, audit_report_id, contact_id, " +
  "state, closed_reason, step, next_channel, first_sent_at, last_touch_at, " +
  "last_reply_at, next_touch_at, last_call_at, call_attempts, conversation_id, " +
  "thread_subject, last_message_id, ammo_used, slack_channel_id, slack_thread_ts, " +
  "confirmed, source, paused, pending_drafts, pending_kind, last_digest_at, " +
  "created_at, updated_at";
