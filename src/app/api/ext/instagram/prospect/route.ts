export const dynamic = "force-dynamic";
// The one button on the Instagram panel: add the lead, then draft the DM.
//
// A doorway, exactly like the CRM workflow route it is modelled on. Everything real lives in
// lib/instagram/dm-run.ts and lib/audit-engine/dm-pitch.ts, so the linter, the angle gates and the
// no-fabrication rules apply here identically to the email lane. A route that assembled its own
// prompt would bypass all of them silently, and the failure would look like slightly worse copy
// rather than like a bug.
//
// ‼️ IT RETURNS 202 AND A runId, NOT THE DRAFTS. A hook run is a crawl, a classify, four parallel
// engine calls and a model call, which does not fit in the 30s these /api/ext/* routes allow. The
// panel polls GET /api/ext/instagram/prospect/{runId}. Same split as /api/scan/start.

import { NextRequest } from "next/server";
import { requireExtTenant, jsonCors, preflight } from "@/lib/ext-auth";
import { supabaseAdmin } from "@/lib/db";
import { normalizeLeadPhone } from "@/lib/phone";
import {
  normalizeHandle,
  firstNameFrom,
  cityFromBio,
  resolveBioLink,
  unwrapInstagramLink,
  businessNameFrom,
} from "@/lib/instagram/profile";
import { IG_CLAIM_MINUTES, startDmRun, leadUrl, profileUrl } from "@/lib/instagram/dm-run";

export const runtime = "nodejs";
// ‼️ 300, NOT the 30 the other /api/ext/* routes use. The response goes out in about a second, but
// the scan continues inside waitUntil and that work counts against THIS function's budget: at 30
// the run would be killed mid-crawl and the row would sit on "running" forever. Same value, and
// the same reason, as the CRM workflow route that hosts the email hook.
export const maxDuration = 300;

export function OPTIONS(req: NextRequest) {
  return preflight(req);
}

interface Body {
  handle?: string;
  fullName?: string;
  bio?: string;
  externalUrl?: string | null;
  category?: string | null;
  businessEmail?: string | null;
  businessPhone?: string | null;
  /** A site Matthew typed into the panel. Beats anything scraped. */
  websiteOverride?: string | null;
  /** Set when he answered "no website at all" rather than pasting one. */
  noWebsite?: boolean;
  /** Free text from the panel, passed to the drafter verbatim. */
  instructions?: string | null;
}

export async function POST(req: NextRequest) {
  const tenant = await requireExtTenant(req);
  if (!tenant) return jsonCors(req, { ok: false, error: "unauthorized" }, 401);

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return jsonCors(req, { ok: false, error: "Invalid JSON body" }, 400);
  }

  const handle = normalizeHandle(body.handle);
  if (!handle) {
    return jsonCors(req, { ok: false, error: "No Instagram handle on this page.", field: "handle" }, 400);
  }

  const bio = (body.bio ?? "").trim();
  const fullName = (body.fullName ?? "").trim();
  // ‼️ The BUSINESS name, never the person and never a URL. classifyBusiness pins its name
  // override to whatever it is handed and every alias and mention match downstream is built from
  // it; see the override doc in classify.ts. An empty string is the right answer when the profile
  // gave us nothing usable, because it lets the classifier read the name off the crawled pages.
  const businessName = businessNameFrom(fullName);
  const firstName = firstNameFrom(fullName);
  const city = cityFromBio(bio);

  // 1. Where the site comes from, in priority order. What Matthew typed always wins.
  const typed = (body.websiteOverride ?? "").trim();
  let website: string | null = null;
  let websiteNote = "";
  if (typed) {
    website = unwrapInstagramLink(typed);
    websiteNote = website ? "Website typed in the panel." : "";
    if (!website) {
      return jsonCors(req, { ok: false, error: `That does not look like a URL: ${typed}`, field: "websiteOverride" }, 400);
    }
  } else if (!body.noWebsite) {
    const resolved = await resolveBioLink(body.externalUrl);
    website = resolved.website;
    websiteNote = resolved.note;
  } else {
    websiteNote = "Marked as having no website of their own.";
  }

  // 2. The lead is created either way. Matthew asked for one press, and a profile worth scanning is
  //    a profile worth having in the CRM even when the scan cannot run yet.
  const contactId = await upsertContact({
    handle,
    businessName,
    firstName,
    website,
    city,
    email: (body.businessEmail ?? "").trim() || null,
    phone: (body.businessPhone ?? "").trim() || null,
    category: (body.category ?? "").trim() || null,
  });

  // 3. No site and he has not yet said there is none: ask, and spend nothing.
  if (!website && !body.noWebsite) {
    return jsonCors(req, {
      ok: true,
      needsWebsite: true,
      contactId,
      leadUrl: leadUrl(contactId),
      handle,
      businessName,
      note: websiteNote,
    });
  }

  // 4. Claim guard. A run is a crawl, a classify, four engine calls and a model call, and a
  //    double-click must not spend it twice. Same intent as HOOK_CLAIM_MINUTES on the CRM button.
  const since = new Date(Date.now() - IG_CLAIM_MINUTES * 60_000).toISOString();
  const { data: inFlight } = await supabaseAdmin
    .from("ig_dm_runs")
    .select("id, status")
    .eq("handle", handle)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (inFlight?.id) {
    // Not an error for the panel: it just attaches to the run already going.
    return jsonCors(req, {
      ok: true,
      runId: inFlight.id as string,
      contactId,
      leadUrl: leadUrl(contactId),
      handle,
      website,
      reused: true,
      note: `A run for this profile started less than ${IG_CLAIM_MINUTES} minutes ago. Showing that one.`,
    });
  }

  const { data: run, error } = await supabaseAdmin
    .from("ig_dm_runs")
    .insert({
      tenant_id: tenant.tenantId,
      contact_id: contactId,
      handle,
      website,
      status: "running",
    })
    .select("id")
    .single();

  if (error || !run?.id) {
    return jsonCors(req, { ok: false, error: `Could not start the run: ${error?.message ?? "no row"}` }, 500);
  }

  startDmRun({
    runId: run.id as string,
    contactId,
    handle,
    website,
    businessName,
    firstName,
    city,
    instructions: body.instructions ?? null,
  });

  return jsonCors(
    req,
    {
      ok: true,
      runId: run.id as string,
      contactId,
      leadUrl: leadUrl(contactId),
      profileUrl: profileUrl(handle),
      handle,
      website,
      businessName,
      firstName,
      city,
      note: websiteNote,
    },
    202
  );
}

