// The Slack cards. Pure builders, exactly like src/lib/chatgpt-ads/card.ts.
//
// Nothing here posts anything. The sign route owns the transport, so there is one place that
// knows about channels and threads and one place that knows about words.
//
// ‼️ THE SIGNATURE CARD IS TOP LEVEL IN #onboarding-srt-aeo, NOT A THREAD REPLY. It cannot hang
// under the client's ops thread because clients.ops_thread_ts does not exist yet at signature
// time: its only writer is api/onboarding/save/route.ts, which runs when the intake completes,
// days later. Everything else about this signing threads under THIS card.
//
// ‼️ EVERY CARD SAYS WHAT DID NOT HAPPEN. A card that reports a signature while silently
// omitting that the email bounced and provisioning hit the seat cap is worse than no card,
// because it is read as an all-clear. The same rule bookedCard follows in /chatgpt-ads.

import type { SlackBlock } from "@/lib/slack-bot";
import type { ProvisionResult } from "./provision";
import type { Onboarding2LeadRow, Onboarding2SigningRow } from "./types";
import { QUALIFYING_QUESTIONS } from "@/config/onboarding2";

function section(text: string): SlackBlock {
  return { type: "section", text: { type: "mrkdwn", text } };
}
function header(text: string): SlackBlock {
  return { type: "header", text: { type: "plain_text", text, emoji: true } };
}
function context(text: string): SlackBlock {
  return { type: "context", elements: [{ type: "mrkdwn", text }] };
}
function orDash(v: string | null | undefined): string {
  return v || "not given";
}
/** Tap to dial from a phone, the way every other card in this repo renders a number. */
function telLink(phone: string | null): string {
  return phone ? `<tel:${phone}|${phone}>` : "not given";
}

export function signedCard(args: {
  row: Onboarding2SigningRow;
  provision: ProvisionResult;
  emailedSigner: boolean;
  emailedSrt: boolean;
  documentUrl: string;
}): { text: string; blocks: SlackBlock[] } {
  const { row, provision } = args;
  const business = row.business_legal_name || row.contact_email || "A new client";
  const text = `Signed: ${business}`;

  const blocks: SlackBlock[] = [
    header(`Signed: ${business}`),
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Signed by*\n${orDash(row.print_name)}` },
        { type: "mrkdwn", text: `*Title*\n${orDash(row.signer_title)}` },
        { type: "mrkdwn", text: `*Email*\n${orDash(row.contact_email)}` },
        { type: "mrkdwn", text: `*Phone*\n${telLink(row.contact_phone)}` },
        {
          type: "mrkdwn",
          text: `*Address*\n${orDash(
            [row.address_line1, row.address_city, row.address_state, row.address_postal]
              .filter(Boolean)
              .join(", ")
          )}`,
        },
        { type: "mrkdwn", text: `*Template*\n${row.template_version}` },
      ],
    },
    section(`*Signed copy*  <${args.documentUrl}|download the PDF>`),
  ];

  // What did and did not happen. Stated plainly, because a waitUntil step can be killed on a
  // cold instance and this card is the only place a lost side effect is ever visible.
  const ledger: string[] = [
    args.emailedSigner ? ":white_check_mark: Signer emailed their copy" : ":x: Signer copy FAILED to send",
    args.emailedSrt ? ":white_check_mark: Internal copy emailed" : ":x: Internal copy FAILED to send",
  ];

  if (provision.error) {
    ledger.push(":rotating_light: *SIGNED BUT NOT PROVISIONED*");
    blocks.push(section(ledger.join("\n")));
    blocks.push(
      section(
        `*This agreement is signed and valid. There is no client row behind it.*\n\`${provision.error}\`\n` +
          `Close out a seat, then provision this signing by hand. Nothing needs re-signing.`
      )
    );
  } else {
    ledger.push(
      provision.alreadyProvisioned
        ? ":information_source: Client already existed, reused rather than taking a second seat"
        : ":white_check_mark: Client provisioned"
    );
    ledger.push(
      provision.onboardingUrl
        ? ":white_check_mark: Intake link minted and emailed"
        : ":warning: No intake link. CLIENT_LINK_SECRET is not set, so none could be minted"
    );
    blocks.push(section(ledger.join("\n")));

    if (provision.onboardingUrl) {
      blocks.push(section(`*Pre-call intake*  <${provision.onboardingUrl}|open the intake form>`));
    }
    if (provision.clientId) {
      blocks.push(context(`Client \`${provision.clientId}\`  |  slug \`${provision.slug ?? "none"}\``));
    }
  }

  if (provision.warnings.length) {
    blocks.push(context(provision.warnings.map((w) => `- ${w}`).join("\n")));
  }

  blocks.push(
    context(
      `Signing \`${row.id}\`  |  agreement \`${row.agreement_sha256.slice(0, 16)}\`  |  ` +
        `initials ${row.initials_snapshot?.length ?? 0} of ${row.agreement_snapshot?.sections?.length ?? 0}`
    )
  );

  return { text, blocks };
}

