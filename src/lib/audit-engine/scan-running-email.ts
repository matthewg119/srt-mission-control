/**
 * The email a funnel lead gets the moment they finish: the scan is running, and an offer.
 *
 * ‼️ /aivisibility SENT THE LEAD NOTHING AT ALL UNTIL NOW. Measured 2026-09-03: that funnel's
 * Vercel function sends exactly one email and it goes to OWNER_EMAIL. The "your scan is running"
 * message that /, /invisible and /pricing send lives inline in srt-agwb/api/invisible-lead.js,
 * and nothing consumed source === 'aivisibility' to trigger a send. So a lead who filled in nine
 * screens got screen ten and silence.
 *
 * ‼️ SENT FROM MISSION CONTROL RATHER THAN FROM THE WEBSITE, AND THAT IS THE WHOLE REASON THIS
 * FILE IS HERE. The srt-agwb function has no database, so it cannot ask whether this person
 * already has a Loom. Sending from here means the brake and the send are the same decision.
 *
 * ‼️ THE SIGNATURE IS A CONSTANT, NOT OUTLOOK'S. Graph sendMail does NOT append the desktop
 * signature block, so a message sent this way arrives unsigned unless the body carries one.
 * PITCH_SIGNATURE_HTML is the plain block; EMAIL_SIGNATURE_HTML is the heavy branded one that
 * was making cold pitches look like marketing.
 */
import { microsoft } from "@/lib/microsoft";
import { PITCH_SIGNATURE_HTML } from "@/config/email-signature";
import { priorReportFor } from "./prior-report";

export type ScanEmailOutcome =
  | "sent"
  | "suppressed_loom"
  | "no_email"
  | "not_configured"
  | "error";

export interface ScanEmailResult {
  outcome: ScanEmailOutcome;
  detail?: string;
}

/** What the reader sees as the thing being scanned. Their domain, never a bare "your website". */
function subjectOf(website: string | null | undefined): string {
  const raw = (website ?? "").trim();
  if (!raw) return "your clinic";
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return url.hostname.replace(/^www\./i, "");
  } catch {
    return raw.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0] || "your clinic";
  }
}

function firstNameOf(name: string | null | undefined): string {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  // Title case a shouted or lowercase entry, and leave a normal one alone.
  if (!first) return "there";
  return /^[A-Z][a-z]/.test(first)
    ? first
    : first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

/**
 * Matthew's words, kept as written. Two edits only, both required by the medium:
 * "your website" becomes their actual domain, and (SIGNATURE) becomes the constant.
 *
 * ‼️ NO EM DASHES ANYWHERE IN HERE. Standing rule on every piece of outbound copy.
 */
export function scanRunningBody(args: { name?: string | null; website?: string | null }): string {
  const target = subjectOf(args.website);
  return [
    `Hey ${firstNameOf(args.name)},`,
    "",
    `We are running the scan on ${target} right now.`,
    "",
    "When it lands, you'll have:",
    "- Your score out of 100",
    "- Every question we tested",
    "- The clinics ChatGPT named ahead of you",
    "",
    "I can also record a personal 3 min video walking through your specific report and the 2-3",
    "things you can fix this week to start showing up more often and pulling in more patients",
    "organically.",
    "",
    "Takes me about 15-20 minutes to put together, yours to keep.",
    "",
    "Thanks",
  ].join("\n");
}

function asHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const body = escaped
    .split("\n")
    .map((line) => (line.trim() === "" ? "<div>&nbsp;</div>" : `<div>${line}</div>`))
    .join("");
  return (
    `<div style="font-family:Arial,Helvetica,sans-serif; font-size:14px; color:#1f2937; ` +
    `line-height:1.6;">${body}</div><br>${PITCH_SIGNATURE_HTML}`
  );
}

/**
 * Send it, unless we already made this person a Loom.
 *
 * ‼️ THE SUPPRESSION IS THE POINT, NOT AN OPTIMISATION. Offering to record a walkthrough for
 * somebody who is already holding one reads as a system that does not know who it is talking to,
 * and it is the exact failure Matthew described: an audit goes out by email, they then poke around
 * the site and run the funnel, and the automation pitches them the thing they already got.
 *
 * ‼️ NEVER THROWS. The lead is already saved by the time this runs. A Graph outage, an expired
 * delegated token, an unset mailbox: none of those may turn a captured lead into a 500.
 */
export async function sendScanRunningEmail(args: {
  email?: string | null;
  name?: string | null;
  website?: string | null;
  contactId?: string | null;
}): Promise<ScanEmailResult> {
  const to = (args.email ?? "").trim();
  if (!to) return { outcome: "no_email" };

  try {
    const prior = await priorReportFor({
      email: to,
      website: args.website,
      contactId: args.contactId,
    });

    if (prior?.loomSent) {
      return {
        outcome: "suppressed_loom",
        detail:
          `a Loom already exists for this clinic (report ${prior.slug ?? prior.id}, ` +
          `${prior.createdAt.slice(0, 10)}), so the walkthrough offer was not sent again`,
      };
    }

    await microsoft.sendMail({
      to,
      subject: `We are running the scan on ${subjectOf(args.website)}`,
      body: asHtml(scanRunningBody(args)),
      isHtml: true,
      // No fromMailbox: sends as the connected account, the same path /api/notify/funnel uses.
    });

    return {
      outcome: "sent",
      // Said out loud because it changes what the follow-up should do: a second scan for somebody
      // who has a report but no Loom is a reply on that thread, not a cold open.
      detail: prior
        ? `they already had a report from ${prior.createdAt.slice(0, 10)}` +
          (prior.pitchSent ? " and a pitch went out on it" : "")
        : undefined,
    };
  } catch (err) {
    return {
      outcome: "error",
      detail: err instanceof Error ? err.message : "unknown send failure",
    };
  }
}
