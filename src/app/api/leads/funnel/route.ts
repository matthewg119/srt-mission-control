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

const ZOHO_LEAD_SOURCE = "AI Visibility Index";

function clean(v: unknown, max = 200): string {
  if (v === undefined || v === null) return "";
  return String(v).replace(/\s+/g, " ").trim().slice(0, max);
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

    if (!email && !phone) {
      return NextResponse.json({ error: "email or phone required" }, { status: 400 });
    }

    const nameParts = name.split(" ").filter(Boolean);
    const firstName = nameParts[0] || "";
    const lastName = nameParts.slice(1).join(" ") || "";
    const leadName = name || clinic || email;

    const { contactId, zohoLeadId } = await ingestLead({
      firstName,
      lastName,
      email,
      phone,
      website,
      businessName: clinic,
      city,
      source,
      zohoLeadSource: ZOHO_LEAD_SOURCE,
      noteTitle: "AI Visibility Index",
      headline:
        `New Index lead: ${leadName} · ${clinic || "?"} · ${city || "?"} · ${website || "?"}` +
        ` · budget ${budget || "?"} · fit ${fit || "?"} · phone ${phone || "?"}`,
      detailLines: [
        website ? `Website: ${website}` : "",
        city ? `City: ${city}` : "",
        services.length ? `Services: ${services.join(", ")}` : "",
        patientGoal ? `New patients goal: ${patientGoal}/mo` : "",
        ads ? `Running ads: ${ads}` : "",
        marketing ? `Marketing today: ${marketing}` : "",
        budget ? `Budget: ${budget} (fit: ${fit || "?"})` : "",
        consentTs ? `SMS/email consent: agreed at ${consentTs}` : "",
        `Funnel: /${source}`,
      ],
    });

    return NextResponse.json({ success: true, contactId, zohoLeadId });
  } catch (err) {
    console.error("[leads/funnel] fatal:", err);
    return NextResponse.json({ error: "capture failed" }, { status: 500 });
  }
}
