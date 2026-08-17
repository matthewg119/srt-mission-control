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
  // application_signed_at was added on 2026-08-19 and is NULL for every record
  // that predates it — nothing in the database recorded a signing time, so
  // nothing was backfilled rather than inventing dates. NULL therefore means
  // "unknown", not "unsigned".
  //
  // This route used to require it to be non-null AND order by it. Both were
  // written against a column that did not exist, so the query 500'd rather than
  // returning nothing. Re-adding the filter now would be just as wrong in a
  // quieter way: it would hide every historical lead behind a column they can
  // never have. `portal_app_completed` is the real gate — the application was
  // submitted — and the signing time is only used to age the row.
  const { data, error } = await supabaseAdmin
    .from("contacts")
    .select("id, first_name, last_name, business_name, phone, mobile_phone, email, application_signed_at, updated_at, last_nudge_posted_at, awaiting_escalation_fired_at, utm_source, ad_source")
    .eq("portal_app_completed", true)
    .eq("portal_statements_uploaded", false)
    .order("updated_at", { ascending: true })
    .limit(500);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const now = Date.now();
  const leads = (data ?? []).map((c) => {
    // Fall back to updated_at so the age is approximate rather than absent.
    const signedAt = (c.application_signed_at as string) ?? (c.updated_at as string);
    const hoursInLimbo = signedAt
      ? Math.floor((now - new Date(signedAt).getTime()) / (1000 * 60 * 60))
      : 0;
    return {
      id: c.id as string,
      name: `${(c.first_name as string) || ""} ${(c.last_name as string) || ""}`.trim()
        || (c.business_name as string)
        || (c.email as string)
        || "Unknown",
      business_name: (c.business_name as string) || null,
      phone: ((c.phone as string) || (c.mobile_phone as string)) || null,
      email: (c.email as string) || null,
      // Report the REAL column, not the fallback. Returning updated_at under
      // the name application_signed_at would have the UI display an exact
      // signing time for a lead whose signing time nobody ever recorded.
      application_signed_at: (c.application_signed_at as string) || null,
      hours_in_limbo: hoursInLimbo,
      // Says whether the age above is measured from the signature or merely
      // from the last time the row was touched.
      limbo_basis: c.application_signed_at ? "signed_at" : "last_updated",
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
