// Opt-in intake for /LHR, the med spa and laser hair removal VSL funnel.
//
// This is the point where an anonymous visitor becomes a lead, so it goes through
// ingestLead() like every other funnel (Supabase contact -> timeline note -> #hot-leads
// thread -> Speed-to-Lead) rather than writing contacts directly. There is no `leads`
// table in this app and this route must not invent one.
//
// NO MIGRATION. The submission lands in `system_logs`, which already carries the
// event_type / description / metadata shape and which api/leads/facebook already
// queries with `.eq("metadata->>key", value)`. That one row is both the per-IP
// rate-limit ledger and the durable copy of the opt-in. This deliberately does NOT
// reuse `medspa_optins`: that table is /webflow-Aivisibility funnel STATE, keyed on
// email and carrying a guide_state claim flag for a guide email this funnel does not
// send. Sharing it would make a repeat opt-in on one funnel look like a repeat on the
// other and silently suppress the other's email.
//
// A PUBLIC ROUTE THAT DIALS A PHONE needs its guards in the right order, cheapest
// first, exactly as api/scan/start and api/onboardingfree/submit document: honeypot,
// then time trap, then per-IP ledger, then the real work. Do not reorder them and do
// not add a path that skips them.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { ingestLead } from "@/lib/lead-intake";
import { hashIp, clientIpFrom } from "@/lib/scan/session";
import { validateOptin, clean, fieldErrorMessage } from "@/lib/medspa/validate";
import { ownsQualifyingClinic } from "@/lib/lhr/qualify";
import { LHR_OPTIN_EVENT, LHR_SOURCE } from "@/lib/lhr/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Not optional. supabase-js calls the global fetch, which Next patches into the DATA
// cache, and force-dynamic governs the ROUTE cache only. A stale read here means the
// per-IP ledger counts from a snapshot seconds old, which is the whole gate.
export const fetchCache = "force-no-store";
export const maxDuration = 60;

/** Opt-ins per IP per day. Generous: this costs us nothing but a row. */
const RATE_LIMIT = Number(process.env.LHR_OPTIN_RATE_LIMIT || 10);
const RATE_WINDOW_HOURS = 24;
/** A human cannot read the page and fill three fields this fast. A bot can. */
const MIN_FILL_SECONDS = 2;

async function countRecentForIp(ipHash: string): Promise<number> {
  const cutoff = new Date(Date.now() - RATE_WINDOW_HOURS * 3_600_000).toISOString();
  const { count } = await supabaseAdmin
    .from("system_logs")
    .select("id", { count: "exact", head: true })
    .eq("event_type", LHR_OPTIN_EVENT)
    .eq("metadata->>ip_hash", ipHash)
    .gte("created_at", cutoff);
  return count ?? 0;
}

