// Turning a signature into a client.
//
// ‼️ THIS FILE DELEGATES. startPilot() in src/lib/clients/provision.ts already inserts the
// clients row, mints signOnboardingToken(clientId) and stores only its hash, sends the welcome
// email, calls linkToCrm (which routes through ingestLead into contacts, the CRM, #hot-leads and
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
import { startPilot, onboardingUrlFor, MAX_CONCURRENT_CLIENTS } from "@/lib/clients/provision";
import { signOnboardingToken, hashToken, isClientLinkSecretConfigured } from "@/lib/clients/token";
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
}

/**
 * Mint a fresh intake link for a client who already exists.
 *
 * Only the token HASH is stored, so an earlier link genuinely cannot be recovered. Re-issuing is
 * the only correct answer to "I need that link again", and it is the same code path either way.
 * Lifted from api/clients/start/route.ts, which does exactly this for a returning starter.
 */
async function reissueLink(clientId: string): Promise<string | null> {
  if (!isClientLinkSecretConfigured()) return null;
  const { token, expiresAt } = signOnboardingToken(clientId);
  const url = onboardingUrlFor(token);
  const { error } = await supabaseAdmin
    .from("clients")
    .update({
      onboarding_token_hash: hashToken(token),
      onboarding_token_expires_at: expiresAt.toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", clientId);
  if (error) console.error("[onboarding2/provision] token store failed:", error.message);
  return url;
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
    const url = await reissueLink(clientId);
    if (!url) warnings.push("CLIENT_LINK_SECRET is not set, so no intake link could be minted.");
    return {
      ok: true,
      clientId,
      slug: (existing.slug as string) ?? null,
      onboardingUrl: url,
      contactId: await contactIdFor(email),
      alreadyProvisioned: true,
      error: null,
      warnings,
    };
  }

  const { firstName, lastName } = splitName(row.print_name ?? "");

  const result = await startPilot({
    legalName: row.business_legal_name,
    email,
    phone: row.contact_phone,
    contactFirstName: firstName || null,
    contactLastName: lastName || null,
    // Four structured boxes, because checkMarket() geocodes an address rather than parsing a
    // line, and a client with no market centre holds no exclusivity at all.
    addressLine1: row.address_line1,
    city: row.address_city,
    state: row.address_state,
    postalCode: row.address_postal,
    // ‼️ 'pilot'. The signature starts the free period the agreement promises. 'active' would
    // tell every board in Mission Control this client is billing, which contradicts Section 3.
    billingStatus: BILLING_STATUS,
  });

  if (!result.ok) {
    // ‼️ THE SEAT CAP LANDS HERE. startPilot DELETES the row it just inserted when
    // MAX_CONCURRENT_CLIENTS is reached, so there is genuinely no client. The signature is
    // already committed and stays valid; this is a Slack problem, not a signer problem, and the
    // signer's screen never mentions it.
    return {
      ...empty,
      error: result.error,
      warnings: [
        result.error,
        `The seat cap is ${MAX_CONCURRENT_CLIENTS}. A signed agreement now has no client row behind it.`,
      ],
    };
  }

  warnings.push(...result.warnings);

  // alreadyProvisioned returns onboardingUrl: null BY DESIGN, because only the token hash was
  // ever stored and the original link cannot be re-derived. Re-issue rather than report nothing.
  let onboardingUrl = result.onboardingUrl;
  if (!onboardingUrl) {
    onboardingUrl = await reissueLink(result.clientId);
    if (!onboardingUrl) {
      warnings.push(
        "CLIENT_LINK_SECRET is not set, so no intake link was generated and no welcome email went out."
      );
    }
  }

  return {
    ok: true,
    clientId: result.clientId,
    slug: result.slug,
    onboardingUrl,
    contactId: await contactIdFor(email),
    alreadyProvisioned: result.alreadyProvisioned,
    error: null,
    warnings,
  };
}
