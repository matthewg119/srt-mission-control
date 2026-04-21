// API: Awaiting Statements segment
//
// Returns every merchant who signed the portal application but hasn't
// uploaded bank statements yet. Fuels the dashboard filter view and the
// KPI count on the home page.

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("contacts")
    .select("id, first_name, last_name, business_name, phone, mobile_phone, email, application_signed_at, last_nudge_posted_at, awaiting_escalation_fired_at, utm_source, ad_source")
    .eq("portal_app_completed", true)
    .eq("portal_statements_uploaded", false)
    .not("application_signed_at", "is", null)
    .order("application_signed_at", { ascending: true })
    .limit(500);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const now = Date.now();
  const leads = (data ?? []).map((c) => {
    const signedAt = c.application_signed_at as string;
    const hoursInLimbo = Math.floor((now - new Date(signedAt).getTime()) / (1000 * 60 * 60));
    return {
      id: c.id as string,
      name: `${(c.first_name as string) || ""} ${(c.last_name as string) || ""}`.trim()
        || (c.business_name as string)
        || (c.email as string)
        || "Unknown",
      business_name: (c.business_name as string) || null,
      phone: ((c.phone as string) || (c.mobile_phone as string)) || null,
      email: (c.email as string) || null,
      application_signed_at: signedAt,
      hours_in_limbo: hoursInLimbo,
      last_nudge_posted_at: (c.last_nudge_posted_at as string) || null,
      awaiting_escalation_fired_at: (c.awaiting_escalation_fired_at as string) || null,
      ad_source: ((c.ad_source as string) || (c.utm_source as string)) || null,
    };
  });

  return NextResponse.json({
    count: leads.length,
    leads,
  });
}
