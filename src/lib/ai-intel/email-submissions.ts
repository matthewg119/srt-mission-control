// Data layer for email-driven deal shopping (verbatim forward to funders).
//
// One "New Deal — {Business}" email Matthew sends to submissions@ becomes one
// email_submissions row + a #srt-sub parent message. The funders it gets
// forwarded to are tracked in email_submission_funders. Funder replies are
// matched back to a row by conversationId → business + funder domain → most
// recent open row, then threaded under the stored slack_thread_ts.
//
// Intentionally standalone — no FK to deals/contacts (see the SQL migration).

import { supabaseAdmin } from "@/lib/db";

export interface EmailSubmissionRow {
  id: string;
  business_name: string;
  original_message_id: string;
  conversation_id: string | null;
  mailbox: string;
  subject: string | null;
  html_body: string | null;
  from_address: string | null;
  slack_channel: string | null;
  slack_thread_ts: string | null;
  status: string;
  suggested_lender_ids: string[] | null;
  pending_adhoc_to: string[] | null;
  pending_adhoc_cc: string[] | null;
}

const ROW_COLS =
  "id, business_name, original_message_id, conversation_id, mailbox, subject, html_body, from_address, slack_channel, slack_thread_ts, status, suggested_lender_ids, pending_adhoc_to, pending_adhoc_cc";

/** lowercase domain part of an email address, or null. */
export function emailDomain(address: string | null | undefined): string | null {
  if (!address) return null;
  const at = address.lastIndexOf("@");
  if (at < 0) return null;
  return address.slice(at + 1).trim().toLowerCase() || null;
}

/**
 * Insert a new email_submissions row. Idempotent on original_message_id — if the
 * Graph webhook delivers a duplicate notification, returns the existing row's id
 * with `created: false` so the caller skips re-posting to Slack.
 */
export async function createEmailSubmission(input: {
  businessName: string;
  originalMessageId: string;
  conversationId: string | null;
  mailbox: string;
  subject: string;
  htmlBody: string;
  fromAddress: string;
}): Promise<{ id: string; created: boolean }> {
  const { data: existing } = await supabaseAdmin
    .from("email_submissions")
    .select("id")
    .eq("original_message_id", input.originalMessageId)
    .maybeSingle();
  if (existing?.id) return { id: existing.id as string, created: false };

  const { data, error } = await supabaseAdmin
    .from("email_submissions")
    .insert({
      business_name: input.businessName,
      original_message_id: input.originalMessageId,
      conversation_id: input.conversationId,
      mailbox: input.mailbox,
      subject: input.subject,
      html_body: input.htmlBody,
      from_address: input.fromAddress,
      status: "awaiting_funders",
    })
    .select("id")
    .single();

  if (error) {
    // Unique-violation race: another notification inserted first — fetch + reuse.
    const { data: row } = await supabaseAdmin
      .from("email_submissions")
      .select("id")
      .eq("original_message_id", input.originalMessageId)
      .maybeSingle();
    if (row?.id) return { id: row.id as string, created: false };
    throw new Error(error.message);
  }
  return { id: data.id as string, created: true };
}

export async function setEmailSubmissionThread(id: string, channel: string, threadTs: string): Promise<void> {
  await supabaseAdmin
    .from("email_submissions")
    .update({ slack_channel: channel, slack_thread_ts: threadTs, updated_at: new Date().toISOString() })
    .eq("id", id);
}

/** Persist the AI-suggested funder set so a later `go`/`all` reply knows who to send to. */
export async function setSuggestedLenderIds(id: string, lenderIds: string[]): Promise<void> {
  await supabaseAdmin
    .from("email_submissions")
    .update({ suggested_lender_ids: lenderIds, updated_at: new Date().toISOString() })
    .eq("id", id);
}

/**
 * Stage a confirm-first ad-hoc forward target (raw To/CC addresses Matthew typed in the thread).
 * A later `go` reads these and sends; takes precedence over suggested funders until cleared.
 */
export async function setPendingAdhocForward(id: string, to: string[], cc: string[]): Promise<void> {
  await supabaseAdmin
    .from("email_submissions")
    .update({ pending_adhoc_to: to, pending_adhoc_cc: cc, updated_at: new Date().toISOString() })
    .eq("id", id);
}

/** Clear the staged ad-hoc forward target after it's been sent (or superseded). */
export async function clearPendingAdhocForward(id: string): Promise<void> {
  await supabaseAdmin
    .from("email_submissions")
    .update({ pending_adhoc_to: null, pending_adhoc_cc: null, updated_at: new Date().toISOString() })
    .eq("id", id);
}

export async function getEmailSubmissionById(id: string): Promise<EmailSubmissionRow | null> {
  const { data } = await supabaseAdmin
    .from("email_submissions")
    .select(ROW_COLS)
    .eq("id", id)
    .maybeSingle();
  return (data as EmailSubmissionRow | null) ?? null;
}