/**
 * Create or update the CRM lead for this profile.
 *
 * Deduped on `instagram_handle`, which is the only identifier a profile reliably has: many med
 * spas publish no email and a shared front-desk number, so phone and email are not keys here.
 *
 * ‼️ ONLY FILLS BLANKS. `upsert` would overwrite a hand-corrected business name or a website
 * Matthew fixed in the CRM with whatever the bio says today, and a scrape is a weaker source than
 * a person. So an existing row is patched field by field, and only where it is empty.
 */
async function upsertContact(input: {
  handle: string;
  businessName: string;
  firstName: string | null;
  website: string | null;
  city: string | null;
  email: string | null;
  phone: string | null;
  category: string | null;
}): Promise<string | null> {
  const { data: existing } = await supabaseAdmin
    .from("contacts")
    .select("id, first_name, business_name, website, email, phone, biz_city, biz_state")
    .eq("instagram_handle", input.handle)
    .maybeSingle();

  const [cityPart, statePart] = (input.city ?? "").split(",").map((s) => s.trim());
  const phone = input.phone ? normalizeLeadPhone(input.phone) : "";

  if (existing?.id) {
    const patch: Record<string, unknown> = {};
    if (!existing.first_name && input.firstName) patch.first_name = input.firstName;
    if (!existing.business_name && input.businessName) patch.business_name = input.businessName;
    if (!existing.website && input.website) patch.website = input.website;
    if (!existing.email && input.email) patch.email = input.email;
    if (!existing.phone && phone) patch.phone = phone;
    if (!existing.biz_city && cityPart) patch.biz_city = cityPart;
    if (!existing.biz_state && statePart) patch.biz_state = statePart;

    if (Object.keys(patch).length > 0) {
      await supabaseAdmin.from("contacts").update(patch).eq("id", existing.id);
    }
    return existing.id as string;
  }

  const { data, error } = await supabaseAdmin
    .from("contacts")
    .insert({
      // first_name is required by the CRM's own create route. The handle is the honest fallback
      // here, unlike for the business name: it is what this lead is actually called on Instagram,
      // and it never reaches a prospect, because the DM greeting uses firstName or no greeting.
      first_name: input.firstName || input.handle,
      business_name: input.businessName || null,
      website: input.website,
      email: input.email,
      phone: phone || null,
      biz_city: cityPart || null,
      biz_state: statePart || null,
      instagram_handle: input.handle,
      source: "Instagram",
    })
    .select("id")
    .single();

  if (error) {
    // The unique index can reject a concurrent insert for the same handle. That is the index doing
    // its job, not a failure: re-read and use the row that won. Returning null here would run the
    // scan with no lead attached and drop the timeline note.
    const { data: raced } = await supabaseAdmin
      .from("contacts")
      .select("id")
      .eq("instagram_handle", input.handle)
      .maybeSingle();
    if (raced?.id) return raced.id as string;

    console.error("[ig/prospect] contact insert failed:", error.message);
    return null;
  }
  return (data?.id as string) ?? null;
}
