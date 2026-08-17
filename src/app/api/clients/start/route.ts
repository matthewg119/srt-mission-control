// Self-serve onboarding start. PUBLIC and unauthenticated.
//
// This is the link that goes on Stripe's thank-you page. Someone types their email, a
// client is provisioned, and they land in the intake funnel with the same link also in
// their inbox.
//
// A PUBLIC ROUTE THAT CREATES SLACK CHANNELS AND SENDS MAIL needs its guards in the right
// order, cheapest first, exactly as api/scan/start documents: honeypot, then time trap,
// then per-IP ledger, then the real work. Do not reorder them and do not add a path that
// skips them.
//
// The honeypot answers 200. A bot that gets an error learns where the gap is; one that
// gets a cheerful success learns nothing.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { startPilot, onboardingUrlFor } from "@/lib/clients/provision";
import { signOnboardingToken, hashToken, isClientLinkSecretConfigured } from "@/lib/clients/token";
import { sendPilotWelcome } from "@/lib/clients/welcome-email";
import { hashIp, clientIpFrom } from "@/lib/scan/session";
import { clean, validEmail } from "@/lib/medspa/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// supabase-js reads go through the Next data cache; a stale read here would mint a second
// client for someone who already started.
export const fetchCache = "force-no-store";
// Provisioning does DNS, Slack, Graph and Zoho work in sequence.
export const maxDuration = 120;

const RATE_LIMIT = Number(process.env.CLIENT_START_RATE_LIMIT || 5);
const RATE_WINDOW_HOURS = 24;
const MIN_FILL_SECONDS = 2;

async function countRecentStartsForIp(ipHash: string): Promise<number> {
  const cutoff = new Date(Date.now() - RATE_WINDOW_HOURS * 3_600_000).toISOString();
  const { count } = await supabaseAdmin
    .from("clients")
    .select("id", { count: "exact", head: true })
    .eq("start_ip_hash", ipHash)
    .gte("created_at", cutoff);
  return count ?? 0;
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }

  // 1. Honeypot. Silent success.
  if (clean(body.company_url_hp, 200)) {
    return NextResponse.json({ ok: true, redirect: null });
  }

  // 2. Time trap. A human cannot read the page and type an address in under two seconds.
  const renderedAt = Number(body.renderedAt);
  if (Number.isFinite(renderedAt) && Date.now() - renderedAt < MIN_FILL_SECONDS * 1000) {
    return NextResponse.json({ ok: true, redirect: null });
  }

  const email = clean(body.email, 254).toLowerCase();
  if (!email || !validEmail(email)) {
    return NextResponse.json(
      { ok: false, error: "That email address does not look right." },
      { status: 400 }
    );
  }

  // 3. Per-IP ledger. clientIpFrom deliberately does NOT trust x-forwarded-for[0]:
  // Vercel appends the real IP, so index 0 is attacker-controlled.
  const ipHash = hashIp(clientIpFrom(req));
  const firstName = clean(body.firstName, 80) || null;

  // An existing client comes back to their own record rather than consuming a second
  // seat. Checked BEFORE the rate limit so someone who lost their link is never locked
  // out by their own earlier visit.
  const { data: existing } = await supabaseAdmin
    .from("clients")
    .select("id, onboarding_status")
    .ilike("email", email)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    const url = await reissueLink(existing.id as string, email, firstName);
    return NextResponse.json({ ok: true, redirect: url });
  }

  if ((await countRecentStartsForIp(ipHash)) >= RATE_LIMIT) {
    return NextResponse.json(
      { ok: false, error: "Too many sign ups from this connection today. Email us and we will sort it out." },
      { status: 429 }
    );
  }

  const result = await startPilot({ email, contactFirstName: firstName });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  await supabaseAdmin
    .from("clients")
    .update({ start_ip_hash: ipHash })
    .eq("id", result.clientId);

  return NextResponse.json({ ok: true, redirect: result.onboardingUrl });
}

/**
 * Mint a fresh link for a client who already exists.
 *
 * Only the token HASH is stored, so the original link genuinely cannot be recovered.
 * Re-issuing is therefore the only correct answer to "I lost my link", and it is the same
 * code path either way.
 */
async function reissueLink(
  clientId: string,
  email: string,
  firstName: string | null
): Promise<string | null> {
  if (!isClientLinkSecretConfigured()) return null;

  const { token, expiresAt } = signOnboardingToken(clientId);
  const url = onboardingUrlFor(token);

  await supabaseAdmin
    .from("clients")
    .update({
      onboarding_token_hash: hashToken(token),
      onboarding_token_expires_at: expiresAt.toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", clientId);

  await sendPilotWelcome({ to: email, firstName, onboardingUrl: url }).catch((e) =>
    console.error("[clients/start] re-issue email failed:", (e as Error).message)
  );

  return url;
}