export async function getEmailSubmissionByThread(threadTs: string): Promise<EmailSubmissionRow | null> {
  const { data } = await supabaseAdmin
    .from("email_submissions")
    .select(ROW_COLS)
    .eq("slack_thread_ts", threadTs)
    .maybeSingle();
  return (data as EmailSubmissionRow | null) ?? null;
}

export async function setEmailSubmissionStatus(id: string, status: string): Promise<void> {
  await supabaseAdmin
    .from("email_submissions")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
}

/**
 * Match an inbound funder reply back to an email_submissions row.
 *  1. exact conversation_id (most reliable — replies keep the conversationId)
 *  2. a funder row whose domain matches + fuzzy business name
 *  3. most-recent forwarded/awaiting row matching the business name
 */
export async function findEmailSubmissionForFunderReply(args: {
  conversationId: string | null;
  businessName: string | null;
  funderDomain: string | null;
}): Promise<{ submission: EmailSubmissionRow; funderRowId: string | null } | null> {
  // (1) conversationId
  if (args.conversationId) {
    const { data } = await supabaseAdmin
      .from("email_submissions")
      .select(ROW_COLS)
      .eq("conversation_id", args.conversationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      const sub = data as EmailSubmissionRow;
      const funderRowId = await findFunderRowId(sub.id, args.funderDomain);
      return { submission: sub, funderRowId };
    }
  }

  // (2) funder domain → its parent submission (prefer same business name)
  if (args.funderDomain) {
    const { data: funders } = await supabaseAdmin
      .from("email_submission_funders")
      .select("id, email_submission_id")
      .eq("funder_domain", args.funderDomain)
      .order("created_at", { ascending: false })
      .limit(10);
    for (const f of (funders ?? []) as Array<{ id: string; email_submission_id: string }>) {
      const sub = await getEmailSubmissionById(f.email_submission_id);
      if (!sub) continue;
      if (!args.businessName || fuzzyNameMatch(sub.business_name, args.businessName)) {
        return { submission: sub, funderRowId: f.id };
      }
    }
  }

  // (3) most-recent open submission for that business name
  if (args.businessName) {
    const { data } = await supabaseAdmin
      .from("email_submissions")
      .select(ROW_COLS)
      .ilike("business_name", `%${args.businessName}%`)
      .in("status", ["forwarded", "awaiting_funders"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      const sub = data as EmailSubmissionRow;
      const funderRowId = await findFunderRowId(sub.id, args.funderDomain);
      return { submission: sub, funderRowId };
    }
  }

  return null;
}

async function findFunderRowId(emailSubmissionId: string, funderDomain: string | null): Promise<string | null> {
  if (!funderDomain) return null;
  const { data } = await supabaseAdmin
    .from("email_submission_funders")
    .select("id")
    .eq("email_submission_id", emailSubmissionId)
    .eq("funder_domain", funderDomain)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.id as string | null) ?? null;
}

function fuzzyNameMatch(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const x = a.toLowerCase().trim();
  const y = b.toLowerCase().trim();
  return x.includes(y) || y.includes(x);
}

/** Record the per-funder send results after a forward fan-out. */
export async function recordFunderSends(
  emailSubmissionId: string,
  funders: Array<{
    lenderId: string | null;
    name: string;
    email: string;
    status: "sent" | "failed";
    notes?: string;
  }>
): Promise<void> {
  if (funders.length === 0) return;
  const now = new Date().toISOString();
  const rows = funders.map((f) => ({
    email_submission_id: emailSubmissionId,
    lender_id: f.lenderId,
    funder_name: f.name,
    funder_email: f.email,
    funder_domain: emailDomain(f.email),
    status: f.status,
    sent_at: f.status === "sent" ? now : null,
    notes: f.notes ?? null,
  }));
  await supabaseAdmin.from("email_submission_funders").insert(rows);
}

/** Update a funder row after a reply (approval/decline/stips/counter). */
export async function updateFunderReplyStatus(args: {
  funderRowId: string | null;
  emailSubmissionId: string;
  funderDomain: string | null;
  status: string;
  replyMessageId: string | null;
  notes: string | null;
}): Promise<void> {
  const patch = {
    status: args.status,
    last_reply_at: new Date().toISOString(),
    reply_message_id: args.replyMessageId,
    notes: args.notes,
  };
  if (args.funderRowId) {
    await supabaseAdmin.from("email_submission_funders").update(patch).eq("id", args.funderRowId);
    return;
  }
  // No exact funder row matched — update by domain if we can, else skip silently.
  if (args.funderDomain) {
    await supabaseAdmin
      .from("email_submission_funders")
      .update(patch)
      .eq("email_submission_id", args.emailSubmissionId)
      .eq("funder_domain", args.funderDomain);
  }
}