export async function POST(req: NextRequest) {
  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, message: "Bad request." }, { status: 400 });
  }

  // 1. Honeypot. A real browser leaves it empty because it is off-screen and carries
  //    autocomplete="off"; most form bots fill every input they find. Answer 200 so a
  //    bot cannot tell it was caught and go looking for the real gap.
  if (clean(payload.company_url_hp, 200)) {
    return NextResponse.json({ ok: true });
  }

  // 2. Time trap.
  const renderedAt = Number(payload.renderedAt);
  if (Number.isFinite(renderedAt) && Date.now() - renderedAt < MIN_FILL_SECONDS * 1000) {
    return NextResponse.json({ ok: true });
  }

  // 3. The qualifier, re-checked here with the same function the modal used.
  //
  //    The modal removes its own submit button for a No, which is a courtesy to a real
  //    person and not a gate: this endpoint is public and unauthenticated, and a
  //    qualified opt-in is what causes ingestLead to dial someone via Speed-to-Lead.
  //    ownsQualifyingClinic defaults to NOT qualified for anything unrecognised, so a
  //    hand-crafted payload with the field missing is refused rather than accepted.
  //
  //    A plain 400 rather than the silent 200 the honeypot gets. This is not a bot, it
  //    is a person who answered honestly, and the browser never posts it in the first
  //    place, so reaching here means something is genuinely wrong with the request.
  const owns = clean(payload.owns, 60);
  if (!ownsQualifyingClinic(owns)) {
    return NextResponse.json(
      { ok: false, message: "This training is for clinic owners." },
      { status: 400 }
    );
  }

  // 4. Re-validate server side with the SAME functions the form used. The client check
  //    is a courtesy; this one is the rule. normalizePhone inside validateOptin is the
  //    STRICT validator, and that is load-bearing: ingestLead fires Speed-to-Lead at
  //    whatever phone it is handed and this endpoint is public and unauthenticated.
  const result = validateOptin({
    name: clean(payload.name, 80),
    email: clean(payload.email, 120),
    phone: clean(payload.phone, 30),
    consent: payload.consent === true,
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        fields: result.errors,
        message: fieldErrorMessage(result.errors[0]),
      },
      { status: 400 }
    );
  }

  // 5. Per-IP ledger. clientIpFrom deliberately does NOT trust x-forwarded-for[0]:
  //    Vercel appends the real IP, so index 0 is attacker-controlled and the cap would
  //    be bypassed by rotating it. hashIp never stores a raw address, because this is a
  //    rate-limit ledger, not a visitor log.
  const ipHash = hashIp(clientIpFrom(req));
  if ((await countRecentForIp(ipHash)) >= RATE_LIMIT) {
    return NextResponse.json(
      { ok: false, message: "Too many sign ups from this connection today." },
      { status: 429 }
    );
  }

  const consentTs = new Date().toISOString();

  // Meta identifiers, harvested client side off the URL and the pixel cookies. fbp is
  // recorded but never counts as attribution on its own.
  const fbclid = clean(payload.fbclid, 255) || null;
  const fbc = clean(payload.fbc, 255) || null;
  const fbp = clean(payload.fbp, 255) || null;
  const utmSource = clean(payload.utmSource, 80) || null;
  const utmMedium = clean(payload.utmMedium, 80) || null;
  const utmCampaign = clean(payload.utmCampaign, 120) || null;

  let contactId: string | null = null;
  try {
    const ingest = await ingestLead({
      firstName: result.firstName,
      lastName: result.lastName,
      email: result.email,
      phone: result.phone,
      // NO website and NO businessName. This form collects neither, and
      // companiesConflict() only fires when BOTH sides carry the field, so omitting
      // them lets this lead match an existing contact correctly. A guessed value would
      // fork the contact and split the #hot-leads thread.
      source: LHR_SOURCE,
      noteTitle: "Laser hair removal training opt-in",
      headline: `New /LHR training opt-in: ${result.name}`,
      detailLines: [
        `Email: ${result.email}`,
        `Phone: ${result.phone}`,
        `Owns a clinic: ${owns}`,
        `Consent to call and text: yes (${consentTs})`,
        `Source: ${LHR_SOURCE}`,
      ],
    });
    contactId = ingest.contactId;
  } catch (e) {
    // ingestLead is internally best-effort, but a hard throw must still not cost us the
    // opt-in row: the contact details are the whole point of the page.
    console.error("[lhr/optin] ingestLead threw:", (e as Error).message);
  }

  // The ledger row goes in whatever happened above, so a Supabase contact failure does
  // not also disable the rate limit. A failure here is logged loudly rather than shown
  // to the visitor: by this point the lead is already in the CRM and in Slack, so it is
  // a degraded success, not something they can act on.
  const { error: insertError } = await supabaseAdmin.from("system_logs").insert({
    event_type: LHR_OPTIN_EVENT,
    description: `/LHR opt-in: ${result.name}`,
    metadata: {
      name: result.name,
      email: result.email,
      phone: result.phone,
      owns: owns,
      consent_at: consentTs,
      contact_id: contactId,
      ip_hash: ipHash,
      source: LHR_SOURCE,
      fbclid,
      fbc,
      fbp,
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
    },
  });

  if (insertError) {
    console.error("[lhr/optin] system_logs insert failed:", insertError.message);
  }

  return NextResponse.json({ ok: true });
}
