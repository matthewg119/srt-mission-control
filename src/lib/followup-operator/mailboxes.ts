// Which mailbox the next outreach email goes out from, and how much room is left today.
//
// Replaces "draft into both mailboxes at once", which spread nothing and left two copies to
// clean up. One draft per email, in the first mailbox that still has headroom.
//
// THE BUDGET COUNTS SENDS, NOT DRAFTS.
// This is the part most likely to be built wrong. Everything in the audit lane creates drafts;
// a draft sitting in Outlook for three days has cost deliverability nothing and must not consume
// budget. So the ledger is outreach_touches (direction=outbound, channel=email), which is only
// written when something actually left, and never audit_reports.outlook_drafts.

import { supabaseAdmin } from "@/lib/db";
import { startOfETDay } from "./cadence";
import { connectedMailbox, outreachMailboxes, type OutreachMailbox } from "@/config/outreach-mailboxes";

export interface MailboxHeadroom {
  address: string;
  used: number;
  cap: number;
  /** cap - used, floored at zero. */
  left: number;
  full: boolean;
}

/** Local part, for the compact headroom gauge. "submissions@srtagency.com" -> "submissions". */
function shortName(address: string): string {
  const at = address.indexOf("@");
  return at > 0 ? address.slice(0, at) : address;
}

/**
 * Sends today, per configured mailbox, on the Eastern calendar day.
 *
 * NULL mailbox counts against the connected account: rows written before rotation existed, and
 * anything the sent sweep logged from /me, all left from there.
 */
export async function mailboxHeadroom(now = new Date()): Promise<MailboxHeadroom[]> {
  const configured = outreachMailboxes();
  const { data, error } = await supabaseAdmin
    .from("outreach_touches")
    .select("mailbox")
    .eq("direction", "outbound")
    .eq("channel", "email")
    .gte("occurred_at", startOfETDay(now).toISOString());

  // A budget we cannot read is a budget we must assume is spent. Reporting zero usage here
  // would let a database blip authorise an unbounded send.
  if (error) {
    console.error("[followup] mailboxHeadroom failed, treating every mailbox as full:", error.message);
    return configured.map((m) => ({ address: m.address, used: m.dailyCap, cap: m.dailyCap, left: 0, full: true }));
  }

  const fallback = connectedMailbox();
  const used = new Map<string, number>();
  for (const row of data ?? []) {
    const key = ((row.mailbox as string | null) ?? fallback).toLowerCase();
    used.set(key, (used.get(key) ?? 0) + 1);
  }

  return configured.map((m) => {
    const u = used.get(m.address) ?? 0;
    return { address: m.address, used: u, cap: m.dailyCap, left: Math.max(0, m.dailyCap - u), full: u >= m.dailyCap };
  });
}

/**
 * The first mailbox with room, in configured order. `chosen: null` means every one is full,
 * and the caller must place NO draft and say so rather than quietly falling back to the first.
 */
export async function chooseOutreachMailbox(
  now = new Date()
): Promise<{ chosen: OutreachMailbox | null; headroom: MailboxHeadroom[] }> {
  const headroom = await mailboxHeadroom(now);
  const configured = outreachMailboxes();
  const open = headroom.find((h) => !h.full);
  const chosen = open ? configured.find((m) => m.address === open.address) ?? null : null;
  return { chosen, headroom };
}

/** The gauge: "matthew full (30/30), submissions 4/30". */
export function headroomGauge(headroom: MailboxHeadroom[]): string {
  return headroom
    .map((h) => (h.full ? `${shortName(h.address)} full (${h.used}/${h.cap})` : `${shortName(h.address)} ${h.used}/${h.cap}`))
    .join(", ");
}

/**
 * The one line every card and CRM note prints about mailbox choice.
 *
 * The chosen mailbox gets its full address because it is the fact being reported; the rest get
 * local parts because they are a gauge and the domain is the same on all of them anyway.
 */
export function mailboxLine(chosen: OutreachMailbox | null, headroom: MailboxHeadroom[]): string {
  const gauge = headroomGauge(headroom);
  return chosen
    ? `In ${chosen.address} · ${gauge}`
    : `No draft created: every mailbox is at its daily cap · ${gauge}. Tomorrow.`;
}
