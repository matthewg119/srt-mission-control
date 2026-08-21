// Turning a decision into a provisioned client. Exactly once.
//
// PILOT §5: "There is no checkout.session.completed. The trigger is a human." One
// caller today, the Start pilot button. When the paid caller arrives it calls this same
// function with billing_status 'active' and its own Stripe work in front of it; nothing
// below is pilot-specific except the defaults.
//
// TWO CLAIMS, deliberately, copying src/lib/medspa/provision.ts. Creating the client row
// is cheap and safe to repeat. Creating a Slack channel and emailing a clinic owner are
// neither, and a double-clicked button that shared one flag with the cheap work would
// send two welcome emails. So the row is claimed by its unique slug, and the expensive
// half is claimed separately by a conditional UPDATE on provisioned_at.
//
// EVERY SIDE EFFECT IS .catch()-LOGGED. A Slack outage must not cost the welcome email,
// and a Graph token lapse must not cost the Slack channel. What it must never do is
// look like success: failures are reported back in ProvisionResult.warnings and posted
// to #alerts-infra, because a silently half-provisioned client is worse than a loud
// failure.
//
// NO PRICE PATH. Nothing here imports Stripe or reads an amount. For a pilot there is
// nothing to branch on, which is the point: absent beats forbidden.

import dns from "dns/promises";
import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import { ingestLead, enrichLead } from "@/lib/lead-intake";
import { normalizeTarget } from "@/lib/scan/normalize";
import { sendPilotWelcome } from "@/lib/clients/welcome-email";
import {
  signOnboardingToken,
  hashToken,
  isClientLinkSecretConfigured,
} from "@/lib/clients/token";
import {
  slugify,
  normalizeAddress,
  normalizeState,
  isInsideMarket,
  isUsableCenter,
  DEFAULT_MARKET_RADIUS_MI,
} from "@/lib/clients/normalize";
import { resolveMarketCenter } from "@/lib/clients/geocode";
import { normalizePhone } from "@/lib/medspa/validate";

/** Six at a time, pilots included. PILOT §1 and D-P2. Enforced here, never rendered. */
export const MAX_CONCURRENT_CLIENTS = 6;

const PILOT_DAYS = 90;

/** The eight stages, in order. Seeded whole so the board renders the journey on day 1. */
export const ONBOARDING_STAGES = [
  "start",
  "intake",
  "photograph_1",
  "call",
  "photograph_2",
  "build",
  "rhythm",
  "renew",
] as const;

export interface StartPilotInput {
  /**
   * Optional, because /start provisions from an email alone and intake step 1 collects
   * the real name minutes later. Anything relying on it must handle null.
   */
  legalName?: string | null;
  dbaName?: string | null;
  /** Optional for the same reason. Intake step 1 is the authority on it. */
  website?: string | null;
  email: string;
  phone?: string | null;
  contactFirstName?: string | null;
  contactLastName?: string | null;
  city?: string | null;
  state?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  postalCode?: string | null;
  /** Internal only. Never rendered client-side, never spoken to a pilot. */
  tierScope?: "core" | "complete";
  marketCenterLat?: number | null;
  marketCenterLng?: number | null;
  marketRadiusMi?: number | null;
  language?: "en" | "es" | "both";
  /** 'pilot' today. The paid caller passes 'active'. */
  billingStatus?: "pilot" | "active";
}

export type StartPilotResult =
  | {
      ok: true;
      clientId: string;
      slug: string;
      /** Null when the secret is unset. The caller must show it, not swallow it. */
      onboardingUrl: string | null;
      alreadyProvisioned: boolean;
      warnings: string[];
    }
  | { ok: false; error: string };

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";
}

export function onboardingUrlFor(token: string): string {
  return `${appUrl()}/onboarding?t=${encodeURIComponent(token)}`;
}

