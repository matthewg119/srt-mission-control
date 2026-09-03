// One prospect in, the ammo that has not been spent on them out.
//
// This is the join the whole lane exists to make: the market dataset knows who ChatGPT names in a
// city, the prospect row knows which city and what we measured about them, and the ledger knows
// what has already been said. Nothing before this could answer "what is true, specific and not yet
// used for this person".
//
// ‼️ EMPTY IS A NORMAL ANSWER, NOT A FAILURE. Measured: about 20 percent of the leads in this
// database sit in a city we have audited. For the other 80 percent there is no competitor ammo and
// there is not supposed to be one, because the alternative is naming a rival in a city we never
// measured. Callers degrade to signal ammo, and when that is empty too they say something generic
// rather than something invented.

import { supabaseAdmin } from "@/lib/db";
import { fromCityState, parseCityCell, type Place } from "@/lib/market/place";
import { competitorAmmo, signalAmmo, type AmmoCandidate } from "./supply";
import { unspentAmmo, spentAmmo } from "./spend";
import type { AmmoSpent } from "@/lib/followup-operator/types";

export interface ProspectAmmo {
  /** Unspent, competitor lines first, strongest first within each kind. */
  candidates: AmmoCandidate[];
  /** What has already been said, for a card that wants to show the history. */
  spent: AmmoSpent[];
  /** The market this prospect was resolved into, for explaining an empty result. */
  place: Place | null;
  service: string | null;
  /** Why there is no competitor ammo, when there is none. Null when there is some. */
  reason: string | null;
}

interface ProspectRow {
  id: string;
  city: string | null;
  company: string | null;
  website: string | null;
  audit_report_id: string | null;
  contact_id: string | null;
  ammo_used: unknown;
  score_components: unknown;
  optimization_components: unknown;
}

/**
 * Resolve the market a prospect sits in.
 *
 * ‼️ THE PROSPECT'S OWN city COLUMN IS TRIED FIRST AND IT IS AUDIT-SHAPED. outreach_prospects.city
 * is copied straight off audit_reports.city by both enrolment doors, so it arrives as "Austin, TX"
 * rather than as a bare city, and parseCityCell is the reader for that. The contact fallback is
 * lead-shaped, two separate columns with a spelled-out state, so it needs the other reader. Using
 * one parser for both is how this returned zero matches the first time it was measured.
 *
 * ‼️ THREE RUNGS, NOT TWO, SINCE 2026-09-03. The third reads the signed agreement. See
 * placeFromSigning below for why neither of the first two can ever see an onboarding2 client.
 */
async function resolvePlace(row: ProspectRow): Promise<Place | null> {
  const fromProspect = parseCityCell(row.city);
  if (fromProspect) return fromProspect;

  if (!row.contact_id) return null;

  const { data } = await supabaseAdmin
    .from("contacts")
    .select("biz_city, biz_state")
    .eq("id", row.contact_id)
    .maybeSingle();

  const fromContact = data
    ? fromCityState(data.biz_city as string | null, data.biz_state as string | null)
    : null;
  if (fromContact) return fromContact;

  return placeFromSigning(row.contact_id);
}

/**
 * The address they typed into the agreement.
 *
 * ‼️ THIS RUNG EXISTS BECAUSE THE TWO ABOVE IT CANNOT SEE AN ONBOARDING2 CLIENT AT ALL.
 * outreach_prospects.city is copied off an audit report, and a signer who arrived through the
 * funnel may never have had one. contacts.biz_city is CRM-shaped and is routinely null on a lead
 * that came in through a funnel rather than a scrape. So a client who told us their address in
 * writing, in a contract, still resolved to no market and got no competitor ammo.
 *
 * Lead-shaped, two separate columns, so fromCityState is the reader rather than parseCityCell.
 * address_state is free text capped at 60 characters by the sign route, so it arrives as "Texas"
 * or as "TX", and toStateCode takes both.
 *
 * ‼️ DEMO SIGNINGS ARE EXCLUDED, AND THAT IS NOT TIDINESS. demo.ts forces is_demo on
 * localhost and on every *.vercel.app host, so those rows hold whatever was typed while testing.
 * Reading one would name a real business's real competitors from an address nobody meant.
 *
 * Newest signature wins: an address corrected on a re-sign is the one that is true.
 */
