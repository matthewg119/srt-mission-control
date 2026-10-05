// What the referral half of the walk needs to know, read off the client's own record.
//
// ‼️ THE DEALS ARE A TABLE AND NOT A BAG KEY, AND THAT WAS THE ONE REAL SCHEMA DECISION HERE.
// Everything else the Referral Engine needs about a client lives in `clients.review_workflow`,
// which is intake step 4's jsonb and is merged rather than replaced. A per-service deal does not
// fit there: the onboarding panel edits one service at a time, the grid has to be orderable, and
// a clinic excluding a service from referrals is a real row with a real reason. jsonb would have
// meant read-modify-write on every edit from two boards at once.
//
// So `client_service_offers` is a table, and the CLINIC-WIDE fallbacks stay in the bag, because
// those genuinely are single values.
//
// ‼️ ABSENT BEATS WRONG, THE SAME RULE destinationsFor() FOLLOWS. A clinic with no deals on file
// gets `null` from here, the two referral steps are skipped, and the patient walks the review
// questions this tool has always asked. The alternative is a patient being promised something the
// front desk has never heard of, which is worse than not being asked.

import { supabaseAdmin } from "@/lib/db";
import type { HubClient } from "./resolve";
import { DEFAULT_INVITE_MODE, readInviteMode, type InviteMode } from "./referral-invite";
import { connectedMailbox, outreachMailboxes } from "@/config/outreach-mailboxes";

export interface ReferralServiceOffer {
  serviceLabel: string;
  /** What the referred friend gets. */
  offerText: string;
  /** What the patient who refers gets, when the clinic offers her anything. */
  referrerOfferText: string | null;
}

export interface ReferralConfigData {
  offers: ReferralServiceOffer[];
  defaultOffer: string | null;
  defaultReferrerOffer: string | null;
  clinicPhone: string | null;
  /** The host a claim link is built on. Null falls back to the app's own origin. */
  reviewsHost: string | null;
  mode: InviteMode;
}

function trimmed(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return value ? value : null;
}

/**
 * Resolve the referral config for one client, or null when there is nothing to offer.
 *
 * ‼️ A FAILED READ RETURNS null AND NOT AN EMPTY CONFIG. The two are different: null skips the
 * referral steps, an empty config would ask her to recommend us and then show her a blank
 * promise. PostgREST answers `42P01 relation does not exist` until the migration is run, so this
 * has to survive the deploy that lands before the SQL does, which is the ordinary order here.
 */
export async function referralConfigFor(client: HubClient): Promise<ReferralConfigData | null> {
  const bag = (client.reviewWorkflow ?? {}) as Record<string, unknown>;
  const referral = (bag.referral_offer ?? {}) as Record<string, unknown>;

  const defaultOffer = trimmed(referral.default_offer);
  const defaultReferrerOffer = trimmed(referral.default_referrer_offer);
  const mode = readInviteMode(referral.mode);
  // The number the patient's text is addressed to, so the clinic is on the thread. The clinic's
  // own record, never typed into this lane.
  const clinicPhone = trimmed(client.phone);

  let offers: ReferralServiceOffer[] = [];
  try {
    const { data, error } = await supabaseAdmin
      .from("client_service_offers")
      .select("service_label, offer_text, referrer_offer_text, excluded, sort_order")
      .eq("client_id", client.id)
      .eq("excluded", false)
      .order("sort_order", { ascending: true });

    if (error) {
      // Logged, not thrown. A broken read here must never 500 a client's reviews page: the review
      // questions are the product and they do not depend on any of this.
      console.error("[hub/referral-config] offers read failed:", error.message);
    } else {
      offers = (data ?? [])
        .map((row) => {
          const r = row as Record<string, unknown>;
          return {
            serviceLabel: trimmed(r.service_label) ?? "",
            offerText: trimmed(r.offer_text) ?? "",
            referrerOfferText: trimmed(r.referrer_offer_text),
          };
        })
        .filter((o) => o.serviceLabel && o.offerText);
    }
  } catch (e) {
    console.error("[hub/referral-config] offers read threw:", (e as Error).message);
  }

  if (offers.length === 0 && !defaultOffer) return null;

  // ‼️ READ SEPARATELY AND NEVER AS AN EMBED. clients and client_hosts point at each other since
  // docs/2026-09-29-destinations.sql, so PostgREST refuses an unnamed embed between them with
  // "more than one relationship was found" and resolve.ts turns that into a 5xx on every hub
  // page. A plain select with eq() has no such problem. See the banner in project_launch_lane.
  let reviewsHost: string | null = null;
  try {
    const { data } = await supabaseAdmin
      .from("client_hosts")
      .select("host, vercel_attached_at")
      .eq("client_id", client.id)
      .eq("kind", "reviews")
      .limit(1);
    const row = (data ?? [])[0] as Record<string, unknown> | undefined;
    // Attached, not merely recorded. A hostname nothing serves is not somewhere to send a friend.
    if (row?.vercel_attached_at) reviewsHost = trimmed(row.host);
  } catch (e) {
    console.error("[hub/referral-config] reviews host read threw:", (e as Error).message);
  }

  return {
    offers,
    defaultOffer,
    defaultReferrerOffer,
    clinicPhone,
    reviewsHost,
    mode: mode ?? DEFAULT_INVITE_MODE,
  };
}

