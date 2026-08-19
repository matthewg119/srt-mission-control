// Opt-in intake for /webflow-Aivisibility.
//
// This is the point where an anonymous visitor becomes a lead, so it goes through
// ingestLead() like every other funnel (Supabase contact -> Zoho lead -> #hot-leads
// thread -> Speed-to-Lead) rather than writing contacts directly. There is no
// `leads` table in this app and this route must not invent one; medspa_optins is
// funnel STATE, and contacts stays the source of truth for people.
//
// Unlike /api/scan/[id]/claim, this route DOES accept a phone and DOES want Speed to
// Lead, because someone who filled in a name, an email and a mobile behind an
// explicit consent checkbox is a real inbound lead. That is why normalizePhone() is
// the strict validator: ingestLead dials whatever it is handed, and this endpoint is
// public and unauthenticated.

import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { supabaseAdmin } from "@/lib/db";
import { ingestLead } from "@/lib/lead-intake";
import { hashIp, clientIpFrom } from "@/lib/scan/session";
import { validateOptin, clean, fieldErrorMessage } from "@/lib/medspa/validate";
import { sendMedspaGuideEmail } from "@/lib/medspa/guide-email";
import { signAccess, isLinkSecretConfigured } from "@/lib/medspa/links";
import { funnelUrl } from "@/config/medspa-funnel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Not optional. supabase-js calls the global fetch, which Next patches into the DATA
// cache, and force-dynamic governs the ROUTE cache only. A stale read here means a
// repeat opt-in looks new and mints a second contact, Zoho lead and Slack thread.
export const fetchCache = "force-no-store";
export const maxDuration = 60;

const SOURCE = "medspa_vsl";

/** Opt-ins per IP per day. Generous, because this costs us nothing but an email. */
const RATE_LIMIT = Number(process.env.MEDSPA_OPTIN_RATE_LIMIT || 10);
const RATE_WINDOW_HOURS = 24;
/** A human cannot read the page and fill three fields this fast. A bot can. */
const MIN_FILL_SECONDS = 2;

async function countRecentOptinsForIp(ipHash: string): Promise<number> {
  const cutoff = new Date(Date.now() - RATE_WINDOW_HOURS * 3_600_000).toISOString();
  const { count } = await supabaseAdmin
    .from("medspa_optins")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
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

  // Honeypot. A real browser leaves it empty because it is visually hidden and
  // carries autocomplete="off"; most form bots fill every input they find.
  if (clean(payload.company_url_hp, 200)) {
    // Answer 200 so a bot cannot tell it was caught and go looking for the real gap.
    return NextResponse.json({ ok: true });
  }

  const renderedAt = Number(payload.renderedAt);
  if (Number.isFinite(renderedAt) && Date.now() - renderedAt < MIN_FILL_SECONDS * 1000) {
    return NextResponse.json({ ok: true });
  }

  // Re-validate server side with the SAME functions the form used. The client check
  // is a courtesy; this one is the rule.
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

  const ipHash = hashIp(clientIpFrom(req));
  if ((await countRecentOptinsForIp(ipHash)) >= RATE_LIMIT) {
    return NextResponse.json(
      { ok: false, message: "Too many sign ups from this connection today." },
      { status: 429 }
    );
  }

  const consentTs = new Date().toISOString();

  // Meta identifiers, harvested client side off the URL and the pixel cookies. fbp
  // is recorded but never counts as attribution on its own.
  const fbclid = clean(payload.fbclid, 255) || null;
  const fbc = clean(payload.fbc, 255) || null;
  const fbp = clean(payload.fbp, 255) || null;

  let contactId: string | null = null;
  try {
    const ingest = await ingestLead({
      firstName: result.firstName,
      lastName: result.lastName,
      email: result.email,
      phone: result.phone,
      // NO website. The opt-in form does not collect one, and companiesConflict()
      // only fires when BOTH sides carry the field, so omitting it lets this lead
      // match an existing contact correctly. A guessed value would fork the contact
      // and split the #hot-leads thread.
      source: SOURCE,
      noteTitle: "Med Spa AI Training opt-in",
      headline: `New med spa training opt-in: ${result.name}`,
      detailLines: [
        `Email: ${result.email}`,
        `Phone: ${result.phone}`,
        `Consent to call and text: yes (${consentTs})`,
        `Source: ${SOURCE}`,
      ],
    });
    contactId = ingest.contactId;
  } catch (e) {
    // ingestLead is internally best-effort, but a hard throw must still not cost us
    // the opt-in row: the email address is the whole point of the page.
    console.error("[medspa/optin] ingestLead threw:", (e as Error).message);
  }

  // One row per email address. A repeat opt-in updates rather than duplicating, and
  // deliberately does NOT reset guide_state, so the guide is not re-sent.
  const { data: optin, error } = await supabaseAdmin
    .from("medspa_optins")
    .upsert(
      {
        contact_id: contactId,
        email: result.email,
        name: result.name,
        phone: result.phone,
        consent_at: consentTs,
        ip_hash: ipHash,
        source: SOURCE,
        fbclid,
        fbc,
        fbp,
        utm_source: clean(payload.utmSource, 80) || null,
        utm_medium: clean(payload.utmMedium, 80) || null,
        utm_campaign: clean(payload.utmCampaign, 120) || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "email" }
    )
    .select("id, guide_state")
    .maybeSingle();

  if (error || !optin) {
    console.error("[medspa/optin] upsert failed:", error?.message);
    // The lead is already in Zoho and Slack, so this is a degraded success, not a
    // failure the visitor should see.
    return NextResponse.json({ ok: true, trainingUrl: null });
  }

  const trainingUrl = isLinkSecretConfigured()
    ? funnelUrl(`/training?k=${encodeURIComponent(signAccess(optin.id as string))}`)
    : null;

  waitUntil(deliverGuide(optin.id as string, result.email, result.firstName, trainingUrl));

  return NextResponse.json({ ok: true, trainingUrl });
}

/**
 * Send the guide exactly once per opt-in.
 *
 * guide_state is a claim flag, the same doctrine as audit_reports.auto_send_state:
 * claimed with a conditional UPDATE before Graph is called, and put back to 'pending'
 * if the send throws so it stays retryable. Without the claim, a double-submitted
 * form sends the guide twice.
 */
async function deliverGuide(
  optinId: string,
  email: string,
  firstName: string,
  trainingUrl: string | null
): Promise<void> {
  const { data: claimed } = await supabaseAdmin
    .from("medspa_optins")
    .update({ guide_state: "sent", guide_sent_at: new Date().toISOString() })
    .eq("id", optinId)
    .eq("guide_state", "pending")
    .select("id")
    .maybeSingle();

  if (!claimed) return; // Already sent, or another request owns it.

  try {
    await sendMedspaGuideEmail({ to: email, firstName, trainingUrl });
  } catch (e) {
    console.error("[medspa/optin] guide email failed:", (e as Error).message);
    await supabaseAdmin
      .from("medspa_optins")
      .update({ guide_state: "pending", guide_sent_at: null })
      .eq("id", optinId);
  }
}
