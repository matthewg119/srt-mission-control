// What actually happened with this prospect, read off Outlook rather than off a column.
//
// `outreach_stage` only moves when Matthew types an exact command in Slack, so it drifts out of
// sync with reality the moment he sends an email himself, or the prospect replies, or he records a
// Loom and forgets to type `loom <url>`. Every generator downstream then reasons from a stage that
// has not been true for a week.
//
// The Grey Seal thread is the worked example. He had sent email 1 and the prospect had said yes,
// but the row still read `drafted`, so `ensurePermissionClose()` appended "I recorded a 4 min video
// with the breakdown, want me to send it over?" to a follow-up written for someone who already had
// the video. The state was wrong, so every draft built on it was wrong, and no amount of prompt
// tuning could have fixed it.
//
// The mailbox knows. Ask the mailbox.
//
// ‼️ A stored `loom_url` / `redesign_url` deliberately does NOT advance the stage. Those prove the
// asset was MADE, not that it was sent, and certainly not that it was watched. Same trap
// call-script.ts already documents for `call` vs `close`: one signal that means two different
// conversations is not a thing to discover with the phone ringing.

import { supabaseAdmin } from "@/lib/db";
import { microsoft, type GraphMessageSummary } from "@/lib/microsoft";
import type { AuditReportRow } from "./types";

/** How long a read stays fresh. A thread reply that costs three Graph round-trips every time turns
 *  a Slack command into a 30 second wait, and this changes on the scale of hours, not seconds. */
const CACHE_MINUTES = 10;

/** Body text kept per message. Enough for the agent to quote what they said, short enough that a
 *  long forwarded chain does not eat the context window. */
const MAX_BODY_CHARS = 1200;

export interface ThreadMessage {
  id: string;
  subject: string | null;
  /** ISO. `sentDateTime` for outbound, `receivedDateTime` for inbound. */
  at: string | null;
  /** Trimmed plain text. Null when the body was not fetched (only the newest few are). */
  body: string | null;
  preview: string | null;
}

export type DerivedStage = "not_sent" | "sent_no_reply" | "replied" | "revealed";

export interface ThreadTruth {
  /** Null when the report has no prospect address at all, which is most cold /audit runs. */
  email: string | null;
  sent: ThreadMessage[];
  replies: ThreadMessage[];
  lastOutboundAt: string | null;
  lastInboundAt: string | null;
  /** Days since the LAST outbound with no reply after it. Null when nothing was ever sent, or
   *  when they have already replied to the newest thing we sent. */
  daysSilent: number | null;
  theyReplied: boolean;
  derivedStage: DerivedStage;
  /** A Sent Items id usable as {id} in /messages/{id}/createReply. */
  anchorMessageId: string | null;
  anchorSubject: string | null;
  /** True when derivedStage disagrees with report.outreach_stage. Surfaced, never silently applied. */
  conflictsWithStoredStage: boolean;
  storedStage: string | null;
  /** Why the read is thin, for the card footer. Empty when everything resolved. */
  notes: string[];
  readAt: string;
}

function emptyTruth(report: AuditReportRow, email: string | null, notes: string[]): ThreadTruth {
  return {
    email,
    sent: [],
    replies: [],
    lastOutboundAt: null,
    lastInboundAt: null,
    daysSilent: null,
    theyReplied: false,
    derivedStage: report.outreach_stage === "revealed" ? "revealed" : "not_sent",
    anchorMessageId: null,
    anchorSubject: null,
    conflictsWithStoredStage: false,
    storedStage: report.outreach_stage ?? null,
    notes,
    readAt: new Date().toISOString(),
  };
}

/**
 * The prospect's address, from wherever it actually is.
 *
 * `prospect_email` is only written when the intake captured it, and plenty of live reports have it
 * null while the conversation is unmistakably real: Grey Seal sat at `drafted` with a null address.
 * Reading only that column meant the Outlook check silently no-opped on exactly the threads it
 * exists for, and reported "nothing has been sent" for a prospect who had been emailed twice.
 *
 * Three fallbacks, cheapest first. All best-effort; a miss returns null and the caller says so
 * rather than treating unknown as empty.
 */
async function resolveProspectEmail(report: AuditReportRow): Promise<string | null> {
  const direct = (report.prospect_email ?? report.requester_email ?? "").trim().toLowerCase();
  if (direct) return direct;

  // The outreach prospect row, which the Sent Items sweep writes even when the intake never did.
  try {
    const { data } = await supabaseAdmin
      .from("outreach_prospects")
      .select("email")
      .eq("audit_report_id", report.id)
      .maybeSingle();
    const found = (data?.email as string | undefined)?.trim().toLowerCase();
    if (found) return found;
  } catch {
    /* best effort */
  }

  // The linked Supabase contact.
  if (report.contact_id) {
    try {
      const { data } = await supabaseAdmin
        .from("contacts")
        .select("email")
        .eq("id", report.contact_id)
        .maybeSingle();
      const found = (data?.email as string | undefined)?.trim().toLowerCase();
      if (found) return found;
    } catch {
      /* best effort */
    }
  }

  return null;
}

