// The ReachInbox lane: turn a forwarded campaign reply into a prospect, a Slack thread and a
// CRM contact.
//
// WHY THIS EXISTS AT ALL
// ReachInbox gates webhooks AND the REST API behind Tier 4, and the sending mailboxes were
// purchased inside ReachInbox, so they are not in our Microsoft 365 tenant and Graph cannot read
// them. There is no API to poll and no mailbox to sweep. The one free channel left is the mail
// itself: the purchased mailboxes forward inbound to a mailbox we DO own, and from that point a
// campaign reply is an ordinary Outlook message that reply-sweep.ts already reads every 5 minutes.
//
// ‼️ THE MAILBOX IS THE DISCRIMINATOR, AND IT MUST STAY SINGLE-PURPOSE.
// A campaign reply arrives from someone we never sent to, so it matches no prospect by
// conversation, address or domain -- exactly the shape reply-sweep drops as `unmatched`. The only
// thing separating "a stranger replied to the campaign" from "a stranger emailed Matthew" is
// WHICH mailbox it landed in. So prospect creation is allowed only in REACHINBOX_REPLY_MAILBOX
// and nowhere else. Point anything else at that address and it starts inventing prospects and
// CRM leads out of ordinary mail.
//
// Opens and clicks are not here and cannot be: they never leave ReachInbox on this plan.

import { slack } from "@/lib/slack-bot";
import { VEKTOR_CHANNELS } from "@/config/vektor";
import { ingestLead } from "@/lib/lead-intake";
import { upsertProspect, updateProspect } from "./prospects";
import { ensureProspectThread, displayName } from "./digest";
import type { ReplyClassification } from "./cadence";
import type { OutreachProspectRow } from "./types";

/** Where the purchased ReachInbox mailboxes forward to. Unset disables the whole lane. */
export function campaignReplyMailbox(): string {
  return (process.env.REACHINBOX_REPLY_MAILBOX || "").trim().toLowerCase();
}

/** True only for the dedicated forwarding mailbox. See the header note. */
export function isCampaignMailbox(mailbox: string): boolean {
  const configured = campaignReplyMailbox();
  return Boolean(configured) && mailbox.trim().toLowerCase() === configured;
}

/** Where campaign replies are announced. */
export function campaignChannel(): string {
  return VEKTOR_CHANNELS.emailDirector;
}

const FREEMAIL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "hotmail.com", "outlook.com",
  "live.com", "msn.com", "aol.com", "icloud.com", "me.com", "mac.com", "proton.me",
  "protonmail.com", "gmx.com", "mail.com", "comcast.net", "verizon.net", "sbcglobal.net",
]);

function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).toLowerCase() : "";
}

/** Graph's display name, split once. "Jane Doe" -> {Jane, Doe}; "Jane" -> {Jane, ""}. */
function splitName(display: string | null | undefined): { first: string; last: string } {
  const cleaned = (display ?? "").replace(/\s+/g, " ").trim();
  // Outlook falls back to the address as the display name; that is not a person's name.
  if (!cleaned || cleaned.includes("@")) return { first: "", last: "" };
  const parts = cleaned.split(" ");
  return { first: parts[0] ?? "", last: parts.slice(1).join(" ") };
}

export interface CampaignProspectInput {
  email: string;
  displayName?: string | null;
  receivedAt: Date;
}

/**
 * Create (or return) the prospect row for a campaign replier.
 *
 * first_sent_at is stamped to the reply's own timestamp on purpose. reply-sweep refuses to attach
 * mail older than first_sent_at -- a guard against reading a pre-existing conversation as a reply
 * to a pitch -- and a null or later value would make it reject the very message that created the
 * row. We genuinely do not know when ReachInbox sent the original, and this is the earliest time
 * we can prove contact existed.
 */
export async function createCampaignProspect(
  input: CampaignProspectInput
): Promise<OutreachProspectRow | null> {
  const email = input.email.trim().toLowerCase();
  const domain = domainOf(email);
  const { first, last } = splitName(input.displayName);
  const name = [first, last].filter(Boolean).join(" ") || null;

  const prospect = await upsertProspect({
    email,
    name,
    // A freemail domain is not a company website, and guessing one would put a dead link in the
    // CRM. Company is left null rather than title-casing a domain into something that reads like
    // a verified fact.
    website: domain && !FREEMAIL.has(domain) ? `https://${domain}` : null,
    source: "reachinbox",
  });
  if (!prospect) return null;

  if (!prospect.first_sent_at) {
    const updated = await updateProspect(prospect.id, {
      first_sent_at: input.receivedAt.toISOString(),
    });
    return updated ?? prospect;
  }
  return prospect;
}

