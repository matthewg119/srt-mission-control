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
import { ensureClientChannel } from "@/lib/clients/client-channel";
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
  marketsOverlap,
  isUsableCenter,
} from "@/lib/clients/normalize";

/** Six at a time, pilots included. PILOT §1 and D-P2. Enforced here, never rendered. */
export const MAX_CONCURRENT_CLIENTS = 6;

const PILOT_DAYS = 90;
const ZOHO_LEAD_SOURCE = "AEO Pilot";

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
  legalName: string;
  dbaName?: string | null;
  website: string;
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
  tierScope: "core" | "complete";
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
  const legalName = input.legalName.trim();
  const email = input.email.trim().toLowerCase();
  if (!legalName) return { ok: false, error: "Legal business name is required." };
  if (!email) return { ok: false, error: "Email is required." };

  const normalized = normalizeTarget(input.website);
  if (!normalized.ok) {
    return { ok: false, error: `That website could not be read (${normalized.error}).` };
  }
  const { website, domain } = normalized.target;

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
    legal_name: legalName,
    dba_name: input.dbaName?.trim() || null,
    website,
    domain,
    email,
    phone: input.phone?.trim() || null,
    address_line1: input.addressLine1 ? normalizeAddress(input.addressLine1) : null,
    address_line2: input.addressLine2 ? normalizeAddress(input.addressLine2) : null,
    city: input.city?.trim() || null,
    state: input.state ? normalizeState(input.state) : null,
    postal_code: input.postalCode?.trim() || null,
    billing_status: billingStatus,
    tier_scope: input.tierScope,
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
  const desired = slugify(input.dbaName?.trim() || legalName) || slugify(domain);
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

    // Same clinic clicking twice, or a genuine name collision. Only the former should
    // reuse the row, and the domain is what tells them apart.
    const { data: existing } = await supabaseAdmin
      .from("clients")
      .select("id, slug, domain")
      .eq("slug", candidate)
      .maybeSingle();

    if (existing && existing.domain === domain) {
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
  await chooseSubdomain(clientId, domain).catch((e) =>
    warn(`subdomain check failed: ${(e as Error).message}`)
  );

  // ── Slack channel ──
  const channel = await ensureClientChannel({ clientId, slug, legalName }).catch((e) => {
    warn(`Slack channel failed: ${(e as Error).message}`);
    return { channelId: null, channelName: null, created: false };
  });
  if (!channel.channelId) warn("Slack channel was not created.");

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
    legalName,
    firstName: input.contactFirstName ?? null,
    lastName: input.contactLastName ?? null,
    phone: input.phone ?? null,
    city: input.city ?? null,
  }).catch((e) => warn(`CRM link failed: ${(e as Error).message}`));

  // ── Post to #onboarding-srt-aeo ──
  await postOnboardingCard({
    legalName,
    slug,
    email,
    website,
    channelId: channel.channelId,
    channelName: channel.channelName,
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
  const lat = input.marketCenterLat;
  const lng = input.marketCenterLng;
  const radius = input.marketRadiusMi;

  if (!isUsableCenter(lat, lng) || !radius || radius <= 0) return;

  const { data: others } = await supabaseAdmin
    .from("clients")
    .select("id, legal_name, market_center_lat, market_center_lng, market_radius_mi")
    .in("billing_status", ["pilot", "active"])
    .neq("id", clientId);

  const hit = (others ?? []).find((o) => {
    const oLat = o.market_center_lat as number | null;
    const oLng = o.market_center_lng as number | null;
    const oRadius = o.market_radius_mi as number | null;
    if (!isUsableCenter(oLat, oLng) || !oRadius) return false;
    return marketsOverlap(
      { lat: lat as number, lng: lng as number, radiusMi: radius },
      { lat: oLat as number, lng: oLng as number, radiusMi: oRadius }
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

async function chooseSubdomain(clientId: string, domain: string): Promise<void> {
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

  await supabaseAdmin
    .from("clients")
    .update({
      subdomain: `${convention}.${domain}`,
      subdomain_convention: convention,
      updated_at: new Date().toISOString(),
    })
    .eq("id", clientId);
}

async function linkToCrm(
  clientId: string,
  who: {
    email: string;
    website: string;
    legalName: string;
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
    city: string | null;
  }
): Promise<void> {
  const headline = `:seedling: Pilot started: ${who.legalName}`;
  const detailLines = [`Website: ${who.website}`, `Client: ${clientId}`];

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
      website: who.website,
      businessName: who.legalName,
      city: who.city || undefined,
      source: "aeo_pilot",
      zohoLeadSource: ZOHO_LEAD_SOURCE,
      noteTitle: "Pilot started",
      headline,
      detailLines,
      // They already said yes on a call. Speed to Lead exists to dial strangers fast,
      // and firing it at a client we just signed would be a bad first impression.
      speedToLead: false,
    });

    await supabaseAdmin
      .from("clients")
      .update({ contact_id: res.contactId, zoho_lead_id: res.zohoLeadId })
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

async function postOnboardingCard(args: {
  legalName: string;
  slug: string;
  email: string;
  website: string;
  channelId: string | null;
  channelName: string | null;
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

  // The guest invite cannot be automated below Enterprise Grid, so this card exists to
  // make the manual step one click: the channel and the address to invite, together.
  const inviteLine = args.channelName
    ? `*Invite them:* open #${args.channelName} and add ${args.email} as a guest.`
    : `*Invite them:* no channel was created, so this needs doing by hand.`;

  const text = [
    `:seedling: *Pilot started: ${args.legalName}*`,
    ``,
    `*Website:* ${args.website}`,
    `*Channel:* ${args.channelName ? `#${args.channelName}` : "not created"}`,
    `*Board:* ${appUrl()}/dashboard/clients/${args.clientId}`,
    args.onboardingUrl ? `*Their link:* ${args.onboardingUrl}` : `*Their link:* not generated`,
    ``,
    inviteLine,
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