function daysBetween(a: string, b: string): number {
  return Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}

function tidy(text: string): string {
  // Outlook plain-text bodies carry the whole quoted chain. Cut at the first quote marker so a
  // one-line "yes send it" does not arrive as forty lines of our own email 1 quoted back.
  const cut = text.split(/\r?\n\s*(?:_{5,}|-{5,}|From:\s|On .{5,60} wrote:)/)[0] ?? text;
  return cut.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_BODY_CHARS);
}

function toMessage(m: GraphMessageSummary, inbound: boolean): ThreadMessage {
  return {
    id: m.id,
    subject: m.subject ?? null,
    at: (inbound ? m.receivedDateTime : m.sentDateTime ?? m.receivedDateTime) ?? null,
    body: null,
    preview: m.bodyPreview?.trim().slice(0, 300) ?? null,
  };
}

/**
 * Read the real conversation.
 *
 * `searchMessagesWithAddress` hits the whole mailbox, so one call returns both what we sent and
 * what came back, and it already filters drafts. Direction is decided by the FROM address rather
 * than by folder, because a reply that got filed somewhere unusual is still a reply.
 */
export async function readThreadTruth(
  report: AuditReportRow,
  opts: { force?: boolean } = {}
): Promise<ThreadTruth> {
  const cached = !opts.force ? readCache(report) : null;
  if (cached) return cached;

  const email = await resolveProspectEmail(report);
  const truth = await readMailboxThread(email, report.outreach_stage ?? null);
  if (email) void writeCache(report.id, truth);
  return truth;
}

/**
 * The same read, for an address with no audit behind it.
 *
 * Split out because most Zoho leads have no audit report, and the first version returned
 * "no audit thread, so nothing was checked" for a lead that had three emails sitting in the
 * mailbox. Whether we have contacted someone is a fact about the MAILBOX, not about whether we
 * happened to run a scan on them, and a cold-call brief that wrongly implies first contact is
 * exactly the brief that gets him caught out in the opening sentence.
 *
 * `storedStage` is passed rather than a whole row so this can be called with nothing but an email.
 */
export async function readMailboxThread(
  email: string | null,
  storedStage: string | null = null
): Promise<ThreadTruth> {
  const stub = { outreach_stage: storedStage } as AuditReportRow;

  if (!email) {
    return emptyTruth(stub, null, [
      "No email address is on file for this prospect anywhere, so the mailbox could not be checked. This says we cannot tell whether they were contacted, NOT that they were not.",
    ]);
  }

  let found: GraphMessageSummary[] = [];
  try {
    found = await microsoft.searchMessagesWithAddress(email, 50);
  } catch (e) {
    // Non-fatal on purpose. A Graph outage should degrade the brief, not block the whole thread.
    return emptyTruth(stub, email, [
      `Outlook could not be read (${(e as Error).message}). Treating the thread as unknown rather than as empty.`,
    ]);
  }

  const inbound: ThreadMessage[] = [];
  const outbound: ThreadMessage[] = [];
  for (const m of found) {
    if (!m.id) continue;
    const from = m.from?.emailAddress?.address?.trim().toLowerCase() ?? "";
    const isInbound = from === email;
    (isInbound ? inbound : outbound).push(toMessage(m, isInbound));
  }

  const byNewest = (a: ThreadMessage, b: ThreadMessage) =>
    new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime();
  inbound.sort(byNewest);
  outbound.sort(byNewest);

  // Bodies only for the newest two replies. What THEY said is the whole reason to read the
  // mailbox; what we said is already reconstructable from the report and the drafts.
  const notes: string[] = [];
  for (const msg of inbound.slice(0, 2)) {
    try {
      const full = await microsoft.getMessageBody(msg.id);
      msg.body = tidy(full.body);
    } catch (e) {
      notes.push(`Could not open one reply (${(e as Error).message}); using its preview instead.`);
    }
  }

  const lastOutboundAt = outbound[0]?.at ?? null;
  const lastInboundAt = inbound[0]?.at ?? null;
  const theyReplied = inbound.length > 0;

  // Silence is measured from the last thing WE sent, and only counts when nothing came back after
  // it. A prospect who replied yesterday to an email from last week is not silent.
  const now = new Date().toISOString();
  const awaitingReply =
    !!lastOutboundAt && (!lastInboundAt || new Date(lastInboundAt) < new Date(lastOutboundAt));
  const daysSilent = awaitingReply ? daysBetween(lastOutboundAt!, now) : null;

  // `revealed` is the one stage the row knows better than the mailbox: it means Matthew explicitly
  // handed over price, report and video, which is a decision, not an observable event.
  let derivedStage: DerivedStage;
  if (storedStage === "revealed") derivedStage = "revealed";
  else if (theyReplied) derivedStage = "replied";
  else if (outbound.length > 0) derivedStage = "sent_no_reply";
  else derivedStage = "not_sent";

  const anchor = outbound[0] ?? null;

  const truth: ThreadTruth = {
    email,
    sent: outbound.slice(0, 6),
    replies: inbound.slice(0, 4),
    lastOutboundAt,
    lastInboundAt,
    daysSilent,
    theyReplied,
    derivedStage,
    anchorMessageId: anchor?.id ?? null,
    anchorSubject: anchor?.subject ?? null,
    conflictsWithStoredStage: conflicts(storedStage, derivedStage),
    storedStage,
    notes,
    readAt: now,
  };

  return truth;
}