/**
 * The top-level card for a BOOKED call, which is what starts a client now.
 *
 * ‼️ IT IS NOT signedCard() WITH THE WORD CHANGED, AND THE DIFFERENCE IS THE POINT. That card
 * reports on an executed contract: who signed, under which template, with which document hash
 * and how many initials, and it links a PDF. None of that exists here. Nothing has been signed;
 * the agreement is signed by hand on the call, which is delivery step `agreement_signed`. A card
 * that kept those fields and rendered them as dashes would be reporting the absence of a
 * ceremony that is no longer supposed to have happened.
 *
 * signedCard() is deliberately left in place for the day e-signature comes back.
 */
export function bookedCard(args: {
  row: Onboarding2SigningRow;
  lead: Onboarding2LeadRow | null;
  provision: ProvisionResult;
}): { text: string; blocks: SlackBlock[] } {
  const { row, provision, lead } = args;
  const business = row.business_legal_name || row.contact_email || "A new lead";
  const text = `Call booked: ${business}`;

  const blocks: SlackBlock[] = [
    header(`Call booked: ${business}`),
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Contact*\n${orDash(row.contact_name)}` },
        { type: "mrkdwn", text: `*Title*\n${orDash(row.signer_title)}` },
        { type: "mrkdwn", text: `*Email*\n${orDash(row.contact_email)}` },
        { type: "mrkdwn", text: `*Phone*\n${telLink(row.contact_phone)}` },
        { type: "mrkdwn", text: `*Website*\n${orDash(row.website)}` },
        { type: "mrkdwn", text: `*When*\n${orDash(lead?.call_choice_label)}` },
      ],
    },
  ];

  // ‼️ THE CONFIRMATION EMAIL IS CALENDLY'S AND WE DID NOT SEND IT. Said out loud because the
  // funnel tells the client "we just sent an email", and whoever reads this card when they say
  // they never got one needs to know which system to go and look in.
  const ledger: string[] = [
    ":white_check_mark: Calendly sent the confirmation and the invite",
    ":black_square_button: Nothing signed yet, the agreement is signed on the call",
  ];

  if (provision.error) {
    ledger.push(":rotating_light: *BOOKED BUT NOT PROVISIONED*");
    blocks.push(section(ledger.join("\n")));
    blocks.push(
      section(
        `*There is a call on the calendar and no client row behind it.*\n\`${provision.error}\`\n` +
          `Close out a seat, then provision this by hand. The booking itself is unaffected.`
      )
    );
  } else {
    ledger.push(
      provision.alreadyProvisioned
        ? ":information_source: Client already existed, reused rather than taking a second seat"
        : ":white_check_mark: Client provisioned"
    );
    ledger.push(
      provision.onboardingUrl
        ? ":white_check_mark: Intake link minted"
        : ":warning: No intake link. CLIENT_LINK_SECRET is not set, so none could be minted"
    );
    blocks.push(section(ledger.join("\n")));

    if (provision.onboardingUrl) {
      blocks.push(section(`*Pre-call intake*  <${provision.onboardingUrl}|open the intake form>`));
    }
    if (provision.clientId) {
      blocks.push(
        context(`Client \`${provision.clientId}\`  |  slug \`${provision.slug ?? "none"}\``)
      );
    }
  }

  if (provision.warnings.length) {
    blocks.push(context(provision.warnings.map((w) => `- ${w}`).join("\n")));
  }

  blocks.push(
    context(
      `Session \`${row.id}\`` +
        (lead?.calendly_event_uri ? `  |  Calendly \`${lead.calendly_event_uri.slice(-12)}\`` : "")
    )
  );

  return { text, blocks };
}