// ── The email settings, added 2026-10-05 ────────────────────────────────────────────────────────
//
// ‼️ EVERY ONE OF THESE IS OFF UNTIL SOMEBODY TURNS IT ON, PER CLIENT. Matthew wants to set this
// up during an onboarding call "anytime", so it is four booleans and three addresses in the same
// `clients.review_workflow` bag the rest of the referral settings live in, written by the Review
// handover panel and by the step-thread commands in src/lib/clients/referral-setup.ts. A default
// of true anywhere here would mean a clinic that never discussed email starts sending it the
// moment the deploy lands.
//
// ‼️ AND THE SENDER IS ALWAYS AN SRT MAILBOX. A clinic's own address is not reachable:
// /users/{mailbox}/sendMail only works for mailboxes inside this tenant that the delegated token
// holds Send-As on. `replyTo` is what puts the clinic on the other end of a reply, and the honest
// description of this arrangement is "SRT sends, the clinic is the reply-to". A real
// from-the-clinic send needs a separate sending domain and a per-client delegation record, which
// is a build of its own and is NOT what this is.

export interface ReferralEmailConfig {
  /** Master switch. False means nothing in this lane sends anything, whatever else is set. */
  enabled: boolean;
  /** The clinic hears about a new referral, and again when the friend claims. */
  notifyClinic: boolean;
  /** The friend hears what she claimed, at the address SHE typed on the claim form. */
  emailFriend: boolean;
  /** The patient hears that her friend came in, at the address SHE typed at the invite step. */
  emailReferrer: boolean;
  /** Where the clinic's own notifications land. Falls back to the clients row's email. */
  notifyTo: string | null;
  /**
   * The SRT mailbox the message leaves from, already validated against the tenant allowlist.
   *
   * ‼️ VALIDATED RATHER THAN TRUSTED, because Graph answers an address it has no Send-As grant on
   * with an error at send time and nothing upstream would notice. An unrecognised value falls
   * back to the connected mailbox instead of silently stopping every send for that client.
   */
  fromMailbox: string;
  /** The clinic's address, so a reply reaches them rather than us. */
  replyTo: string | null;
}

/**
 * One address, or null. Deliberately strict: a stored value that is not an address is a send that
 * fails at Graph, which is a silent outage rather than a visible fault.
 */
export function oneEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  if (value.length < 6 || value.length > 254) return null;
  // One @, something either side, a dot in the domain, and no whitespace. Not RFC 5322 and not
  // trying to be: this rejects what a person typo'd, and Graph is the real judge of the rest.
  if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;.]{2,}$/.test(value)) return null;
  return value;
}

export function referralEmailConfig(client: HubClient): ReferralEmailConfig {
  const bag = (client.reviewWorkflow ?? {}) as Record<string, unknown>;
  const settings = (bag.referral_email ?? {}) as Record<string, unknown>;

  return {
    enabled: settings.enabled === true,
    notifyClinic: settings.notify_clinic === true,
    emailFriend: settings.email_friend === true,
    emailReferrer: settings.email_referrer === true,
    // The clinic's own record is the fallback, so turning the notification on during a call does
    // not also require finding out where it should go.
    notifyTo: oneEmail(settings.notify_to) ?? oneEmail(client.email),
    fromMailbox: allowedMailbox(settings.from_mailbox),
    replyTo: oneEmail(settings.reply_to),
  };
}

/** The mailboxes a client may be configured to send from: the outreach rotation, nothing else. */
export function allowedMailboxes(): string[] {
  const list = outreachMailboxes().map((m) => m.address);
  const connected = connectedMailbox();
  return list.includes(connected) ? list : [connected, ...list];
}

/**
 * The stored mailbox if it is one we can actually send from, the connected account otherwise.
 *
 * ‼️ IT FALLS BACK RATHER THAN REFUSING, on purpose. A typo'd mailbox that stopped every send for
 * that client would be an outage with no error anywhere: the panel validates on the way in, and
 * this is the second line for a value that got in some other way.
 */
export function allowedMailbox(raw: unknown): string {
  const wanted = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return allowedMailboxes().includes(wanted) ? wanted : connectedMailbox();
}
