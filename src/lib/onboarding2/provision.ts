// Turning a signature into a client.
//
// ‼️ THIS FILE DELEGATES. startPilot() in src/lib/clients/provision.ts already inserts the
// clients row, creates the private board channel with Matthew in it, calls linkToCrm (which routes through ingestLead into contacts, the CRM, #hot-leads and
// Speed-to-Lead), and posts the internal card into #onboarding-srt-aeo. Re-implementing any of
// that here would give the funnel a second, subtly different way to create a client.
//
// ‼️ NEVER CALL ingestLead() FROM THE SIGN ROUTE. startPilot already does, inside linkToCrm, and
// calling it twice posts two #hot-leads cards for one person.
//
// ‼️ NOTHING HERE MAY COST THE SIGNATURE. By the time this runs the signature row is committed
// and the person has been told they signed. Every failure is collected as a warning, said out
// loud in Slack, and returned. It is never thrown.

import { supabaseAdmin } from "@/lib/db";
import { startPilot, MAX_CONCURRENT_CLIENTS } from "@/lib/clients/provision";
import { splitName } from "@/lib/medspa/validate";
import { BILLING_STATUS } from "./constants";
import type { Onboarding2SigningRow } from "./types";

export interface ProvisionResult {
  ok: boolean;
  clientId: string | null;
  slug: string | null;
  /** The /onboarding?t=... intake link, or null. Null is a real and expected state. */
  onboardingUrl: string | null;
  contactId: string | null;
  alreadyProvisioned: boolean;
  /** Set when no client row exists. The signature is still valid; this is what Slack shouts. */
  error: string | null;
  warnings: string[];
  /** The client's private board channel. Null when it could not be created. */
  opsChannelId?: string | null;
  /** The audit they booked from, when the session carried its slug and the report exists. */
  report?: BookedFromReport | null;
}

export interface BookedFromReport {
  id: string;
  slug: string;
  businessName: string | null;
  website: string | null;
  city: string | null;
}

/**
 * The audit report behind a booking, read by the `r=` slug the report's Get Started button carries.
 *
 * ‼️ THE SLUG WAS STORED ON EVERY SESSION AND READ BY NOTHING UNTIL 2026-09-15. Without it a booking
 * provisioned a client named after the person's email address with "Website: not given yet", even
 * though the report they had just clicked on held the business name, the website and the city.
 */
export async function reportForSlug(slug: string | null | undefined): Promise<BookedFromReport | null> {
  const s = slug?.trim();
  if (!s) return null;
  const { data } = await supabaseAdmin
    .from("audit_reports")
    .select("id, slug, client_name, website, city")
    .eq("slug", s)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id as string,
    slug: data.slug as string,
    businessName: ((data.client_name as string | null) ?? "").trim() || null,
    website: ((data.website as string | null) ?? "").trim() || null,
    city: ((data.city as string | null) ?? "").trim() || null,
  };
}


/**
 * Record which offer this client came in on.
 *
 * ‼️ A FAILURE IS A WARNING AND NEVER A THROW, because the signature is already committed by the
 * time this runs. Same posture as every other side effect on this path: a client whose offer did
 * not stamp is a Slack problem, and a signer shown an error over one is a signer who thinks their
 * contract did not go through.
 *
 * A null offer is a row frozen before the split. It is left alone rather than guessed at.
 */
async function stampOffer(clientId: string, offer: string | null): Promise<void> {
  if (!clientId || !offer) return;
  const { error } = await supabaseAdmin
    .from("clients")
    .update({ offer_key: offer })
    .eq("id", clientId);
  if (error) console.error("[onboarding2/provision] offer stamp failed:", error.message);
}

/** The contact ingestLead created or matched, looked up by the address we just signed. */
async function contactIdFor(email: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("contacts")
    .select("id")
    .ilike("email", email)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.id as string) ?? null;
}