/** All six answers, in ONE reply. Not six replies, which is the wall the step board removed. */
export function qualifyingReply(lead: Onboarding2LeadRow): { text: string; blocks: SlackBlock[] } {
  const byKey = new Map(lead.qualifying.map((a) => [a.key, a.answer]));
  const lines = QUALIFYING_QUESTIONS.map((q) => `*${q.question}*\n${orDash(byKey.get(q.key))}`);

  return {
    text: `Qualifying answers for ${lead.business_name || lead.email}`,
    blocks: [
      section(`*Qualifying answers, ${lead.qualifying_answered} of ${QUALIFYING_QUESTIONS.length}*`),
      section(lines.join("\n\n")),
      context("Collected by the post-signature assistant. Access inventory is still owed, after the call."),
    ],
  };
}

/**
 * They picked a day for the onboarding call, in the chat.
 *
 * ---------------------------------------------------------------------------
 * !! THREE OUTCOMES, THREE DIFFERENT CARDS, AND THE ONE THAT SAYS "BOOKED" IS ONLY REACHABLE
 * WHEN AN INVITE ACTUALLY EXISTS.
 *
 * This card used to have one wording and it was the honest one: "NO INVITE HAS BEEN SENT. Pick
 * the hour with them and put it in the diary." A Graph invite now goes out when MS_CALENDAR_* is
 * configured, and the temptation is to change that sentence and be done. That would be exactly
 * wrong, because the unconfigured path is still the DEFAULT path and a Graph call can still
 * fail: a card claiming an invite on either of those would have a human stop looking for
 * something that was never sent, and nobody finds out until the hour arrives.
 *
 *   call_invite_sent_at set  -> BOOKED. The invite is in their inbox and the hour is real.
 *   call_invite_error set    -> AGREED, and it names the failure so somebody can fix it.
 *   both null                -> AGREED, no attempt was made. The original wording, unchanged.
 *
 * The third state is not a fallback that got left behind. It is what every row says until the
 * Azure app exists, and it is the same tri-state discipline the DNS panel draws between `added`
 * and `verified`: what a human asserted and what the system observed are different facts.
 * ---------------------------------------------------------------------------
 */
export function callReply(lead: Onboarding2LeadRow): { text: string; blocks: SlackBlock[] } {
  const who = lead.business_name || lead.contact_name || lead.email;
  const when = lead.call_choice_label || "day not recorded";
  const sent = Boolean(lead.call_invite_sent_at);

  // The hour, printed in the zone the client actually chose. Reading it back off the STORED
  // instant rather than recomputing it is what stops the card and the invite disagreeing.
  const at =
    lead.call_starts_at && lead.call_timezone
      ? new Intl.DateTimeFormat("en-US", {
          timeZone: lead.call_timezone,
          hour: "numeric",
          minute: "2-digit",
          timeZoneName: "short",
        }).format(new Date(lead.call_starts_at))
      : null;

  const headline = sent ? "Onboarding call BOOKED" : "Onboarding call day agreed";
  const note = sent
    ? `Invite sent to ${orDash(lead.email)}. It is in the diary. Graph event ${lead.call_event_id ?? "?"}.`
    : lead.call_invite_error
      ? `NO INVITE HAS BEEN SENT: the calendar call failed (${lead.call_invite_error}). Pick the hour with them and put it in the diary.`
      : "Chosen in the chat, not on a calendar. NO INVITE HAS BEEN SENT. Pick the hour with them and put it in the diary.";

  return {
    text: `${sent ? "Call booked" : "Call day agreed"}: ${who}`,
    blocks: [
      section(
        `:date: *${headline}*\n*${who}*\n${when}${at ? ` at ${at}` : ""}\n` +
          `Phone ${telLink(lead.phone)}  |  ${orDash(lead.email)}`
      ),
      context(note),
    ],
  };
}
