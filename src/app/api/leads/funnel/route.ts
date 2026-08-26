export const dynamic = "force-dynamic";
// POST /api/leads/funnel — secret-gated intake for the static-site funnels
// (srtagency.com/aivisibility). Server-to-server only: the srt-agwb
// /api/visibility-notify function forwards the captured lead here with the
// x-funnel-secret header (same secret as /api/notify/funnel).
//
// The whole inbound-lead stack (Supabase contact → Zoho lead → #hot-leads
// thread → Speed-to-Lead) lives in src/lib/lead-intake.ts and is shared with
// the free-audit intake and the Facebook Lead Ads webhook. This route just
// maps the /aivisibility field vocabulary onto it.

import { NextRequest, NextResponse } from "next/server";
import { ingestLead } from "@/lib/lead-intake";
import { normalizeLeadPhone } from "@/lib/phone";
import { sendEvent } from "@/lib/meta-capi";
import { hasMetaAttributionServer } from "@/lib/metaAttribution";
import { supabaseAdmin } from "@/lib/db";

/** The ONE pixel, since 2319215808600729 was retired on 2026-08-26. */
const FUNNEL_PIXEL_ID = "2571789533326438";

/**
 * Does the Conversions API point at the same pixel the pages fire into?
 *
 * ‼️ Kept even though they now agree, because this failure is invisible.
 * Posting to the wrong pixel files the conversion in a dataset the ad set
 * never reads AND breaks eventId dedup, and Ads Manager shows no error for
 * either. It just looks like an ad set that is not converting.
 * Same guard, same reasoning, as api/lhr/optin/route.ts.
 */
function capiTargetsFunnelPixel(): boolean {
  const serverPixel = (process.env.META_PIXEL_ID || "").trim();
  if (!serverPixel) return false;
  if (serverPixel === FUNNEL_PIXEL_ID) return true;
  console.warn(
    `[leads/funnel] CAPI SKIPPED: META_PIXEL_ID (${serverPixel}) is not the pixel ` +
      `the funnels fire into (${FUNNEL_PIXEL_ID}).`
  );
  return false;
}

function clean(v: unknown, max = 200): string {
  if (v === undefined || v === null) return "";
  return String(v).replace(/\s+/g, " ").trim().slice(0, max);
}

/** Bounded, because these reach a Slack message and contacts.source. */
function oneOf(v: unknown, allowed: readonly string[], max = 40): string {
  const s = clean(v, max);
  return allowed.indexOf(s) !== -1 ? s : "";
}