/**
 * Does the stored stage positively contradict what the mailbox shows?
 *
 * Only the pairs that would change a draft count. `awaiting_intake` + `not_sent` agree; `drafted` +
 * `replied` do not, and that mismatch is exactly the Grey Seal failure.
 */
function conflicts(stored: string | null, derived: DerivedStage): boolean {
  if (!stored) return derived === "replied";
  if (derived === "replied") return stored !== "revealed";
  if (derived === "not_sent") return stored === "revealed";
  return false;
}

function readCache(report: AuditReportRow): ThreadTruth | null {
  const row = report as AuditReportRow & {
    thread_truth?: ThreadTruth | null;
    thread_truth_at?: string | null;
  };
  if (!row.thread_truth || !row.thread_truth_at) return null;
  const ageMin = (Date.now() - new Date(row.thread_truth_at).getTime()) / 60_000;
  if (ageMin > CACHE_MINUTES || Number.isNaN(ageMin)) return null;
  return row.thread_truth;
}

async function writeCache(reportId: string, truth: ThreadTruth): Promise<void> {
  try {
    await supabaseAdmin
      .from("audit_reports")
      .update({ thread_truth: truth, thread_truth_at: truth.readAt })
      .eq("id", reportId);
  } catch (e) {
    // A cache that cannot be written is a slower feature, not a broken one.
    console.error("[thread-truth] cache write failed:", (e as Error).message);
  }
}

/**
 * The human-readable block. Goes into the call brief, the agent's tool result and the card footer.
 *
 * Written in code for the same reason the COACH NOTES are: a model summarising "did they reply"
 * has every incentive to be encouraging about it.
 */
export function formatThreadTruth(t: ThreadTruth): string {
  if (!t.email) return "EMAIL HISTORY: no address on file, nothing could be checked.";

  const lines: string[] = [`EMAIL HISTORY with ${t.email} (read from Outlook, not from a column):`];

  if (!t.sent.length && !t.replies.length) {
    lines.push("- Nothing has been sent to them and nothing has come back. This is a first touch.");
  } else {
    lines.push(
      `- We have sent ${t.sent.length} message(s). Last one ${t.lastOutboundAt ? shortDate(t.lastOutboundAt) : "unknown"}.`
    );
    if (t.theyReplied) {
      lines.push(`- They HAVE replied, ${t.replies.length} time(s). Last ${shortDate(t.lastInboundAt!)}.`);
      for (const r of t.replies.slice(0, 2)) {
        const said = (r.body ?? r.preview ?? "").replace(/\s+/g, " ").slice(0, 400);
        if (said) lines.push(`  THEY SAID (${shortDate(r.at ?? "")}): "${said}"`);
      }
    } else {
      lines.push("- They have NEVER replied.");
    }
    if (t.daysSilent !== null) {
      lines.push(`- ${t.daysSilent} day(s) of silence since our last message.`);
    }
  }

  lines.push(`- Where this actually stands: ${stageLabel(t.derivedStage)}`);
  if (t.conflictsWithStoredStage) {
    lines.push(
      `- NOTE: the stored stage says "${t.storedStage}", which the mailbox contradicts. Trust the mailbox.`
    );
  }
  for (const n of t.notes) lines.push(`- ${n}`);
  return lines.join("\n");
}

function stageLabel(s: DerivedStage): string {
  switch (s) {
    case "not_sent":
      return "nothing has gone out yet";
    case "sent_no_reply":
      return "we have written, they have not answered";
    case "replied":
      return "they answered us and the ball is in our court";
    case "revealed":
      return "everything has been handed over: report, price, video";
  }
}

function shortDate(iso: string): string {
  if (!iso) return "unknown";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  return d.toISOString().slice(0, 10);
}
