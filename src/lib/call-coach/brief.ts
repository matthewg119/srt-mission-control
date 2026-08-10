// The pre-call brief: everything the coach needs about who is on the phone, in one block.
//
// Until now this was a copy-paste. `call` in the audit thread printed a COACH NOTES block and
// Matthew pasted it into a textarea, which meant the coach only ever knew about prospects with a
// finished audit AND a Slack thread AND a spare thirty seconds before dialing. Every other call
// ran blind.
//
// This joins the two context builders that never spoke: `buildCallFacts`/`buildCoachNotes` on the
// audit side and Zoho on the CRM side, plus the real Outlook thread.
//
// ‼️ BUILT IN CODE. Not one figure in here is written by a model. That is the same rule
// `buildCoachNotes` already runs on and the reason is unchanged: this block grounds every live
// suggestion for the whole call, so a hallucinated number is not one bad line, it is forty minutes
// of confident wrong coaching. `buildCoachNotes` is reused verbatim rather than reimplemented, so
// there is exactly one place that turns audit rows into speakable numbers.

import { supabaseAdmin } from "@/lib/db";
import { companiesConflict, normalizeHost } from "@/lib/company-identity";
import { buildZohoOnlyContext, type ZohoOnlySnapshot } from "@/lib/ai-intel/merchant-context";
import { buildCallFacts, buildCoachNotes } from "@/lib/audit-engine/call-script";
import { loadReportView } from "@/lib/audit-engine/report-view";
import {
  readThreadTruth,
  readMailboxThread,
  formatThreadTruth,
  type ThreadTruth,
} from "@/lib/audit-engine/thread-truth";
import type { AuditReportRow } from "@/lib/audit-engine/types";
import { decideCallType, callTypeLabel, type CoachCallType } from "./call-type";
import { whoLine, type CallTarget } from "./resolve-target";

/** `MAX_BRIEF_CHARS` on the suggest route is 4000. Leave room so nothing important is clipped. */
const BRIEF_BUDGET = 3800;

export interface CallBrief {
  callType: CoachCallType;
  /** Goes verbatim into the extension's CLOSING NOTES box and then into `callContext`. */
  text: string;
  hasAudit: boolean;
  auditReportId: string | null;
  who: CallTarget;
  reasons: string[];
  /** Slack thread of the audit, so the wrap card knows where to post. */
  slackChannel: string | null;
  slackThreadTs: string | null;
}

/**
 * Find the audit for this Zoho record.
 *
 * Four routes, most-trusted first. Every route that is not an id match is gated through
 * `companiesConflict`, which only fires when BOTH sides carry the field, so a sparse Zoho record
 * is never punished for having no website.
 */
async function findReport(target: CallTarget): Promise<AuditReportRow | null> {
  const done = () => supabaseAdmin.from("audit_reports").select("*").eq("status", "done");

  // 1. contacts.zoho_lead_id -> contacts.id -> audit_reports.contact_id
  if (target.contactId) {
    const { data } = await done().eq("contact_id", target.contactId).order("created_at", { ascending: false }).limit(1);
    if (data?.length) return data[0] as AuditReportRow;
  }

  // 2. The outreach prospect row, keyed on email.
  if (target.email) {
    const { data: prospect } = await supabaseAdmin
      .from("outreach_prospects")
      .select("audit_report_id")
      .eq("email", target.email.toLowerCase())
      .maybeSingle();
    if (prospect?.audit_report_id) {
      const { data } = await done().eq("id", prospect.audit_report_id).maybeSingle();
      if (data) return data as AuditReportRow;
    }

    // 3. The report's own address columns.
    const { data: byEmail } = await done()
      .or(`prospect_email.eq.${target.email},requester_email.eq.${target.email}`)
      .order("created_at", { ascending: false })
      .limit(1);
    if (byEmail?.length) return byEmail[0] as AuditReportRow;
  }

  // 4. Website host. Weakest, so it is the only one that gets a conflict check against the name
  //    as well: two businesses on one host is rare, but a parked domain or a shared builder
  //    subdomain does happen.
  const host = normalizeHost(target.website);
  if (host) {
    const { data } = await done().order("created_at", { ascending: false }).limit(50);
    const match = (data ?? []).find((r) => normalizeHost((r as AuditReportRow).website) === host);
    if (match) {
      const row = match as AuditReportRow;
      const conflict = companiesConflict(
        { businessName: target.businessName, website: target.website },
        { businessName: row.client_name, website: row.website }
      );
      if (!conflict) return row;
    }
  }

  return null;
}