export async function provisionFromSigning(row: Onboarding2SigningRow): Promise<ProvisionResult> {
  const warnings: string[] = [];
  const email = (row.contact_email || row.email || "").toLowerCase();
  const empty: ProvisionResult = {
    ok: false,
    clientId: null,
    slug: null,
    onboardingUrl: null,
    contactId: null,
    alreadyProvisioned: false,
    error: null,
    warnings,
  };

  if (!email) return { ...empty, error: "The signing carried no email address." };

  const report = await reportForSlug(row.report_slug).catch(() => null);
  empty.report = report;

  // An existing client comes back to their own record rather than consuming a second seat.
  // Checked FIRST, before startPilot, exactly as api/clients/start does: somebody signing a
  // second agreement must not spend one of six seats on a row that already exists.
  const { data: existing } = await supabaseAdmin
    .from("clients")
    .select("id, slug")
    .ilike("email", email)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    const clientId = existing.id as string;
    await stampOffer(clientId, row.offer_key);
    const { data: channel } = await supabaseAdmin
      .from("clients")
      .select("ops_channel_id")
      .eq("id", clientId)
      .maybeSingle();
    return {
      ok: true,
      clientId,
      slug: (existing.slug as string) ?? null,
      // No intake link for a booking any more: nothing is asked of the client before the call.
      onboardingUrl: null,
      contactId: await contactIdFor(email),
      alreadyProvisioned: true,
      error: null,
      warnings,
      opsChannelId: (channel?.ops_channel_id as string | null) ?? null,
      report,
    };
  }

  const { firstName, lastName } = splitName(row.print_name || row.contact_name || "");

  const result = await startPilot({
    // The report's business name before the signing's, because the signature block that typed
    // business_legal_name no longer exists and the name falls back to the email address without one.
    legalName: row.business_legal_name || report?.businessName || null,
    // The website they typed on screen one, else the one the audit was run on.
    website: row.website || report?.website || null,
    email,
    door: "booking",
    phone: row.contact_phone,
    contactFirstName: firstName || null,
    contactLastName: lastName || null,
    // Four structured boxes, because checkMarket() geocodes an address rather than parsing a
    // line, and a client with no market centre holds no exclusivity at all.
    addressLine1: row.address_line1,
    city: row.address_city || report?.city?.split(",")[0]?.trim() || null,
    state: row.address_state,
    postalCode: row.address_postal,
    // ‼️ 'pilot' ON EVERY OFFER, AND THE REASON CHANGED ON 2026-09-16 EVEN THOUGH THE VALUE DID
    // NOT. It used to mean "the signature starts the free period the agreement promises", which
    // was true when there was one offer and nothing was charged until 5 appointments landed.
    // Two of the three offers are now paid, so there is no free period to start.
    //
    // It stays 'pilot' because MONEY IS TAKEN ON THE CALL, AFTER SIGNING, and this runs at
    // signature. Marking a client 'active' here would tell every board in Mission Control they
    // are billing before anybody has charged them. Whatever flips this to 'active' should be the
    // thing that takes the payment, and that thing does not exist yet.
    billingStatus: BILLING_STATUS,
  });

  if (!result.ok) {
    // ‼️ A SEAT CAP WOULD LAND HERE. startPilot DELETES the row it just inserted when
    // MAX_CONCURRENT_CLIENTS is reached, so there is genuinely no client. The signature is
    // already committed and stays valid; this is a Slack problem, not a signer problem, and the
    // signer's screen never mentions it.
    //
    // The cap is Infinity unless CLIENT_SEAT_CAP is set, so this second line is CONDITIONAL:
    // startPilot fails for other reasons too (an unreadable website, no free channel name),
    // and printing "the seat cap is Infinity" against one of those sends whoever reads the
    // warning looking for a cap that is not there.
    const capped = Number.isFinite(MAX_CONCURRENT_CLIENTS);
    return {
      ...empty,
      error: result.error,
      warnings: [
        result.error,
        capped
          ? `The seat cap is ${MAX_CONCURRENT_CLIENTS}. A signed agreement now has no client row behind it.`
          : "A signed agreement now has no client row behind it.",
      ],
    };
  }

  warnings.push(...result.warnings);
  await stampOffer(result.clientId, row.offer_key);

  // ‼️ NO INTAKE LINK IS RE-ISSUED FOR A BOOKING (2026-09-15). The client is asked for nothing
  // before the call; the confirmation email is the only thing they get. startPilot still mints a
  // token (the /onboarding form stays deployed for the legacy door), and nothing sends it.
  return {
    ok: true,
    clientId: result.clientId,
    slug: result.slug,
    onboardingUrl: null,
    contactId: await contactIdFor(email),
    alreadyProvisioned: result.alreadyProvisioned,
    error: null,
    warnings,
    opsChannelId: result.opsChannelId ?? null,
    report,
  };
}
