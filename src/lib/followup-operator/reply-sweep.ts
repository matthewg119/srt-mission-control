// Reads inbound mail and stops the ladder for anyone who answered.
//
// This did not exist. outreach_sweep_state.last_reply_scan_at has been a column since
// 2026-07-31 and nothing ever wrote it; applyReply() in cadence.ts was exported and never
// called, so outreach_prospects.last_reply_at was NULL on every row. The follow-up operator
// could see what it sent and was structurally incapable of noticing a reply.
//
// GRAPH NOTES
//   - folder: null reads EVERY folder. A reply that got filed or auto-filtered is the one we
//     least want to miss, and the sent sweep's "InefficientFilter" problem does not apply here:
//     the window filters on receivedDateTime and listMessages orders by receivedDateTime, so
//     the filter and the sort agree.
//   - Junk is swept separately and deduped by id. /me/messages is documented as all-folders,
//     but a reply in Junk is exactly the case worth being paranoid about.

import { supabaseAdmin } from "@/lib/db";
import { microsoft, type GraphMessage } from "@/lib/microsoft";
import { logTouch, updateProspect, getProspectByEmail, getProspectByConversation, normalizeEmail } from "./prospects";
import { applyReply } from "./cadence";
import { excludedDomains, isExcluded } from "./sent-sweep";
import { classifyReply, isAutomated, isBounce } from "./classify-reply";
import { connectedMailbox } from "@/config/outreach-mailboxes";
import type { OutreachProspectRow } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;
const OVERLAP_MS = 30 * 60 * 1000;
const FIRST_RUN_LOOKBACK_MS = 7 * DAY_MS;
const DEFAULT_MAX = 400;

export interface ReplySweepResult {
  scanned: number;
  replies: number;
  automated: number;
  bounced: number;
  unmatched: number;
  skippedDuplicate: number;
  windowStart: string;
  error?: string;
}

type InboundMessage = GraphMessage & {
  from?: { emailAddress?: { address?: string; name?: string } };
  internetMessageId?: string;
};

async function readState(): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("outreach_sweep_state").select("last_reply_scan_at").eq("id", 1).maybeSingle();
  return (data?.last_reply_scan_at as string | null) ?? null;
}

async function writeState(at: Date): Promise<void> {
  await supabaseAdmin
    .from("outreach_sweep_state")
    .upsert({ id: 1, last_reply_scan_at: at.toISOString(), updated_at: at.toISOString() });
}

/** Prospects that have actually been emailed, indexed by domain. The third and weakest match
 *  tier: an assistant or a second person at the business replying from a different address. */
async function domainIndex(): Promise<Map<string, OutreachProspectRow>> {
  const { data } = await supabaseAdmin
    .from("outreach_prospects")
    .select("*")
    .not("first_sent_at", "is", null);
  const map = new Map<string, OutreachProspectRow>();
  for (const row of (data ?? []) as OutreachProspectRow[]) {
    const at = row.email.lastIndexOf("@");
    if (at < 0) continue;
    const domain = row.email.slice(at + 1).toLowerCase();
    // First writer wins, so the oldest prospect on a domain owns it rather than the newest.
    if (!map.has(domain)) map.set(domain, row);
  }
  return map;
}

async function* inboundMessages(windowStart: string, mailbox: string | undefined) {
  const select = [
    "id", "conversationId", "subject", "from", "receivedDateTime",
    "bodyPreview", "isDraft", "internetMessageId",
  ];
  const filter = `receivedDateTime ge ${windowStart}`;
  const seen = new Set<string>();

  for await (const msg of microsoft.listMessages({ mailbox, folder: null, filter, top: 50, select })) {
    seen.add(msg.id);
    yield msg as InboundMessage;
  }
  // Belt and braces: Junk explicitly, deduped against what the all-folders pass already gave us.
  for await (const msg of microsoft.listMessages({ mailbox, folder: "junkemail", filter, top: 50, select })) {
    if (seen.has(msg.id)) continue;
    yield msg as InboundMessage;
  }
}

/**
 * Scan inbound mail, log every reply as a touch, and stop the ladder for anyone who answered.
 *
 * `minIntervalMinutes` makes this cheap to call from a frequent cron: it returns immediately
 * when the watermark is fresher than that.
 */