/** Interested or asking price. The only two states worth interrupting Matthew's day for. */
export function isHot(c: ReplyClassification): boolean {
  return c.state === "REPLIED_INTERESTED" || c.state === "ASKED_PRICE_HOT";
}

function verdictLabel(c: ReplyClassification): string {
  if (c.wantsOut || c.state === "CLOSED") return ":no_entry: Opt-out";
  if (c.state === "ASKED_PRICE_HOT") return ":fire: Asked price";
  if (c.state === "REPLIED_INTERESTED") return ":white_check_mark: Interested";
  if (c.deferDays) return `:hourglass: Defer ~${c.deferDays}d`;
  return ":speech_balloon: Needs a read";
}

export interface AnnounceInput {
  prospect: OutreachProspectRow;
  classification: ReplyClassification;
  subject: string | null;
  bodyPreview: string | null;
  receivedAt: Date;
}

/**
 * Post the reply into the prospect's own thread, and put them in the CRM the first time.
 *
 * Called ONLY for outcome === "replied". A bounce closes the prospect silently and an
 * out-of-office is not an answer; announcing either would rebuild the notification noise this
 * lane exists to remove.
 */
export async function announceCampaignReply(
  input: AnnounceInput
): Promise<{ threaded: boolean; contactId: string | null }> {
  const { prospect, classification, subject, bodyPreview, receivedAt } = input;
  const channel = campaignChannel();
  if (!channel) {
    console.error("[reachinbox] SLACK_VEKTOR_EMAIL_DIRECTOR_CHANNEL unset; reply not announced");
    return { threaded: false, contactId: prospect.contact_id ?? null };
  }

  // CRM first, so the thread can link a contact that already exists. contact_id is the idempotency
  // key: a second reply from the same person must not create a second lead or re-fire a RingOut.
  let contactId = prospect.contact_id ?? null;
  if (!contactId) {
    const { first, last } = splitName(prospect.name);
    const res = await ingestLead({
      firstName: first,
      lastName: last,
      email: prospect.email,
      website: prospect.website ?? undefined,
      source: "reachinbox",
      headline: `Replied to the ReachInbox campaign — ${verdictLabel(classification)}`,
      noteTitle: "ReachInbox campaign reply",
      detailLines: [
        `Subject: ${subject || "(none)"}`,
        `Reply: ${classification.summary || bodyPreview || "(empty)"}`,
        `Received: ${receivedAt.toISOString()}`,
      ],
      // A RingOut on "take me off your list" is worse than no RingOut at all.
      speedToLead: isHot(classification),
      utmSource: "reachinbox",
      utmMedium: "email",
    });
    contactId = res.contactId;
    if (contactId) await updateProspect(prospect.id, { contact_id: contactId });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";
  const header = [
    `*${displayName(prospect)}* replied to the campaign`,
    `:e-mail: ${prospect.email}${prospect.website ? ` · ${prospect.website}` : ""}`,
    contactId
      ? `<${appUrl}/dashboard/leads/${contactId}|Open in CRM>`
      : "_Not in the CRM — ingest failed, see logs._",
  ];

  const threaded = await ensureProspectThread(prospect, channel, header);
  if (!threaded.slack_thread_ts || !threaded.slack_channel_id) {
    console.error(`[reachinbox] no thread for ${prospect.email}; reply not posted`);
    return { threaded: false, contactId };
  }

  const body = (bodyPreview ?? "").replace(/\s+/g, " ").trim().slice(0, 600);
  const when = receivedAt.toLocaleString("en-US", { timeZone: "America/New_York" });
  await slack.postThreadReply(
    threaded.slack_channel_id,
    threaded.slack_thread_ts,
    `${verdictLabel(classification)} — ${prospect.email}`,
    [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: [
            `${verdictLabel(classification)}  ·  _${when} ET_`,
            subject ? `*${subject}*` : null,
            body ? `>${body}` : "_No preview text._",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      },
    ]
  );

  return { threaded: true, contactId };
}
