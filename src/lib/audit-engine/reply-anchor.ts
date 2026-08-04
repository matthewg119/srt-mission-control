// Finding the message to reply TO, so the delivery email lands on the original thread.
//
// The audit lane never stored one. `audit_reports.pending_drafts` is overwritten on every draft, so
// email 1's subject is gone by the time nudge 2 exists, and `audit_reports.draft_message_id` is a
// PRE-SEND draft id that Graph invalidates the moment /send is called: the message is re-created in
// Sent Items under a new id. So neither column can anchor a reply.
//
// Three places the real thread does exist, in descending order of how much we trust them:
//
//   1. outreach_touches — append-only, so the FIRST outbound email survives forever with its real
//      subject, graph_message_id and conversation_id. This is the only record of what was actually
//      sent rather than what was drafted.
//   2. outreach_prospects.last_message_id — denormalized and overwritten per touch, which is what
//      we want for a reply anchor (reply to the newest message on the thread, not the oldest).
//   3. Outlook itself. Both of the above are written by the daily Sent Items sweep, so between
//      "Matthew sends email 1" and "the sweep runs tomorrow" they are empty. That window is
//      precisely when a Loom gets recorded, so falling back to a live search is not an edge case.
//
// Returning null is a legitimate outcome and is NOT fatal: the caller sends a new message and says
// so out loud in the flags, which is better than silently starting a second conversation.

import { supabaseAdmin } from "@/lib/db";
import { microsoft } from "@/lib/microsoft";
import type { AuditReportRow } from "./types";

export interface ReplyAnchor {
  /** A Sent Items message id, valid as the {id} in /messages/{id}/createReply. */
  messageId: string;
  /** The original subject, for display only. Graph writes the actual Re: line itself. */
  subject: string | null;
  /** Where it came from, so the Slack card can say how confident to be. */
  source: "touches" | "prospect" | "outlook";
}

export async function resolveReplyAnchor(report: AuditReportRow): Promise<ReplyAnchor | null> {
  const email = report.prospect_email ?? report.requester_email ?? null;
  if (!email) return null;

  // 1) The prospect row, which is both the denormalized pointer AND the only way to scope the
  // touch log: outreach_touches is keyed on prospect_id, so querying it by direction/channel alone
  // would happily return some other prospect's oldest email and reply to a stranger's thread.
  const { data: prospect } = await supabaseAdmin
    .from("outreach_prospects")
    .select("id, last_message_id, thread_subject")
    .eq("email", email)
    .maybeSingle();

  if (!prospect) return searchOutlook(email);

  if (prospect.last_message_id) {
    return {
      messageId: prospect.last_message_id as string,
      subject: (prospect.thread_subject as string | null) ?? null,
      source: "prospect",
    };
  }

  // 2) The append-only touch log. Oldest outbound email = the one that started the thread.
  const { data: touch } = await supabaseAdmin
    .from("outreach_touches")
    .select("graph_message_id, subject")
    .eq("prospect_id", prospect.id)
    .eq("direction", "outbound")
    .eq("channel", "email")
    .not("graph_message_id", "is", null)
    .order("occurred_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (touch?.graph_message_id) {
    return {
      messageId: touch.graph_message_id as string,
      subject: (touch.subject as string | null) ?? (prospect.thread_subject as string | null) ?? null,
      source: "touches",
    };
  }

  return searchOutlook(email);
}

/**
 * 3) Ask Outlook directly.
 *
 * searchMessagesWithAddress covers Sent Items and filters drafts, so this finds the thread on the
 * same day it was sent, before any sweep has run. Newest first, because replying to the latest
 * message on a conversation is what keeps the thread linear.
 */
async function searchOutlook(email: string): Promise<ReplyAnchor | null> {
  try {
    const found = await microsoft.searchMessagesWithAddress(email, 25);
    const newest = found
      .filter((m) => m.id)
      .sort((a, b) => new Date(b.sentDateTime ?? b.receivedDateTime ?? 0).getTime() - new Date(a.sentDateTime ?? a.receivedDateTime ?? 0).getTime())[0];
    if (newest?.id) return { messageId: newest.id, subject: newest.subject ?? null, source: "outlook" };
  } catch (e) {
    console.error("[reply-anchor] Outlook search failed:", (e as Error).message);
  }
  return null;
}