export async function buildCallBrief(input: CallTarget): Promise<CallBrief> {
  const report = await findReport(input);

  // The WHO line is the mechanism that makes a misidentified lead obvious in the first five
  // seconds, so it cannot read "unknown business". Plenty of real Zoho leads have an empty
  // `Company` (Facebook lead ads and form fills often only capture a person), and the name is
  // usually sitting right there on the audit report or in the website host.
  const target: CallTarget = {
    ...input,
    businessName: input.businessName ?? report?.client_name ?? hostLabel(input.website) ?? null,
    website: input.website ?? report?.website ?? null,
  };

  // The mailbox, once, ALWAYS.
  //
  // Whether we have contacted someone is a fact about the mailbox, not about whether an audit
  // happens to exist. The first cut only read it when there was a report, so a Zoho lead with
  // three emails already sent came back as "nothing was checked" and the brief implied a first
  // touch. That is the brief that gets him caught out in the opening sentence.
  const truth: ThreadTruth | null = report
    ? await readThreadTruth(report).catch(() => null)
    : target.email
      ? await readMailboxThread(target.email).catch(() => null)
      : null;

  const { data: prospect } = target.email
    ? await supabaseAdmin
        .from("outreach_prospects")
        .select("state, first_sent_at")
        .eq("email", target.email.toLowerCase())
        .maybeSingle()
    : { data: null };

  const decision = decideCallType({ report, truth, prospect: prospect ?? null });

  const header = [
    `WHO: ${whoLine(target)}`,
    `CALL TYPE: ${callTypeLabel(decision)}`,
    ...decision.reasons.map((r) => `  · ${r}`),
    "",
  ];

  // ── The numbers block ────────────────────────────────────────────────────
  let numbers: string;
  if (report) {
    const view = await loadReportView(report);
    const facts = await buildCallFacts(report, view);
    // Two modes exist and there are three call types. `cold` with a real audit maps to "followup",
    // because that mode WITHHOLDS the price, which is right for someone who has heard nothing but
    // about whom we do have measured numbers worth naming.
    numbers = buildCoachNotes(facts, decision.type === "close" ? "closing" : "followup");
  } else {
    numbers = zohoOnlyNumbers();
  }

  // ── The CRM block ────────────────────────────────────────────────────────
  const zoho = await buildZohoOnlyContext(target.module, target.recordId).catch(() => null);
  const crm = zoho ? crmBlock(zoho) : "";

  const email = truth ? formatThreadTruth(truth) : "EMAIL HISTORY: no audit thread, so nothing was checked.";

  const text = clip([...header, numbers, "", crm, "", email].filter(Boolean).join("\n"));

  return {
    callType: decision.type,
    text,
    hasAudit: Boolean(report),
    auditReportId: report?.id ?? null,
    who: target,
    reasons: decision.reasons,
    slackChannel: report?.slack_channel_id ?? null,
    slackThreadTs: report?.slack_thread_ts ?? null,
  };
}

/**
 * The no-audit numbers block, and the negative assertion is the whole point of it.
 *
 * Every brief the model has ever been shown had a score in it. Handing it a brief with the numbers
 * section simply missing invites it to supply one, and it will, confidently, mid-call. Saying "none
 * exist, do not cite any" is a much stronger instrument than saying nothing.
 */
function zohoOnlyNumbers(): string {
  return [
    "NUMBERS I MAY CITE (nothing else exists):",
    "- NONE. No AI visibility audit has been run on this business.",
    "- Do NOT cite a score, a percentage, a number of questions, a competitor, or a gap count. None of them have been measured for this business and any figure you produce would be invented.",
    "- What you CAN say is what we do and what we find for businesses like theirs, in general terms, with no numbers attached to THEM.",
    "- If he needs numbers for this prospect, the honest answer is that the audit has not been run yet and it takes about ten minutes.",
  ].join("\n");
}

/** "GroveCityDental.com" -> "grovecitydental.com". Last resort for a nameless record: a host is a
 *  weak label but it is checkable on screen, which "unknown business" is not. */
function hostLabel(website: string | null | undefined): string | null {
  const host = normalizeHost(website ?? null);
  return host || null;
}

function crmBlock(z: ZohoOnlySnapshot): string {
  const lines = ["CRM (facts, not talking points):"];
  const bits = [
    z.lead_status ? `status ${z.lead_status}` : null,
    z.lead_source ? `source ${z.lead_source}` : null,
    z.lead_owner ? `owner ${z.lead_owner}` : null,
    z.days_since_modified != null ? `last touched ${z.days_since_modified}d ago` : null,
  ].filter(Boolean);
  if (bits.length) lines.push(`- ${bits.join(" · ")}`);
  if (z.website) lines.push(`- website ${z.website}`);

  if (z.notes.length) {
    lines.push("- Notes from previous calls, newest first. These are what Matthew wrote after talking to them:");
    for (const n of z.notes.slice(0, 3)) {
      const when = n.modified_at ? n.modified_at.slice(0, 10) : "undated";
      lines.push(`  · ${when}: ${n.content.replace(/\s+/g, " ").slice(0, 300)}`);
    }
  } else {
    lines.push("- No notes on this record. Nobody has written up a call with them.");
  }
  return lines.join("\n");
}

/**
 * Fit the budget by dropping from the TAIL.
 *
 * Order matters: the WHO line and the numbers block are what make the call safe, the CRM notes and
 * the email history are what make it good. So a brief that must be cut loses the nice-to-have and
 * keeps the load-bearing, and it says out loud that it was cut.
 */
function clip(text: string): string {
  if (text.length <= BRIEF_BUDGET) return text;
  console.warn(`[call-brief] clipped from ${text.length} to ${BRIEF_BUDGET} chars`);
  return `${text.slice(0, BRIEF_BUDGET - 80).trimEnd()}\n\n[brief truncated to fit, the numbers above are complete]`;
}