async function placeFromSigning(contactId: string): Promise<Place | null> {
  const { data } = await supabaseAdmin
    .from("onboarding2_signings")
    .select("address_city, address_state")
    .eq("contact_id", contactId)
    .eq("is_demo", false)
    .not("address_city", "is", null)
    .order("signed_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  return fromCityState(data.address_city as string | null, data.address_state as string | null);
}

/** vertical_slug first, business_type behind it. The same ladder on both tables that carry them. */
function pickService(
  row: { vertical_slug?: unknown; business_type?: unknown } | null
): string | null {
  if (!row) return null;
  const service =
    ((row.vertical_slug as string | null) ?? "").trim() ||
    ((row.business_type as string | null) ?? "").trim();
  return service ? service.toLowerCase() : null;
}

/**
 * The service this prospect is in.
 *
 * The prospect row itself cannot answer this. It has a company name and a website, neither of
 * which says what the business sells, and guessing a vertical from a domain is the kind of
 * inference that puts a med spa's rivals in a plumber's inbox. So it comes from a record where
 * something actually classified them.
 *
 * ‼️ THE CLIENT FALLBACK IS WHAT MAKES THE SIGNING RUNG IN resolvePlace WORTH ANYTHING.
 * Adding a city and stopping there accomplishes NOTHING on its own: an onboarding2 signer usually
 * has no audit_report_id, so the place would resolve, the service would still be null, and
 * `reason` would merely change from "no city" to "no vertical" with the same empty list.
 *
 * onboarding2_signings has no vertical column at all, so the classification has to come from
 * clients, where adoptAuditClassification (clients/baseline-scan.ts) copies it off the baseline
 * audit. A null here before that scan has run is honest and stays null: it means nothing has
 * classified this business yet, which is not the same as it having no vertical.
 */
async function resolveService(row: ProspectRow): Promise<string | null> {
  if (row.audit_report_id) {
    const { data } = await supabaseAdmin
      .from("audit_reports")
      .select("vertical_slug, business_type")
      .eq("id", row.audit_report_id)
      .maybeSingle();

    const fromReport = pickService(data);
    if (fromReport) return fromReport;
  }

  if (!row.contact_id) return null;

  const { data } = await supabaseAdmin
    .from("clients")
    .select("vertical_slug, business_type")
    .eq("contact_id", row.contact_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return pickService(data);
}

/** Everything unspent for one prospect, with the reason when there is nothing. */
export async function ammoForProspect(prospectId: string): Promise<ProspectAmmo> {
  const { data } = await supabaseAdmin
    .from("outreach_prospects")
    .select(
      "id, city, company, website, audit_report_id, contact_id, ammo_used, " +
        "score_components, optimization_components"
    )
    .eq("id", prospectId)
    .maybeSingle();

  const empty: ProspectAmmo = {
    candidates: [],
    spent: [],
    place: null,
    service: null,
    reason: "prospect not found",
  };
  if (!data) return empty;

  const row = data as unknown as ProspectRow;
  const spent = spentAmmo(row);

  // Signal ammo needs no market at all, so it is built first and always available when we measured
  // anything. A prospect in an unaudited city still gets something true to say.
  const signals = signalAmmo({
    scoreComponents: row.score_components,
    optimizationComponents: row.optimization_components,
  });

  const place = await resolvePlace(row);
  const service = await resolveService(row);

  let competitors: AmmoCandidate[] = [];
  let reason: string | null = null;

  if (!place) reason = "no city on the prospect, their contact or their signed agreement";
  else if (!service) reason = "no vertical on the audit report or the client record";
  else {
    competitors = await competitorAmmo({
      place,
      service,
      excludeNames: [row.company, row.website],
    });
    if (!competitors.length) reason = "no engine has named anyone in this city and service yet";
  }

  return {
    // Competitor lines lead. A rival by name is a stronger opener than a metric about you.
    //
    // For the EMAIL lane the order is the whole choice, because operator-rules.ts allows exactly
    // one idea per message and nextAmmo() takes the head of this list. The on-page concierge reads
    // the whole ordered list through unspentAmmo(), where the order is a ranking rather than a
    // decision. See the header of followup-operator/operator-rules.ts for why the two differ.
    candidates: unspentAmmo(spent, [...competitors, ...signals]),
    spent,
    place,
    service,
    reason,
  };
}
