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