export async function POST(req: NextRequest) {
  const secret = process.env.FUNNEL_NOTIFY_SECRET;
  if (!secret || req.headers.get("x-funnel-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const name = clean(body.name, 80);
    const clinic = clean(body.clinic, 120);
    const email = clean(body.email, 120).toLowerCase();
    const phone = normalizeLeadPhone(clean(body.phone, 20));
    const website = clean(body.website, 120);
    const city = clean(body.city, 60);
    const services = Array.isArray(body.services)
      ? body.services.map((s: unknown) => clean(s, 40)).filter(Boolean).slice(0, 6)
      : [];
    const patientGoal = clean(body.patientGoal, 20);
    const ads = clean(body.ads, 20);
    const marketing = clean(body.marketing, 20);
    const budget = clean(body.budget, 20);
    const fit = clean(body.fit, 10);
    const consentTs = clean(body.consentTs, 40);
    const source = clean(body.source, 40) || "aivisibility";
    // Which priced tier they clicked on /pricing. Empty for every other
    // caller, so nothing below changes shape for the funnels that predate it.
    const tier = clean(body.tier, 40);

    // Opt-out for the RingOut. ingestLead gates on `!== false`, so leaving this
    // undefined keeps every caller that predates it dialing exactly as before.
    // /invisible sends false: it collects a phone, but RingCentral is cancelled.
    const speedToLead = body.speedToLead === false ? false : undefined;

    // Attribution. The columns exist on contacts (utm_source was added in
    // docs/2026-08-19-contacts-drift-repair.sql); nothing was writing them on
    // this path, so a paid funnel lost its origin the moment it landed.
    const utmSource = clean(body.utmSource, 80);
    const utmMedium = clean(body.utmMedium, 80);
    const utmCampaign = clean(body.utmCampaign, 120);
    const utmContent = clean(body.utmContent, 120);

    // ‼️ ADDED 2026-08-26 for the med spa funnel. This clean() list is an
    // ALLOWLIST, not a passthrough: srt-agwb/api/invisible-lead.js sends every
    // field below, and one added there but not here is dropped in silence.
    const revenue = oneOf(body.revenue, ["0-10k", "10-20k", "20-50k", "50-100k", "100k+"], 20);
    const qualified = body.qualified === true;
    const channels = oneOf(body.channels, ["Instagram", "Facebook", "TikTok", "Referrals", "Other"]);
    const channelsOther = clean(body.channelsOther, 400);
    const variant = /^[a-d]$/.test(clean(body.variant, 2)) ? clean(body.variant, 2) : "";
    const sid = clean(body.sid, 60);
    // Closed list. It is interpolated into a Slack headline and the caller is a
    // static page holding a shared secret, so it must never be free text.
    const stageLabel = oneOf(body.stageLabel, ["qualified", "disqualified", "booked"], 20);

    // Meta CAPI. eventId pairs with the browser pixel's eventID so the two
    // dedupe into one conversion rather than counting twice.
    const eventId = clean(body.eventId, 80);
    const fbc = clean(body.fbc, 200);
    const fbp = clean(body.fbp, 200);
    const fbclid = clean(body.fbclid, 200);
    const sourceUrl = clean(body.sourceUrl, 300);

    if (!email && !phone) {
      return NextResponse.json({ error: "email or phone required" }, { status: 400 });
    }

    const nameParts = name.split(" ").filter(Boolean);
    const firstName = nameParts[0] || "";
    const lastName = nameParts.slice(1).join(" ") || "";
    const leadName = name || clinic || email;

    const { contactId } = await ingestLead({
      firstName,
      lastName,
      email,
      phone,
      website,
      businessName: clinic,
      city,
      source,
      speedToLead,
      utmSource,
      utmMedium,
      utmCampaign,
      utmContent,
      noteTitle: "AI Visibility Index",
      headline:
        (stageLabel === "booked" ? "BOOKED A CALL: " : stageLabel === "disqualified" ? "DQ: " : "New Index lead: ") +
        `${leadName} · ${clinic || "?"} · ${city || "?"} · ${website || "?"}` +
        ` · budget ${budget || "?"} · fit ${fit || "?"} · phone ${phone || "?"}` +
        (tier ? ` · tier ${tier}` : ""),
      detailLines: [
        tier ? `Tier clicked: ${tier}` : "",
        website ? `Website: ${website}` : "",
        city ? `City: ${city}` : "",
        services.length ? `Services: ${services.join(", ")}` : "",
        patientGoal ? `New patients goal: ${patientGoal}/mo` : "",
        ads ? `Running ads: ${ads}` : "",
        marketing ? `Marketing today: ${marketing}` : "",
        budget ? `Budget: ${budget} (fit: ${fit || "?"})` : "",
        revenue ? `Monthly revenue: ${revenue}${qualified ? " (qualified)" : " (below the floor)"}` : "",
        channels ? `Finds clients via: ${channels}${channelsOther ? `, ${channelsOther}` : ""}` : "",
        variant ? `Booking headline: variant ${variant.toUpperCase()}` : "",
        consentTs ? `SMS/email consent: agreed at ${consentTs}` : "",
        utmSource || utmCampaign
          ? `Attribution: ${[utmSource, utmMedium, utmCampaign].filter(Boolean).join(" / ")}`
          : "",
        `Funnel: /${source}`,
      ],
    });

    // Meta CAPI, server side, paired with the browser pixel by eventId.
    //
    // Three gates, and all three matter:
    //   - an eventId, so this can only ever be the server half of a browser
    //     event the page already fired. No eventId means the page decided not
    //     to fire (a disqualified lead), and the server must not overrule it.
    //   - real ad attribution, so direct and WhatsApp leads are not counted
    //     as Meta conversions.
    //   - the right pixel, see capiTargetsFunnelPixel above.
    if (eventId && hasMetaAttributionServer({ fbc, fbclid }) && capiTargetsFunnelPixel()) {
      const eventName = stageLabel === "booked" ? "Schedule" : "Lead";
      try {
        const capi = await sendEvent({
          eventName,
          eventId,
          eventSourceUrl: sourceUrl || "https://srtagency.com/",
          actionSource: "website",
          userData: {
            email: email || undefined,
            phone: phone || undefined,
            firstName,
            lastName: lastName || undefined,
            fbc: fbc || undefined,
            fbp: fbp || undefined,
            clientIpAddress:
              req.headers.get("x-vercel-forwarded-for")?.split(",")[0].trim() ||
              req.headers.get("x-forwarded-for")?.split(",").pop()?.trim() ||
              undefined,
            clientUserAgent: req.headers.get("user-agent") || undefined,
            // ingestLead returns null if the contact write failed. Meta takes
            // the event either way; dropping it over a missing external id
            // would lose a real conversion to a database blip.
            externalId: contactId || undefined,
          },
        });
        if (!capi.success) {
          console.error(`[leads/funnel] Meta CAPI ${eventName} failed:`, capi.error);
          try {
            await supabaseAdmin.from("system_logs").insert({
              event_type: "meta_capi_error",
              description: `Meta CAPI ${eventName} failed: ${capi.error}`,
              metadata: { email, eventName, source, variant },
            });
          } catch { /* a logging failure must not fail the lead */ }
        }
      } catch (err) {
        console.error("[leads/funnel] Meta CAPI error:", err);
      }
    }

    return NextResponse.json({ success: true, contactId });
  } catch (err) {
    console.error("[leads/funnel] fatal:", err);
    return NextResponse.json({ error: "capture failed" }, { status: 500 });
  }
}