export async function startPilot(input: StartPilotInput): Promise<StartPilotResult> {
  const legalName = input.legalName?.trim() || "";
  const email = input.email.trim().toLowerCase();
  if (!email) return { ok: false, error: "Email is required." };

  // Email alone is a valid start: /start provisions from the Stripe thank-you page before
  // anyone has typed a business name, and intake step 1 backfills every one of these
  // fields minutes later. A website that was TYPED and is unreadable is still an error,
  // because that is a mistake worth surfacing rather than silently dropping.
  let website: string | null = null;
  let domain: string | null = null;

  if (input.website?.trim()) {
    const normalized = normalizeTarget(input.website);
    if (!normalized.ok) {
      return { ok: false, error: `That website could not be read (${normalized.error}).` };
    }
    website = normalized.target.website;
    domain = normalized.target.domain;
  }

  // ── Seat cap ──
  // Counted server-side, refused with a plain sentence. There is no counter anywhere in
  // the UI: "six at a time" is delivery truth, not scarcity marketing (PILOT §1).
  const { count } = await supabaseAdmin
    .from("clients")
    .select("id", { count: "exact", head: true })
    .in("billing_status", ["pilot", "active"]);

  const live = count ?? 0;

  const billingStatus = input.billingStatus ?? "pilot";
  const now = new Date();

  const baseRow = {
    // Placeholder rather than null: the column is NOT NULL, and a self-serve start has no
    // name yet. Intake step 1 overwrites it with the real one within minutes.
    legal_name: legalName || email,
    dba_name: input.dbaName?.trim() || null,
    website,
    domain,
    email,
    // E.164 or nothing usable. The form live-formats, but this is the last gate before
    // the column every WhatsApp draft is addressed off, and /start posts here too. A
    // number that will not normalize is KEPT as typed rather than dropped: it is still
    // the only way to reach this person, and the client board flags it in amber.
    phone: normalizePhone(input.phone ?? "") ?? (input.phone?.trim() || null),
    address_line1: input.addressLine1 ? normalizeAddress(input.addressLine1) : null,
    address_line2: input.addressLine2 ? normalizeAddress(input.addressLine2) : null,
    city: input.city?.trim() || null,
    state: input.state ? normalizeState(input.state) : null,
    postal_code: input.postalCode?.trim() || null,
    billing_status: billingStatus,
    tier_scope: input.tierScope ?? "complete",
    language: input.language ?? "en",
    market_center_lat: input.marketCenterLat ?? null,
    market_center_lng: input.marketCenterLng ?? null,
    market_radius_mi: input.marketRadiusMi ?? null,
    market_locked_at: isUsableCenter(input.marketCenterLat, input.marketCenterLng)
      ? now.toISOString()
      : null,
    onboarding_status: "invited",
    ...(billingStatus === "pilot"
      ? {
          pilot_started_at: now.toISOString(),
          pilot_ends_at: new Date(now.getTime() + PILOT_DAYS * 86400_000).toISOString(),
        }
      : {}),
  };

  // ── THE ROW CLAIM ──
  // The unique slug is the claim. A double-clicked button produces a duplicate-key
  // error on the second insert, and the existing row is read back. Two genuinely
  // different clinics whose names slugify the same get a numeric suffix instead, which
  // is why this loops rather than simply returning.
  // Falls back to the email local-part, because a self-serve start has neither a name nor
  // a domain and slugify("") returns "" — which would make every email-only client
  // collide on the same empty slug.
  const desired =
    slugify(input.dbaName?.trim() || legalName) ||
    slugify(domain ?? "") ||
    slugify(email.split("@")[0]) ||
    "client";
  let clientId: string | null = null;
  let slug = desired;
  let inserted = false;

  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = attempt === 0 ? desired : `${desired}-${attempt + 1}`;

    const { data, error } = await supabaseAdmin
      .from("clients")
      .insert({ ...baseRow, slug: candidate })
      .select("id, slug")
      .maybeSingle();

    if (data?.id) {
      clientId = data.id as string;
      slug = data.slug as string;
      inserted = true;
      break;
    }

    // 23505 = unique_violation. Anything else is a real failure worth surfacing.
    if (error && error.code !== "23505") {
      console.error("[clients/provision] insert failed:", error.message);
      return { ok: false, error: `Could not create the client row: ${error.message}` };
    }

    // Same business starting twice, or two different businesses whose names slugify the
    // same. Only the first should reuse the row.
    const { data: existing } = await supabaseAdmin
      .from("clients")
      .select("id, slug, domain, email")
      .eq("slug", candidate)
      .maybeSingle();

    // Domain identifies them when there IS one. When there is not, it must NOT: two
    // email-only starts both have domain null, and `null === null` would hand the second
    // business the first one's client row, its Slack channel and its onboarding link.
    // Email is the only identifier a self-serve start actually has.
    const sameBusiness = existing
      ? domain
        ? existing.domain === domain
        : existing.domain === null && existing.email === email
      : false;

    if (existing && sameBusiness) {
      clientId = existing.id as string;
      slug = existing.slug as string;
      break;
    }
  }

  if (!clientId) {
    return { ok: false, error: "Could not find a free channel name for this business." };
  }

  // The cap is checked against clients that already existed, so a re-click on an
  // existing client is never refused by it.
  if (inserted && live >= MAX_CONCURRENT_CLIENTS) {
    await supabaseAdmin.from("clients").delete().eq("id", clientId);
    return {
      ok: false,
      error: `All ${MAX_CONCURRENT_CLIENTS} seats are taken. Close one out before starting another.`,
    };
  }

  // ── THE PROVISIONING CLAIM ──
  // Everything below runs once, ever, for this client.
  const { data: claimed } = await supabaseAdmin
    .from("clients")
    .update({ provisioned_at: now.toISOString(), updated_at: now.toISOString() })
    .eq("id", clientId)
    .is("provisioned_at", null)
    .select("id")
    .maybeSingle();

  if (!claimed) {
    // A second click, or two callers racing. Hand back the same client and send
    // nothing: the first caller already did, or is doing, all of it.
    //
    // onboardingUrl is null here and cannot be otherwise. Only the token's HASH is
    // stored, so the link genuinely cannot be re-derived. Re-issuing one is a
    // deliberate, separate action, which is the correct cost for handing out a new
    // bearer credential.
    return {
      ok: true,
      clientId,
      slug,
      onboardingUrl: null,
      alreadyProvisioned: true,
      warnings: [],
    };
  }

  const warnings: string[] = [];
  const warn = (msg: string) => {
    console.error(`[clients/provision] ${msg}`);
    warnings.push(msg);
  };

  // ── Seed the eight stages, 'start' complete ──
  const { error: seedError } = await supabaseAdmin
    .from("client_onboarding_steps")
    .upsert(
      ONBOARDING_STAGES.map((stage) => ({
        client_id: clientId,
        stage,
        status: stage === "start" ? "complete" : "pending",
        completed_at: stage === "start" ? now.toISOString() : null,
      })),
      { onConflict: "client_id,stage" }
    );
  if (seedError) warn(`stage seeding failed: ${seedError.message}`);

  // ── Market check. Flags, never blocks. ──
  await checkMarket(clientId, input).catch((e) =>
    warn(`market check failed: ${(e as Error).message}`)
  );

  // ── Subdomain: learn.{domain} unless it already resolves, then guide. ──
  // Skipped when there is no domain yet, because a DNS lookup of "learn.null" is not a check
  // worth running. It is then decided by registerHubAndSeedDns, which runs as the hub_preview
  // step and cannot proceed without a domain anyway. This comment used to claim intake step 1
  // decided it; nothing did, and every /start client carried a null subdomain into the hub.
  if (domain) {
    await chooseSubdomain(clientId, domain).catch((e) =>
      warn(`subdomain check failed: ${(e as Error).message}`)
    );
  }

  // No client Slack channel is created. Slack is INTERNAL ONLY as of 2026-08-20: guests
  // bill at 5 per PAID ACTIVE MEMBER, so fifty clients would mean buying ten seats for a
  // workspace with one human in it. Client conversation is WhatsApp, contracts are email.
  // See src/lib/clients/client-drafts.ts. The slack_channel_id / slack_channel_name
  // columns still exist and still hold the one channel that was created before this
  // reversed, but nothing writes them any more.

  // ── Onboarding token ──
  let onboardingUrl: string | null = null;
  if (!isClientLinkSecretConfigured()) {
    warn("CLIENT_LINK_SECRET is not set, so no onboarding link was generated.");
  } else {
    const { token, expiresAt } = signOnboardingToken(clientId);
    onboardingUrl = onboardingUrlFor(token);
    const { error } = await supabaseAdmin
      .from("clients")
      .update({
        onboarding_token_hash: hashToken(token),
        onboarding_token_expires_at: expiresAt.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", clientId);
    if (error) warn(`token store failed: ${error.message}`);
  }

  // ── Welcome email ──
  if (onboardingUrl) {
    await sendPilotWelcome({
      to: email,
      firstName: input.contactFirstName?.trim() || null,
      onboardingUrl,
    }).catch((e) => warn(`welcome email failed: ${(e as Error).message}`));
  } else {
    warn("Welcome email was not sent, because there was no link to put in it.");
  }

  // ── CRM link. Append to an existing #hot-leads thread, or open one. ──
  await linkToCrm(clientId, {
    email,
    website,
    legalName: legalName || email,
    firstName: input.contactFirstName ?? null,
    lastName: input.contactLastName ?? null,
    phone: input.phone ?? null,
    city: input.city ?? null,
  }).catch((e) => warn(`CRM link failed: ${(e as Error).message}`));

  // ── Post to #onboarding-srt-aeo ──
  await postOnboardingCard({
    legalName: legalName || email,
    slug,
    email,
    website,
    onboardingUrl,
    clientId,
  }).catch((e) => warn(`onboarding card failed: ${(e as Error).message}`));

  if (warnings.length) {
    await postInfraAlert(
      [`:warning: Provisioning for *${legalName}* finished with problems:`, ...warnings.map((w) => `- ${w}`)].join("\n")
    ).catch(() => {});
  }

  return { ok: true, clientId, slug, onboardingUrl, alreadyProvisioned: false, warnings };
}

// ─────────────────────────────────────────────────────────────────────────────

async function checkMarket(clientId: string, input: StartPilotInput): Promise<void> {
  let lat = input.marketCenterLat;
  let lng = input.marketCenterLng;
  const radius = input.marketRadiusMi ?? DEFAULT_MARKET_RADIUS_MI;

  // A2 §2: geocode the canonical address ONCE, at intake, with the US Census geocoder.
  // Only when nobody typed a centre by hand — a hand-entered pin is somebody looking at a
  // map, and that beats an address-file match.
  if (!isUsableCenter(lat, lng)) {
    // Street address first, ZIP centroid second. A centre-less client holds no market at
    // all, so "no match" must not be allowed to mean "no exclusivity".
    const point = await resolveMarketCenter({
      addressLine1: input.addressLine1,
      city: input.city,
      state: input.state,
      postalCode: input.postalCode,
    }).catch(() => null);

    if (point) {
      lat = point.lat;
      lng = point.lng;
      await supabaseAdmin
        .from("clients")
        .update({
          market_center_lat: point.lat,
          market_center_lng: point.lng,
          market_radius_mi: radius,
          market_locked_at: new Date().toISOString(),
        })
        .eq("id", clientId);
    }
  }

  if (!isUsableCenter(lat, lng) || radius <= 0) return;

  const { data: others } = await supabaseAdmin
    .from("clients")
    .select("id, legal_name, market_center_lat, market_center_lng, market_radius_mi")
    .in("billing_status", ["pilot", "active"])
    .neq("id", clientId);

  // D-P13's test, both ways round: this clinic inside a held market, OR a held clinic
  // inside this one. Either is one market with two clinics in it, and only checking one
  // direction lets the second clinic in whenever its radius is the smaller of the two.
  const hit = (others ?? []).find((o) => {
    const oLat = o.market_center_lat as number | null;
    const oLng = o.market_center_lng as number | null;
    const oRadius = (o.market_radius_mi as number | null) ?? DEFAULT_MARKET_RADIUS_MI;
    if (!isUsableCenter(oLat, oLng)) return false;

    const held = { lat: oLat as number, lng: oLng as number, radiusMi: oRadius };
    const mine = { lat: lat as number, lng: lng as number, radiusMi: radius };
    return (
      isInsideMarket({ lat: lat as number, lng: lng as number }, held) ||
      isInsideMarket({ lat: held.lat, lng: held.lng }, mine)
    );
  });

  if (!hit) return;

  await supabaseAdmin
    .from("clients")
    .update({ market_conflict: true, market_conflict_with: hit.id as string })
    .eq("id", clientId);

  // Flagged and said out loud. Provisioning continues: one clinic per market is a
  // promise a human adjudicates, not an arithmetic result.
  await postInfraAlert(
    `:round_pushpin: Market overlap: *${input.legalName}* overlaps *${hit.legal_name as string}*. Provisioning continued, someone needs to decide.`
  ).catch(() => {});
}

/**
 * learn.{domain} unless it already resolves, in which case guide.{domain}.
 *
 * ‼️ EXPORTED, because startPilot is not the only moment this can be decided and for a large
 * share of clients it is not even a possible one. /start provisions from a Stripe thank-you
 * page with an email and nothing else, so `domain` is null, so the call below is skipped and
 * `clients.subdomain` stays NULL forever. `subdomainLabel()` then falls back to the literal
 * "learn" — which is a guess, not a check, and it is wrong precisely when it matters: on a
 * domain where learn. is already taken. registerHubAndSeedDns calls this before it attaches
 * anything, which is the moment the domain is certain to be known.
 */
export async function chooseSubdomain(clientId: string, domain: string): Promise<void> {
  let convention: "learn" | "guide" = "learn";

  try {
    const records = await dns.resolve(`learn.${domain}`);
    // Anything that resolves means the label is in use. Two options only, never a third.
    if (records.length) convention = "guide";
  } catch {
    // NXDOMAIN is the expected, good case: the label is free.
  }

  if (convention === "guide") {
    await postInfraAlert(
      `:information_source: learn.${domain} already resolves, so this client uses guide.${domain}.`
    ).catch(() => {});
  }

  // THE LABEL, not the full host. Both real consumers of this column want the part that
  // goes in a registrar's Host box: seedDnsRecords writes it straight into
  // client_dns_records.host, and baseVars builds hubHost as `${sub}.${domain}`. Storing
  // "learn.clinic.com" here made both of those say "learn.clinic.com.clinic.com" — the
  // doubling dns-records.ts documents as the reason host is stored label-only.
  await supabaseAdmin
    .from("clients")
    .update({
      subdomain: convention,
      subdomain_convention: convention,
      updated_at: new Date().toISOString(),
    })
    .eq("id", clientId);
}

async function linkToCrm(
  clientId: string,
  who: {
    email: string;
    website: string | null;
    legalName: string;
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
    city: string | null;
  }
): Promise<void> {
  const headline = `:seedling: Pilot started: ${who.legalName}`;
  const detailLines = [
    who.website ? `Website: ${who.website}` : null,
    `Client: ${clientId}`,
  ].filter(Boolean) as string[];

  const enriched = await enrichLead({
    email: who.email,
    noteTitle: "Pilot started",
    headline,
    detailLines,
  }).catch(() => false);

  if (!enriched) {
    const res = await ingestLead({
      firstName: who.firstName || undefined,
      lastName: who.lastName || undefined,
      email: who.email,
      phone: who.phone || undefined,
      // Omitted entirely when unknown. A guessed or placeholder website forks the contact
      // record, which is the trap documented in api/medspa/optin.
      website: who.website || undefined,
      businessName: who.legalName,
      city: who.city || undefined,
      source: "aeo_pilot",
      noteTitle: "Pilot started",
      headline,
      detailLines,
      // They already said yes on a call. Speed to Lead exists to dial strangers fast,
      // and firing it at a client we just signed would be a bad first impression.
      speedToLead: false,
    });

    await supabaseAdmin
      .from("clients")
      .update({ contact_id: res.contactId })
      .eq("id", clientId);
    return;
  }

  const { data: contact } = await supabaseAdmin
    .from("contacts")
    .select("id, zoho_lead_id")
    .ilike("email", who.email)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (contact?.id) {
    await supabaseAdmin
      .from("clients")
      .update({
        contact_id: contact.id as string,
        zoho_lead_id: (contact.zoho_lead_id as string | null) ?? null,
      })
      .eq("id", clientId);
  }
}

/**
 * The INTERNAL card in #onboarding-srt-aeo. This is not the client's view of anything and
 * never was; it is the row of the team's own board. The guest-invite line and the invite
 * reminder email that used to hang off it are gone with the client channel.
 */
async function postOnboardingCard(args: {
  legalName: string;
  slug: string;
  email: string;
  website: string | null;
  onboardingUrl: string | null;
  clientId: string;
}): Promise<void> {
  const channel = process.env.SLACK_CLIENT_ONBOARDING_CHANNEL;
  if (!channel) {
    console.error(
      "[clients/provision] SLACK_CLIENT_ONBOARDING_CHANNEL is not set. Create #onboarding-srt-aeo and paste its id."
    );
    return;
  }

  const text = [
    `:seedling: *Pilot started: ${args.legalName}*`,
    ``,
    args.website ? `*Website:* ${args.website}` : `*Website:* not given yet`,
    `*Board:* ${appUrl()}/dashboard/clients/${args.clientId}`,
    args.onboardingUrl ? `*Their link:* ${args.onboardingUrl}` : `*Their link:* not generated`,
  ].join("\n");

  await slack.postMessage(channel, text);
}

/** Loud failures go here. Silence about a half-provisioned client is the failure mode. */
async function postInfraAlert(text: string): Promise<void> {
  const channel = process.env.SLACK_ALERTS_INFRA_CHANNEL;
  if (!channel) {
    console.error("[clients/provision] SLACK_ALERTS_INFRA_CHANNEL unset. Alert dropped:", text);
    return;
  }
  await slack.postMessage(channel, text);
}