export async function runReplyMailSweep(opts?: {
  sinceISO?: string;
  max?: number;
  minIntervalMinutes?: number;
  writeWatermark?: boolean;
}): Promise<ReplySweepResult> {
  const now = new Date();
  const max = opts?.max ?? DEFAULT_MAX;
  const domains = excludedDomains();
  const last = await readState();

  if (opts?.minIntervalMinutes && last) {
    const age = now.getTime() - new Date(last).getTime();
    if (age < opts.minIntervalMinutes * 60_000) {
      return { scanned: 0, replies: 0, automated: 0, bounced: 0, unmatched: 0, skippedDuplicate: 0, windowStart: last };
    }
  }

  const windowStart =
    opts?.sinceISO ??
    new Date(last ? new Date(last).getTime() - OVERLAP_MS : now.getTime() - FIRST_RUN_LOOKBACK_MS).toISOString();

  const result: ReplySweepResult = {
    scanned: 0, replies: 0, automated: 0, bounced: 0, unmatched: 0, skippedDuplicate: 0, windowStart,
  };

  try {
    const byDomain = await domainIndex();
    const mailbox = connectedMailbox();

    for await (const msg of inboundMessages(windowStart, undefined)) {
      result.scanned++;
      if (result.scanned > max) break;
      if (msg.isDraft) continue;

      const from = (msg.from?.emailAddress?.address ?? "").trim().toLowerCase();
      // Our own Sent Items live in the all-folders view too. This is what keeps the sweep
      // from reading Matthew's own outbound as a reply to himself.
      if (!from || isExcluded(from, domains)) continue;

      // Match in descending order of trust, mirroring reply-anchor.ts.
      let prospect: OutreachProspectRow | null = null;
      let matchedBy = "conversation";
      if (msg.conversationId) prospect = await getProspectByConversation(msg.conversationId);
      if (!prospect) {
        prospect = await getProspectByEmail(normalizeEmail(from));
        if (prospect) matchedBy = "address";
      }
      if (!prospect) {
        const at = from.lastIndexOf("@");
        const cand = at >= 0 ? byDomain.get(from.slice(at + 1)) : undefined;
        if (cand) {
          prospect = cand;
          matchedBy = "domain";
        }
      }
      if (!prospect) {
        result.unmatched++;
        continue;
      }

      // Never attach mail older than the first thing we sent them. An existing thread with
      // the same person is not a reply to a pitch.
      const receivedAt = new Date(msg.receivedDateTime ?? now.toISOString());
      if (prospect.first_sent_at && receivedAt < new Date(prospect.first_sent_at)) continue;

      const automated = isAutomated(from, msg.subject ?? null);
      const bounced = automated && isBounce(from, msg.subject ?? null);

      const logged = await logTouch({
        prospect_id: prospect.id,
        direction: "inbound",
        channel: "email",
        subject: msg.subject ?? null,
        body: msg.bodyPreview ?? null,
        outcome: bounced ? "bounced" : automated ? "auto_reply" : "replied",
        graph_message_id: msg.id,
        internet_message_id: msg.internetMessageId ?? null,
        mailbox,
        conversation_id: msg.conversationId ?? null,
        occurred_at: receivedAt.toISOString(),
        // counts_as_touch:false keeps an inbound out of the one-channel-per-day rule, which
        // is about what WE sent. matched_by is recorded so a wrong domain match is visible
        // in the row rather than inferred weeks later.
        metadata: { source: "reply_sweep", matched_by: matchedBy, counts_as_touch: false },
      });

      if (logged.status === "error") {
        throw new Error(`logTouch failed for reply from ${from}: ${logged.message}`);
      }
      if (logged.status === "duplicate") {
        result.skippedDuplicate++;
        continue;
      }

      if (bounced) {
        result.bounced++;
        // A dead address is closed, not nudged. This is the single cheapest protection for
        // domain reputation, and it matters more as send volume goes up.
        await updateProspect(prospect.id, {
          paused: true, state: "CLOSED", closed_reason: "bounced", next_touch_at: null,
        });
        continue;
      }

      if (automated) {
        // Deliberately does NOT set last_reply_at. An out-of-office is not an answer, and
        // treating it as one would silently stop the ladder for someone who never read it.
        result.automated++;
        continue;
      }

      result.replies++;
      const patch = applyReply(prospect, classifyReply(msg.subject ?? null, msg.bodyPreview ?? null), receivedAt);
      await updateProspect(prospect.id, {
        ...patch,
        conversation_id: prospect.conversation_id ?? msg.conversationId ?? null,
        thread_subject: prospect.thread_subject ?? msg.subject ?? null,
      });
    }

    if (opts?.writeWatermark !== false) await writeState(now);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[followup] reply sweep failed:", message);
    result.error = message;
    // Same discipline as the sent sweep: do NOT advance the watermark on a failed run.
  }

  return result;
}
